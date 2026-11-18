"""Build desktop bundles and stage an exact, platform-specific artifact set."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def run(*command):
    subprocess.run(command, check=True, cwd=ROOT/'desktop')


def one(folder, pattern):
    files = list(folder.glob(pattern))
    if len(files) != 1:
        raise ValueError(f'Expected one {pattern} artifact in {folder.name}, found {len(files)}')
    return files[0]


def require(*variables):
    if missing := [variable for variable in variables if not os.environ.get(variable)]:
        raise ValueError('Missing desktop release configuration: '+', '.join(missing))


def main(target, tag, version, channel):
    signed = channel != 'preview'
    server = os.environ.get('REMOTESHIELD_SERVER', '') if signed else 'https://desktop-ci.example.invalid'
    origin = urlsplit(server)
    if origin.scheme != 'https' or not origin.hostname or origin.path not in ('', '/') or origin.query or origin.fragment or origin.username or origin.password:
        raise ValueError('Desktop release requires a configured HTTPS origin')
    os.environ.update(REMOTESHIELD_SERVER=server.rstrip('/'), VITE_SERVER_URL=server.rstrip('/'))
    bundle = {'targets': {'windows-x64':['msi','nsis'], 'linux-x64':['deb','appimage'], 'macos-universal':['dmg']}[target]}
    if signed and target == 'windows-x64':
        require('WINDOWS_SIGNING_THUMBPRINT')
        bundle['windows']={'certificateThumbprint':os.environ['WINDOWS_SIGNING_THUMBPRINT'], 'digestAlgorithm':'sha256',
                           'timestampUrl':'https://timestamp.digicert.com', 'tsp':True}
    if signed and target == 'macos-universal':
        require('APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_SIGNING_IDENTITY','APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID')
    configuration=Path(os.environ['RUNNER_TEMP'])/'rsx-tauri-release.json'
    configuration.write_text(json.dumps({'version':version,'bundle':bundle}),encoding='utf8')
    args=['--target','universal-apple-darwin'] if target=='macos-universal' else []
    run('node', 'node_modules/@tauri-apps/cli/tauri.js', 'build', '--ci', '--config', str(configuration), *args, '--', '--locked')
    build=ROOT/'desktop/src-tauri/target'
    if args:
        build/=args[-1]
    build/='release'
    output=ROOT/'release-payload'
    output.mkdir()
    prefix=f'RemoteShield-{tag}-{target}'
    patterns={'windows-x64':[('msi/*.msi','.msi'),('nsis/*-setup.exe','-setup.exe')],
              'linux-x64':[('deb/*.deb','.deb'),('appimage/*.AppImage','.AppImage')],
              'macos-universal':[('dmg/*.dmg','.dmg')]}[target]
    for pattern, suffix in patterns:
        shutil.copyfile(one(build/'bundle',pattern),output/(prefix+suffix))
    if target=='linux-x64':
        with tarfile.open(output/(prefix+'.tar.gz'),'w:gz') as archive:
            archive.add(build/'remoteshield-x',arcname='remoteshield-x')
            archive.add(output/(prefix+'.AppImage'),arcname='RemoteShield.AppImage')
    if signed and target=='windows-x64':
        for file in output.iterdir():
            run('pwsh','-NoProfile','-File',str(ROOT/'scripts/release/windows-sign.ps1'),'verify',str(file))
    if signed and target=='macos-universal':
        app=one(build/'bundle','macos/*.app')
        run('codesign','--verify','--deep','--strict',str(app))
        run('xcrun','stapler','validate',str(app))


if __name__=='__main__':
    try:
        main(*sys.argv[1:])
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
