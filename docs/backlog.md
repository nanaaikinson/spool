# Backlog

## Hosted platform validation

Local production-container rehearsal is implemented and passing. Live platform testing is deferred until a server, DNS and a published image containing these changes are available.

- [ ] **Dokploy:** deploy `compose.hosted.yaml` as a customer Compose resource, configure `app:8080` behind HTTPS, and review final networks and volumes. Confirm storage services remain private.
- [ ] **Coolify:** deploy the same stack through the Compose build pack with the app's HTTPS domain and internal port. Review the generated definition and resource isolation.
- [ ] For each platform, run `scripts/check_hosted.py`, verify customer Redis connectivity and queue/database selection, and check live events through the proxy.
- [ ] For each platform, redeploy the pinned image with retained volumes/keys, configure encrypted off-host backups and failure alerts, and restore a backup into a disposable resource.
- [ ] Record platform versions, resource/destination identity, image digest, test date and outcomes before the first customer handover.

See the [hosted operator guide](hosting.md) and [local organization/RBAC walkthrough](testing.md).
