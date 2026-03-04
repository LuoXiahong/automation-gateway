import fetch, { Response } from "node-fetch";

export interface HttpClient {
  post(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
}

export function createHttpClient(): HttpClient {
  return {
    async post(
      url: string,
      body: unknown,
      headers?: Record<string, string>,
    ): Promise<Response> {
      return fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(headers ?? {}),
        },
        body: JSON.stringify(body),
        // Basic timeout to avoid hanging connections
        // AbortSignal.timeout is available in Node.js 18+
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signal: (AbortSignal as any).timeout
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (AbortSignal as any).timeout(5000)
          : undefined,
      });
    },
  };
}

