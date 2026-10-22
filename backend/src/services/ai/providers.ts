import { ModelInfo, ProviderConfig, ProviderModels, ChatStyle } from "./types";
import { getStoredKey } from "./keystore";

/**
 * The provider registry. One entry per vendor; a provider is "enabled" when
 * its API key is present — in the server environment (.env / Vercel settings)
 * or in the database via the UI's key manager (env wins). The UI shows
 * nothing else. Model lists are fetched live from each vendor's native
 * endpoint (see listProviderModels in models.ts) so newly released models
 * appear without any code change.
 */

interface ProviderDef {
  id: string;
  label: string;
  /** Env vars checked in order; first non-empty wins. Empty for keyless hosts. */
  keyEnv: string[];
  baseURL: string;
  chatStyle: ChatStyle;
  /** Ollama/LM Studio have no key — presence of a host env var enables them */
  extraEnableEnv?: string[];
  /** Model-list fetch; receives the resolved key (env or stored). */
  fetchModels: (key?: string) => Promise<ModelInfo[]>;
  /** Per-model endpoint routing (only OpenCode needs this) */
  route?: ProviderConfig["route"];
  /** Optional extra headers for chat calls (OpenRouter etiquette headers) */
  headers?: Record<string, string>;
}

const env = (...names: string[]): string | undefined => {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

const json = async (url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
};

/** OpenAI ships non-chat models (TTS, embeddings, images) in /v1/models — hide them. */
const OPENAI_NOISE = ["whisper", "tts", "dall-e", "gpt-image", "audio", "text-embedding", "omni-moderation", "moderation", "transcribe", "computer-use"];

/* ------------------------------------------------------------------ fetchers */

async function fetchOpenCodeModels(_key?: string): Promise<ModelInfo[]> {
  const data = await json("https://opencode.ai/inference/v1/models");
  return (data?.data || [])
    .map((m: any) => ({ id: String(m.id || "") }))
    .filter((m: ModelInfo) => m.id && !m.id.startsWith("jev-") && !m.id.includes("backup") && m.id !== "test")
    .map((m: ModelInfo) => {
      // OpenCode's zero-cost models only run inside the OpenCode app; the API
      // rejects them with a FreeTierError, so flag them for the UI and sort
      // them after the paid models (which a server can actually call).
      const free = m.id.endsWith("-free") || m.id === "big-pickle";
      return { ...m, free, ...(free ? { appOnly: true } : {}) };
    });
}

async function fetchOpenAIModels(key?: string): Promise<ModelInfo[]> {
  const data = await json("https://api.openai.com/v1/models", { Authorization: `Bearer ${key || env("OPENAI_API_KEY") || ""}` });
  return (data?.data || [])
    .map((m: any) => ({ id: String(m.id || ""), created: m.created ? Number(m.created) : undefined }))
    .filter((m: ModelInfo) => m.id && !OPENAI_NOISE.some((p) => m.id.startsWith(p)));
}

async function fetchAnthropicModels(key?: string): Promise<ModelInfo[]> {
  const k = key || env("ANTHROPIC_API_KEY") || "";
  const data = await json("https://api.anthropic.com/v1/models?limit=1000", {
    "x-api-key": k,
    "anthropic-version": "2023-06-01",
  });
  return (data?.data || []).map((m: any) => ({
    id: String(m.id || ""),
    name: m.display_name || undefined,
    created: m.created_at ? Math.floor(new Date(m.created_at).getTime() / 1000) : undefined,
  }));
}

async function fetchGoogleModels(key?: string): Promise<ModelInfo[]> {
  const data = await json("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    "x-goog-api-key": key || env("GEMINI_API_KEY", "GOOGLE_API_KEY") || "",
  });
  return (data?.models || [])
    .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m: any) => ({
      id: String(m.name || "").replace(/^models\//, ""),
      name: m.displayName || undefined,
      context: m.inputTokenLimit ? Number(m.inputTokenLimit) : undefined,
    }))
    // Gemini lists image, TTS, music, deep-research and agent models next to
    // the chat models. They advertise generateContent too, but answer with an
    // image/audio payload or need an async job — a teacher picking one just
    // hits an error. Keep only text-chat families.
    .filter((m: ModelInfo) => !GOOGLE_NON_CHAT.some((needle) => m.id.toLowerCase().includes(needle)))
    .map((m: ModelInfo) => ({ ...m, rank: googleRank(m.id) }));
}

