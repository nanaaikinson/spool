#!/usr/bin/env python3
"""Rehearse hosted HTTPS, Redis TLS, redeployment and PostgreSQL restore in an isolated stack."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

from check_hosted import Client, check, require

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="already-built local image or release image to test")
    args = parser.parse_args()
    require(args.image and not args.image.startswith("-") and not any(c.isspace() for c in args.image), "Provide a valid image reference.")
    # Never reuse an operator's Compose project, environment file, volumes or Redis.
    environment = {k: v for k, v in os.environ.items() if not k.startswith(("SPOOL_", "COMPOSE_"))}
    project = "spool-pilot-" + secrets.token_hex(8)
    environment.update({
        "SPOOL_CUSTOMER": project, "SPOOL_IMAGE": args.image, "SPOOL_MULTI_ORG": "true",
        "SPOOL_INSTANCE_NAME": "Hosted pilot", "SPOOL_ORGANIZATION_NAME": "Pilot team",
        "SPOOL_ENV": "pilot", "SPOOL_READ_ONLY": "false", "SPOOL_VIEWER_USER": "",
        "SPOOL_VIEWER_PASSWORD": "", "SPOOL_SUPPORT_URL": "https://example.com/support",
        "SPOOL_ADMIN_USER": "admin", "SPOOL_ADMIN_PASSWORD": secrets.token_hex(24),
        "SPOOL_SESSION_KEY": secrets.token_hex(32), "SPOOL_DATA_KEY": secrets.token_hex(32),
        "SPOOL_SETUP_TOKEN": secrets.token_hex(32), "SPOOL_METRICS_TOKEN": secrets.token_hex(32),
        "POSTGRES_PASSWORD": secrets.token_hex(32),
    })
    redis_password = secrets.token_hex(24)
    environment["REDIS_URL"] = f"rediss://:{redis_password}@redis:6380/3"
    with tempfile.TemporaryDirectory(prefix="spool-pilot-") as temporary:
        directory = Path(temporary)
        # Host directory is owner-only. The test Redis user needs to read its mounted cert/key.
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-keyout", str(directory / "tls.key"), "-out", str(directory / "tls.crt"),
            "-subj", "/CN=Spool disposable pilot", "-addext", "subjectAltName=DNS:localhost,DNS:redis,IP:127.0.0.1",
        ], check=True, capture_output=True)
        (directory / "tls.key").chmod(0o644)
        (directory / "redis.conf").write_text(f"""port 0
tls-port 6380
tls-cert-file /pilot/tls.crt
tls-key-file /pilot/tls.key
tls-ca-cert-file /pilot/tls.crt
tls-auth-clients no
requirepass {redis_password}
""")
        (directory / "nginx.conf").write_text("""events {}
