"""Configuration guards that run without Docker, a database or cloud access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("operations", Path(__file__).parents[1] / "manage.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings()

    def tearDown(self):
        self.temporary.cleanup()

    def settings(self, extra="", directory=None):
        (self.root / "environment.env").write_text("DEPLOYMENT_ENV=production\nDEPLOYMENT_DIRECTORY=" + str(directory or self.root) + "\n" + extra)

    def test_existing_project_can_preserve_volume_namespace(self):
        self.settings("COMPOSE_PROJECT_NAME=remoteshield\n")
        arguments = M.compose(self.root, ["config", "--quiet"])
        self.assertEqual(arguments[arguments.index("--project-name") + 1], "remoteshield")

    def test_invalid_project_and_other_deployment_are_rejected(self):
        self.settings("COMPOSE_PROJECT_NAME=../other\n")
        with self.assertRaises(M.OperationError):
            M.environment(self.root)
        self.settings(directory=self.root / "different")
        with self.assertRaises(M.OperationError):
            M.environment(self.root)

    def test_mutable_release_reference_is_rejected(self):
        release = self.root / "release.json"
        release.write_text(json.dumps({"version": 1, "name": "fixture", "backend": "app:latest", "edge": "sha256:" + "a" * 64}))
        with self.assertRaises(M.OperationError):
            M.read_release(release)

    def test_file_updates_preserve_private_mode_and_no_partial_output(self):
        path = self.root / "private"
        M.atomic(path, "fixture")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        M.atomic(path, "replacement", 0o444)
        self.assertEqual(path.read_text(), "replacement")
        self.assertFalse(list(self.root.glob("*.tmp-*")))

    def test_invalid_restore_target_is_rejected_before_external_commands(self):
        with self.assertRaises(M.OperationError):
            M.restore(self.root, None, None, "remoteshield_db")


if __name__ == "__main__":
    unittest.main()
