# `@turingfocus/tfrs-auth` release guide

The CNB repository is the source of truth. The public GitHub repository
`A2C-SMCP/tfrs-foundation-ts` is the npm release surface and must contain the
same `main` commit before a release starts.

## One-time bootstrap

The package must exist on npm before npm Trusted Publishing can be configured.
Publish `0.1.0` once from an interactive npm session with 2FA:

```bash
npm login
pnpm install --frozen-lockfile
pnpm check
pnpm exec npm pack --dry-run ./packages/tfrs-auth
pnpm exec npm publish ./packages/tfrs-auth --access public
```

Then open the npm package settings and create this Trusted Publisher:

- Provider: GitHub Actions
- Organization: `A2C-SMCP`
- Repository: `tfrs-foundation-ts`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

After the first OIDC release succeeds, set Publishing access to **Require
two-factor authentication and disallow tokens**.

## Synchronize CNB to GitHub

Configure the GitHub mirror as a second remote once per clone:

```bash
git remote add github https://github.com/A2C-SMCP/tfrs-foundation-ts.git
```

After a release PR is merged in CNB, synchronize the exact main commit:

```bash
git switch main
git pull --ff-only origin main
git push github main
```

Do not author independent commits on the GitHub mirror.

## Publish a subsequent version

1. Update `packages/tfrs-auth/package.json` to the next SemVer version.
2. Run `pnpm check` and merge the change through CNB.
3. Synchronize CNB `main` to GitHub.
4. In GitHub Actions, run **tfrs-foundation-ts protected npm release** from
   `main` and enter the exact package version.
5. Confirm the workflow publishes the package and creates the matching `v*`
   GitHub release.
