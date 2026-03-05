import fetch, { Response } from "node-fetch";
import type { ChatId } from "../domain.js";

interface AbortSignalWithTimeout {
  timeout?(ms: number): AbortSignal;
}

export interface N8nWebhookPayload {
  readonly chatId: ChatId;
  readonly text: string;
  readonly voiceBase64?: string;
  readonly voiceMimeType?: string;
  readonly voiceDurationSeconds?: number;
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
