#!/usr/bin/env python3
"""Exercise the installer and real Compose parsing without starting services."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCKER = shutil.which("docker")


class InstallationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.config = self.directory / ".env.installation"
        self.environment = dict(os.environ)
        # Installation configuration must win over inherited development values.
        self.environment.update(REDIS_URL="redis://wrong:6379/9", SPOOL_SESSION_KEY="wrong")

    def install(self, answers="", configure=True, success=True, browser=False):
        command = ["bash", str(ROOT / "scripts/install.sh"), "--env-file", str(self.config)]
        if browser:
            command.append("--browser-setup")
        if configure:
            command.append("--configure-only")
        result = subprocess.run(command, input=answers, text=True, capture_output=True,
                                env=self.environment, timeout=20)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def model(self):
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("SPOOL_", "COMPOSE_"))
                       and key not in {"REDIS_URL", "DATABASE_URL", "PROMETHEUS_URL", "POSTGRES_PASSWORD"}}
        result = subprocess.run([DOCKER, "compose", "--env-file", str(self.config),
                                 "config", "--format", "json"], env=environment,
                                text=True, capture_output=True, check=True)
        model = json.loads(result.stdout)
        # Compose escapes dollars in its serialized model so that it can be
        # reused as a Compose file. Container values contain the literal dollar.
        for service in model["services"].values():
            service["environment"] = {key: value.replace("$$", "$") if isinstance(value, str) else value
                                      for key, value in service.get("environment", {}).items()}
        return model

    def mock_start(self, healthy=True):
        # Delegate parsing to real Compose; replace only Docker daemon operations.
        executable = self.directory / "docker"
        executable.write_text(
            '#!/usr/bin/env bash\nset -eu\n'
            'if [[ "$1" == info ]]; then exit 0; fi\n'
            'if [[ " $* " == *" up "* || " $* " == *" exec "* ]]; then\n'
            '  printf "%s\\n" "$*" >> "$INSTALL_TEST_TRACE"\n'
            '  if [[ " $* " == *" exec "* ]]; then exit "${INSTALL_TEST_EXEC_STATUS:-0}"; fi\n'
            '  exit "$INSTALL_TEST_STATUS"\nfi\n'
            'exec "$INSTALL_TEST_DOCKER" "$@"\n'
        )
        executable.chmod(0o700)
        self.environment.update(
            PATH=str(self.directory) + os.pathsep + os.environ["PATH"],
            INSTALL_TEST_DOCKER=DOCKER,
            INSTALL_TEST_TRACE=str(self.directory / "trace"),
            INSTALL_TEST_STATUS="0" if healthy else "1",
        )

    def test_bundled_services_literal_credentials_and_rerun(self):
        marker = self.directory / "should-not-exist"
        redis = f"rediss://spool:$SECRET$(touch {marker})`id`#pass@redis.example:6380/2"
        output = self.install(redis + "\n" * 7)
        self.assertNotIn(redis, output)
        self.assertFalse(marker.exists())
        self.assertEqual(self.config.stat().st_mode & 0o777, 0o600)
        services = self.model()["services"]
        self.assertEqual(set(services), {"app", "postgres", "prometheus"})
        settings = services["app"]["environment"]
        self.assertEqual(settings["REDIS_URL"], redis)
        self.assertEqual(settings["PROMETHEUS_URL"], "http://prometheus:9090")
        self.assertEqual(settings["SPOOL_SECURE_COOKIE"], "false")
        self.assertEqual(settings["SPOOL_ENV"], "production")
        self.assertEqual(settings["SPOOL_MULTI_ORG"], "true")
        self.assertEqual(settings["SPOOL_METRICS_TOKEN"], services["prometheus"]["environment"]["SPOOL_METRICS_TOKEN"])
        self.assertEqual(settings["SPOOL_ORGANIZATION_NAME"], "My organization")
        self.assertTrue(all(len(settings[key]) >= 32 for key in
                            ("SPOOL_ADMIN_PASSWORD", "SPOOL_SESSION_KEY", "SPOOL_DATA_KEY", "SPOOL_SETUP_TOKEN", "SPOOL_METRICS_TOKEN")))
        self.assertNotEqual(settings["SPOOL_ADMIN_PASSWORD"], settings["SPOOL_SESSION_KEY"])
        self.assertIn("://spool:" + services["postgres"]["environment"]["POSTGRES_PASSWORD"] + "@",
                      settings["DATABASE_URL"])
        self.assertEqual(services["app"]["ports"][0]["host_ip"], "127.0.0.1")
        self.assertNotIn("ports", services["postgres"])
        self.assertNotIn("ports", services["prometheus"])
        original = self.config.read_bytes()
        self.install()
        self.assertEqual(self.config.read_bytes(), original)
        self.mock_start()
        self.assertIn("Spool is ready.", self.install(configure=False))
        trace = (self.directory / "trace").read_text()
        self.assertIn("--wait --wait-timeout 180", trace)
        self.assertIn("exec -T prometheus", trace)

    def test_external_services_https_and_failure_preserves_secrets(self):
        postgres = "postgres://spool:pa$ss@postgres.example:5432/spool?sslmode=verify-full"
        metrics = "https://metrics.example"
        self.install("\n".join(["redis://redis.example:6379/3", "external", postgres,
                                "external", metrics, "owner", "8090", "https://spool.example", "Acme operations", ""]))
        services = self.model()["services"]
        self.assertEqual(set(services), {"app"})
        settings = services["app"]["environment"]
        self.assertEqual(settings["DATABASE_URL"], postgres)
        self.assertEqual(settings["PROMETHEUS_URL"], metrics)
        self.assertEqual(settings["SPOOL_SECURE_COOKIE"], "true")
        self.assertEqual(services["app"]["ports"][0]["published"], "8090")
        original = self.config.read_bytes()
        self.mock_start(healthy=False)
        self.assertIn("Startup failed", self.install(configure=False, success=False))
        self.assertEqual(self.config.read_bytes(), original)
        self.environment["INSTALL_TEST_STATUS"] = "0"
        self.assertIn("Spool is ready.", self.install(configure=False))
        self.assertIn("exec -T app", (self.directory / "trace").read_text())
        self.environment["INSTALL_TEST_EXEC_STATUS"] = "1"
        self.assertIn("external Prometheus is unreachable", self.install(configure=False, success=False))
        self.assertEqual(self.config.read_bytes(), original)

    def test_mixed_services(self):
        self.install("redis://redis.example:6379/0\nexternal\npostgres://spool:secret@db.example/spool\n" + "\n" * 5)
        self.assertEqual(set(self.model()["services"]), {"app", "prometheus"})
        self.config.unlink()
        self.install("redis://redis.example:6379/0\n\nexternal\nhttp://metrics.example:9090\n" + "\n" * 4)
        self.assertEqual(set(self.model()["services"]), {"app", "postgres"})

    def test_local_rbac_stack_is_managed_and_private(self):
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("SPOOL_", "COMPOSE_"))
                       and key not in {"REDIS_URL", "DATABASE_URL", "PROMETHEUS_URL", "POSTGRES_PASSWORD"}}
        result = subprocess.run(
            [DOCKER, "compose", "--env-file", str(ROOT / ".env.rbac.example"), "--profile", "demo",
             "config", "--format", "json"], cwd=ROOT, env=environment,
            capture_output=True, text=True, check=True,
        )
        model = json.loads(result.stdout)
        self.assertEqual(model["name"], "spool-rbac")
        services = model["services"]
        self.assertEqual(set(services), {"app", "postgres", "prometheus", "redis-alpha", "redis-beta", "demo-alpha", "demo-beta"})
        app = services["app"]["environment"]
        self.assertEqual(app["SPOOL_MULTI_ORG"], "true")
        self.assertEqual(app["SPOOL_ORGANIZATION_NAME"], "Alpha")
        self.assertEqual(app["SPOOL_SECURE_COOKIE"], "false")
        self.assertEqual(app["REDIS_URL"], "redis://redis-alpha:6379/0")
        self.assertEqual(app["SPOOL_METRICS_TOKEN"], services["prometheus"]["environment"]["SPOOL_METRICS_TOKEN"])
        for name, service in services.items():
            if name == "app":
                self.assertEqual(service["ports"][0]["host_ip"], "127.0.0.1")
                self.assertEqual(service["ports"][0]["published"], "8098")
            else:
                self.assertFalse(service.get("ports"))
        for organization in ("alpha", "beta"):
            self.assertEqual(services[f"demo-{organization}"]["environment"]["REDIS_URL"], f"redis://redis-{organization}:6379/0")
            self.assertTrue(services[f"demo-{organization}"]["healthcheck"]["disable"])
            self.assertEqual(services[f"demo-{organization}"]["environment"]["SPOOL_ADDR"], "127.0.0.1:8088")
        self.assertTrue(all(volume["name"].startswith("spool-rbac_") for volume in model["volumes"].values()))

    def test_remote_http_and_incomplete_input_do_not_save(self):
        self.install("redis://redis.example:6379/0\n\n\n\n\nhttp://spool.example\n", success=False)
        self.assertFalse(self.config.exists())
        self.install("redis://redis.example:6379/0\n", success=False)
        self.assertFalse(self.config.exists())

    def test_browser_setup_preserves_private_bootstrap_token(self):
        self.install("redis://redis.example:6379/0" + "\n" * 5, browser=True)
        settings = self.model()["services"]["app"]["environment"]
        self.assertEqual(settings["SPOOL_ADMIN_USER"], "")
        self.assertEqual(settings["SPOOL_ADMIN_PASSWORD"], "")
        self.assertEqual(settings["SPOOL_MULTI_ORG"], "true")
        self.assertGreaterEqual(len(settings["SPOOL_SETUP_TOKEN"]), 32)
        self.assertNotEqual(settings["SPOOL_SETUP_TOKEN"], settings["SPOOL_DATA_KEY"])

    def test_existing_configuration_and_symlinks_are_not_overwritten(self):
        self.config.write_text("SPOOL_ADMIN_PASSWORD=keep-me\n")
        self.install(success=False)
        self.assertEqual(self.config.read_text(), "SPOOL_ADMIN_PASSWORD=keep-me\n")
        self.config.unlink()
        target = self.directory / "existing.env"
        target.write_text("do not overwrite\n")
        self.config.symlink_to(target)
        self.install(success=False)
        self.assertEqual(target.read_text(), "do not overwrite\n")


if __name__ == "__main__":
    if not DOCKER:
        raise SystemExit("Docker Compose is required for installation checks.")
    unittest.main()
