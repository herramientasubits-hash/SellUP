/**
 * Agente 3 · lo que entrega un modelo por herramienta, en una forma fija (puro).
 *
 * Los modelos chicos (Haiku) a veces entregan una lista o un objeto como TEXTO JSON
 * («"facts": "[{…}]"») o con las claves en camelCase: el redactor (Grupo Ciisa, 18-10) y la
 * investigación de la empresa (Itaú en el banco, 19-10: 0 datos aunque Claude respondió).
 */

export function unwrapJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Desenvuelve el texto JSON y pasa las claves a snake_case, en todos los niveles. */
export function normalizeKeys(value: unknown): unknown {
  const unwrapped = unwrapJson(value);
  if (Array.isArray(unwrapped)) return unwrapped.map(normalizeKeys);
  if (unwrapped && typeof unwrapped === 'object') {
    return Object.fromEntries(Object.entries(unwrapped as Record<string, unknown>).map(([k, v]) => [snakeCase(k), normalizeKeys(v)]));
  }
  return unwrapped;
}