/**
 * Families that cannot answer a text question. Matched as substrings against
 * the model id (`gemini-2.5-flash-image`, `*-tts`, `lyria-3.5`, …).
 */
const GOOGLE_NON_CHAT = [
  "tts", "image", "imagen", "nano-banana", "nanobanana", "lyria",
  "deep-research", "antigravity", "computer-use", "robotics",
  "transcribe", "embedding", "embed-", "veo",
];

/**
 * Default-pick ordering. Gemini publishes no release dates, so score the id:
 * Flash first (available on free tiers), then Pro, then Flash-Lite, Omni and
 * Gemma; within a family the newest version wins and pinned versions outrank
 * the floating "-latest" aliases.
 */
function googleRank(id: string): number {
  const version = Number((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const family =
    /flash-lite/.test(id) ? 2_000 :
    /omni/.test(id) ? 1_000 :
    /flash/.test(id) ? 4_000 :
    /pro/.test(id) ? 3_000 :
    /^gemma/.test(id) ? 500 :
    100;
  const pinned = /-latest$/.test(id) ? 0 : 1;
  return family + version * 10 + pinned;
}

async function fetchOpenRouterModels(_key?: string): Promise<ModelInfo[]> {
  const data = await json("https://openrouter.ai/api/v1/models");
  return (data?.data || [])
    .filter((m: any) => {
      if (typeof m?.id !== "string") return false;
      // ":batch" variants only accept the async Batch API, not chat/completions.
      if (m.id.endsWith(":batch")) return false;
      // Keep text-in/text-out models; drop image and audio generators, which
      // advertise chat-shaped endpoints but do not return an answer.
      const out = m?.architecture?.output_modalities;
      return !Array.isArray(out) || out.length === 0 || (out.includes("text") && out.every((o: string) => o === "text"));
    })
    .map((m: any) => {
      const pin = Number(m?.pricing?.prompt || 0);
      const pout = Number(m?.pricing?.completion || 0);
      const input = m?.architecture?.input_modalities;
      const vision = Array.isArray(input) ? input.includes("image") : undefined;
      const free = pin === 0 && pout === 0;
      return {
        id: String(m.id || ""),
        name: m.name || undefined,
        created: m.created ? Number(m.created) : undefined,
        context: m.context_length ? Number(m.context_length) : undefined,
        free,
        vision,
        // Free vision models first: they cost nothing and can also read page
        // photos, so they make the best free-only default. Everything else
        // keeps the newest-first order.
        rank: free && vision ? 1 : 0,
        pricing: pin || pout ? { input: pin * 1_000_000, output: pout * 1_000_000 } : undefined,
      };
    });
}

async function fetchOllamaModels(_key?: string): Promise<ModelInfo[]> {
  const host = env("OLLAMA_HOST")!;
  const data = await json(`${host.replace(/\/$/, "")}/api/tags`);
  return (data?.models || []).map((m: any) => ({ id: String(m.name || "") })).filter((m: ModelInfo) => m.id);
}

/**
 * Every OpenAI-compatible vendor (Groq, DeepSeek, Mistral, xAI, Together,
 * Cerebras, LM Studio…) exposes GET {base}/models with the same
 * { data: [ { id } ] } shape — one fetcher covers them all. Verified: each
 * vendor's endpoint answers 401/400 (not 404) without a key, i.e. the path
 * is right and only auth is missing.
 */
const openAIStyleModels = (baseURL: string) => async (key?: string): Promise<ModelInfo[]> => {
  const data = await json(`${baseURL.replace(/\/$/, "")}/models`, key ? { Authorization: `Bearer ${key}` } : {});
  return (data?.data || [])
    .map((m: any) => ({ id: String(m.id || ""), created: m.created ? Number(m.created) : undefined }))
    .filter((m: ModelInfo) => m.id && !OPENAI_NOISE.some((p) => m.id.startsWith(p)));
};

/* ------------------------------------------------------------- opencode routes */

/**
 * OpenCode serves every model family through its family-matching endpoint:
 * Claude → Anthropic Messages, Gemini → generateContent, GPT/Grok/Muse →
 * Responses API, everything else (DeepSeek, GLM, Kimi, Qwen, MiniMax…) →
 * OpenAI-compatible chat completions. Mirrors https://opencode.ai/v2/docs/console/models
 *
 * Every family needs the version segment in the path — /inference/anthropic
 * (no /v1) answers 404, while /inference/anthropic/v1/messages reaches the
 * upstream. The chat callers append the final segment, so the base URLs here
 * carry the version.
 */
const opencodeRoute: ProviderConfig["route"] = (modelId: string) => {
  if (modelId.startsWith("claude-")) return { baseURL: "https://opencode.ai/inference/anthropic", chatStyle: "anthropic" };
  if (modelId.startsWith("gemini-")) return { baseURL: "https://opencode.ai/inference/google/v1beta", chatStyle: "google" };
  if (modelId.startsWith("gpt-") || modelId.startsWith("grok-") || modelId.startsWith("muse-")) {
    return { baseURL: "https://opencode.ai/inference/v1", chatStyle: "responses" };
  }
  // Qwen 3.5–3.8 (except 3.8-max) are served through Anthropic's shape there.
  if (/^qwen3\.[5-8](?!-max)/.test(modelId)) return { baseURL: "https://opencode.ai/inference/anthropic", chatStyle: "anthropic" };
  return { baseURL: "https://opencode.ai/inference/v1", chatStyle: "openai" };
};

/* -------------------------------------------------------------------- registry */

const PROVIDERS: ProviderDef[] = [
  {
    id: "opencode",
    label: "OpenCode",
    keyEnv: ["OPENCODE_API_KEY", "ZEN_API_KEY"],
    baseURL: "https://opencode.ai/inference/v1",
    chatStyle: "openai",
    fetchModels: fetchOpenCodeModels,
    route: opencodeRoute,
  },
  {
    id: "openai",
    label: "OpenAI",
    keyEnv: ["OPENAI_API_KEY"],
    baseURL: "https://api.openai.com/v1",
    chatStyle: "openai",
    fetchModels: fetchOpenAIModels,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyEnv: ["ANTHROPIC_API_KEY"],
    baseURL: "https://api.anthropic.com",
    chatStyle: "anthropic",
    fetchModels: fetchAnthropicModels,
  },
  {
    id: "google",
    label: "Google Gemini",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    baseURL: "https://generativelanguage.googleapis.com/v1beta",
    chatStyle: "google",
    fetchModels: fetchGoogleModels,
  },
  {
    id: "groq",
    label: "Groq",
    keyEnv: ["GROQ_API_KEY"],
    baseURL: "https://api.groq.com/openai/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.groq.com/openai/v1"),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyEnv: ["DEEPSEEK_API_KEY"],
    baseURL: "https://api.deepseek.com/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.deepseek.com/v1"),
  },
  {
    id: "mistral",
    label: "Mistral",
    keyEnv: ["MISTRAL_API_KEY"],
    baseURL: "https://api.mistral.ai/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.mistral.ai/v1"),
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    keyEnv: ["XAI_API_KEY"],
    baseURL: "https://api.x.ai/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.x.ai/v1"),
  },
  {
    id: "together",
    label: "Together AI",
    keyEnv: ["TOGETHER_API_KEY"],
    baseURL: "https://api.together.xyz/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.together.xyz/v1"),
  },
  {
    id: "cerebras",
    label: "Cerebras",
    keyEnv: ["CEREBRAS_API_KEY"],
    baseURL: "https://api.cerebras.ai/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels("https://api.cerebras.ai/v1"),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    keyEnv: ["OPENROUTER_API_KEY"],
    baseURL: "https://openrouter.ai/api/v1",
    chatStyle: "openai",
    fetchModels: fetchOpenRouterModels,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    keyEnv: [],
    extraEnableEnv: ["OLLAMA_HOST"],
    baseURL: env("OLLAMA_HOST")?.replace(/\/$/, "") || "http://127.0.0.1:11434/v1",
    chatStyle: "openai",
    fetchModels: fetchOllamaModels,
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    keyEnv: [],
    extraEnableEnv: ["LMSTUDIO_HOST"],
    baseURL: (env("LMSTUDIO_HOST")?.replace(/\/$/, "") || "http://localhost:1234") + "/v1",
    chatStyle: "openai",
    fetchModels: openAIStyleModels((env("LMSTUDIO_HOST")?.replace(/\/$/, "") || "http://localhost:1234") + "/v1"),
  },
];

