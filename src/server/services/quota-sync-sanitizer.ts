/**
 * Quota Sync Sanitizer — Hito L2.1
 *
 * Helpers para guardar respuestas externas de forma segura en logs de observabilidad.
 * NUNCA expone API keys, tokens, ni secretos.
 * NUNCA guarda headers de request.
 */

const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'key', 'token', 'access_token',
  'authorization', 'secret', 'password', 'credential', 'bearer',
]);

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 10;
const MAX_DEPTH = 3;

function isSensitiveKey(k: string): boolean {
  const lower = k.toLowerCase();
  return SENSITIVE_KEYS.has(lower);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth <= 0) return '[truncated]';

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? value.slice(0, MAX_STRING_LENGTH) + '…[truncated]'
      : value;
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth - 1));
    const result: unknown[] = items;
    if (value.length > MAX_ARRAY_ITEMS) {
      (result as unknown[]).push(`…[${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return result;
  }

  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (isSensitiveKey(k)) {
        sanitized[k] = '[REDACTED]';
      } else {
        sanitized[k] = sanitizeValue(v, depth - 1);
      }
    }
    return sanitized;
  }

  return value;
}

/**
 * Sanitiza una respuesta externa para almacenamiento seguro en logs.
 * Elimina campos sensibles, trunca strings largos, limita arrays y profundidad.
 * Si la respuesta no es JSON parseable, guarda content_type y body_preview truncado.
 */
export function sanitizeQuotaSyncResponse(input: unknown): unknown {
  if (input === null || input === undefined) return null;

  if (typeof input === 'string') {
    // Respuesta no-JSON: guardar solo preview
    return {
      _type: 'non_json_string',
      body_preview: input.slice(0, MAX_STRING_LENGTH) + (input.length > MAX_STRING_LENGTH ? '…[truncated]' : ''),
    };
  }

  return sanitizeValue(input, MAX_DEPTH);
}

/**
 * Extrae la "shape" (estructura) de una respuesta para poder ajustar el parser
 * sin guardar los valores completos.
 *
 * Guarda:
 * - tipo raíz
 * - keys de primer nivel
 * - keys de segundo nivel si son objetos
 * - longitud de arrays + keys del primer item
 */
export function getResponseShape(input: unknown): unknown {
  if (input === null) return { _type: 'null' };
  if (input === undefined) return { _type: 'undefined' };
  if (typeof input === 'string') return { _type: 'string', length: input.length };
  if (typeof input === 'number') return { _type: 'number' };
  if (typeof input === 'boolean') return { _type: 'boolean' };

  if (Array.isArray(input)) {
    return {
      _type: 'array',
      length: input.length,
      first_item_shape: input.length > 0 ? getResponseShape(input[0]) : null,
    };
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj);
    const shape: Record<string, unknown> = { _type: 'object', keys };

    for (const k of keys) {
      const v = obj[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        shape[`${k}:keys`] = Object.keys(v as Record<string, unknown>);
      } else if (Array.isArray(v)) {
        shape[`${k}:array_length`] = v.length;
        if (v.length > 0) {
          shape[`${k}:first_item_type`] = typeof v[0];
          if (v[0] !== null && typeof v[0] === 'object') {
            shape[`${k}:first_item_keys`] = Object.keys(v[0] as Record<string, unknown>);
          }
        }
      } else {
        shape[`${k}:type`] = typeof v;
      }
    }

    return shape;
  }

  return { _type: typeof input };
}

/**
 * Elimina query params sensibles de una URL para logging seguro.
 * Nunca guardar API keys como query params (e.g. ?api_key=xxx).
 */
export function sanitizeEndpointUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Eliminar query params que puedan contener secretos
    const sensitiveParams = ['api_key', 'apikey', 'key', 'token', 'access_token', 'secret', 'authorization'];
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    // Si la URL no parsea, retornar solo origin + path truncado
    const match = url.match(/^(https?:\/\/[^/?#]+)([^?#]*)/);
    return match ? `${match[1]}${match[2]}` : '[invalid_url]';
  }
}
