import { describe, expect, it, vi } from "vitest";

import {
  DiscoveryError,
  fetchAuthorizationServerMetadata,
  fetchProtectedResourceMetadata,
  parseAuthorizationServerMetadata,
  parseProtectedResourceMetadata,
  TransportError,
} from "../src/index.js";

const AS_URL = "https://accounts.example.test";
const PR_URL = "https://api.example.test";

function asData(): Record<string, unknown> {
  return {
    issuer: AS_URL,
    authorization_endpoint: `${AS_URL}/authorize`,
    token_endpoint: `${AS_URL}/token`,
    jwks_uri: `${AS_URL}/jwks`,
  };
}

function prData(): Record<string, unknown> {
  return {
    resource: PR_URL,
    authorization_servers: [AS_URL],
  };
}

describe("Python parity: test_discovery.py", () => {
  it("parses required AS metadata fields", () => {
    const metadata = parseAuthorizationServerMetadata(asData());
    expect(metadata).toMatchObject({
      issuer: AS_URL,
      authorizationEndpoint: `${AS_URL}/authorize`,
      tokenEndpoint: `${AS_URL}/token`,
      jwksUri: `${AS_URL}/jwks`,
    });
  });

  it("rejects AS metadata missing issuer", () => {
    expect(() => parseAuthorizationServerMetadata({})).toThrow(/issuer/u);
  });

  it("rejects AS metadata missing jwks_uri", () => {
    const data = asData();
    Reflect.deleteProperty(data, "jwks_uri");
    expect(() => parseAuthorizationServerMetadata(data)).toThrow(/jwks_uri/u);
  });

  it("parses optional AS fields and preserves unknown fields", () => {
    const metadata = parseAuthorizationServerMetadata({
      ...asData(),
      revocation_endpoint: `${AS_URL}/revoke`,
      scopes_supported: ["chat:read", "a2a:invoke"],
      code_challenge_methods_supported: ["S256"],
      unknown_future_field: "kept",
    });
    expect(metadata.revocationEndpoint).toBe(`${AS_URL}/revoke`);
    expect(metadata.scopesSupported).toEqual(["chat:read", "a2a:invoke"]);
    expect(metadata.codeChallengeMethodsSupported).toEqual(["S256"]);
    expect(metadata.extra).toEqual({ unknown_future_field: "kept" });
  });

  it("parses required protected-resource metadata fields", () => {
    const metadata = parseProtectedResourceMetadata(prData());
    expect(metadata.resource).toBe(PR_URL);
    expect(metadata.authorizationServers).toEqual([AS_URL]);
  });

  it("rejects protected-resource metadata missing resource", () => {
    expect(() => parseProtectedResourceMetadata({})).toThrow(/resource/u);
  });

  it("rejects protected-resource metadata missing authorization_servers", () => {
    expect(() =>
      parseProtectedResourceMetadata({ resource: PR_URL }),
    ).toThrow(/authorization_servers/u);
  });

  it("parses optional resource fields and preserves unknown fields", () => {
    const metadata = parseProtectedResourceMetadata({
      ...prData(),
      scopes_supported: ["chat:read"],
      bearer_methods_supported: ["header"],
      unknown_future_field: "kept",
    });
    expect(metadata.scopesSupported).toEqual(["chat:read"]);
    expect(metadata.bearerMethodsSupported).toEqual(["header"]);
    expect(metadata.extra).toEqual({ unknown_future_field: "kept" });
  });

  it("fetches AS metadata from its well-known endpoint", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe(`${AS_URL}/.well-known/oauth-authorization-server`);
      return Response.json(asData());
    });
    expect((await fetchAuthorizationServerMetadata(AS_URL, fetchFn)).issuer).toBe(
      AS_URL,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps an AS metadata HTTP error to TransportError", async () => {
    await expect(
      fetchAuthorizationServerMetadata(
        AS_URL,
        vi.fn(async () => new Response(null, { status: 404 })),
      ),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it("maps invalid AS metadata JSON to DiscoveryError", async () => {
    await expect(
      fetchAuthorizationServerMetadata(
        AS_URL,
        vi.fn(async () => new Response("<html>nope</html>")),
      ),
    ).rejects.toBeInstanceOf(DiscoveryError);
  });

  it("fetches protected-resource metadata", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe(`${PR_URL}/.well-known/oauth-protected-resource`);
      return Response.json(prData());
    });
    const metadata = await fetchProtectedResourceMetadata(PR_URL, fetchFn);
    expect(metadata.resource).toBe(PR_URL);
    expect(metadata.authorizationServers).toEqual([AS_URL]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps a protected-resource HTTP error to TransportError", async () => {
    await expect(
      fetchProtectedResourceMetadata(
        PR_URL,
        vi.fn(async () => new Response(null, { status: 503 })),
      ),
    ).rejects.toBeInstanceOf(TransportError);
  });

  it("maps invalid protected-resource JSON to DiscoveryError", async () => {
    await expect(
      fetchProtectedResourceMetadata(
        PR_URL,
        vi.fn(async () => new Response("not-json")),
      ),
    ).rejects.toBeInstanceOf(DiscoveryError);
  });

  it("rejects a protected-resource JSON array", async () => {
    await expect(
      fetchProtectedResourceMetadata(
        PR_URL,
        vi.fn(async () => Response.json(["a", "b"])),
      ),
    ).rejects.toBeInstanceOf(DiscoveryError);
  });

  it("uses the caller-supplied fetch implementation", async () => {
    const externalFetch = vi.fn<typeof fetch>(async () => Response.json(prData()));
    const metadata = await fetchProtectedResourceMetadata(PR_URL, externalFetch);
    expect(metadata.resource).toBe(PR_URL);
    expect(externalFetch).toHaveBeenCalledTimes(1);
  });

  it("inserts well-known suffixes before path and resource query", async () => {
    await fetchAuthorizationServerMetadata(
      `${AS_URL}/tenant`,
      vi.fn(async (input) => {
        expect(input).toBe(
          `${AS_URL}/.well-known/oauth-authorization-server/tenant`,
        );
        return Response.json({ ...asData(), issuer: `${AS_URL}/tenant` });
      }),
    );
    await fetchProtectedResourceMetadata(
      `${PR_URL}/tenant?region=cn`,
      vi.fn(async (input) => {
        expect(input).toBe(
          `${PR_URL}/.well-known/oauth-protected-resource/tenant?region=cn`,
        );
        return Response.json({
          ...prData(),
          resource: `${PR_URL}/tenant?region=cn`,
        });
      }),
    );
  });

  it("rejects metadata identity mismatches", async () => {
    await expect(
      fetchAuthorizationServerMetadata(
        AS_URL,
        vi.fn(async () =>
          Response.json({ ...asData(), issuer: "https://attacker.example" }),
        ),
      ),
    ).rejects.toThrow(/issuer mismatch/u);
    await expect(
      fetchProtectedResourceMetadata(
        PR_URL,
        vi.fn(async () =>
          Response.json({ ...prData(), resource: "https://attacker.example" }),
        ),
      ),
    ).rejects.toThrow(/resource mismatch/u);
  });

  it("rejects insecure or fragmented discovery identifiers", async () => {
    await expect(
      fetchAuthorizationServerMetadata("http://accounts.example.test"),
    ).rejects.toBeInstanceOf(DiscoveryError);
    await expect(
      fetchProtectedResourceMetadata(`${PR_URL}/#fragment`),
    ).rejects.toBeInstanceOf(DiscoveryError);
  });

  it("maps discovery network failures to TransportError with the cause", async () => {
    const networkError = new TypeError("connection refused");
    await expect(
      fetchAuthorizationServerMetadata(
        AS_URL,
        vi.fn(async () => Promise.reject(networkError)),
      ),
    ).rejects.toMatchObject({
      name: new TransportError().name,
      cause: networkError,
    });
  });

  it("rejects invalid and credential-bearing discovery identifiers", async () => {
    await expect(
      fetchAuthorizationServerMetadata("not a URL"),
    ).rejects.toBeInstanceOf(DiscoveryError);
    await expect(
      fetchProtectedResourceMetadata("https://user:secret@api.example.test"),
    ).rejects.toThrow(/user information/u);
  });
});
