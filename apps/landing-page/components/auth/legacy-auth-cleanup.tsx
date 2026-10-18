"use client";
import { useEffect } from "react";
export function LegacyAuthCleanup() {
  useEffect(() => {
    try {
      window.localStorage.removeItem("oml-demo-user");
    } catch {}
  }, []);
  return null;
}
