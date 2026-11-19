"""Writes the desktop updater feed (latest.json) of one GitHub release.

The platform builds run in parallel and only upload their installers and .sig
files. When each build also merged itself into latest.json, two builds finishing
together could overwrite each other's entries. This runs once, after all of them,
and fails when a platform is missing, so an incomplete release is not published
unnoticed. Re-running a failed platform build re-runs this step as well.

Usage: GITHUB_TOKEN=... python3 scripts/updater_manifest.py OWNER/REPO RELEASE_ID [--upload]
Without --upload it prints the feed instead of replacing the release's latest.json.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Signature file suffix -> feed keys, named as tauri-action names them. The plain
# os-arch key is the fallback for an app that cannot tell how it was installed.
PLATFORMS = {
    '_universal.app.tar.gz.sig': ['darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app'],
    '_x64_en-US.msi.sig': ['windows-x86_64', 'windows-x86_64-msi'],
    '_x64-setup.exe.sig': ['windows-x86_64-nsis'],
    '_arm64_en-US.msi.sig': ['windows-aarch64', 'windows-aarch64-msi'],
    '_arm64-setup.exe.sig': ['windows-aarch64-nsis'],
    '_amd64.AppImage.sig': ['linux-x86_64', 'linux-x86_64-appimage'],
    '_amd64.deb.sig': ['linux-x86_64-deb'],
    '.x86_64.rpm.sig': ['linux-x86_64-rpm'],
}
API = 'https://api.github.com'


class KeepRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def call(url, method='GET', data=None, headers=None, auth=True):
    headers = {'Accept': 'application/vnd.github+json', **(headers or {})}
    if auth:
        headers['Authorization'] = f'Bearer {os.environ["GITHUB_TOKEN"]}'
    try:
        with urllib.request.build_opener(KeepRedirect).open(urllib.request.Request(url, data, headers, method=method)) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        # Asset downloads redirect to storage that rejects a second credential.
        if error.code in (301, 302, 307):
            return call(error.headers['Location'], auth=False)
        raise


def main():
    repo, release_id = sys.argv[1:3]
    release = json.loads(call(f'{API}/repos/{repo}/releases/{release_id}'))
    assets = {asset['name']: asset for asset in json.loads(call(f'{API}/repos/{repo}/releases/{release_id}/assets?per_page=100'))}
    platforms, missing = {}, []
    for suffix, keys in PLATFORMS.items():
        found = [name for name in assets if name.endswith(suffix) and name[:-4] in assets]
        if len(found) != 1:
            missing.append(f'*{suffix[:-4]} ({len(found)} found)')
            continue
        signature = call(f'{API}/repos/{repo}/releases/assets/{assets[found[0]]["id"]}',
                         headers={'Accept': 'application/octet-stream'}).decode()
        # A draft's own asset URLs are temporary; installed apps fetch by tag.
        url = f'https://github.com/{repo}/releases/download/{release["tag_name"]}/{found[0][:-4]}'
        platforms.update({key: {'signature': signature, 'url': url} for key in keys})

    feed = json.dumps({
        'version': release['tag_name'].removeprefix('v'),
        'notes': release['body'] or '',
        'pub_date': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'platforms': platforms,
    }, indent=2)
    if '--upload' not in sys.argv:
        print(feed)
    elif platforms:
        if 'latest.json' in assets:
            call(f'{API}/repos/{repo}/releases/assets/{assets["latest.json"]["id"]}', 'DELETE')
        call(f'https://uploads.github.com/repos/{repo}/releases/{release_id}/assets?name=latest.json',
             'POST', feed.encode(), {'Content-Type': 'application/json'})
    if missing:
        sys.exit(f'Not in the updater feed of {release["tag_name"]}: {", ".join(missing)}. Re-run the failed platform build.')
    print(f'latest.json for {release["tag_name"]}: {len(platforms)} platform entries', file=sys.stderr)


if __name__ == '__main__':
    main()
