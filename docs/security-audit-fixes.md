# Frontend security changes

## Local development

Use Node 22.23.2 with npm 10.9.8. The version files, package engines, CI, and
security checks use these versions. Install through your usual Node version
manager, then run `npm ci --ignore-scripts`.

Vite serves this checkout only. It no longer exposes sibling repositories.
Licensed composition can still set `VITE_ADDITIONAL_FS_ROOT` to the OSS frontend
checkout, but only that checkout's `node_modules` directory is added to the
allowlist. It does not grant access to the checkout's source or parent workspace.

For SSO testing through a tunnel, allow its exact hostname:

```sh
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=my-tunnel.ngrok-free.app make dev
```

Do not expose a development server to untrusted users. The hostname check does
not authenticate visitors, and development servers intentionally serve source.

## Session changes

Login attempts, logout, and session expiration invalidate earlier requests.
Responses that finish after an identity change cannot restore authentication or
overwrite the tenant list, feature flags, or license state. The API wrapper also
checks the session after reading response bodies, not just response headers.

If session refresh discovers that another tab changed the cookie to a different
user, the UI locks instead of adopting that user in an already-mounted page.
Server-side authentication, authorization, revocation, and audit logging remain
the API's responsibility. These changes do not create or revoke server sessions
outside the existing login and logout endpoints.

## Query history

History and saved queries reject credential-shaped object keys, JSON text,
connection strings with passwords, and sensitive field/value filters. Existing
unsafe entries are removed from the active stored history when it loads.

This is a precaution, not a guarantee that arbitrary text contains no secrets.
Avoid pasting credentials into searches. Browser history and deliberately shared
search links are separate from the application's saved-query storage.

## Releases

Changes to package metadata, such as Node engine pins, do not request a release
unless the app version also changes. Manual release runs still use the existing
version and tag checks.

The build publishes a unique `candidate-<run>-<attempt>` tag first. Candidates
are unverified and must not be used for deployments or automatic updates.

Both amd64 and arm64 images must pass the fixable high/critical vulnerability
scan and non-root check. Provenance and SBOM steps must also succeed before the
workflow promotes the same immutable digest to version and moving release tags.
The GitHub release and licensed-build dispatch follow that promotion.

A failed check leaves the candidate available for diagnosis but does not update
release tags. Local tests validate promotion arguments and workflow ordering;
the registry scan and publication run in GitHub Actions.
