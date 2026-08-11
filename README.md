# tfrs-foundation-ts

TFRS TypeScript commons monorepo. It mirrors the shared contracts maintained by
TFRSManager and provides reusable, framework-independent SDK packages.

The first package is [`@turingfocus/tfrs-auth`](packages/tfrs-auth):

- TFRS OAuth contract constants and claim helpers
- PAT, user JWT, and `client_credentials` token exchange
- cached, single-flight token refresh with bounded retry
- Bearer injection with one refresh retry after HTTP 401
- OAuth discovery and RS256/JWKS verification

## Development

Requires Node.js 20 or newer and pnpm 10.

```bash
pnpm install
pnpm check
```

## Releases

The CNB repository remains the source of truth and is synchronized to the
public [`A2C-SMCP/tfrs-foundation-ts`](https://github.com/A2C-SMCP/tfrs-foundation-ts)
repository. npm releases run from the GitHub mirror through npm Trusted
Publishing. See [`docs/release.md`](docs/release.md) for the bootstrap and
release procedure.

The test suites maintain semantic parity with the Python reference. See
[`docs/test-parity.md`](docs/test-parity.md). Live Manager exchange tests are
available through `pnpm test:e2e` and are gated by `.env.example` variables.

The sibling Python, Go, and Rust implementations can be cloned into the local
`.references/` directory. That directory is intentionally ignored by Git.

## Contract boundary

TFRSManager is the source of truth. This repository mirrors its OAuth scope,
claim, error, grant, token-type, and JWKS contracts. Server middleware and
authorization enforcement remain in the consuming services.

## License

MIT © 2026 TuringFocus
