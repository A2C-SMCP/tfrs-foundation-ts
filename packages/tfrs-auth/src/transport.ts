import type { TokenSource } from "./client.js";

/**
 * Wrap fetch with Bearer injection. A 401 invalidates the source and retries
 * exactly once using a request clone prepared before the first body is consumed.
 */
export function createBearerFetch(
  tokenSource: TokenSource,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const retryRequest = request.clone();
    const token = await tokenSource.token();
    request.headers.set(
      "Authorization",
      `${token.tokenType} ${token.accessToken}`,
    );

    const response = await fetchFn(request);
    if (response.status !== 401) return response;

    tokenSource.invalidate();
    const refreshed = await tokenSource.token();
    retryRequest.headers.set(
      "Authorization",
      `${refreshed.tokenType} ${refreshed.accessToken}`,
    );
    return fetchFn(retryRequest);
  };
}
