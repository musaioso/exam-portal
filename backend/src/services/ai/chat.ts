import { AIError, ChatMessage, ChatResult, ChatStyle, ProviderConfig } from "./types";

/**
 * One function that speaks all four wire formats the supported providers use.
 *
 * The OpenAI shape (chat/completions) covers OpenAI, OpenRouter, Ollama and
 * most OpenCode models; "responses" is OpenAI's newer Responses API (OpenCode
 * routes its GPT/Grok models through it); "anthropic" is the Messages API;
 * "google" is Gemini's generateContent. Everything above this file deals only
 * in ChatMessage/ChatResult and never with vendor payloads.
 */

const TIMEOUT_MS = 120_000;

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new AIError("The AI provider timed out. Try again or pick a faster model.", 504);
    }
    throw new AIError("Could not reach the AI provider. Check your network or provider URL.", 502, String(err?.message || err));
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body — handled below */ }
  if (!res.ok) throw mapProviderError(res.status, data, text);
  return data;
}

/** Turn a vendor HTTP error into an AIError with a message a teacher can act on. */
function mapProviderError(status: number, data: any, raw: string): AIError {
  const detail =
    data?.error?.message ||      // openai / google / openrouter
    data?.error?.type ||         // anthropic: {error:{type}}
    data?.message ||             // anthropic top-level
    raw.slice(0, 300);
  const lower = String(detail || "").toLowerCase();

  // Free-tier models (e.g. OpenCode's *-free models) refuse calls made from a
  // server. The key is fine — the model itself cannot be used this way.
  if (status === 403 && (lower.includes("free tier") || lower.includes("freetier") || lower.includes("only be used from within"))) {
    return new AIError(
      "This is a free-tier model that only works inside the OpenCode app, not from a server. Pick a non-free model (and make sure the account has credits).",
      status,
      detail
    );
  }
  if (status === 401 || status === 403) {
    // Model gated/disabled (usually: no credits on the account) must win over the
    // generic key-rejected wording — a 403 with this detail is not an auth problem.
    if (lower.includes("model access is disabled") || lower.includes("model is unavailable") || lower.includes("not enabled")) {
      return new AIError(
        "This model is not available on the account (it may need credits or to be enabled in the provider console). Try another model.",
        status,
        detail
      );
    }
    return new AIError("The API key for this provider was rejected. Update it in the server environment.", status, detail);
  }
  if (status === 404) return new AIError("The model was not found on this provider. Refresh the model list and pick an available model.", status, detail);
  if (status === 429) return new AIError("The provider is rate-limiting or out of quota. Wait a moment or try another model.", status, detail);
  if (status === 402) return new AIError("The provider reports insufficient credit.", status, detail);
  // Same wording, surfaced for statuses other than 401/403.
  if (lower.includes("model access is disabled") || lower.includes("model is unavailable") || lower.includes("not enabled")) {
    return new AIError(
      "This model is not available on the account (it may need credits or to be enabled in the provider console). Try another model.",
      status,
      detail
    );
  }
  return new AIError(`The AI provider returned an error (HTTP ${status}).`, status, detail);
}

/** Reads text out of the shapes vendors use for message content. */
function contentToString(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
      .join("");
  }
  return content == null ? "" : String(content);
}

async function callOpenAI(baseURL: string, apiKey: string | undefined, model: string, messages: ChatMessage[], maxTokens: number | undefined, timeoutMs: number): Promise<ChatResult> {
  const data = await postJSON(
    `${baseURL.replace(/\/$/, "")}/chat/completions`,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    { model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}) },
    timeoutMs
  );
  const choice = data?.choices?.[0];
  const text = contentToString(choice?.message?.content ?? choice?.text);
  if (!text) throw new AIError("The model returned an empty response. Try again.", 502, JSON.stringify(data).slice(0, 300));
  return {
    text,
    usage: { inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens },
  };
}

