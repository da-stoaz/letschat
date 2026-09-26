"""Native Compose/Caddy check: python3 deploy/caddy/test_config.py (Docker required)."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import uuid

ROOT = Path(__file__).resolve().parents[2]
UPSTREAMS = {
    "DISCOVERY_AUTH_URL": "core-api:8787",
    "DISCOVERY_SPACETIMEDB_URI": "spacetimedb:3000",
    "MINIO_PUBLIC_ENDPOINT": "minio:44390",
    "DISCOVERY_LIVEKIT_URL": "livekit:44380",
    "DISCOVERY_WEB_URL": "web:80",
}
DOMAINS = ("AUTH_DOMAIN", "CHAT_DOMAIN", "FILES_DOMAIN", "LIVEKIT_DOMAIN", "APP_DOMAIN")


def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def compose(track="caddy", **overrides):
    env = {key: value for key, value in os.environ.items()
           if key not in (*DOMAINS, *UPSTREAMS, "PUBLIC_SCHEME", "VITE_WEB_CONNECT_URL")}
    env.update(overrides)
    return run(["docker", "compose", "--env-file", str(ROOT / f".env.production.{track}.example"),
                "-f", str(ROOT / "docker-compose.prod.base.yml"),
                "-f", str(ROOT / f"docker-compose.prod.{track}.yml"), "config", "--format", "json"], env=env)


def container_args(folder, env):
    args = ["docker", "run", "--rm", "--pull", "never", "--network", "none",
            "-v", f"{ROOT}/deploy/{folder}/Caddyfile:/etc/caddy/Caddyfile:ro"]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    return args


def objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from objects(child)


def check_routes(services, port):
    result = run(container_args("caddy", services["caddy"]["environment"])
                 + ["caddy:2", "caddy", "adapt", "--config", "/etc/caddy/Caddyfile"])
    assert result.returncode == 0, result.stderr
    servers = json.loads(result.stdout)["apps"]["http"]["servers"].values()
    routes = {}
    for server in servers:
        assert server["listen"] == [f":{port}"], server
        for route in server["routes"]:
            hosts = route["match"][0]["host"]  # No catch-all, even without APP_DOMAIN.
            assert len(hosts) == 1
            routes[hosts[0]] = route
    urls = services["core-api"]["environment"]
    expected = {urlsplit(urls[key]).hostname: [target] for key, target in UPSTREAMS.items() if urls[key]}
    actual = {host: [upstream["dial"] for obj in objects(route)
                     if obj.get("handler") == "reverse_proxy" for upstream in obj["upstreams"]]
              for host, route in routes.items()}
    assert actual == expected, actual


def check_web(env):
    name = f"letschat-web-config-test-{uuid.uuid4().hex[:10]}"
    with tempfile.TemporaryDirectory(prefix="letschat-config-test-") as td:
        # Template-looking asset content must remain literal outside /config.js.
        html = '<html>{{env "DISCOVERY_AUTH_URL"}}</html>'
        Path(td, "index.html").write_text(html)
        args = container_args("web", env) + ["-d", "--name", name, "--tmpfs", "/data",
                "--tmpfs", "/config", "-v", f"{td}:/srv:ro", "caddy:2"]
        try:
            started = run(args)
            assert started.returncode == 0, started.stderr
            for _ in range(30):
                response = run(["docker", "exec", name, "wget", "-SO-", "http://127.0.0.1/config.js"])
                if response.returncode == 0:
                    break
                time.sleep(0.1)
            assert response.returncode == 0, run(["docker", "logs", name]).stderr
            config = json.loads(response.stdout.split(" = ", 1)[1].strip().removesuffix(";"))
            assert config == {"webConnectUrl": env["DISCOVERY_AUTH_URL"],
                              "wsCompression": env["VITE_WEB_WS_COMPRESSION"]}, config
            assert "Content-Type: application/javascript" in response.stderr
            assert "Cache-Control: no-cache" in response.stderr
            csp = next(line for line in response.stderr.splitlines() if "Content-Security-Policy:" in line)
            for key in UPSTREAMS.keys() - {"DISCOVERY_WEB_URL"}:
                assert env[key] in csp, csp
            for key in ("DISCOVERY_SPACETIMEDB_URI", "DISCOVERY_LIVEKIT_URL"):
                assert env[key].replace("http", "ws", 1) in csp, csp
            fallback = run(["docker", "exec", name, "wget", "-qO-", "http://127.0.0.1/app/example"])
            assert fallback.returncode == 0 and fallback.stdout == html, fallback
        finally:
            run(["docker", "rm", "-f", name])


def check_isolation(services, track):
    proxy = services["caddy" if track == "caddy" else "cloudflared"]
    assert set(proxy["networks"]) == {"proxy", "chat"}
    assert set(services["spacetimedb"]["networks"]) == {"default"}
    assert services["chat-edge"]["networks"]["chat"]["aliases"] == ["spacetimedb"]
    for service in ("core-api", "archive-worker", "module-init"):
        assert "default" in services[service]["networks"]
        assert "chat" not in services[service]["networks"]
    for service, port in (("spacetimedb", "44302"), ("chat-edge", "44300")):
        assert services[service]["ports"][0]["host_ip"] == "127.0.0.1"
        assert services[service]["ports"][0]["published"] == port
    mounts = {m["target"]: m for m in services["core-api"]["volumes"]}
    assert mounts["/module-init"]["read_only"] and mounts["/archive-worker"]["read_only"]
    assert mounts["/data"]["source"].endswith("core_api_data")


def check_edge(config):
    """Exercise the shipped allowlist against an upstream accepting EVERYTHING."""
    name = f"letschat-edge-test-{uuid.uuid4().hex[:10]}"
    image = config["services"]["chat-edge"]["image"]
    with tempfile.TemporaryDirectory(prefix="letschat-edge-test-") as td:
        Path(td, "edge").write_text(config["configs"]["chat-edge"]["content"])
        Path(td, "upstream").write_text(":3000 {\n respond upstream 200\n}\n")
        try:
            created = run(["docker", "network", "create", name])
            assert created.returncode == 0, created.stderr
            # Pin from production, not whichever floating Caddy version is cached.
            pulled = run(["docker", "image", "inspect", image])
            if pulled.returncode:
                pulled = run(["docker", "pull", image])
                assert pulled.returncode == 0, pulled.stderr
            for suffix, extra in [("upstream", ["--network-alias", "spacetimedb-internal"]),
                                  ("edge", ["-p", "127.0.0.1::3000"])]:
                started = run(["docker", "run", "-d", "--name", f"{name}-{suffix}",
                               "--network", name, "-v", f"{td}/{suffix}:/etc/caddy/Caddyfile:ro",
                               *extra, image])
                assert started.returncode == 0, started.stderr
            port = run(["docker", "port", f"{name}-edge", "3000"]).stdout.strip()
            for _ in range(40):
                ready = run(["docker", "exec", f"{name}-edge", "wget", "-qO-",
                             "http://127.0.0.1:3000/v1/database/letschat/subscribe"])
                if ready.returncode == 0:
                    break
                time.sleep(0.1)
            assert ready.stdout == "upstream", ready
            cases = [("POST", "/v1/identity/websocket-token", 200),
                     ("GET", "/v1/database/letschat/subscribe?compression=Gzip", 200),
                     ("OPTIONS", "/v1/identity/websocket-token", 204)]
            denied = ["/", "/v1/identity", "/v1/database/strangerprobe",
                      "/v1/database/letschat", "/v1/database/letschat/sql",
                      "/v1/database/letschat/call/register_user",
                      "/v1/database/other/subscribe",
                      "/v1/database/letschat/subscribe/../sql",
                      "/v1/database/letschat%2f..%2fother/subscribe",
                      "/v1/identity/websocket-token/../", "/v1/identity/websocket-token/extra"]
            cases += [(method, path, 404) for method in ("GET", "POST", "PUT", "DELETE", "OPTIONS")
                      for path in denied]
            cases += [(method, "/v1/identity/websocket-token", 404) for method in ("GET", "PUT", "DELETE")]
            cases += [(method, "/v1/database/letschat/subscribe", 404) for method in ("POST", "PUT", "DELETE", "OPTIONS")]
            for method, path, expected in cases:
                request = Request(f"http://{port}{path}", method=method,
                                  headers={"Origin": "https://app.example.com",
                                           "Access-Control-Request-Headers": "authorization"})
                try:
                    response = urlopen(request, timeout=5)
                except HTTPError as error:
                    response = error
                with response:
                    assert response.status == expected, (method, path, response.status)
                    if expected == 200:
                        assert response.read() == b"upstream"
                    if expected == 204:
                        assert response.headers["Access-Control-Allow-Origin"] == "*"
                        assert response.headers["Access-Control-Allow-Headers"] == "Authorization"
                        assert response.headers["Access-Control-Allow-Methods"] == "POST"
        finally:
            run(["docker", "rm", "-f", f"{name}-edge", f"{name}-upstream"])
            run(["docker", "network", "rm", name])


if __name__ == "__main__":
    for track, overrides in [("caddy", {}), ("tunnel", {}), ("caddy", {"APP_DOMAIN": ""}),
                             ("caddy", {"AUTH_DOMAIN": "new-auth.example.com", "PUBLIC_SCHEME": "http",
                                        "DISCOVERY_AUTH_URL": "https://ignored.example.com"})]:
        result = compose(track, **overrides)
        assert result.returncode == 0, result.stderr
        config = json.loads(result.stdout)
        services = config["services"]
        check_isolation(services, track)
        if track == "caddy" and not overrides:
            check_edge(config)
        for key in UPSTREAMS:
            assert services["core-api"]["environment"][key] == services["web"]["environment"][key]
        assert "VITE_WEB_CONNECT_URL" not in services["web"]["environment"]
        if track == "caddy":
            assert services["caddy"].get("entrypoint") is None
            assert len(services["caddy"]["volumes"]) == 3
            check_routes(services, 80 if overrides.get("PUBLIC_SCHEME") == "http" else 443)
        if not overrides or overrides.get("PUBLIC_SCHEME") == "http":
            check_web(services["web"]["environment"])
    for domain in DOMAINS[:-1]:
        result = compose(**{domain: ""})
        assert result.returncode != 0 and domain in result.stderr, result
    assert not list((ROOT / "deploy").rglob("*.sh"))
    print("PASS: one hostname per service, both tracks, HTTP/HTTPS, optional web, isolated API allowlist and CORS, native config.js, CSP, SPA fallback; no shell scripts")
