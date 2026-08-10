import { describe, expect, it, vi } from "vitest";

import {
  CachingTokenSource,
  ClientCredentials,
  createBearerFetch,
} from "../src/index.js";

const TOKEN_URL = "https://user.example.test/api/v1/oauth/token";
const API_URL = "https://api.example.test/data";

function tokenResponse(accessToken: string): Response {
  return Response.json({
    access_token: accessToken,
    issued_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_type: "Bearer",
    expires_in: 300,
    scope: "config:read",
  });
}

function source(fetchFn: typeof fetch): CachingTokenSource {
  return new CachingTokenSource(
    new ClientCredentials({
      clientId: "turingfocus:000001",
      clientSecret: "tfp_x",
      audience: "robot:turingfocus:000042",
    }),
    { tokenUrl: TOKEN_URL, fetch: fetchFn },
  );
}

describe("Python parity: test_transport.py", () => {
  it("injects Bearer and returns a successful response", async () => {
    const tokenFetch = vi.fn<typeof fetch>(async () => tokenResponse("jwt_A"));
    const apiFetch = vi.fn<typeof fetch>(async (input) => {
      expect((input as Request).headers.get("Authorization")).toBe(
        "Bearer jwt_A",
      );
      return Response.json({ ok: true });
    });
    const response = await createBearerFetch(source(tokenFetch), apiFetch)(API_URL);
    expect(response.status).toBe(200);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it("invalidates on 401, refreshes, and retries once with the new token", async () => {
    const tokenFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("jwt_A"))
      .mockResolvedValueOnce(tokenResponse("jwt_B"));
    const seen: string[] = [];
    const apiFetch = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      seen.push(request.headers.get("Authorization") ?? "");
      expect(await request.text()).toBe("payload");
      return new Response(null, { status: seen.length === 1 ? 401 : 200 });
    });
    const response = await createBearerFetch(source(tokenFetch), apiFetch)(API_URL, {
      method: "POST",
      body: "payload",
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual(["Bearer jwt_A", "Bearer jwt_B"]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });

  it("returns the second 401 without retrying forever", async () => {
    const tokenFetch = vi.fn<typeof fetch>(async () => tokenResponse("jwt_A"));
    const apiFetch = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 401 }),
    );
    const response = await createBearerFetch(source(tokenFetch), apiFetch)(API_URL);
    expect(response.status).toBe(401);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(tokenFetch).toHaveBeenCalledTimes(2);
  });
});
