"""Disposable real-backend smoke test. Never connects to existing dev/prod stacks.
Candidate images must be built first; see README.md. Optional backend source/images
and client source permit testing published releases without modifying this checkout.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import time
from urllib.request import urlopen
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--backend-source', type=Path, default=ROOT)
parser.add_argument('--client-source', type=Path, default=ROOT)
parser.add_argument('--core-image', default='letschat-compat-core:candidate')
parser.add_argument('--module-image', default='letschat-compat-module:candidate')
parser.add_argument('--session-file', type=Path, help='Keep the disposable stack alive for UI tests until this private file is removed')
args = parser.parse_args()
if args.session_file and args.session_file.exists():
    raise RuntimeError('Refusing to overwrite an existing session file')
project = 'letschat-compat-' + secrets.token_hex(5)


def run(*command, **kwargs):
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode:
        # Compose output can contain generated secrets. Keep failures concise.
        raise RuntimeError(f'{command[0]} {command[1]} failed (exit {result.returncode})')
    return result.stdout.strip()


with tempfile.TemporaryDirectory(prefix=project) as temporary:
    folder = Path(temporary)
    for name in ('docker-compose.prod.base.yml', 'spacetimedb/config.prod.toml', 'livekit/config.prod.yaml'):
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(args.backend_source / name, target)
    password = secrets.token_hex(32)
    # Explicitly neutralise deployment variables; never load the repository .env.
    env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'TMPDIR')}
    env.update(LETSCHAT_VERSION='compatibility', PUBLIC_SCHEME='http', ASPNETCORE_ENVIRONMENT='Staging',
               AUTH_DOMAIN='127.0.0.1', CHAT_DOMAIN='127.0.0.1', LIVEKIT_DOMAIN='127.0.0.1',
               FILES_DOMAIN='127.0.0.1', APP_DOMAIN='', EMAIL_FROM_ADDRESS='compat@test.local',
               EMAIL_SENDER='log', SMTP_HOST='', ADMIN_BOOTSTRAP_USERNAME='admin',
               ADMIN_BOOTSTRAP_PASSWORD=password, ADMIN_BOOTSTRAP_EMAIL='admin@test.local',
               REQUIRE_EMAIL_CONFIRMATION='false', REQUIRE_ADMIN_APPROVAL='false', LIVEKIT_API_KEY='compat-key')
    for key in ('AUTH_JWT_SECRET', 'POSTGRES_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY', 'LIVEKIT_API_SECRET'):
        env[key] = secrets.token_hex(32)
    config = json.loads(run('docker', 'compose', '--env-file', '/dev/null', '-p', project,
                            '-f', str(folder / 'docker-compose.prod.base.yml'), 'config', '--format', 'json', env=env))
    for name, service in config['services'].items():
        service['container_name'] = project + '-' + name
        service.pop('ports', None)
        # All mounts must be new project volumes or copied fixture config files.
        for volume in service.get('volumes', []):
            if volume['type'] == 'bind':
                assert Path(volume['source']).is_relative_to(folder)
    for name, volume in config.get('volumes', {}).items():
        assert not volume.get('external')
        volume['name'] = project + '-' + name
    for name, network in config.get('networks', {}).items():
        assert not network.get('external')
        network['name'] = project + '-' + name
    config['services']['core-api']['image'] = args.core_image
    config['services']['module-init']['image'] = args.module_image
    for name, port in (('core-api', 8787), ('spacetimedb', 3000)):
        config['services'][name]['ports'] = [{'target': port, 'published': '0', 'host_ip': '127.0.0.1'}]
    config_file = folder / 'compose.json'
    config_file.write_text(json.dumps(config))

    def compose(*command):
        return run('docker', 'compose', '-p', project, '-f', str(config_file), *command, env=env)

    session_created = False
    try:
        compose('up', '-d', 'core-api', 'module-init', 'minio-init')
        auth = 'http://' + compose('port', 'core-api', '8787')
        database = 'http://' + compose('port', 'spacetimedb', '3000')
        if args.session_file:
            # Real app discovery needs the published loopback ports, not Docker DNS.
            config['services']['core-api']['ports'][0]['published'] = str(urlsplit(auth).port)
            config['services']['spacetimedb']['ports'][0]['published'] = str(urlsplit(database).port)
            config['services']['core-api']['environment'].update(
                DISCOVERY_AUTH_URL=auth, DISCOVERY_SPACETIMEDB_URI=database,
                DISCOVERY_LIVEKIT_URL='http://127.0.0.1:7880')
            config_file.write_text(json.dumps(config))
            compose('up', '-d', '--no-deps', 'spacetimedb', 'core-api')
        deadline = time.monotonic() + 120
        while True:
            try:
                with urlopen(auth + '/health', timeout=2) as response:
                    if response.status == 200:
                        # core-api pins the module issuer during first login; module publish must finish.
                        state = json.loads(run('docker', 'inspect', project + '-module-init'))[0]['State']
                        if state['Status'] == 'exited' and state['ExitCode'] == 0:
                            break
            except (OSError, RuntimeError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Disposable backend did not become ready')
            time.sleep(1)
        client_env = dict(env, COMPAT_AUTH_URL=auth, COMPAT_DATABASE_URL=database,
                          COMPAT_PASSWORD=password, COMPAT_CLIENT_SOURCE=str(args.client_source.resolve()))
        # Visible output contains assertions and PASS only, never authentication responses.
        subprocess.run(['bun', '--no-env-file', str(ROOT / 'tests/compatibility/smoke.ts')],
                       cwd=folder, env=client_env, check=True, timeout=120)
        if args.session_file:
            with args.session_file.open('x') as session:
                session_created = True
                os.chmod(args.session_file, 0o600)
                json.dump({'auth': auth, 'database': database, 'username': 'admin',
                           'password': password, 'project': project, 'compose': str(config_file)}, session)
            print('Disposable UI backend ready; remove the private session file to stop and clean up.', flush=True)
            while args.session_file.exists():
                time.sleep(1)
    finally:
        if session_created:
            args.session_file.unlink(missing_ok=True)
        compose('down', '-v', '--remove-orphans')
