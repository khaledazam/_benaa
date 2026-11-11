import { createNaraRouterChatCompletion, isNaraRouterConfigured } from "./nararouter";
import { createGroqChatCompletion, isGroqConfigured } from "./groq";
import {
  createOpenRouterChatCompletion,
  isOpenRouterConfigured,
} from "./openrouter";
import type {
  ChatCompletionFailureKind,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
} from "./types";

export type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatCompletionFailureKind,
  ChatCompletionResult,
  LlmProvider,
} from "./types";

/** Re-export for callers that only check OpenRouter or NaraRouter */
export { isOpenRouterConfigured } from "./openrouter";
export { isGroqConfigured } from "./groq";
export { isNaraRouterConfigured } from "./nararouter";

/** True when at least one provider has an API key */
export function isLlmConfigured(): boolean {
  return isNaraRouterConfigured() || isOpenRouterConfigured() || isGroqConfigured();
}

const FALLBACK_KINDS: ChatCompletionFailureKind[] = [
  "billing",
  "rate_limit",
  "upstream",
  "not_configured",
];

function shouldTryFallback(
  result: Extract<ChatCompletionResult, { ok: false }>,
): boolean {
  return FALLBACK_KINDS.includes(result.kind);
}

/**
 * Try NaraRouter first (preferred), then OpenRouter, then Groq fallback.
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  // 1. Try NaraRouter if configured
  if (isNaraRouterConfigured()) {
    const naraResult = await createNaraRouterChatCompletion(messages, options);
    if (naraResult.ok) {
      return naraResult;
    }
    console.warn("[LLM] NaraRouter failed, checking next fallback:", naraResult.kind);
    if (!shouldTryFallback(naraResult)) {
      return naraResult;
    }
  }

  // 2. Try OpenRouter
  const openRouterResult = await createOpenRouterChatCompletion(
    messages,
    options,
  );

  if (openRouterResult.ok) {
    return openRouterResult;
  }

  if (shouldTryFallback(openRouterResult)) {
    console.warn(
      "[LLM] OpenRouter failed, trying Groq fallback:",
      openRouterResult.kind,
    );
    const groqResult = await createGroqChatCompletion(messages, options);
    if (groqResult.ok) {
      return groqResult;
    }
    return groqResult;
  }

  return openRouterResult;
}
