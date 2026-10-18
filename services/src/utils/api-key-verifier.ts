export function extractKeyId(plainKey: string): string | null {
  if (!plainKey.startsWith('oml_')) return null;

  const parts = plainKey.split('_');
  if (parts.length !== 3) return null;

  const keyId = parts[1];
  if (!/^[0-9a-f]{32}$/i.test(keyId)) return null;

  return keyId.toLowerCase();
}
