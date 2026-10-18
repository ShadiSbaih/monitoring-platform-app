"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const DEMO_USER_STORAGE_KEY = "oml-demo-user";

export type DemoUser = {
  name: string;
  email: string;
  organizations: string[];
  activeOrganization: string;
};

type DemoAuthContextValue = {
  user: DemoUser | null;
  isLoaded: boolean;
  signIn: (email: string, name?: string) => void;
  signUp: (name: string, email: string, organization: string) => void;
  signOut: () => void;
  createOrganization: (name: string) => void;
  selectOrganization: (name: string) => void;
};

const DemoAuthContext = createContext<DemoAuthContextValue | null>(null);

export function DemoAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<DemoUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const savedUser = window.localStorage.getItem(DEMO_USER_STORAGE_KEY);
      if (savedUser) setUser(JSON.parse(savedUser) as DemoUser);
    } catch {
      window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  const saveUser = useCallback((nextUser: DemoUser | null) => {
    setUser(nextUser);
    if (nextUser) {
      window.localStorage.setItem(DEMO_USER_STORAGE_KEY, JSON.stringify(nextUser));
    } else {
      window.localStorage.removeItem(DEMO_USER_STORAGE_KEY);
    }
  }, []);

  const signIn = useCallback(
    (email: string, name?: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      const nextUser =
        user?.email === normalizedEmail
          ? user
          : {
              name: name?.trim() || normalizedEmail.split("@")[0] || "Demo User",
              email: normalizedEmail,
              organizations: ["Demo Workspace"],
              activeOrganization: "Demo Workspace",
            };
      saveUser(nextUser);
    },
    [saveUser, user],
  );

  const signUp = useCallback(
    (name: string, email: string, organization: string) => {
      const workspace = organization.trim() || `${name.trim() || "My"}'s Workspace`;
      saveUser({
        name: name.trim() || "Demo User",
        email: email.trim().toLowerCase(),
        organizations: [workspace],
        activeOrganization: workspace,
      });
    },
    [saveUser],
  );

  const signOut = useCallback(() => saveUser(null), [saveUser]);

  const createOrganization = useCallback(
    (name: string) => {
      const organization = name.trim();
      if (!organization || !user) return;
      const organizations = user.organizations.includes(organization)
        ? user.organizations
        : [...user.organizations, organization];
      saveUser({ ...user, organizations, activeOrganization: organization });
    },
    [saveUser, user],
  );

  const selectOrganization = useCallback(
    (name: string) => {
      if (!user || !user.organizations.includes(name)) return;
      saveUser({ ...user, activeOrganization: name });
    },
    [saveUser, user],
  );

  return (
    <DemoAuthContext.Provider
      value={{ user, isLoaded, signIn, signUp, signOut, createOrganization, selectOrganization }}
    >
      {children}
    </DemoAuthContext.Provider>
  );
}

export function useDemoAuth() {
  const context = useContext(DemoAuthContext);
  if (!context) throw new Error("useDemoAuth must be used inside DemoAuthProvider");
  return context;
}
