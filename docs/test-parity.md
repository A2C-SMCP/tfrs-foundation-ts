# Python test parity

The Python package is the behavioral test baseline for `@turingfocus/tfrs-auth`. TypeScript
uses asynchronous platform APIs only, so Python sync/async duplicates map to one
TypeScript case. Parameterized wire and error cases remain independently counted.

| Python baseline | TypeScript suite | Python semantic cases | TypeScript cases |
| --- | --- | ---: | ---: |
| `test_client_cache.py` | `client-cache.test.ts` | 7 | 11 |
| `test_client_credentials.py` | `client-credentials.test.ts` | 8 | 15 |
| `test_contract.py` | `contract.test.ts` | 13 | 16 |
| `test_discovery.py` | `discovery.test.ts` | 16 | 21 |
| `test_e2e.py` | `e2e.test.ts` | 3 | 3 (gated) |
| `test_pat.py` | `pat.test.ts` | 11 | 11 |
| `test_transport.py` | `transport.test.ts` | 3 | 3 |
| `test_user_jwt.py` | `user-jwt.test.ts` | 12 | 21 |
| `test_verify.py` | `verify.test.ts` | 23 | 29 |
| **Total** |  | **96** | **130** |

The additional TypeScript cases lock fixes and runtime-specific failure paths:
generic gateway and network retries, malformed token responses, strict claim
typing, RFC well-known path and identity binding, malformed or unreachable JWKS,
JWKS refresh single-flight, and the session-profile token exchange (TFRM-189):
wire field rendering, default-profile zero regression, unknown-profile boundary
rejection, server `expires_in` honoring, per-source cache isolation, token
secrecy in errors, and machine-identity type boundaries.

## Local gates

```bash
pnpm test           # L1: 127 pass, three gated E2E cases skip without credentials
pnpm test:coverage  # L1 plus enforced repository coverage thresholds
pnpm check          # lint + strict typecheck + coverage gate + package build
```

Coverage cannot regress below 90% statements, 85% branches, 95% functions, or
90% lines.

## Live Manager E2E

Copy `.env.example`, export the relevant values in the shell, and run:

```bash
pnpm test:e2e
```

Each grant is gated independently. Supplying only one grant's variables runs
that grant and skips the other two. When `TFRS_AUTH_E2E_JWKS_URL` is supplied,
the returned access token is also verified with the real JWKS endpoint.
