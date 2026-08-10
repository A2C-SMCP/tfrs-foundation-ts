import {
  AS_METADATA_WELL_KNOWN_PATH,
  PR_METADATA_WELL_KNOWN_PATH,
} from "./contract.js";
import { DiscoveryError, TransportError } from "./errors.js";

export type AuthorizationServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  revocationEndpoint: string | undefined;
  introspectionEndpoint: string | undefined;
  responseTypesSupported: string[];
  codeChallengeMethodsSupported: string[] | undefined;
  scopesSupported: string[] | undefined;
  extra: Readonly<Record<string, unknown>>;
};

export type ProtectedResourceMetadata = {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[] | undefined;
  bearerMethodsSupported: string[] | undefined;
  extra: Readonly<Record<string, unknown>>;
};

export async function fetchAuthorizationServerMetadata(
  issuer: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<AuthorizationServerMetadata> {
  const metadataUrl = authorizationServerMetadataUrl(issuer);
  const metadata = parseAuthorizationServerMetadata(
    await fetchJson(metadataUrl, fetchFn),
  );
  if (metadata.issuer !== issuer) {
    throw new DiscoveryError(
      `AS metadata issuer mismatch: expected=${issuer}, actual=${metadata.issuer}`,
    );
  }
  return metadata;
}

export async function fetchProtectedResourceMetadata(
  resourceUrl: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<ProtectedResourceMetadata> {
  const metadataUrl = protectedResourceMetadataUrl(resourceUrl);
  const metadata = parseProtectedResourceMetadata(
    await fetchJson(metadataUrl, fetchFn),
  );
  if (metadata.resource !== resourceUrl) {
    throw new DiscoveryError(
      `PR metadata resource mismatch: expected=${resourceUrl}, actual=${metadata.resource}`,
    );
  }
  return metadata;
}

/** Build an RFC 8414 metadata URL by inserting the suffix before issuer path. */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = parseIdentifier(issuer, "authorization server issuer");
  if (url.search !== "") {
    throw new DiscoveryError("Authorization server issuer must not contain query");
  }
  return insertedWellKnownUrl(url, AS_METADATA_WELL_KNOWN_PATH);
}

/** Build an RFC 9728 metadata URL, preserving an optional resource query. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = parseIdentifier(resource, "protected resource identifier");
  return insertedWellKnownUrl(url, PR_METADATA_WELL_KNOWN_PATH);
}

export function parseAuthorizationServerMetadata(
  data: Readonly<Record<string, unknown>>,
): AuthorizationServerMetadata {
  const required = [
    "issuer",
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ] as const;
  for (const key of required) {
    if (!nonEmptyString(data[key])) {
      throw new DiscoveryError(`AS metadata is missing required field: ${key}`);
    }
  }
  const known = new Set<string>([
    ...required,
    "revocation_endpoint",
    "introspection_endpoint",
    "response_types_supported",
    "code_challenge_methods_supported",
    "scopes_supported",
  ]);
  return {
    issuer: String(data.issuer),
    authorizationEndpoint: String(data.authorization_endpoint),
    tokenEndpoint: String(data.token_endpoint),
    jwksUri: String(data.jwks_uri),
    revocationEndpoint: optionalString(data.revocation_endpoint),
    introspectionEndpoint: optionalString(data.introspection_endpoint),
    responseTypesSupported: stringArray(data.response_types_supported) ?? ["code"],
    codeChallengeMethodsSupported: stringArray(
      data.code_challenge_methods_supported,
    ),
    scopesSupported: stringArray(data.scopes_supported),
    extra: extraFields(data, known),
  };
}

export function parseProtectedResourceMetadata(
  data: Readonly<Record<string, unknown>>,
): ProtectedResourceMetadata {
  const resource = nonEmptyString(data.resource);
  if (resource === undefined) {
    throw new DiscoveryError("PR metadata is missing required field: resource");
  }
  const authorizationServers = stringArray(data.authorization_servers);
  if (authorizationServers === undefined || authorizationServers.length === 0) {
    throw new DiscoveryError(
      "PR metadata is missing required field: authorization_servers",
    );
  }
  const known = new Set([
    "resource",
    "authorization_servers",
    "scopes_supported",
    "bearer_methods_supported",
  ]);
  return {
    resource,
    authorizationServers,
    scopesSupported: stringArray(data.scopes_supported),
    bearerMethodsSupported: stringArray(data.bearer_methods_supported),
    extra: extraFields(data, known),
  };
}

async function fetchJson(
  url: string,
  fetchFn: typeof globalThis.fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new TransportError(`Discovery request failed: ${url}`, {
      cause: error,
    });
  }
  if (response.status !== 200) {
    throw new TransportError(
      `Discovery endpoint returned HTTP ${String(response.status)}: ${url}`,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new DiscoveryError(`Discovery response is not JSON: ${url}`, {
      cause: error,
    });
  }
  if (!isRecord(data)) {
    throw new DiscoveryError(`Discovery response is not a JSON object: ${url}`);
  }
  return data;
}

function parseIdentifier(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new DiscoveryError(`Invalid ${label}`, { cause: error });
  }
  if (url.protocol !== "https:") {
    throw new DiscoveryError(`${label} must use https`);
  }
  if (url.hash !== "") {
    throw new DiscoveryError(`${label} must not contain fragment`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new DiscoveryError(`${label} must not contain user information`);
  }
  return url;
}

function insertedWellKnownUrl(url: URL, suffix: string): string {
  const path = url.pathname.replace(/\/+$/u, "");
  return `${url.origin}${suffix}${path}${url.search}`;
}

function optionalString(value: unknown): string | undefined {
  return primitiveString(value);
}

function nonEmptyString(value: unknown): string | undefined {
  const result = optionalString(value);
  return result === "" ? undefined : result;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return (value as unknown[]).map(primitiveString).filter(isString);
}

function primitiveString(value: unknown): string | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
    ? String(value)
    : undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraFields(
  data: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !known.has(key)),
  );
}
