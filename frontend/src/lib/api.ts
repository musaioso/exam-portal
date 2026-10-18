import axios from "axios";

// In dev, "/api" is proxied by Vite to localhost:4000.
// In production (Vercel), set VITE_API_URL to your deployed backend, e.g.
//   VITE_API_URL = https://mcq-studio-api.onrender.com/api
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

api.interceptors.request.use((config) => {
  const t = localStorage.getItem("mcq_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

// Vercel's gateway occasionally answers a single request with 502/503/504 (a
// cold start, or a deployment rolling over). Those are worth a couple of quiet
// retries — but only for reads: a write is never retried, because the first
// attempt may well have gone through.
const RETRYABLE_STATUS = [502, 503, 504];
const MAX_RETRIES = 2;

api.interceptors.response.use(undefined, async (error) => {
  const config: any = error?.config || {};
  const method = String(config.method || "get").toLowerCase();
  const status = error?.response?.status;
  const transient = !error?.response || RETRYABLE_STATUS.includes(status);
  const used = config.__retries || 0;
  if (method !== "get" || !transient || used >= MAX_RETRIES || config.__noRetry) throw error;

  config.__retries = used + 1;
  await new Promise((resolve) => setTimeout(resolve, 350 * config.__retries));
  return api.request(config);
});

/** A message worth showing a user for any failed request. */
export function errorMessage(e: any, fallback: string): string {
  const status = e?.response?.status;
  if (e?.response?.data?.error) return e.response.data.error;
  if (RETRYABLE_STATUS.includes(status)) {
    return `The server was briefly unavailable (${status}). Please try again in a moment.`;
  }
  if (!e?.response && e?.code === "ERR_NETWORK") return "No connection to the server. Please check your network and try again.";
  return e?.message || fallback;
}

export interface User { id: string; name: string; email: string; role: "admin"|"teacher"|"student"; }

export function setAuth(token: string, user: User) {
  localStorage.setItem("mcq_token", token);
  localStorage.setItem("mcq_user", JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem("mcq_token");
  localStorage.removeItem("mcq_user");
}
export function currentUser(): User | null {
  const raw = localStorage.getItem("mcq_user");
  return raw ? JSON.parse(raw) : null;
}