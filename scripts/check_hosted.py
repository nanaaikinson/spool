#!/usr/bin/env python3
"""Verify a hosted Spool origin without changing customer data or tasks."""
import argparse
from html.parser import HTMLParser
from http.cookiejar import CookieJar
import json
from pathlib import Path
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    build_opener, HTTPCookieProcessor, HTTPRedirectHandler, HTTPSHandler,
    ProxyHandler, Request,
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


class NoRedirects(HTTPRedirectHandler):
    # Never forward a password or cookie to a redirect destination.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, origin, ca_file=None):
        parsed = urlsplit(origin)
        require(parsed.scheme == "https" and parsed.hostname and parsed.username is None and parsed.password is None
                and parsed.path in ("", "/") and not parsed.query and not parsed.fragment,
                "Provide an HTTPS origin without credentials, a path, query or fragment.")
        parsed.port  # Reject invalid ports before making a request.
        self.origin = origin.rstrip("/")
        self.organization = ""
        self.cookies = CookieJar()
        self.opener = build_opener(
            ProxyHandler({}), NoRedirects(), HTTPCookieProcessor(self.cookies),
            HTTPSHandler(context=ssl.create_default_context(cafile=ca_file)),
        )

    def open(self, path, body=None, method=None, expected=200, headers=None):
        require(path.startswith("/") and not path.startswith("//"), "Invalid check path.")
        values = {"X-Spool-Action": "confirmed", "Origin": self.origin}
        if self.organization:
            values["X-Spool-Organization"] = self.organization
        values.update(headers or {})
        if body is not None:
            values["Content-Type"] = "application/json"
        request = Request(self.origin + path, data=None if body is None else json.dumps(body).encode(),
                          headers=values, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except HTTPError as error:
            response = error
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("HTTPS request failed; check the origin, certificate and network.") from None
        if response.code != expected:
            status = response.code
            response.close()
            raise RuntimeError(f"{request.get_method()} {path} returned {status}; expected {expected}.")
        return response

    def json(self, path, body=None, **kwargs):
        with self.open(path, body, **kwargs) as response:
            require(response.headers.get_content_type() == "application/json", "Expected a JSON API response.")
            return json.loads(response.read(2 * 1024 * 1024))


class ModuleScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("type") == "module":
            self.paths.append(values.get("src", ""))


def check(client, credentials, organization_id="", instance_name=None, wait_seconds=90):
    require(client.json("/ready").get("ok"), "The app is not ready.")
    session = client.json("/api/v1/session")
    require(session.get("deployment_mode") == "hosted" and session.get("managed")
            and session.get("auth_required") and not session.get("setup_required")
            and not session.get("authenticated"), "Expected a configured hosted deployment with managed sign-in.")
    if instance_name is not None:
        require(session.get("instance_name") == instance_name, "Instance identity does not match the expected customer.")
    with client.open("/") as response:
        require(response.headers.get_content_type() == "text/html", "The built UI is unavailable.")
        scripts = ModuleScripts()
        scripts.feed(response.read(1024 * 1024).decode())
    require(scripts.paths, "The built UI has no module script.")
    for path in scripts.paths:
        require(path.startswith("/assets/") and not urlsplit(path).netloc, "Unexpected UI script origin.")
        with client.open(path) as response:
            require(response.headers.get_content_type() in ("text/javascript", "application/javascript"),
                    "A built UI script is unavailable.")
            response.read(1)
    client.json("/api/v1/queues", expected=401)
    for headers in ({}, {"Authorization": "Bearer invalid-pilot-token"}):
        client.json("/metrics", expected=401, headers=headers)
    print("PASS HTTPS, instance identity, built UI, sign-in enforcement and protected metrics", flush=True)
    signed_in = False
    try:
        session = client.json("/api/v1/session", credentials)
        signed_in = True
        require(session.get("authenticated"), "Sign-in did not authenticate the account.")
        cookie = next((c for c in client.cookies if c.name == "spool_session"), None)
        require(cookie and cookie.secure and cookie.has_nonstandard_attr("HttpOnly")
                and cookie.get_nonstandard_attr("SameSite", "").lower() == "strict",
                "The session cookie must be Secure, HttpOnly and SameSite=Strict.")
        available = client.json("/api/v1/organizations")["data"]
        selected = organization_id or (session.get("organization") or {}).get("id")
        require(selected and any(org["id"] == selected for org in available), "The account cannot access the selected organization.")
        client.organization = selected
        client.json("/metrics", expected=401)
        client.json("/api/v1/queues")
        with client.open("/api/v1/events") as response:
            require(response.headers.get_content_type() == "text/event-stream"
                    and response.readline(256) == b"event: connected\n", "Live events do not stream through the proxy.")
        print("PASS account sign-in, secure cookie, organization access and live events", flush=True)
        deadline = time.monotonic() + wait_seconds
        while True:
            status = client.json("/api/v1/status")
            healthy = all(status[name].get("available") for name in ("redis", "database", "metrics"))
            if healthy and status["metrics"].get("scrape_status") == "up":
                break
            require(time.monotonic() < deadline, "Redis, PostgreSQL or Prometheus collection is unavailable; inspect Settings connection status.")
            time.sleep(2)
        print("PASS organization Redis, PostgreSQL and authenticated Prometheus collection", flush=True)
    finally:
        if signed_in:
            client.json("/api/v1/session", {"confirm": True}, method="DELETE")
    client.json("/api/v1/queues", expected=401)
    print("PASS sign-out; customer tasks and configuration were unchanged", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="public HTTPS origin")
    parser.add_argument("--credentials-file", required=True, type=Path, help="owner-only JSON with username and password")
    parser.add_argument("--organization-id", default="", help="check this organization instead of the sign-in default")
    parser.add_argument("--instance-name", help="expected public customer identity")
    parser.add_argument("--ca-file", help="trusted private CA PEM; TLS verification always remains enabled")
    parser.add_argument("--wait-seconds", default=90, type=int, help="maximum wait for initial scrape collection (1–300)")
    args = parser.parse_args()
    require(1 <= args.wait_seconds <= 300, "Scrape wait must be 1–300 seconds.")
    require(args.credentials_file.stat().st_mode & 0o077 == 0, "The credentials file must have owner-only permissions (chmod 600).")
    with args.credentials_file.open("rb") as input_file:
        raw = input_file.read(4097)
    require(len(raw) <= 4096, "The credentials file is too large.")
    credentials = json.loads(raw)
    require(isinstance(credentials, dict) and set(credentials) == {"username", "password"}
            and all(isinstance(value, str) and value for value in credentials.values()),
            "Provide one JSON object with username and password.")
    check(Client(args.url, args.ca_file), credentials, args.organization_id, args.instance_name, args.wait_seconds)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        sys.exit(f"FAIL {error}")
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("FAIL Could not read the private credentials/CA or interpret the server response.")
    except KeyboardInterrupt:
        sys.exit("Check interrupted.")
