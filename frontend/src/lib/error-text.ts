/**
 * Error payloads do not always arrive as strings. A gateway (Vercel), a
 * provider, or a database driver can return `{ code, message }`; rendering
 * that object directly crashes React with error #31. Everything user-facing
 * goes through here so a render never receives an object.
 */

/** Turn one error value into display text, or null when it has none. */
export function errorText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  // `message` first: `{ code, message }` should show the sentence, not the code.
  const message = errorText(record.message);
  if (message) return message;
  const code = errorText(record.code);
  if (code) return code;

  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" ? json : null;
  } catch {
    return null;
  }
}

/** A message worth showing a user for any failed request. */
export function errorMessageFrom(error: any, fallback: string): string {
  const response = error?.response;
  const fromApi = errorText(response?.data?.error);
  if (fromApi) return fromApi;
  const fromApiMessage = errorText(response?.data?.message);
  if (fromApiMessage) return fromApiMessage;

  const status = Number(response?.status);
  if ([502, 503, 504].includes(status)) {
    return `The server was briefly unavailable (${status}). Please try again in a moment.`;
  }
  if (!response && error?.code === "ERR_NETWORK") {
    return "No connection to the server. Please check your network and try again.";
  }

  return errorText(error?.message) || errorText(error) || fallback;
}
