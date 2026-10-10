#!/usr/bin/env python3
"""Create a private PostgreSQL backup for one explicit hosted Compose project."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile


def docker(*arguments, **kwargs):
    result = subprocess.run(["docker", *arguments], stderr=subprocess.PIPE, timeout=600, **kwargs)
    if result.returncode:
        # Upstream diagnostics may contain private connection information.
        raise RuntimeError("Docker or pg_dump failed; no completed backup was published.")
    return result


def backup(project, directory):
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise RuntimeError("Provide the exact lowercase Compose project name from the platform.")
    containers = docker("ps", "-q", "--filter", f"label=com.docker.compose.project={project}",
                        "--filter", "label=com.docker.compose.service=postgres", stdout=subprocess.PIPE).stdout.decode().split()
    if len(containers) != 1 or not re.fullmatch(r"[a-f0-9]{12,64}", containers[0]):
        raise RuntimeError("Expected exactly one running postgres service for this project; no backup was started.")
    container = containers[0]
    labels = json.loads(docker("inspect", "--format", "{{json .Config.Labels}}", container, stdout=subprocess.PIPE).stdout)
    if labels.get("com.docker.compose.project") != project or labels.get("com.docker.compose.service") != "postgres":
        raise RuntimeError("The selected container does not match the requested customer project.")
    if directory.is_symlink():
        raise RuntimeError("The backup directory cannot be a symlink.")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    permissions = directory.stat()
    if permissions.st_uid != os.getuid() or permissions.st_mode & 0o077:
        raise RuntimeError("Use an owner-only backup directory (chmod 700) owned by the current operator.")
    name = "spool-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(8) + ".dump"
    destination = directory / name
    checksum = directory / (name + ".sha256")
    checksum_created = False
    published = False
    with tempfile.NamedTemporaryFile(prefix=".spool-backup-", dir=directory, delete=False) as output:
        partial = Path(output.name)
        try:
            docker("exec", container, "pg_dump", "--no-password", "-U", "spool", "-d", "spool", "-Fc", stdout=output)
            output.flush()
            os.fsync(output.fileno())
            with partial.open("rb") as input_file:
                if input_file.read(5) != b"PGDMP":
                    raise RuntimeError("pg_dump did not produce a PostgreSQL custom-format backup.")
                input_file.seek(0)
                digest = hashlib.sha256()
                for chunk in iter(lambda: input_file.read(1024 * 1024), b""):
                    digest.update(chunk)
            # Publish the checksum first; a .dump appears only once both files are complete.
            with checksum.open("x") as metadata:
                checksum_created = True
                checksum.chmod(0o600)
                metadata.write(f"{digest.hexdigest()}  {name}\n")
                metadata.flush()
                os.fsync(metadata.fileno())
            # Linking is atomic and refuses to replace an existing file.
            os.link(partial, destination)
            published = True
        finally:
            partial.unlink(missing_ok=True)
            if checksum_created and not published:
                checksum.unlink(missing_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="actual platform Compose project label, not just the customer slug")
    parser.add_argument("--output-dir", required=True, type=Path, help="private local backup directory")
    args = parser.parse_args()
    old_mask = os.umask(0o077)
    try:
        destination = backup(args.project, args.output_dir)
    finally:
        os.umask(old_mask)
    print(f"Created {destination} and its .sha256 checksum.")
    print("Upload both files to your approved encrypted backup destination; preserve SPOOL_DATA_KEY separately.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        sys.exit(f"FAIL {error}")
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        sys.exit("FAIL Could not select the customer container or complete its private backup.")
    except KeyboardInterrupt:
        sys.exit("Backup interrupted.")
