#!/usr/bin/env python3
"""Check hosted preparation and the actual Compose model; no daemon or Redis needed."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from check_hosted import Client

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "ghcr.io/nanaaikinson/spool:9.9.9"


class HostedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.uri = self.directory / "redis-url"
        self.uri.write_text("rediss://spool:literal$secret@redis.example.com:6380/3\n")
        self.environment = dict(os.environ, SPOOL_METRICS_TOKEN="inherited", COMPOSE_FILE="missing.yaml", COMPOSE_PROJECT_NAME="wrong")

    def prepare(self, customer="acme", image=IMAGE, extra=()):
        return subprocess.run(
            ["python3", str(ROOT / "scripts/prepare-hosted.py"), customer, "--image", image,
             "--output-dir", str(self.directory), "--redis-url-file", str(self.uri), *extra],
            env=self.environment, capture_output=True, text=True,
        )

    def model(self, customer):
        environment = {k: v for k, v in os.environ.items() if not k.startswith(("SPOOL_", "COMPOSE_"))}
        result = subprocess.run(
            ["docker", "compose", "--env-file", str(self.directory / customer / ".env.hosted"),
             "-p", "spool-" + customer, "-f", str(ROOT / "compose.hosted.yaml"), "config", "--format", "json"],
            env=environment, capture_output=True, text=True, check=True,
        )
        return json.loads(result.stdout)

    def test_secrets_isolation_and_networks(self):
        models = []
        for customer in ("acme", "beta"):
            result = self.prepare(customer)
            self.assertEqual(result.returncode, 0, result.stderr)
            path = self.directory / customer / ".env.hosted"
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)
            model = self.model(customer)
            models.append(model)
            services = model["services"]
            app = services["app"]["environment"]
            self.assertEqual(app["REDIS_URL"].replace("$$", "$"), self.uri.read_text().strip())
            self.assertEqual(app["SPOOL_ENV"], "production")
            self.assertEqual(app["SPOOL_INSTANCE_NAME"], customer)
            self.assertEqual(app["SPOOL_DEPLOYMENT_MODE"], "hosted")
            self.assertEqual(app["SPOOL_SECURE_COOKIE"], "true")
            self.assertEqual(app["SPOOL_METRICS_TOKEN"], services["prometheus"]["environment"]["SPOOL_METRICS_TOKEN"])
            for key in ("POSTGRES_PASSWORD", "SPOOL_ADMIN_PASSWORD", "SPOOL_SESSION_KEY", "SPOOL_METRICS_TOKEN"):
                self.assertNotIn(app.get(key, services["postgres"]["environment"].get(key)), result.stdout + result.stderr)
            for service in services.values():
                self.assertNotIn("build", service)
                self.assertNotIn("ports", service)
                self.assertNotIn("container_name", service)
                self.assertTrue(all(v["type"] == "volume" for v in service.get("volumes", [])))
            self.assertEqual(set(services["postgres"]["networks"]), {"storage"})
            self.assertEqual(set(services["prometheus"]["networks"]), {"storage"})
            self.assertTrue(model["networks"]["storage"]["internal"])
            self.assertIn("credentials_file: /tmp/spool-metrics-token", services["prometheus"]["command"][0])
        for key in ("SPOOL_ADMIN_PASSWORD", "SPOOL_SESSION_KEY", "SPOOL_METRICS_TOKEN"):
            self.assertNotEqual(models[0]["services"]["app"]["environment"][key], models[1]["services"]["app"]["environment"][key])
        self.assertNotEqual(models[0]["volumes"], models[1]["volumes"])
        self.assertNotEqual(models[0]["networks"], models[1]["networks"])

    def test_browser_setup_and_organization_name(self):
        result = self.prepare(extra=("--browser-setup", "--organization-name", "Acme team"))
        self.assertEqual(result.returncode, 0, result.stderr)
        app = self.model("acme")["services"]["app"]["environment"]
        self.assertEqual(app["SPOOL_MULTI_ORG"], "true")
        self.assertEqual(app["SPOOL_ORGANIZATION_NAME"], "Acme team")
        self.assertEqual(app["SPOOL_ADMIN_USER"], "")
        self.assertEqual(app["SPOOL_ADMIN_PASSWORD"], "")
        self.assertNotEqual(app["SPOOL_SETUP_TOKEN"], app["SPOOL_DATA_KEY"])
        self.assertNotIn(app["SPOOL_SETUP_TOKEN"], result.stdout + result.stderr)

    def test_existing_credentials_are_never_replaced(self):
        self.assertEqual(self.prepare().returncode, 0)
        path = self.directory / "acme/.env.hosted"
        before = path.read_bytes()
        self.assertNotEqual(self.prepare().returncode, 0)
        self.assertEqual(path.read_bytes(), before)

    def test_invalid_input_creates_no_customer_configuration(self):
        for customer, image in (("../escape", IMAGE), ("UpperCase", IMAGE), ("acme", "spool:latest"), ("acme", "ghcr.io/spool:0.1")):
            self.assertNotEqual(self.prepare(customer, image).returncode, 0)
        for uri in ("redis://redis.example.com/0", "rediss://:oops'@redis.example.com/0", "https://redis.example.com", "rediss://redis.example.com:bad/0", "rediss://redis.example.com:6380/not-a-db", "rediss://redis.example.com:6380/0#fragment", "rediss://bad host/0", "rediss://redis.example.com:6380/"):
            self.uri.write_text(uri)
            result = self.prepare()
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(uri, result.stdout + result.stderr)
        self.assertFalse((self.directory / "acme").exists())

    def test_public_metadata(self):
        result = self.prepare(extra=("--instance-name", "Acme operations", "--environment", "staging", "--support-url", "https://support.example.com/spool"))
        self.assertEqual(result.returncode, 0, result.stderr)
        app = self.model("acme")["services"]["app"]["environment"]
        self.assertEqual(app["SPOOL_INSTANCE_NAME"], "Acme operations")
        self.assertEqual(app["SPOOL_ENV"], "staging")
        self.assertEqual(app["SPOOL_SUPPORT_URL"], "https://support.example.com/spool")
        for number, link in enumerate(("javascript:alert(1)", "http://support.example.com", "https://user:secret@support.example.com", "https://[")):
            self.assertNotEqual(self.prepare("invalid-" + str(number), extra=("--support-url", link)).returncode, 0)

    def test_private_network_requires_explicit_choice(self):
        self.uri.write_text("redis://private-redis:6379/0")
        self.assertNotEqual(self.prepare().returncode, 0)
        self.assertEqual(self.prepare(extra=("--private-redis",)).returncode, 0)

    def test_symlink_is_refused(self):
        target = self.directory / "untouched"
        target.mkdir()
        (self.directory / "acme").symlink_to(target, target_is_directory=True)
        self.assertNotEqual(self.prepare().returncode, 0)
        self.assertEqual(list(target.iterdir()), [])

    def test_digest_and_existing_directory_permissions(self):
        directory = self.directory / "acme"
        directory.mkdir(mode=0o755)
        result = self.prepare(image="ghcr.io/nanaaikinson/spool@sha256:" + "a" * 64)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)

    def test_compose_failure_does_not_write_or_leak_secrets(self):
        fake_bin = self.directory / "fake-bin"
        fake_bin.mkdir()
        docker = fake_bin / "docker"
        docker.write_text('#!/bin/sh\nprintf "%s\\n" "$REDIS_URL" >&2\nexit 1\n')
        docker.chmod(0o700)
        self.environment["PATH"] = str(fake_bin) + os.pathsep + os.environ["PATH"]
        result = self.prepare()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(self.uri.read_text().strip(), result.stdout + result.stderr)
        self.assertFalse((self.directory / "acme").exists())

    def test_verifier_rejects_unsafe_origins(self):
        for origin in ("http://example.com", "https://user:password@example.com", "https://:password@example.com",
                       "https://example.com/path", "https://example.com?token=secret", "https://example.com#secret"):
            with self.assertRaises(RuntimeError):
                Client(origin)

    def test_verifier_keeps_private_input_out_of_errors(self):
        credentials = self.directory / "pilot.json"
        private_value = "never-print-this-password"
        credentials.write_text(json.dumps({"username": "admin", "password": private_value}))
        credentials.chmod(0o644)
        result = subprocess.run(
            ["python3", str(ROOT / "scripts/check_hosted.py"), "--url", "https://example.com",
             "--credentials-file", str(credentials)], capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("owner-only", result.stderr)
        self.assertNotIn(private_value, result.stdout + result.stderr)
        credentials.chmod(0o600)
        credentials.write_text('{"username":"admin","password":"' + private_value + '",bad json}')
        result = subprocess.run(
            ["python3", str(ROOT / "scripts/check_hosted.py"), "--url", "https://example.com",
             "--credentials-file", str(credentials)], capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(private_value, result.stdout + result.stderr)

    def test_backup_selection_publication_and_failures(self):
        fake_bin = self.directory / "backup-bin"
        fake_bin.mkdir()
        docker = fake_bin / "docker"
        # Fake only Docker's boundary; the real backup writer streams and publishes files.
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
if sys.argv[1] == "ps":
    if os.getenv("BACKUP_CASE") != "missing": print("a" * 12)
    if os.getenv("BACKUP_CASE") == "ambiguous": print("b" * 12)
elif sys.argv[1] == "inspect":
    project = "other" if os.getenv("BACKUP_CASE") == "mismatch" else "acme"
    print(json.dumps({"com.docker.compose.project": project, "com.docker.compose.service": "postgres"}))
else:
    sys.stdout.buffer.write(b"not-a-dump" if os.getenv("BACKUP_CASE") == "invalid" else b"PGDMPfake-private-database-data")
    if os.getenv("BACKUP_CASE") == "failed":
        print("never-print-private-upstream-error", file=sys.stderr)
        sys.exit(1)
''')
        docker.chmod(0o700)
        environment = dict(self.environment, PATH=str(fake_bin) + os.pathsep + os.environ["PATH"])
        output = self.directory / "backups"
        command = ["python3", str(ROOT / "scripts/backup_hosted.py"), "--project", "acme", "--output-dir", str(output)]
        for case in ("missing", "ambiguous", "mismatch", "failed", "invalid"):
            result = subprocess.run(command, env=dict(environment, BACKUP_CASE=case), capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("never-print-private-upstream-error", result.stdout + result.stderr)
            self.assertFalse(output.exists() and list(output.iterdir()))
        result = subprocess.run(command, env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        dumps = list(output.glob("*.dump"))
        self.assertEqual(len(dumps), 1)
        original = dumps[0].read_bytes()
        self.assertNotIn(original.decode(), result.stdout + result.stderr)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        self.assertEqual(dumps[0].stat().st_mode & 0o777, 0o600)
        checksum = dumps[0].with_suffix(".dump.sha256")
        self.assertEqual(checksum.read_text(), f"{hashlib.sha256(original).hexdigest()}  {dumps[0].name}\n")
        self.assertEqual(checksum.stat().st_mode & 0o777, 0o600)
        output.chmod(0o755)
        self.assertNotEqual(subprocess.run(command, env=environment, capture_output=True).returncode, 0)
        self.assertEqual(dumps[0].read_bytes(), original)
        output.chmod(0o700)
        # Later runs add backups instead of replacing the previous successful one.
        self.assertEqual(subprocess.run(command, env=environment, capture_output=True).returncode, 0)
        self.assertEqual(len(list(output.glob("*.dump"))), 2)
        self.assertEqual(dumps[0].read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
