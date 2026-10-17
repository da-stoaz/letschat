"""Gate releases against the candidate and the oldest/latest published protocol family.
Uses GitHub Releases only to select TEST baselines, never as a client update feed.
Requires a full git checkout including tags and locally built candidate images.
"""
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
policy = (ROOT / 'core-api/src/CoreApi/Services/VersionInfo.cs').read_text()
protocol = int(re.search(r'ClientProtocol = (\d+)', policy)[1])
first = re.search(r'FirstCompatibleClient = "([^"]+)"', policy)[1]
current = json.loads((ROOT / 'package.json').read_text())['version']


def smoke(**options):
    command = ['python3', str(ROOT / 'tests/compatibility/run.py')]
    for key, value in options.items():
        command.extend(['--' + key.replace('_', '-'), str(value)])
    subprocess.run(command, check=True, cwd=ROOT)


smoke()
if current == first:
    print(f'Protocol {protocol} begins with {first}; candidate/candidate establishes the baseline.', flush=True)
    raise SystemExit(0)

headers = {'Accept': 'application/vnd.github+json'}
if os.environ.get('GITHUB_TOKEN'):
    headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
releases = []
page = 1
while True:
    request = Request(f'https://api.github.com/repos/da-stoaz/letschat/releases?per_page=100&page={page}', headers=headers)
    with urlopen(request, timeout=30) as response:
        batch = json.load(response)
    releases.extend(batch)
    if len(batch) < 100:
        break
    page += 1

matching = []
for release in releases:
    tag = release['tag_name']
    if release['draft'] or release['prerelease'] or not re.fullmatch(r'v\d+\.\d+\.\d+', tag):
        continue
    if tuple(map(int, tag[1:].split('.'))) >= tuple(map(int, current.split('.'))):
        continue
    source = subprocess.run(['git', 'show', f'{tag}:core-api/src/CoreApi/Services/VersionInfo.cs'],
                            cwd=ROOT, text=True, capture_output=True)
    if source.returncode:
        raise RuntimeError(f'Missing source for published {tag}; fetch tags before running the matrix')
    declared = re.search(r'ClientProtocol = (\d+)', source.stdout)
    if declared and int(declared[1]) == protocol:
        matching.append(tag)
matching.sort(key=lambda tag: tuple(map(int, tag[1:].split('.'))))
assert matching and matching[0] == 'v' + first, f'Published protocol-{protocol} baseline v{first} is required'

with tempfile.TemporaryDirectory(prefix='letschat-compat-sources-') as temporary:
    for tag in dict.fromkeys([matching[0], matching[-1]]):
        source = Path(temporary) / tag
        source.mkdir()
        archive = subprocess.check_output(['git', 'archive', tag], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            files.extractall(source, filter='data')
        subprocess.run(['bun', 'install', '--frozen-lockfile'], cwd=source, check=True)
        version = tag[1:]
        print(f'Candidate client → backend {version}', flush=True)
        smoke(backend_source=source, core_image=f'ghcr.io/da-stoaz/letschat-core-api:{version}',
              module_image=f'ghcr.io/da-stoaz/letschat-module:{version}')
        print(f'Client {version} → candidate backend', flush=True)
        smoke(client_source=source)
