# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中编写代码时提供指导。

## 概述

pnpm monorepo，包含镜像 TFRSManager 维护的 TFRS OAuth 契约的可复用、框架无关的 TypeScript SDK 包。目前只有一个包：`@turingfocus/tfrs-auth`（令牌交换、缓存、Bearer 注入、JWT/JWKS 验证、OAuth 发现）。服务端中间件和授权强制实施被刻意排除在外。仅 ESM（`"type": "module"`、NodeNext 解析、相对导入使用 `.js` 扩展名）。

## 命令

需要 Node ≥ 20（`.nvmrc` 固定为 24）和 pnpm 10（若固定版本 `packageManager` 未生效，先运行 `corepack enable`）。

```bash
pnpm install          # 安装依赖
pnpm check            # 完整关卡:lint + typecheck + coverage + build(CI 运行此命令)
pnpm lint             # eslint .(strictTypeChecked + stylisticTypeChecked)
pnpm typecheck        # 每个包运行 tsc --noEmit
pnpm test             # vitest run(封闭测试套件)
pnpm test:watch       # vitest 监听模式
pnpm test:coverage    # vitest 并强制覆盖率阈值:
                      #   statements ≥90, branches ≥85, functions ≥95, lines ≥90
pnpm test:e2e         # 针对真实 TFRS Manager 的测试;由 TFRS_AUTH_E2E=1 及 .env.example 中的变量控制
pnpm build            # tsup(ESM + dts + sourcemap)逐包构建
```

单个测试文件: `pnpm exec vitest run packages/tfrs-auth/test/verify.test.ts`（可加 `-t <name>` 过滤单个用例）。E2E 的每种授权类型各自独立控制——只需设置一种授权类型的变量即可单独运行该授权。

## 架构

- `packages/tfrs-auth/src/contract.ts` — 镜像的 TFRS 契约注册表:scope 名称、授权类型/令牌类型、OAuth 错误码、claim 常量,以及 `Claims` 类(严格载荷解析)。**TFRSManager 是契约的权威来源——切勿在此先更改线上常量或 claim 语义**(文件头注释如此声明)。
- `src/credentials.ts` — `Credential` 接口;`ClientCredentials`(robot)、`PatCredential`、`UserJwtCredential`。每个都渲染出 OAuth 请求表单。
- `src/exchange.ts` — 表单构建器和 `parseTokenResponse`(成功解析、错误码映射、HTTP 402 → `PaymentRequiredError` 含 renew URL、429 → `RateLimitedError`)。
- `src/errors.ts` — 以 `TfrsAuthError` 为根的层级;通过 `typedExchangeError` 构建的类型化 OAuth 错误类,由 `fromOAuthError` 分发。
- `src/client.ts` — `Token`、`TokenSource` 和 `CachingTokenSource`:带 30 秒过期偏移(默认)的缓存令牌、单飞(inflight)交换(代数计数器,`invalidate()` 递增代数)、有界指数退避重试(默认 2 次,针对 `TransportError` 和可重试的交换错误)。
- `src/transport.ts` — `createBearerFetch`:注入 Bearer;收到 401 时使缓存失效、刷新一次,并在首次消费请求体之前获取的 `request.clone()` 上重试。
- `src/verify.ts` — `JwtVerifier`(静态 JWKS 或远程 JWKS,带 300 秒 TTL 缓存 + 10 秒最小刷新间隔,单飞刷新):通过 `jose` 进行 RS256 验证,严格校验契约 claim,可选 `requiredScope` 和撤销水印。
- `src/discovery.ts` — RFC 8414 AS 元数据和 RFC 9728 PR 元数据的获取/解析,以及 well-known URL 构建器(后缀插入在 issuer 路径之前)。

依赖面刻意保持最小:只有 `jose`(加密)。其余全部使用平台 `fetch`/WebCrypto。所有 I/O 和密钥导入边界都按设计是异步的(参见 `docs/feature-matrix.md`)。

## 约定

- **测试对等**:九个测试文件镜像 Python 参考套件(映射和用例数量见 `docs/test-parity.md`)。增删用例时保持该表同步;额外的 TypeScript 用例覆盖运行时特有的失败路径(重试、畸形响应、JWKS 刷新)。
- **时间注入**:`CachingTokenSource` 和 `JwtVerifier` 接受可注入的 `clock()`(source 还有 `sleep()`)— 测试使用假时钟,而非真实定时器。
- **严格性被强制**:已启用 `exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`;eslint 运行严格类型检查规则。新代码必须同时通过 `pnpm typecheck` 和 `pnpm lint`。
- **发布流程**:CNB 仓库是权威来源,CI/CD 由 CNB 流水线(`.cnb.yml`)承载——`main` push / MR 跑 `pnpm check` 门禁;`vX.Y.Z` tag 推送触发 npm 发布(版本一致性校验 + `NPM_TOKEN` 经密钥仓库 `build_env` imports 注入)+ `git:release` 自动创建 CNB Release。参见 `docs/release.md`。GitHub 镜像 `A2C-SMCP/tfrs-foundation-ts` 处于删除前的过渡期(仅保持同步),切勿直接在镜像上创建提交。

Python/Go/Rust 兄弟实现可克隆到 `.references/`(已被 git 忽略)用于交叉参考。
