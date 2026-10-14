import { createContext, useContext, useState } from "react";
import { api, currentUser, setAuth, clearAuth, type User } from "./api";

interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(currentUser());
  const login = async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    setAuth(data.token, data.user);
    setUser(data.user);
  };
  const logout = () => { clearAuth(); setUser(null); };
  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("no auth");
  return c;
}