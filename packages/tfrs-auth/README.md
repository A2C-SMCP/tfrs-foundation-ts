# `@turingfocus/tfrs-auth`

Framework-independent TypeScript client primitives for TFRS access tokens.

```ts
import {
  CachingTokenSource,
  ClientCredentials,
  createBearerFetch,
  JwtVerifier,
} from "@turingfocus/tfrs-auth";

const credential = ClientCredentials.forRobot({
  clientId: "turingfocus:000101",
  clientSecret: process.env.TFRS_CLIENT_SECRET!,
  calleeOrgSlug: "turingfocus",
  calleeEmployeeNo: "000042",
  scope: ["a2a:invoke"],
});

const source = new CachingTokenSource(credential, {
  tokenUrl: "https://user.example.com/api/v1/oauth/token",
});

const authenticatedFetch = createBearerFetch(source);
await authenticatedFetch("https://api.example.com/data");

const verifier = JwtVerifier.fromUrl(
  "https://user.example.com/.well-known/jwks.json",
  {
    issuer: "https://user.example.com",
    audience: "robot:turingfocus:000042",
  },
);
const claims = await verifier.verify(accessToken, {
  requiredScope: "a2a:invoke",
});
```

TFRSManager is the source of truth for all mirrored wire contracts. Server-side
framework middleware and authorization enforcement are intentionally excluded.

## Session-profile tokens

A user subject can request the session-profile Robot access token (TFRM-189,
server-controlled TTL, default 12h) instead of the 5-minute connection profile
by setting `tokenProfile` on the credential. When omitted, the wire form
contains no `token_profile` field and the default profile applies:

```ts
import { TokenProfile, UserJwtCredential } from "@turingfocus/tfrs-auth";

const sessionCredential = new UserJwtCredential({
  userJwt,
  audience: "robot:turingfocus:000042",
  scope: ["a2a:invoke"],
  tokenProfile: TokenProfile.Session,
});
```

Only `UserJwtCredential` exposes `tokenProfile`; machine identities
(`ClientCredentials`, `PatCredential`) cannot express it, and unknown profile
values are rejected at the form boundary.

## Testing

The nine test files mirror the Python package suites. Run `pnpm test` for the
hermetic suite, `pnpm test:coverage` for enforced coverage thresholds, and
`pnpm test:e2e` for the three independently gated live Manager grants. The
complete mapping is documented in
[`../../docs/test-parity.md`](../../docs/test-parity.md).