async function callResponses(baseURL: string, apiKey: string | undefined, model: string, messages: ChatMessage[], maxTokens: number | undefined, timeoutMs: number): Promise<ChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const data = await postJSON(
    `${baseURL.replace(/\/$/, "")}/responses`,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    {
      model,
      ...(system ? { instructions: system } : {}),
      input: conversation.map((m) => ({ role: m.role, content: m.content })),
      ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    },
    timeoutMs
  );
  // Preferred: output[] → message items → output_text parts.
  let text = "";
  if (Array.isArray(data?.output)) {
    text = data.output
      .filter((item: any) => item?.type === "message")
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .filter((part: any) => part?.type === "output_text" || typeof part?.text === "string")
      .map((part: any) => part.text || "")
      .join("");
  }
  if (!text && typeof data?.output_text === "string") text = data.output_text;
  if (!text) text = contentToString(data?.choices?.[0]?.message?.content);
  if (!text) throw new AIError("The model returned an empty response. Try again.", 502, JSON.stringify(data).slice(0, 300));
  return { text, usage: { inputTokens: data?.input_tokens, outputTokens: data?.output_tokens } };
}

async function callAnthropic(baseURL: string, apiKey: string | undefined, model: string, messages: ChatMessage[], maxTokens: number | undefined, timeoutMs: number): Promise<ChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const data = await postJSON(
    `${baseURL.replace(/\/$/, "")}/v1/messages`,
    {
      ...(apiKey ? { "x-api-key": apiKey, Authorization: `Bearer ${apiKey}` } : {}),
      "anthropic-version": "2023-06-01",
    },
    {
      model,
      ...(system ? { system } : {}),
      messages: conversation.map((m) => ({ role: m.role, content: m.content })),
      // Anthropic refuses to answer without max_tokens; 8192 is within every
      // current model's limit and plenty for a batch of MCQs.
      max_tokens: maxTokens || 8192,
    },
    timeoutMs
  );
  const text = (Array.isArray(data?.content) ? data.content : [])
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text || "")
    .join("");
  if (!text) throw new AIError("The model returned an empty response. Try again.", 502, JSON.stringify(data).slice(0, 300));
  return { text, usage: { inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens } };
}

async function callGoogle(baseURL: string, apiKey: string | undefined, model: string, messages: ChatMessage[], _maxTokens: number | undefined, timeoutMs: number): Promise<ChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const conversation = messages.filter((m) => m.role !== "system");
  const bareModel = model.startsWith("models/") ? model.slice("models/".length) : model;
  const data = await postJSON(
    `${baseURL.replace(/\/$/, "")}/models/${encodeURIComponent(bareModel)}:generateContent`,
    // Google's own API reads x-goog-api-key; the OpenCode gateway reads the
    // Bearer header — sending both satisfies either backend.
    apiKey ? { "x-goog-api-key": apiKey, Authorization: `Bearer ${apiKey}` } : {},
    {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: conversation.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    },
    timeoutMs
  );
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => p?.text && !p?.thought).map((p: any) => p.text).join("");
  if (!text) {
    const block = data?.promptFeedback?.blockReason;
    throw new AIError(
      block ? `The model refused: ${block}. Try a different prompt or model.` : "The model returned an empty response. Try again.",
      502,
      JSON.stringify(data).slice(0, 300)
    );
  }
  return { text, usage: { inputTokens: data?.usageMetadata?.promptTokenCount, outputTokens: data?.usageMetadata?.candidatesTokenCount } };
}

/** Single entry point: send messages, get plain text back. */
export async function chatComplete(
  cfg: ProviderConfig,
  model: string,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<ChatResult> {
  const routed = cfg.route?.(model) || {};
  const baseURL = routed.baseURL || cfg.baseURL;
  const style: ChatStyle = routed.chatStyle || cfg.chatStyle;
  const finalModel = routed.model || model;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  if (style === "openai") return callOpenAI(baseURL, cfg.apiKey, finalModel, messages, opts.maxTokens, timeoutMs);
  if (style === "responses") return callResponses(baseURL, cfg.apiKey, finalModel, messages, opts.maxTokens, timeoutMs);
  if (style === "anthropic") return callAnthropic(baseURL, cfg.apiKey, finalModel, messages, opts.maxTokens, timeoutMs);
  return callGoogle(baseURL, cfg.apiKey, finalModel, messages, opts.maxTokens, timeoutMs);
}
