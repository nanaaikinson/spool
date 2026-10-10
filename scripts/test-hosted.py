#!/usr/bin/env python3
"""Check hosted preparation and the actual Compose model; no daemon or Redis needed."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

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
            self.assertEqual(app["SPOOL_ENV"], "hosted-" + customer)
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


if __name__ == "__main__":
    unittest.main()
