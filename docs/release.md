# `@turingfocus/tfrs-auth` release guide（CNB 流水线）

CNB 仓库（`turingfocus/foundation/tfrs-foundation-ts`）是唯一权威来源，CI/CD 均由 CNB
流水线（`.cnb.yml`）承担：`pnpm check` 全关卡作为合并门禁，`vX.Y.Z` tag 触发发布到 npm
并创建 CNB Release。GitHub 镜像 `A2C-SMCP/tfrs-foundation-ts` 处于过渡期，仅保留
main 同步，删除 GitHub 仓库后该步取消。

## 流水线总览（.cnb.yml）

| 事件 | 流水线 | 内容 |
|------|--------|------|
| `main` push / pull_request | `lint-and-test` | corepack 固定 pnpm 10.14.0 → `pnpm install --frozen-lockfile` → `pnpm check` → `npm pack --dry-run` |
| `v*` tag_push | `build-and-publish` | 版本一致性校验 → `pnpm check` → 幂等 `npm publish`（NPM_TOKEN 经密钥仓库注入） |
| `v*` tag_push | `create-cnb-release`（`git:release`） | 自动为 tag 创建 CNB Release（含源码包，与发布并行） |

## One-time bootstrap（凭据迁移：GitHub OIDC → CNB 密钥仓库）

GitHub 的 npm Trusted Publishing（OIDC）在 CNB 不可用（npmjs 仅认 GitHub/GitLab 等固定
provider），迁移方案为 **npm granular access token + CNB 密钥仓库 `imports`**（与 Python
侧 `UV_PUBLISH_TOKEN` 同一模式）。

1. npmjs.com → Access Tokens → **Generate New Token → Granular Access Token**：
   - Package scope：`@turingfocus`（或精确到 `@turingfocus/tfrs-auth`）
   - Permissions：**Publish**（read and write）
   - **Automation** 勾选（绕过 OTP，供流水线使用）
2. npm 账户 2FA 设置：若当前为「Require two-factor authentication **and disallow
   tokens**」（GitHub OIDC 引导时设置），需改为「Require two-factor authentication」
   （允许 token；启用 Automation 的 granular token 发布无需 OTP，人为登录仍走 2FA）。
3. 在 CNB **密钥仓库**（如 `turingfocus/build_env`，网页端受审计编辑，禁止本地推送）
   的 `main` 分支维护 `tfrs_foundation.yaml`：

   ```yaml
   # 仅限本仓的 tag_push 流水线可引用（精细化授权，越权直接拒绝）
   allow_slugs:
     - turingfocus/foundation/tfrs-foundation-ts
   allow_events:
     - tag_push
   # npm publish 从 .npmrc 读取；token 不出现在命令行/日志
   NPM_TOKEN: npm_XXXXXXXXXXXXXXXXXXXXXXXX
   ```

   `.cnb.yml` 已配好引用（无需改动）：

   ```yaml
   imports:
     - https://cnb.cool/turingfocus/build_env/-/blob/main/tfrs_foundation.yaml
   ```

**轮换 token**：只改密钥仓库里 `NPM_TOKEN` 的值，引用它的流水线下次自动取新值。

## 发布一个新版本

1. **bump 版本**：更新 `packages/tfrs-auth/package.json` 的 `version`（SemVer）。
2. **全关卡校验**：本地 `pnpm check` 通过后提交，经 CNB MR 合入 `main`
   （`lint-and-test` 流水线为合并门禁）。
3. **打 tag 触发发布**：

   ```bash
   git switch main
   git pull --ff-only cnb main
   git tag v0.2.0
   git push cnb v0.2.0
   ```

   `v*` tag_push 触发 `build-and-publish`，依次完成：
   - 版本一致性校验：tag 去掉 `v` 前缀必须等于 `packages/tfrs-auth/package.json` 的
     `version`（不等即失败，替代 GitHub 时代的 `expected-version` 手工输入）
   - 完整发布关卡 `pnpm check` + `npm pack --dry-run`
   - 幂等 `npm publish`（版本已在 npm 则跳过）
   - `git:release` 并行创建 CNB Release（含源码 .zip/.tar 附件）
4. **验收**：
   - CNB 构建日志全部 stage/job 通过
   - `https://www.npmjs.com/package/@turingfocus/tfrs-auth` 可见新版本
   - CNB 仓库 Releases 页出现 `vX.Y.Z`（源码包附件）

发布失败重试：修好问题后**升一个版本号**重新走流程（版本已发布时幂等跳过，不会重复发布）。

## 过渡期：CNB → GitHub 同步（删除 GitHub 仓库前）

GitHub 镜像只做同步，不承载发布。CNB 合并/打 tag 后同步 exact commit：

```bash
git pull --ff-only cnb main
git push origin main
git push origin v0.2.0     # 保留镜像 tag，便于源码跳转
```

切勿在镜像上独立创建提交。GitHub 的 `.github/workflows` 在 CNB 发布验收通过后退役
（见下），删除 GitHub 仓库后本步全部取消。

## 退役 GitHub 发布（CNB 验收通过后）

1. 删除 `.github/workflows/`（ci.yml + publish.yml），提交推 CNB → 同步 GitHub。
2. npm 设置：移除 GitHub Actions Trusted Publisher（OIDC 不再使用）；保留上述
   granular access token 设置。
3. 确认 CNB 流水线独立闭环后，删除 GitHub 镜像仓库，删除本文件的同步章节。

## 发布检查清单

- [ ] `packages/tfrs-auth/package.json` 的 `version` 已按 SemVer bump
- [ ] 本地 `pnpm check` 全绿（lint + strict typecheck + coverage 阈值 + build）
- [ ] 变更经 CNB MR 合入 `main`，`lint-and-test` 通过
- [ ] `git tag vX.Y.Z && git push cnb vX.Y.Z` 触发 `build-and-publish`
- [ ] 构建日志：版本一致性校验通过、`pnpm check` 通过、`npm publish` 成功
- [ ] npm 包页可见新版本；CNB Releases 页有 `vX.Y.Z` 及源码附件
