"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
type User = {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
};
type AuthContext = {
  user: User | null;
  error: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};
const Context = createContext<AuthContext | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setLoaded] = useState(false);
  const router = useRouter();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      setError(null);
      if (response.ok) setUser((await response.json()) as User);
      else if (response.status === 401) setUser(null);
      else setError('The service is waking up or unavailable. Please retry shortly.');
    } catch {
      setError("Could not connect to the service. Please retry.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  const signOut = useCallback(async () => {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Sign out failed. Please retry.");
    setUser(null);
    router.replace("/sign-in");
    router.refresh();
  }, [router]);
  return (
    <Context.Provider
      value={{ user, error, isLoaded, isSignedIn: Boolean(user), refresh, signOut }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("AuthProvider missing");
  return context;
}
