import fetch, { Response } from "node-fetch";

/** AbortSignal constructor with optional timeout (Node 18+). */
interface AbortSignalWithTimeout {
  timeout?(ms: number): AbortSignal;
}

/** Payload sent to n8n webhook for user plan (text or voice). */
export interface N8nWebhookPayload {
  chatId: number;
  text: string;
  fileUrl?: string;
}

export interface HttpClient {
  post(url: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
}

function getAbortSignalTimeout(): AbortSignal | undefined {
  const Ctor = globalThis.AbortSignal as AbortSignalWithTimeout | undefined;
  if (typeof Ctor?.timeout === "function") {
    return Ctor.timeout(5000);
  }
  return undefined;
}

export function createHttpClient(): HttpClient {
  return {
    async post(url: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
      return fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: getAbortSignalTimeout(),
      });
    },
  };
}
