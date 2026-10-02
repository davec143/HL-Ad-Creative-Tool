# ADR 0002: Google Workspace SSO

- **Status:** Proposed. The current mechanism is a shared team password with signed, expiring, server-revocable sessions (Phase 4).
- **Date:** 2026-10-02

## Context

A shared password has three limits:
- it can't identify **who** approved an override or resolved an unconfirmed render: the actor is recorded only as `team-session:<id>`;
- it can't be revoked per person;
- it gets shared outside the team.

HitLights uses Google Workspace (`@hitlights.com`).

## Proposal

Use OpenID Connect against Google: authorization code flow with PKCE and the `openid email profile` scopes.

- **Allow-list.** Only verified `@hitlights.com` accounts (the `hd` claim plus `email_verified`), optionally narrowed by an `ALLOWED_EMAILS` list.
- **Sessions** stay as they are today (signed, expiring, server-side revocation). The payload gains `sub` and `email`, and `actorOf()` returns the email, so overrides, fidelity approvals and render decisions are attributed to a person.
- **Configuration.** New variables: `GOOGLE_OIDC_CLIENT_ID`, `GOOGLE_OIDC_CLIENT_SECRET`, `ALLOWED_DOMAIN=hitlights.com`. The redirect URI is `PUBLIC_URL/auth/google/callback`.
- **Fallback.** The password login stays available behind `AUTH_MODE=password|google|both` for break-glass access.
- **Security.** Reuse the single-use, session-bound state pattern built for Higgsfield OAuth, and verify the ID token against Google's JWKS (issuer, audience, expiry, nonce).

## Cost and risk

About a day of work. It needs a Google Cloud OAuth client (internal consent screen) set up by the Workspace admin. There's no impact on render safety or delivery gates.
