#!/usr/bin/env python3
"""Prepare customer runtime secrets for a Dokploy/Coolify Compose resource."""
import argparse
import getpass
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("customer", help="unique lowercase customer slug")
    parser.add_argument("--image", required=True, help="tested full release tag or sha256 digest")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "deployments")
    parser.add_argument("--redis-url-file", type=Path, help="read Redis URI from a private file instead of prompting")
    parser.add_argument("--private-redis", action="store_true", help="allow plaintext Redis only on an approved private network")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", args.customer) or len(args.customer) > 40:
        parser.error("customer must be a lowercase slug of at most 40 characters")
    if not re.fullmatch(r"[a-zA-Z0-9./_-]+(?::[0-9]+)?/[a-zA-Z0-9./_-]+(?:@sha256:[a-f0-9]{64}|:[0-9]+\.[0-9]+\.[0-9]+(?:[-.][a-zA-Z0-9.-]+)?)", args.image):
        parser.error("image must include a registry/repository and a full version tag or sha256 digest")
    directory = args.output_dir / args.customer
    path = directory / ".env.hosted"
    # Refuse replacement: an existing database depends on these exact secrets.
    if directory.is_symlink() or path.exists() or path.is_symlink():
        parser.error("customer configuration already exists or is a symlink; reuse it in the platform")
    if not args.redis_url_file and not sys.stdin.isatty():
        parser.error("use an interactive terminal for hidden input, or --redis-url-file")
    uri = args.redis_url_file.read_text().strip() if args.redis_url_file else getpass.getpass("Customer Asynq Redis URI (hidden): ")
    try:
        parsed = urlsplit(uri)
        port = parsed.port
        valid = parsed.hostname and parsed.scheme in ("redis", "rediss")
        valid = valid and port is not None and port > 0
        valid = valid and (not parsed.path or re.fullmatch(r"/[0-9]+", parsed.path)) and not parsed.fragment
    except ValueError:
        valid = False
    if not valid or any(c in uri for c in "'\\") or any(c.isspace() for c in uri):
        parser.error("invalid Redis URI; include host:port and a numeric database, and percent-encode credential characters")
    if parsed.scheme != "rediss" and not args.private_redis:
        parser.error("use rediss:// for TLS, or --private-redis for an approved private network")
    values = {
        "SPOOL_CUSTOMER": args.customer,
        "SPOOL_IMAGE": args.image,
        "REDIS_URL": uri,
        "POSTGRES_PASSWORD": secrets.token_hex(32),
        "SPOOL_ADMIN_USER": "admin",
        "SPOOL_ADMIN_PASSWORD": secrets.token_hex(32),
        "SPOOL_SESSION_KEY": secrets.token_hex(32),
        "SPOOL_METRICS_TOKEN": secrets.token_hex(32),
        "SPOOL_READ_ONLY": "false",
    }
    # Validate against real Compose without creating containers or connecting to Redis.
    environment = {k: v for k, v in os.environ.items() if not k.startswith(("SPOOL_", "COMPOSE_"))}
    environment.update(values)
    result = subprocess.run(
        ["docker", "compose", "--env-file", "/dev/null", "-p", "spool-" + args.customer,
         "-f", str(ROOT / "compose.hosted.yaml"), "config", "--quiet"],
        env=environment, capture_output=True, text=True,
    )
    if result.returncode:
        # Compose errors can contain interpolated secrets. Keep them out of stdout.
        parser.error("hosted Compose validation failed; check Docker Compose is installed and the template is valid")
    old_mask = os.umask(0o077)
    try:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        with path.open("x") as output:
            output.write("# Spool dedicated hosted runtime configuration. Never commit or source this file.\n")
            output.writelines(f"{key}='{value}'\n" for key, value in values.items())
    finally:
        os.umask(old_mask)
    print(f"Prepared {path}. Copy its values into this customer's platform runtime environment.")
    print("Route only app:8080 through HTTPS. Keep PostgreSQL and Prometheus private.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, EOFError, KeyboardInterrupt):
        sys.exit("Could not prepare customer configuration; check file access and Docker Compose, then retry.")
