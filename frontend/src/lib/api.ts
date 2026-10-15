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