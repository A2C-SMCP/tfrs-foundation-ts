# Cross-language feature matrix

This matrix records the baseline used to bootstrap the TypeScript package.
TFRSManager remains the contract source of truth; sibling repositories are
implementation references, not independent authorities.

| Capability | Python | Go | Rust | TypeScript target |
| --- | --- | --- | --- | --- |
| Contract constants and claims | Complete | Complete | Complete | Complete |
| `client_credentials` | Complete | Complete | Complete | Complete |
| PAT token exchange | Complete | Complete | Complete | Complete |
| User JWT token exchange | Complete | Complete | Complete | Complete |
| User JWT session-profile token exchange | Not present | Not present | Unknown | Complete |
| Token cache and early refresh | Complete | Complete | Complete | Complete |
| Concurrent refresh single-flight | Complete | Complete | Complete | Complete |
| Bounded transient retry | Complete | Complete | Complete | Complete |
| Bearer injection and one 401 retry | Complete | Complete | Complete | Complete |
| Static JWKS RS256 verification | Complete | Complete | Complete | Complete |
| Remote JWKS cache and refresh limiting | Complete | Partial | Partial | Complete |
| AS/PR discovery metadata | Complete | Not present | Not present | Complete |
| Server enforcement middleware | Out of scope | Out of scope | Out of scope | Out of scope |

TypeScript deliberately exposes asynchronous APIs only because platform
`fetch`, WebCrypto, and modern TypeScript runtimes are asynchronous at the
relevant I/O and key-import boundaries.

Session-profile token exchange mirrors the delivered Manager contract TFRM-189
(`token_profile=session`, user subjects only). The Go sibling was verified
against its CNB repository (no `token_profile` traces); the Python baseline has
no session-profile cases (the TypeScript ones are additions, see
`test-parity.md`); the Rust column is unverified and marked Unknown.
