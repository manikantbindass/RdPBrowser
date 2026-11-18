import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from manifest import collect, expected_files, hash_file, verify, version


class ReleaseTests(unittest.TestCase):
    tag = 'v2.5.0-preview.1'
    commit = 'd' * 40

    def setUp(self):
        work = TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.source = Path(work.name) / 'downloaded'
        self.output = Path(work.name) / 'release-dist'

    def seed(self, tag):
        for name, target in expected_files(version(tag)).items():
            folder = self.source / f'payload-{target}-2'
            folder.mkdir(parents=True, exist_ok=True)
            content = name
            if name.endswith('.cdx.json'):
                content = json.dumps({'bomFormat': 'CycloneDX', 'components': [{'name': 'fixture'}]})
            if name == 'image-identities.json':
                content = json.dumps({'sourceCommit': self.commit, 'platform': 'linux/amd64',
                                      'backend': 'sha256:' + 'a' * 64, 'edge': 'sha256:' + 'b' * 64})
            (folder / name).write_text(content, encoding='utf8')

    def assemble(self, tag=None):
        collect(self.source, self.output, tag or self.tag, self.commit, '42', '2')

    def test_android_code_is_monotonic_across_publishable_tags(self):
        tags = ['v2.4.99', 'v2.5.0-rc.1', 'v2.5.0-rc.98', 'v2.5.0', 'v2.5.1-rc.1']
        codes = [version(tag)['androidCode'] for tag in tags]
        self.assertEqual(sorted(set(codes)), codes)
        for tag in ['version2.5.0', 'v2.05.0', 'v2.5.0-rc.0', 'v2.5.0-preview.99', 'v2.5.0+update']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                version(tag)

    def test_preview_inventory_and_manifest_checksum(self):
        self.seed(self.tag)
        self.assemble()
        manifest = verify(self.output, self.tag, self.commit)
        self.assertEqual(len(manifest['artifacts']), 16)
        names = [artifact['name'] for artifact in manifest['artifacts']]
        self.assertEqual(names, sorted(names))
        self.assertTrue(names[0].startswith('RemoteShield-'))
        self.assertEqual((manifest['runId'], manifest['runAttempt']), (42, 2))
        self.assertEqual(manifest['signing'], 'verification-only')
        self.assertIn(hash_file(self.output / 'release-manifest.json'),
                      (self.output / 'SHA256SUMS.txt').read_text())

    def test_signed_release_requires_all_linux_signatures(self):
        tag = 'v2.5.0-rc.1'
        self.seed(tag)
        (self.source / 'payload-linux-x64-2' / f'RemoteShield-{tag}-linux-x64.deb.asc').unlink()
        with self.assertRaisesRegex(ValueError, r'Missing.*\.deb\.asc'):
            self.assemble(tag)

    def test_missing_platform_fails(self):
        self.seed(self.tag)
        (self.source / 'payload-macos-universal-2' / f'RemoteShield-{self.tag}-macos-universal.dmg').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing.*macos-universal'):
            self.assemble()

    def test_evidence_from_another_attempt_fails(self):
        self.seed(self.tag)
        (self.source / 'payload-windows-x64-2').rename(self.source / 'payload-windows-x64-1')
        with self.assertRaisesRegex(ValueError, 'Unexpected artifact'):
            self.assemble()

    def test_modified_payload_fails(self):
        self.seed(self.tag)
        self.assemble()
        (self.output / f'RemoteShield-{self.tag}-windows-x64.msi').write_bytes(b'modified')
        with self.assertRaisesRegex(ValueError, 'payload or checksum list changed'):
            verify(self.output, self.tag, self.commit)

    def test_unexpected_payload_fails(self):
        self.seed(self.tag)
        self.assemble()
        (self.output / 'external.exe').write_bytes(b'extra')
        with self.assertRaisesRegex(ValueError, 'Unexpected.*external.exe'):
            verify(self.output, self.tag, self.commit)

    def test_wrong_commit_fails(self):
        self.seed(self.tag)
        self.assemble()
        with self.assertRaisesRegex(ValueError, 'source commit'):
            verify(self.output, self.tag, 'b' * 40)

    def test_empty_sbom_fails(self):
        self.seed(self.tag)
        (self.source / 'payload-containers-2' / 'source-lockfiles.cdx.json').write_text('{"bomFormat":"CycloneDX"}')
        with self.assertRaisesRegex(ValueError, 'Empty or invalid CycloneDX'):
            self.assemble()

    def test_container_identity_must_match_release(self):
        self.seed(self.tag)
        path = self.source / 'payload-containers-2' / 'image-identities.json'
        identity = json.loads(path.read_text())
        identity['sourceCommit'] = 'a' * 40
        path.write_text(json.dumps(identity))
        with self.assertRaisesRegex(ValueError, 'Invalid container identity'):
            self.assemble()


if __name__ == '__main__':
    unittest.main()