/* ------------------------------------------------------- async key resolution */

/** Env first (backend/.env / Vercel settings), then the UI-managed store. */
async function resolveKey(p: ProviderDef): Promise<string | undefined> {
  const fromEnv = env(...p.keyEnv);
  if (fromEnv) return fromEnv;
  if (p.keyEnv.length === 0) return undefined;
  return getStoredKey(p.id);
}

async function isEnabled(p: ProviderDef): Promise<boolean> {
  if (p.keyEnv.length === 0) return (p.extraEnableEnv || []).some((e) => !!env(e));
  return !!(await resolveKey(p));
}

/* ------------------------------------------------------------------ public API */

/** Provider list with enabled flags for GET /api/ai/models. */
export async function providerSummaries(): Promise<Array<Pick<ProviderModels, "id" | "label" | "enabled">>> {
  return Promise.all(
    PROVIDERS.map(async (p) => ({ id: p.id, label: p.label, enabled: await isEnabled(p) }))
  );
}

/** Resolve the connection config for a chat call; null when not enabled. */
export async function getProviderConfig(providerId: string): Promise<ProviderConfig | null> {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  if (!(await isEnabled(p))) return null;
  return { id: p.id, label: p.label, apiKey: await resolveKey(p), baseURL: p.baseURL, chatStyle: p.chatStyle, route: p.route };
}

