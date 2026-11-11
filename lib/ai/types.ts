/**
 * Shared types for LLM chat providers (OpenRouter, Groq).
 * Both use OpenAI-compatible chat/completions JSON shape.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  /** Provider-specific model id */
  model?: string;
  max_tokens?: number;
  temperature?: number;
};

export type ChatCompletionResponse = {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type ChatCompletionFailureKind =
  | "not_configured"
  | "billing"
  | "rate_limit"
  | "upstream";

export type LlmProvider = "openrouter" | "groq" | "nararouter";

export type ChatCompletionResult =
  | { ok: true; data: ChatCompletionResponse; provider: LlmProvider }
  | {
      ok: false;
      kind: ChatCompletionFailureKind;
      provider?: LlmProvider;
      status?: number;
      message?: string;
    };
