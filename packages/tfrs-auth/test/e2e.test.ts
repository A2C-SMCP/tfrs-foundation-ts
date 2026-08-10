import { describe, expect, it } from "vitest";

import {
  CachingTokenSource,
  ClientCredentials,
  JwtVerifier,
  PatCredential,
  type Token,
  UserJwtCredential,
} from "../src/index.js";

const enabled = process.env.TFRS_AUTH_E2E === "1";

function ready(...names: string[]): boolean {
  return enabled && names.every((name) => Boolean(process.env[name]));
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
}

async function assertVerifies(
  token: Token,
  audience: string,
  scopeEnvironmentName: string,
): Promise<void> {
  const jwksUrl = process.env.TFRS_AUTH_E2E_JWKS_URL;
  if (!jwksUrl) return;
  const verifier = JwtVerifier.fromUrl(jwksUrl, {
    ...(process.env.TFRS_AUTH_E2E_ISSUER
      ? { issuer: process.env.TFRS_AUTH_E2E_ISSUER }
      : {}),
    audience,
  });
  const claims = await verifier.verify(token.accessToken);
  expect(claims.aud).toBe(audience);
  expect(claims.exp).toBeGreaterThan(claims.iat);
  const expectedScope = process.env[scopeEnvironmentName];
  if (expectedScope) {
    expect(claims.scopes.every((scope) => expectedScope.split(/\s+/u).includes(scope))).toBe(
      true,
    );
  }
}

async function loginUserJwt(phone: string, password: string): Promise<string> {
  const tokenUrl = new URL(required("TFRS_AUTH_E2E_TOKEN_URL"));
  const response = await fetch(
    new URL("/auth/login-by-password", tokenUrl.origin),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`E2E login failed with HTTP ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("E2E login response is not an object");
  }
  const record = body as Record<string, unknown>;
  const payload =
    typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : record;
  if (typeof payload.token !== "string" || payload.token === "") {
    throw new Error(`E2E login returned no token; top-level keys=${Object.keys(record).join(",")}`);
  }
  return payload.token;
}

describe("Python parity: test_e2e.py (gated live Manager)", () => {
  it.skipIf(
    !ready(
      "TFRS_AUTH_E2E_TOKEN_URL",
      "TFRS_AUTH_E2E_CLIENT_ID",
      "TFRS_AUTH_E2E_CLIENT_SECRET",
      "TFRS_AUTH_E2E_AUDIENCE",
    ),
  )("exchanges real client_credentials and verifies the JWT", async () => {
    const audience = required("TFRS_AUTH_E2E_AUDIENCE");
    const token = await new CachingTokenSource(
      new ClientCredentials({
        clientId: required("TFRS_AUTH_E2E_CLIENT_ID"),
        clientSecret: required("TFRS_AUTH_E2E_CLIENT_SECRET"),
        audience,
        ...(process.env.TFRS_AUTH_E2E_SCOPE
          ? { scope: process.env.TFRS_AUTH_E2E_SCOPE }
          : {}),
      }),
      { tokenUrl: required("TFRS_AUTH_E2E_TOKEN_URL") },
    ).token();
    expect(token.accessToken).not.toBe("");
    expect(token.tokenType).toBe("Bearer");
    await assertVerifies(token, audience, "TFRS_AUTH_E2E_SCOPE");
  });

  it.skipIf(
    !ready(
      "TFRS_AUTH_E2E_TOKEN_URL",
      "TFRS_AUTH_E2E_PAT",
      "TFRS_AUTH_E2E_PAT_AUDIENCE",
    ),
  )("exchanges a real PAT and verifies the JWT", async () => {
    const audience = required("TFRS_AUTH_E2E_PAT_AUDIENCE");
    const token = await new CachingTokenSource(
      new PatCredential({
        pat: required("TFRS_AUTH_E2E_PAT"),
        audience,
        ...(process.env.TFRS_AUTH_E2E_PAT_SCOPE
          ? { scope: process.env.TFRS_AUTH_E2E_PAT_SCOPE }
          : {}),
      }),
      { tokenUrl: required("TFRS_AUTH_E2E_TOKEN_URL") },
    ).token();
    expect(token.accessToken).not.toBe("");
    expect(token.tokenType).toBe("Bearer");
    await assertVerifies(token, audience, "TFRS_AUTH_E2E_PAT_SCOPE");
  });

  it.skipIf(
    !ready(
      "TFRS_AUTH_E2E_TOKEN_URL",
      "TFRS_AUTH_E2E_LOGIN_PHONE",
      "TFRS_AUTH_E2E_LOGIN_PASSWORD",
      "TFRS_AUTH_E2E_USER_JWT_AUDIENCE",
    ),
  )("logs in, exchanges a real User JWT, and verifies it", async () => {
    const userJwt = await loginUserJwt(
      required("TFRS_AUTH_E2E_LOGIN_PHONE"),
      required("TFRS_AUTH_E2E_LOGIN_PASSWORD"),
    );
    const audience = required("TFRS_AUTH_E2E_USER_JWT_AUDIENCE");
    const token = await new CachingTokenSource(
      new UserJwtCredential({
        userJwt,
        audience,
        ...(process.env.TFRS_AUTH_E2E_USER_JWT_SCOPE
          ? { scope: process.env.TFRS_AUTH_E2E_USER_JWT_SCOPE }
          : {}),
      }),
      { tokenUrl: required("TFRS_AUTH_E2E_TOKEN_URL") },
    ).token();
    expect(token.accessToken).not.toBe("");
    expect(token.tokenType).toBe("Bearer");
    await assertVerifies(token, audience, "TFRS_AUTH_E2E_USER_JWT_SCOPE");
  });
});