/** Used by models.ts to fetch each enabled provider's live model list. */
export async function modelFetchers(): Promise<Array<{ id: string; label: string; fetch: () => Promise<ModelInfo[]> }>> {
  const out: Array<{ id: string; label: string; fetch: () => Promise<ModelInfo[]> }> = [];
  for (const p of PROVIDERS) {
    if (await isEnabled(p)) {
      // Resolve inside the closure: env first, then a key stored via the UI.
      out.push({ id: p.id, label: p.label, fetch: async () => p.fetchModels(await resolveKey(p)) });
    }
  }
  return out;
}

/* ------------------------------------------------------------ key manager data */

export interface KeyStatus {
  id: string;
  label: string;
  /** True for Ollama/LM Studio — they authenticate by host, not key. */
  keyless: boolean;
  enabled: boolean;
  /** where the active key comes from; null when there is none */
  source: "env" | "stored" | null;
  /** masked hint of the active key — the raw value never leaves the server */
  hint: string | null;
  /** env vars to document, for env-sourced keys */
  envVar?: string;
}

/** First three chars + ellipsis + last four — safe to display. */
function mask(key: string): string {
  return key.length <= 8 ? "••••••" : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** Everything the UI's key manager needs; never includes a raw key. */
export async function keyStatuses(): Promise<KeyStatus[]> {
  return Promise.all(
    PROVIDERS.map(async (p): Promise<KeyStatus> => {
      const keyless = p.keyEnv.length === 0;
      const fromEnv = keyless ? undefined : env(...p.keyEnv);
      const fromStore = keyless || fromEnv ? undefined : await getStoredKey(p.id);
      const active = fromEnv || fromStore;
      return {
        id: p.id,
        label: p.label,
        keyless,
        enabled: await isEnabled(p),
        source: fromEnv ? "env" : fromStore ? "stored" : null,
        hint: active ? mask(active) : null,
        envVar: p.keyEnv[0],
      };
    })
  );
}

export function providerKeyMeta(providerId: string): { id: string; label: string; keyless: boolean } | null {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return null;
  return { id: p.id, label: p.label, keyless: p.keyEnv.length === 0 };
}

/**
 * Try the candidate key against the vendor's own /models endpoint — the
 * cheapest live proof that the key works before we store it. Callers may
 * still store a rejected key explicitly (the vendor might gate /models
 * while chat works).
 */
export async function validateProviderKey(providerId: string, key: string): Promise<{ ok: boolean; message?: string; models?: number }> {
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p) return { ok: false, message: "Unknown provider." };
  if (p.keyEnv.length === 0) return { ok: false, message: `${p.label} does not use an API key.` };
  try {
    const models = await p.fetchModels(key.trim());
    if (models.length === 0) return { ok: false, message: "The key was accepted but the vendor returned no models." };
    return { ok: true, models: models.length };
  } catch (err: any) {
    return { ok: false, message: `The vendor rejected this key (${String(err?.message || err).slice(0, 240)})` };
  }
}
