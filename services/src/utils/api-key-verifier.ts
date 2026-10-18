export function extractKeyId(plainKey: string): string | null {
  // Base64url secrets can contain underscores; only the prefix separates the ID.
  const match = /^oml_([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/i.exec(plainKey);
  return match?.[1].toLowerCase() ?? null;
}
