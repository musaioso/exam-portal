/**
 * Shared types for the provider-agnostic AI gateway.
 *
 * Every vendor speaks a different wire format; ChatStyle names the four
 * request/response shapes we need to speak. ProviderConfig is the resolved
 * connection (key + base URL + style) for one provider call.
 */

/** Wire formats supported by chat.ts */
export type ChatStyle = "openai" | "responses" | "anthropic" | "google";

/** One model as shown in the UI's model picker */
export interface ModelInfo {
  /** Model id exactly as the provider's API expects it */
  id: string;
  /** Display label (falls back to id when the provider gives none) */
  name?: string;
  /** True when the provider bills nothing for this model */
  free?: boolean;
  /**
   * True when the model refuses calls made from a server (OpenCode's free-tier
   * models only run inside the OpenCode app). Shown with a warning in the UI and
   * sorted last so they are not picked by default.
   */
  appOnly?: boolean;
  /** Unix seconds when known — used to sort newest first */
  created?: number;
  /** Context window in tokens when known */
  context?: number;
  /** USD per 1M tokens when known (OpenRouter publishes these) */
  pricing?: { input: number; output: number };
}

/** One provider's entry in GET /api/ai/models */
export interface ProviderModels {
  id: string;
  label: string;
  enabled: boolean;
  /** Set when the provider is enabled but its model list could not be fetched */
  error?: string;
  models: ModelInfo[];
}

/**
 * An image attached to a message, for vision models. `data` is raw base64
 * (no "data:" prefix) — every vendor's inline-image field wants it that way.
 */
export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /**
   * Images to send alongside `content`. Vision-capable providers accept these
   * as inline parts; text-only providers would reject the request, so callers
   * must only attach images when the chosen model supports them (see
   * `supportsVision` in models.ts).
   */
  images?: ChatImage[];
}

export interface ChatResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Resolved connection details for a single chat call */
export interface ProviderConfig {
  id: string;
  label: string;
  apiKey?: string;
  baseURL: string;
  chatStyle: ChatStyle;
  /**
   * Per-model routing override. OpenCode serves Claude/Gemini/GPT models
   * through different endpoints and formats under one key, so it maps the
   * model family to the right URL/style; other providers return undefined.
   */
  route?: (modelId: string) => { baseURL?: string; chatStyle?: ChatStyle; model?: string };
}

/** Thrown by chat.ts with an HTTP-ish status the route layer can map */
export class AIError extends Error {
  status: number;
  detail?: string;
  constructor(message: string, status = 502, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
