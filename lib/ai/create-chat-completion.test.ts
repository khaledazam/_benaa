import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChatCompletion } from "./create-chat-completion";
import { DEFAULT_GROQ_MODEL } from "./groq";

describe("createChatCompletion orchestrator", () => {
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  const originalGroq = process.env.GROQ_API_KEY;
  const originalNara = process.env.NARA_API_KEY;

  beforeEach(() => {
    delete process.env.NARA_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (originalNara === undefined) delete process.env.NARA_API_KEY; else process.env.NARA_API_KEY = originalNara;
    process.env.OPENROUTER_API_KEY = originalOpenRouter;
    process.env.GROQ_API_KEY = originalGroq;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to Groq when OpenRouter returns 402", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.GROQ_API_KEY = "groq-key";

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("insufficient credits", { status: 402 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "2",
            choices: [
              {
                message: { role: "assistant", content: "from-groq" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await createChatCompletion([
      { role: "user", content: "hi" },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("groq");
      expect(result.data.choices[0]?.message.content).toBe("from-groq");
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses OpenRouter only when it succeeds", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.GROQ_API_KEY = "groq-key";

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "1",
          choices: [
            {
              message: { role: "assistant", content: "from-or" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await createChatCompletion([
      { role: "user", content: "hi" },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe("openrouter");
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Groq fallback ignores OpenRouter model slug from forecasting", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.GROQ_API_KEY = "groq-key";
    delete process.env.GROQ_MODEL;

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response("insufficient credits", { status: 402 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "2",
            choices: [
              {
                message: { role: "assistant", content: "forecast" },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    await createChatCompletion([{ role: "user", content: "hi" }], {
      model: "openai/gpt-2.5-turbo",
      max_tokens: 200,
    });

    const groqBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1]?.[1]?.body as string) ?? "{}",
    );
    expect(groqBody.model).toBe(DEFAULT_GROQ_MODEL);
  });

  it("returns not_configured when no keys", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;

    const result = await createChatCompletion([
      { role: "user", content: "hi" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("not_configured");
    }
  });
  it("uses NaraRouter first when configured", async () => {
    process.env.NARA_API_KEY = "mock-nara-key";
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "mock-nara-success" } }] }), { status: 200 }));
    const result = await createChatCompletion([{ role: "user", content: "test fixture" }]);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("nararouter");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/chat/completions");
  });
  it("falls back from NaraRouter 429 to OpenRouter", async () => {
    process.env.NARA_API_KEY = "mock-nara-key";
    process.env.OPENROUTER_API_KEY = "mock-or-key";
    vi.mocked(fetch).mockResolvedValueOnce(new Response("limited", { status: 429 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "mock-or-success" } }] }), { status: 200 }));
    const result = await createChatCompletion([{ role: "user", content: "test fixture" }]);
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("openrouter");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

});