http {
  access_log off;
  resolver 127.0.0.11 valid=5s;
  server {
    listen 443 ssl;
    ssl_certificate /pilot/tls.crt;
    ssl_certificate_key /pilot/tls.key;
    location = /pilot-redirect { return 307 https://elsewhere.invalid; }
    location / {
      set $spool_upstream app:8003;
      proxy_pass http://$spool_upstream;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_http_version 1.1;
      proxy_buffering off;
    }
  }
}
""")
        override = directory / "compose.pilot.json"
        override.write_text(json.dumps({"services": {
            "app": {
                "environment": {"REDIS_TLS_CA_FILE": "/pilot/tls.crt"},
                "volumes": [f"{directory}/tls.crt:/pilot/tls.crt:ro"],
                "depends_on": {"redis": {"condition": "service_healthy"}},
            },
            "redis": {
                "image": "redis:7.4-alpine", "networks": ["default"],
                "command": ["redis-server", "/pilot/redis.conf"], "volumes": [f"{directory}:/pilot:ro"],
                "environment": {"REDISCLI_AUTH": redis_password},
                "healthcheck": {"test": ["CMD", "redis-cli", "--tls", "--cacert", "/pilot/tls.crt", "-p", "6380", "ping"],
                                "interval": "2s", "timeout": "3s", "retries": 20},
            },
            "proxy": {
                "image": "nginx:1.28-alpine", "networks": ["default"],
                "ports": ["127.0.0.1::443"],
                "volumes": [f"{directory}:/pilot:ro", f"{directory}/nginx.conf:/etc/nginx/nginx.conf:ro"],
                "depends_on": {"app": {"condition": "service_healthy"}},
            },
        }}))
        command = ["docker", "compose", "--env-file", "/dev/null", "-p", project,
                   "-f", str(ROOT / "compose.hosted.yaml"), "-f", str(override)]

        def compose(*arguments, input_data=None, timeout=180):
            result = subprocess.run(command + list(arguments), env=environment, input=input_data,
                                    capture_output=True, timeout=timeout)
            # Docker diagnostics may contain connection credentials; never dump them.
            require(result.returncode == 0, f"Disposable pilot Compose operation {arguments[0]} failed; no customer services were targeted.")
            return result.stdout

        try:
            print("Starting isolated hosted pilot (HTTPS proxy and private-CA Redis TLS)…", flush=True)
            compose("up", "-d", "--wait", "--wait-timeout", "120")
            endpoint = compose("port", "proxy", "443").decode().strip()
            origin = "https://" + endpoint
            credentials = {"username": "admin", "password": environment["SPOOL_ADMIN_PASSWORD"]}
            ca_file = str(directory / "tls.crt")
            client = Client(origin, ca_file)
            try:
                with client.open("/pilot-redirect", credentials):
                    raise RuntimeError("The verifier accepted an unexpected redirect.")
            except RuntimeError as error:
                require("returned 307" in str(error), "The verifier followed a credential-bearing redirect.")
            check(client, credentials, instance_name="Hosted pilot")

            # The real production Compose storage services must stay off the proxy network.
            services = json.loads(compose("config", "--format", "json"))["services"]
            for name in ("postgres", "prometheus"):
                require(not services[name].get("ports") and set(services[name]["networks"]) == {"storage"},
                        "A storage service was exposed by the pilot definition.")
            session = client.json("/api/v1/session", credentials)
            organization_id = session["organization"]["id"]
            client.organization = organization_id
            viewer_credentials = {"username": "pilot-viewer", "password": secrets.token_hex(24)}
            client.json("/api/v1/members", {**viewer_credentials, "role": "viewer"})
            view = client.json("/api/v1/views", {"name": "Pilot saved view", "path": "/queues"})
            # PostgreSQL timestamps have microsecond precision; compare persisted snapshots.
            views_before = client.json("/api/v1/views")["data"]
            require(len(views_before) == 1 and views_before[0]["id"] == view["id"], "The pilot view was not persisted.")
            client.json("/api/v1/organization", {"name": "Restored pilot team"}, method="PATCH")
            audit_before = client.json("/api/v1/audit")["data"]
            require(any(entry["action"] == "organization.rename" for entry in audit_before), "The pilot change was not audited.")
            cookie_before = next(c.value for c in client.cookies if c.name == "spool_session")

            compose("up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", "app")
            require(client.json("/api/v1/session").get("authenticated"), "Redeployment lost the managed account or signing key.")
            require(client.json("/api/v1/views")["data"] == views_before, "Redeployment lost a saved view.")
            print("PASS redeployment preserves accounts, sessions, organization and saved views", flush=True)

            # Every destructive operation below targets only the randomly named test stack.
            backup_directory = directory / "backups"
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/backup_hosted.py"), "--project", project,
                "--output-dir", str(backup_directory),
            ], env=environment, timeout=180)
            require(result.returncode == 0, "The operator backup command failed.")
            backups = list(backup_directory.glob("*.dump"))
            require(len(backups) == 1, "The backup command did not publish exactly one dump.")
            dump = backups[0].read_bytes()
            require(backups[0].stat().st_mode & 0o777 == 0o600, "The database backup is not owner-only.")
            require(backups[0].with_suffix(".dump.sha256").read_text() == f"{hashlib.sha256(dump).hexdigest()}  {backups[0].name}\n",
                    "The database backup checksum does not match.")
            require(dump.startswith(b"PGDMP"), "PostgreSQL did not produce a custom-format backup.")
            compose("stop", "app")
            compose("exec", "-T", "postgres", "dropdb", "-U", "spool", "--force", "spool")
            compose("exec", "-T", "postgres", "createdb", "-U", "spool", "spool")
            compose("exec", "-T", "postgres", "pg_restore", "--exit-on-error", "--no-owner", "-U", "spool", "-d", "spool", input_data=dump)
            compose("up", "-d", "--no-deps", "--wait", "--wait-timeout", "90", "app")
            require(client.json("/api/v1/session").get("authenticated"), "Restore lost accounts or signing-key compatibility.")
            require(client.json("/api/v1/views")["data"] == views_before, "Restore lost the saved view.")
            require(client.json("/api/v1/audit")["data"] == audit_before, "Restore lost audit entries.")
            require(client.json("/api/v1/organizations")["data"][0]["name"] == "Restored pilot team", "Restore lost organization metadata.")
            # /status resolves the encrypted organization connection using the original data key.
            status = client.json("/api/v1/status")
            require(status["redis"]["available"] and status["database"]["available"], "Restore could not decrypt or use the organization connection.")
            require(next(c.value for c in client.cookies if c.name == "spool_session") == cookie_before, "The pilot unexpectedly replaced its session.")
            print("PASS backup restore preserves accounts, audit, saved views and encrypted Redis connection", flush=True)

            # A viewer can run the deployed-console check without deployment authority.
            check(Client(origin, ca_file), viewer_credentials, organization_id, "Hosted pilot")

            # Run the operator's actual CLI, not just its imported helper.
            credentials["password"] = secrets.token_hex(24)
            compose("exec", "-T", "app", "/app/spool", "admin", "recover", "--username", "admin", "--confirm",
                    input_data=json.dumps({"password": credentials["password"]}).encode())
            client.json("/api/v1/users", expected=401)
            credentials_file = directory / "pilot.json"
            credentials_file.write_text(json.dumps(credentials))
            credentials_file.chmod(0o600)
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/check_hosted.py"), "--url", origin,
                "--credentials-file", str(credentials_file), "--ca-file", ca_file,
                "--organization-id", organization_id, "--instance-name", "Hosted pilot",
            ], env=environment, timeout=130)
            require(result.returncode == 0, "Post-restore verification command failed.")
            print("PASS container administrator recovery and post-restore hosted checks", flush=True)
        finally:
            compose("down", "--volumes", "--remove-orphans")
            print("Removed the disposable pilot containers, networks and volumes", flush=True)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        sys.exit(f"FAIL {error}")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        sys.exit("FAIL Could not run the isolated pilot; check Docker Compose, OpenSSL and the selected image.")
    except KeyboardInterrupt:
        sys.exit("Pilot interrupted.")
