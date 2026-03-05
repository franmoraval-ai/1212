/** Convierte claves de objeto de camelCase a snake_case para Supabase */
export function toSnakeCaseKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[snake] = v;
  }
  return out;
}

/** Para campos tipo Firestore serverTimestamp() - usar new Date().toISOString() */
export function nowIso() {
  return new Date().toISOString();
}
