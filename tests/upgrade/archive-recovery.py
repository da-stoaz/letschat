"""Real 1.2.5 -> candidate upgrade; Docker images :archive-recovery must be built first.
Run: python3 tests/upgrade/archive-recovery.py
Only creates/removes its randomly named Compose project. Never uses dev/prod volumes.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "archive-upgrade-" + secrets.token_hex(4)


def run(*args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs).stdout.strip()


def wait(check, description, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, HTTPError, subprocess.CalledProcessError) as error:
            last = type(error).__name__
        time.sleep(0.5)
    raise AssertionError(f"Timed out: {description} ({last})")


def http(url, body=None, token=None):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if isinstance(body, (list, dict)):
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    elif isinstance(body, str):
        body = body.encode()
    try:
        response = urlopen(Request(url, data=body, headers=headers), timeout=10)
    except HTTPError as error:
        response = error
    with response:
        return response.status, response.read().decode()


def corrupt(token):
    parts = token.split(".")
    parts[2] = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    return ".".join(parts)


with tempfile.TemporaryDirectory(prefix=PROJECT) as temporary:
    folder = Path(temporary)
    for file in ("docker-compose.prod.base.yml", "spacetimedb/config.prod.toml", "livekit/config.prod.yaml"):
        destination = folder / file
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / file, destination)
    password = secrets.token_hex(32)
    settings = dict(LETSCHAT_VERSION="1.2.5", PUBLIC_SCHEME="http", ASPNETCORE_ENVIRONMENT="Staging",
                    EMAIL_SENDER="log", ADMIN_BOOTSTRAP_USERNAME="admin", ADMIN_BOOTSTRAP_EMAIL="admin@test.local",
                    AUTH_DOMAIN="localhost:8787", CHAT_DOMAIN="localhost:44300", FILES_DOMAIN="localhost:44390",
                    LIVEKIT_DOMAIN="localhost:44380", APP_DOMAIN="localhost:44310", LIVEKIT_API_KEY="test-key",
                    EMAIL_FROM_ADDRESS="test@test.local", SMTP_HOST="", ADMIN_BOOTSTRAP_PASSWORD=password)
    for key in ("AUTH_JWT_SECRET", "POSTGRES_PASSWORD", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "LIVEKIT_API_SECRET"):
        settings[key] = secrets.token_hex(32)
    env = dict(os.environ)
    env.update(settings)
    config = json.loads(run("docker", "compose", "--env-file", "/dev/null", "-p", PROJECT,
                            "-f", str(folder / "docker-compose.prod.base.yml"), "config", "--format", "json", env=env))
    for name, service in config["services"].items():
        service["container_name"] = PROJECT + "-" + name
        service.pop("ports", None)
    for name, port in (("core-api", 8787), ("spacetimedb", 3000)):
        config["services"][name]["ports"] = [{"target": port, "published": "0", "host_ip": "127.0.0.1"}]
    config_file = folder / "compose.json"
    config_file.write_text(json.dumps(config))

    def compose(*args):
        return run("docker", "compose", "-p", PROJECT, "-f", str(config_file), *args)

    def container(service):
        return PROJECT + "-" + service

    def pg(query):
        return run("docker", "exec", container("postgres"), "psql", "-U", "letschat", "-d", "archive", "-Atc", query)

    def worker_token():
        return run("docker", "exec", container("core-api"), "cat", "/archive-worker/archive-worker.token")

    def replace_worker_token(token):
        path = folder / "replacement.token"
        path.write_text(token)
        path.chmod(0o600)
        run("docker", "cp", str(path), container("archive-worker") + ":/data/archive-worker.token")

    try:
        compose("up", "-d", "core-api", "module-init", "archive-worker", "minio-init")
        auth = "http://" + compose("port", "core-api", "8787")
        database = "http://" + compose("port", "spacetimedb", "3000")
        wait(lambda: http(auth + "/health")[0] == 200, "old core-api health")
        wait(lambda: pg("SELECT count(*) FROM archive_user") == "1", "old worker registered and copying")
        owner_config = run("docker", "exec", container("core-api"), "cat", "/module-init/.config/spacetime/cli.toml")
        owner_token = next(line.split("=", 1)[1].strip().strip('"') for line in owner_config.splitlines()
                           if line.startswith("spacetimedb_token ="))

        def call(reducer, args, token=owner_token):
            status, body = http(database + "/v1/database/letschat/call/" + reducer, args, token)
            assert status == 200, (reducer, status, body)

        def sql(query):
            status, body = http(database + "/v1/database/letschat/sql", query, owner_token)
            assert status == 200, (query, status, body)
            return json.loads(body)[0]["rows"]

        status, body = http(auth + "/auth/login", {"username": "admin", "password": password})
        assert status == 200, "baseline login"
        account = json.loads(body)
        call("register_user", ["admin", "Upgrade test"], account["spacetimeToken"])
        call("create_server", ["Upgrade test"], account["spacetimeToken"])
        server_id = sql("SELECT id FROM server")[0][0]
        call("create_channel", [server_id, "test", {"text": []}, {"none": []}, False], account["spacetimeToken"])
        channel_id = sql("SELECT id FROM channel WHERE name = 'test'")[0][0]
        call("send_message", [channel_id, "before upgrade"], account["spacetimeToken"])
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE content = 'before upgrade'") == "1", "baseline archive message")
        print("PASS baseline 1.2.5: login, chat and archive replication", flush=True)

        compose("stop", "archive-worker")
        previous_token = worker_token()
        broken_token = corrupt(previous_token)
        replace_worker_token(broken_token)
        status, body = http(database + "/v1/identity/websocket-token", "", broken_token)
        assert status == 401 and "InvalidSignature" in body
        compose("start", "archive-worker")
        wait(lambda: "401" in run("docker", "logs", container("archive-worker")), "released worker 401 failure")
        compose("stop", "archive-worker")
        assert worker_token() == broken_token
        print("PASS reproduced persistent InvalidSignature on released worker with existing messages", flush=True)

        for service in ("core-api", "archive-worker", "module-init"):
            image = "module" if service == "module-init" else service
            config["services"][service]["image"] = f"ghcr.io/da-stoaz/letschat-{image}:archive-recovery"
        config_file.write_text(json.dumps(config))
        compose("up", "-d", "core-api", "module-init", "archive-worker", "minio-init")
        auth = "http://" + compose("port", "core-api", "8787")
        wait(lambda: http(auth + "/health")[0] == 200, "candidate core-api health")
        wait(lambda: worker_token() != broken_token, "automatic managed token recovery")
        wait(lambda: "Subscription applied" in run("docker", "logs", container("archive-worker")), "automatic registration and subscription")
        assert sql("SELECT content FROM message")[0][0] == "before upgrade"
        status, body = http(auth + "/auth/login", {"username": "admin", "password": password})
        assert status == 200
        account = json.loads(body)
        call("send_message", [channel_id, "after upgrade"], account["spacetimeToken"])
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE content = 'after upgrade'") == "1", "new messages replicated after upgrade")
        print("PASS upgrade: automatic recovery, existing chat retained, new messages archived", flush=True)

        core_started = run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("core-api"))
        compose("stop", "archive-worker")
        replacement_broken = corrupt(worker_token())
        replace_worker_token(replacement_broken)
        compose("start", "archive-worker")
        wait(lambda: worker_token() != replacement_broken, "second recovery without core-api restart")
        call("send_message", [channel_id, "after second recovery"], account["spacetimeToken"])
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE content = 'after second recovery'") == "1", "re-registration while core-api stays up")
        assert core_started == run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("core-api"))
        print("PASS replacement identity registered without core-api restart", flush=True)

        stable = worker_token()
        compose("up", "-d", "--no-deps", "--force-recreate", "spacetimedb")
        database = "http://" + compose("port", "spacetimedb", "3000")
        wait(lambda: http(database + "/v1/identity/websocket-token", "", stable)[0] == 200, "signing key survives server recreation")
        call("send_message", [channel_id, "after database restart"], account["spacetimeToken"])
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE content = 'after database restart'") == "1", "replication resumes after server recreation")
        assert worker_token() == stable
        print("PASS server recreation preserves token validity and ongoing replication", flush=True)
        # Exercise the real ten-minute restore quiet period and the running
        # core-api sweeper. No SQL fence edits or service restarts may release it.
        worker_started = run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("archive-worker"))
        core_started = run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("core-api"))
        call("archive_restore_message", [[]], stable)
        pg("INSERT INTO archive_message SELECT 999999, channel_id, sender_identity, 'preserve during restore', sent_at, edited_at, deleted FROM archive_message LIMIT 1")
        call("send_message", [channel_id, "during restore"], account["spacetimeToken"])
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE content = 'during restore'") == "1", "replication while restore fenced")
        assert pg("SELECT count(*) FROM archive_message WHERE id = 999999") == "1"
        status, body = http(database + "/v1/database/letschat/call/rebuild_storage_references", [], owner_token)
        assert status != 200 and "archive restore in progress" in body
        print("Waiting for the real restore quiet period and automatic cleanup (up to 12 minutes)…", flush=True)
        wait(lambda: pg("SELECT count(*) FROM archive_message WHERE id = 999999") == "0", "automatic reconciliation after restore completion", timeout=720)
        assert len(sql("SELECT id FROM storage_restore_fence")) == 1, "restore fence must remain intact"
        assert worker_started == run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("archive-worker"))
        assert core_started == run("docker", "inspect", "--format", "{{.State.StartedAt}}", container("core-api"))
        assert pg("SELECT count(*) FROM archive_message WHERE content = 'during restore'") == "1"
        print("PASS restore protection and automatic reconciliation with the fence retained and both services continuously running", flush=True)
    finally:
        # Explicit project + generated file: never addresses any pre-existing stack.
        compose("down", "--volumes", "--remove-orphans")
