"""Prepare and verify a complete RemoteShield release payload."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

TAG = re.compile(r'v(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]?)\.(0|[1-9][0-9]?)(?:-(preview|rc)\.([1-9][0-9]?))?\Z')
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,180}\Z')
COMMIT = re.compile(r'[0-9a-f]{40}\Z')
IMAGE_HASH = re.compile(r'sha256:[0-9a-f]{64}\Z')


def version(tag):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError('Expected vMAJOR.MINOR.PATCH, -rc.N or -preview.N')
    major, minor, patch, channel, sequence = match.groups()
    build = int(sequence or '99')
    if sequence and build > 98:
        raise ValueError('Candidate sequence must be 1 through 98')
    return {'tag': tag, 'version': f'{major}.{minor}.{patch}', 'channel': channel or 'stable',
            'androidCode': int(major)*1_000_000+int(minor)*10_000+int(patch)*100+build}


def hash_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024*1024), b''):
            digest.update(block)
    return digest.hexdigest()


def expected_files(metadata):
    tag = metadata['tag']
    signed = metadata['channel'] != 'preview'
    components = {
        'windows-x64': [f'RemoteShield-{tag}-windows-x64.msi', f'RemoteShield-{tag}-windows-x64-setup.exe'],
        'linux-x64': [f'RemoteShield-{tag}-linux-x64.deb', f'RemoteShield-{tag}-linux-x64.AppImage', f'RemoteShield-{tag}-linux-x64.tar.gz'],
        'macos-universal': [f'RemoteShield-{tag}-macos-universal.dmg'],
        'android': [f'RemoteShield-{tag}-android-{abi}.apk' for abi in ('armeabi-v7a', 'arm64-v8a', 'x86_64', 'universal')],
        'containers': [f'remoteshield-{service}-{tag}-linux-amd64.tar.gz' for service in ('backend', 'edge')]
                      + ['backend-image.cdx.json', 'edge-image.cdx.json', 'source-lockfiles.cdx.json', 'image-identities.json'],
    }
    if signed:
        components['linux-x64'] += [item+'.asc' for item in components['linux-x64']]
    return {file: target for target, files in components.items() for file in files}


def check_sbom(path):
    sbom = json.loads(path.read_text(encoding='utf8'))
    if sbom.get('bomFormat') != 'CycloneDX' or not sbom.get('components'):
        raise ValueError(f'Empty or invalid CycloneDX inventory: {path.name}')


def inventory(folder, metadata, commit):
    expected = expected_files(metadata)
    payload = [path for path in folder.iterdir() if path.name not in {'release-manifest.json', 'SHA256SUMS.txt'}]
    if {path.name for path in payload} != set(expected):
        missing = sorted(set(expected)-{path.name for path in payload})
        unexpected = sorted({path.name for path in payload}-set(expected))
        raise ValueError(f'Artifact inventory differs. Missing: {missing}. Unexpected: {unexpected}')
    entries = []
    for path in sorted(payload):
        if not NAME.fullmatch(path.name) or path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f'Invalid payload file: {path.name}')
        if path.name.endswith('.cdx.json'):
            check_sbom(path)
        if path.name == 'image-identities.json':
            images = json.loads(path.read_text(encoding='utf8'))
            if (images.get('sourceCommit') != commit or images.get('platform') != 'linux/amd64'
                    or not all(IMAGE_HASH.fullmatch(images.get(service, '')) for service in ('backend', 'edge'))):
                raise ValueError('Invalid container identity metadata')
        entries.append({'name': path.name, 'target': expected[path.name], 'bytes': path.stat().st_size, 'sha256': hash_file(path)})
    return entries


def checksum_text(entries, manifest_hash):
    return ''.join(f'{entry["sha256"]}  {entry["name"]}\n' for entry in entries) + f'{manifest_hash}  release-manifest.json\n'


def collect(source, destination, tag, commit, run, attempt):
    metadata = version(tag)
    if not COMMIT.fullmatch(commit) or not run.isdecimal() or not attempt.isdecimal():
        raise ValueError('Invalid source commit or workflow run identity')
    destination.mkdir()
    expected = expected_files(metadata)
    for group in source.iterdir():
        if group.is_symlink() or not group.is_dir():
            raise ValueError('Expected per-platform artifact directories')
        for path in group.iterdir():
            if path.name not in expected or group.name != f'payload-{expected[path.name]}-{attempt}' or path.is_symlink() or not path.is_file():
                raise ValueError(f'Unexpected artifact: {group.name}/{path.name}')
            target = destination/path.name
            if target.exists():
                raise ValueError(f'Duplicate artifact: {path.name}')
            shutil.copyfile(path, target)
    entries = inventory(destination, metadata, commit)
    manifest = {**metadata, 'schemaVersion': 1, 'commit': commit, 'runId': int(run), 'runAttempt': int(attempt),
                'signing': 'verification-only' if metadata['channel']=='preview' else 'protected-release', 'artifacts': entries}
    path = destination/'release-manifest.json'
    path.write_bytes((json.dumps(manifest, indent=2)+'\n').encode())
    (destination/'SHA256SUMS.txt').write_bytes(checksum_text(entries, hash_file(path)).encode())


def verify(folder, tag, commit):
    path = folder/'release-manifest.json'
    checksums = folder/'SHA256SUMS.txt'
    if path.is_symlink() or checksums.is_symlink():
        raise ValueError('Release metadata must be regular files')
    manifest = json.loads(path.read_text(encoding='utf8'))
    wanted = version(tag)
    signing = 'verification-only' if wanted['channel']=='preview' else 'protected-release'
    if (not COMMIT.fullmatch(commit) or manifest.get('schemaVersion') != 1 or manifest.get('commit') != commit
            or manifest.get('signing') != signing or any(manifest.get(k) != v for k, v in wanted.items())):
        raise ValueError('Release identity, source commit or signing mode differs')
    entries = inventory(folder, wanted, commit)
    if manifest['artifacts'] != entries or checksums.read_bytes() != checksum_text(entries, hash_file(path)).encode():
        raise ValueError('Release payload or checksum list changed')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_subparsers(dest='command', required=True)
    prepare = command.add_parser('version')
    prepare.add_argument('tag')
    assembly = command.add_parser('collect')
    assembly.add_argument('source', type=Path)
    assembly.add_argument('destination', type=Path)
    assembly.add_argument('tag')
    assembly.add_argument('commit')
    assembly.add_argument('run')
    assembly.add_argument('attempt')
    check = command.add_parser('verify')
    check.add_argument('directory', type=Path)
    check.add_argument('tag')
    check.add_argument('commit')
    args = parser.parse_args()
    try:
        if args.command == 'version':
            metadata = version(args.tag)
            print(json.dumps(metadata))
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf8') as output:
                    output.write(''.join(f'{key}={value}\n' for key, value in metadata.items()))
        elif args.command == 'collect':
            collect(args.source, args.destination, args.tag, args.commit, args.run, args.attempt)
        else:
            manifest = verify(args.directory, args.tag, args.commit)
            print(f'Verified {len(manifest["artifacts"])} artifacts for {args.tag} at {args.commit}')
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
