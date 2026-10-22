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

/**
 * Transient vendor failures worth another attempt. Quota 429s are excluded on
 * purpose: retrying a hard quota error just burns time and worsens the limit.
 */
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [900, 2600];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  let networkError: any;
  // Gemini in particular answers 503 "high demand" and the odd dropped
  // connection; one or two short retries turn those into successful runs.
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
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
      // A timeout is already the full budget — retrying would double the wait.
      if (err?.name === "AbortError") {
        throw new AIError("The AI provider timed out. Try again or pick a faster model.", 504);
      }
      networkError = err;
      continue;
    }
    clearTimeout(timer);

    let text = "";
    try {
      text = await res.text();
    } catch (err: any) {
      networkError = err;
      continue;
    }
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body — handled below */ }
    if (!res.ok) {
      const mapped = mapProviderError(res.status, data, text);
      if (RETRY_STATUSES.has(res.status) && attempt < RETRY_DELAYS_MS.length) continue;
      throw mapped;
    }
    return data;
  }
  throw new AIError("Could not reach the AI provider. Check your network or provider URL.", 502, String(networkError?.message || networkError || ""));
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
  if (status === 404) {
    // Gemini retires model ids and names the replacement in the error text
    // ("…models/old is no longer available… use models/new instead").
    const ids = [...String(detail || "").matchAll(/models\/([A-Za-z0-9._-]+)/g)]
      .map((m) => m[1].replace(/[.,;:)]+$/, ""));
    const suggested = ids.length > 1 ? ids[ids.length - 1] : null;
    if (suggested && /no longer available|retired|decommission/i.test(lower)) {
      return new AIError(
        `This model has been retired by the provider. Pick ${suggested} instead (refresh the model list).`,
        status,
        detail
      );
    }
    return new AIError("The model was not found on this provider. Refresh the model list and pick an available model.", status, detail);
  }
  if (status === 429) {
    // "exceeded your current quota / check your plan and billing" is a plan
    // limit, not a momentary rate limit — telling the user to wait is wrong.
    if (/quota|billing|plan/i.test(lower)) {
      return new AIError(
        "This model is outside your plan's quota. On a free tier, pick a Flash or Flash-Lite model, or enable billing on the provider account.",
        status,
        detail
      );
    }
    return new AIError("The provider is rate-limiting requests. Wait a moment or try another model.", status, detail);
  }
  if (status === 402) return new AIError("The provider reports insufficient credit.", status, detail);
  if (status === 400 && /response modalit/i.test(lower)) {
    // e.g. a TTS model asked for text: it only returns audio.
    return new AIError("This model does not return text (it is an image or audio model). Pick a text model.", status, detail);
  }
  if (status === 503) {
    return new AIError(
      "The provider is overloaded right now (Gemini Flash models return this transiently). Try again in a minute or pick another model.",
      status,
      detail
    );
  }
  if (status === 500 || status === 502) {
    return new AIError(
      "The provider is temporarily unavailable or over capacity. Try again shortly or pick another model.",
      status,
      detail
    );
  }
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

/** True when a message carries images — some shapes need a different body. */
const hasImages = (m: ChatMessage) => Array.isArray(m.images) && m.images.length > 0;

/**
 * OpenAI-style content: a plain string for text-only messages, or a parts
 * array once images are attached (`image_url` with a data URL is accepted by
 * OpenAI, OpenRouter, Groq, xAI, Together and Ollama alike).
 */
function openAIContent(m: ChatMessage): any {
  if (!hasImages(m)) return m.content;
  return [
    ...(m.content ? [{ type: "text", text: m.content }] : []),
    ...(m.images || []).map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.data}` },
    })),
  ];
}

/** Anthropic Messages content: text and base64 image blocks. */
function anthropicContent(m: ChatMessage): any {
  if (!hasImages(m)) return m.content;
  return [
    ...(m.content ? [{ type: "text", text: m.content }] : []),
    ...(m.images || []).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.data },
    })),
  ];
}

/** Gemini parts: `inline_data` carries raw base64. */
function googleParts(m: ChatMessage): any[] {
  return [
    ...(m.content ? [{ text: m.content }] : []),
    ...(m.images || []).map((img) => ({
      inline_data: { mime_type: img.mimeType, data: img.data },
    })),
  ];
}

async function callOpenAI(baseURL: string, apiKey: string | undefined, model: string, messages: ChatMessage[], maxTokens: number | undefined, timeoutMs: number): Promise<ChatResult> {
  const data = await postJSON(
    `${baseURL.replace(/\/$/, "")}/chat/completions`,
    apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    {
      model,
      messages: messages.map((m) => (hasImages(m) ? { role: m.role, content: openAIContent(m) } : m)),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    },
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
      input: conversation.map((m) => ({
        role: m.role,
        content: hasImages(m)
          ? [
              ...(m.content ? [{ type: "input_text", text: m.content }] : []),
              ...(m.images || []).map((img) => ({ type: "input_image", image_url: `data:${img.mimeType};base64,${img.data}` })),
            ]
          : m.content,
      })),
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
      messages: conversation.map((m) => ({ role: m.role, content: anthropicContent(m) })),
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
    // Google's own API reads `x-goog-api-key`; the OpenCode gateway reads the
    // Bearer header. Sending BOTH breaks OAuth-style ("AQ.…") credentials —
    // Google rejects the request on the invalid Bearer header before ever
    // looking at the valid key — so pick by host.
    apiKey
      ? (baseURL.includes("generativelanguage.googleapis.com")
          ? { "x-goog-api-key": apiKey }
          : { Authorization: `Bearer ${apiKey}`, "x-goog-api-key": apiKey })
      : {},
    {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: conversation.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: googleParts(m),
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
