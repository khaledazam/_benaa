/**
 * NaraRouter AI Client for Benaa Intelligence
 * Provider: NaraRouter (OpenAI-compatible router)
 * Base URL: https://router.bynara.id/v1
 * Model: nemotron-3.5-lightning-free
 */

import type {
  ChatCompletionOptions,
  ChatCompletionFailureKind,
  ChatCompletionResponse,
  ChatCompletionResult,
  ChatMessage,
} from "./types";

export const DEFAULT_NARA_BASE_URL = "https://router.bynara.id/v1";
export const DEFAULT_NARA_MODEL = "nemotron-3.5-lightning-free";

export function isNaraRouterConfigured(): boolean {
  const key = process.env.NARA_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function getNaraBaseUrl(): string {
  const url = process.env.NARA_BASE_URL?.trim();
  return url && url.length > 0 ? url : DEFAULT_NARA_BASE_URL;
}

export function getNaraModel(): string {
  const model = process.env.NARA_MODEL?.trim();
  return model && model.length > 0 ? model : DEFAULT_NARA_MODEL;
}

function mapHttpStatusToKind(status: number): ChatCompletionFailureKind {
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  return "upstream";
}

/**
 * Execute chat completion via NaraRouter
 */
export async function createNaraRouterChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  if (!isNaraRouterConfigured()) {
    return { ok: false, kind: "not_configured", provider: "nararouter" };
  }

  const apiKey = process.env.NARA_API_KEY!;
  const baseUrl = getNaraBaseUrl();
  const model = options.model ?? getNaraModel();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer":
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Benaa Warehouse ERP Intelligence",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.max_tokens ?? 1024,
        temperature: options.temperature ?? 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const kind = mapHttpStatusToKind(response.status);
      console.warn(`[NaraRouter] Upstream error HTTP ${response.status}`);
      return {
        ok: false,
        kind,
        provider: "nararouter",
        status: response.status,
        message: "AI provider request failed",
      };
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return { ok: true, data, provider: "nararouter" };
  } catch (error: any) {
    console.error("[NaraRouter] Network or execution failure:", error?.message || error);
    return {
      ok: false,
      kind: "upstream",
      provider: "nararouter",
      message: error?.message || "NaraRouter connection timed out",
    };
  }
}
