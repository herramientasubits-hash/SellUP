// Hito L2.1 — Tests puros para helpers de observabilidad de quota sync
// Sin llamadas reales. Sin fetch. Solo lógica pura.
// Usa el runner nativo de Node.js (node:test + assert).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Replicamos los helpers inline para evitar dependencias de módulo en node:test ──

const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'key', 'token', 'access_token',
  'authorization', 'secret', 'password', 'credential', 'bearer',
]);

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 10;
const MAX_DEPTH = 3;

function isSensitiveKey(k: string): boolean {
  return SENSITIVE_KEYS.has(k.toLowerCase());
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
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      sanitized[k] = isSensitiveKey(k) ? '[REDACTED]' : sanitizeValue(v, depth - 1);
    }
    return sanitized;
  }
  return value;
}

function sanitizeQuotaSyncResponse(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') {
    return {
      _type: 'non_json_string',
      body_preview: input.slice(0, MAX_STRING_LENGTH) + (input.length > MAX_STRING_LENGTH ? '…[truncated]' : ''),
    };
  }
  return sanitizeValue(input, MAX_DEPTH);
}

function getResponseShape(input: unknown): unknown {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sanitizeQuotaSyncResponse — eliminación de secretos', () => {
  it('redacta api_key en raíz', () => {
    const input = { api_key: 'sk-secret-123', credits_remaining: 500 };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['api_key'], '[REDACTED]');
    assert.equal(result['credits_remaining'], 500);
  });

  it('redacta token en raíz', () => {
    const input = { token: 'Bearer xyz', data: { remaining: 100 } };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['token'], '[REDACTED]');
  });

  it('redacta authorization en raíz', () => {
    const input = { authorization: 'Bearer secret', status: 'ok' };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['authorization'], '[REDACTED]');
  });

  it('redacta access_token, secret, password, credential, bearer', () => {
    const sensitiveFields = ['access_token', 'secret', 'password', 'credential', 'bearer'];
    for (const field of sensitiveFields) {
      const input = { [field]: 'supersecret', credits: 100 };
      const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
      assert.equal(result[field], '[REDACTED]', `${field} debe ser REDACTED`);
    }
  });

  it('redacta keys anidadas (segundo nivel)', () => {
    const input = { data: { api_key: 'nested-secret', credits_remaining: 200 } };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    const data = result['data'] as Record<string, unknown>;
    assert.equal(data['api_key'], '[REDACTED]');
    assert.equal(data['credits_remaining'], 200);
  });

  it('preserva campos no sensibles', () => {
    const input = { credits_remaining: 300, plan: 'pro', reset_at: '2026-08-01' };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['credits_remaining'], 300);
    assert.equal(result['plan'], 'pro');
    assert.equal(result['reset_at'], '2026-08-01');
  });
});

describe('sanitizeQuotaSyncResponse — truncado de strings', () => {
  it('trunca strings largos a 500 chars + sufijo', () => {
    const longString = 'x'.repeat(600);
    const input = { message: longString };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    const msg = result['message'] as string;
    assert.ok(msg.length < 600);
    assert.ok(msg.endsWith('…[truncated]'));
  });

  it('preserva strings cortos sin modificar', () => {
    const input = { message: 'short' };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['message'], 'short');
  });

  it('respuesta string no-JSON devuelve _type y body_preview', () => {
    const htmlBody = '<html><body>Error 500</body></html>';
    const result = sanitizeQuotaSyncResponse(htmlBody) as Record<string, unknown>;
    assert.equal(result['_type'], 'non_json_string');
    assert.ok(typeof result['body_preview'] === 'string');
  });
});

describe('sanitizeQuotaSyncResponse — limitación de arrays', () => {
  it('limita array a 10 items con nota de truncado', () => {
    const bigArray = Array.from({ length: 20 }, (_, i) => ({ id: i, value: i * 10 }));
    const input = { items: bigArray };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    const items = result['items'] as unknown[];
    assert.ok(items.length <= 11); // 10 items + 1 nota
    assert.ok(typeof items[items.length - 1] === 'string');
  });

  it('preserva arrays pequeños sin truncar', () => {
    const input = { items: [1, 2, 3] };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    const items = result['items'] as unknown[];
    assert.equal(items.length, 3);
  });
});

describe('getResponseShape — estructura de respuesta', () => {
  it('devuelve keys útiles para objeto plano', () => {
    const input = { credits_remaining: 500, credits_used: 100, plan: 'pro' };
    const shape = getResponseShape(input) as Record<string, unknown>;
    assert.equal(shape['_type'], 'object');
    const keys = shape['keys'] as string[];
    assert.ok(keys.includes('credits_remaining'));
    assert.ok(keys.includes('credits_used'));
    assert.ok(keys.includes('plan'));
  });

  it('devuelve keys de segundo nivel para objetos anidados', () => {
    const input = { usage: { credits_remaining: 500, reset_at: '2026-08-01' } };
    const shape = getResponseShape(input) as Record<string, unknown>;
    const nestedKeys = shape['usage:keys'] as string[];
    assert.ok(Array.isArray(nestedKeys));
    assert.ok(nestedKeys.includes('credits_remaining'));
    assert.ok(nestedKeys.includes('reset_at'));
  });

  it('devuelve longitud y tipo del primer item para arrays', () => {
    const input = { results: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] };
    const shape = getResponseShape(input) as Record<string, unknown>;
    assert.equal(shape['results:array_length'], 2);
    assert.ok(Array.isArray(shape['results:first_item_keys']));
  });

  it('devuelve _type: null para null', () => {
    const shape = getResponseShape(null) as Record<string, unknown>;
    assert.equal(shape['_type'], 'null');
  });

  it('devuelve _type: array con longitud para array vacío', () => {
    const shape = getResponseShape([]) as Record<string, unknown>;
    assert.equal(shape['_type'], 'array');
    assert.equal(shape['length'], 0);
    assert.equal(shape['first_item_shape'], null);
  });
});

describe('observabilidad — error de parser Tavily', () => {
  it('guarda response_shape cuando el parser falla (sin campos de cuota)', () => {
    // Simula: API responde 200 con objeto sin campos conocidos
    const rawUnknownResponse = { status: 'active', plan_name: 'starter', user_id: 'abc123' };
    const shape = getResponseShape(rawUnknownResponse) as Record<string, unknown>;
    const keys = shape['keys'] as string[];
    // El shape debe revelar que no hay credits_remaining, credits_used, etc.
    assert.ok(keys.includes('status'));
    assert.ok(keys.includes('plan_name'));
    assert.ok(!keys.includes('credits_remaining'));
    assert.ok(!keys.includes('credits_used'));
  });

  it('raw_response_sanitized no contiene api_key aunque API la devuelva por error', () => {
    const rawWithKey = { error: 'invalid', api_key: 'leaked-key', code: 401 };
    const sanitized = sanitizeQuotaSyncResponse(rawWithKey) as Record<string, unknown>;
    assert.equal(sanitized['api_key'], '[REDACTED]');
    assert.equal(sanitized['error'], 'invalid');
  });
});

describe('observabilidad — error de parser Lusha', () => {
  it('guarda response_shape cuando Lusha devuelve formato desconocido', () => {
    const rawLushaUnknown = { success: true, account_info: { plan: 'enterprise' } };
    const shape = getResponseShape(rawLushaUnknown) as Record<string, unknown>;
    const keys = shape['keys'] as string[];
    assert.ok(keys.includes('success'));
    assert.ok(keys.includes('account_info'));
    // account_info existe pero sin campos de cuota
    const nestedKeys = shape['account_info:keys'] as string[];
    assert.ok(nestedKeys.includes('plan'));
    assert.ok(!nestedKeys.includes('remaining_credits'));
  });

  it('sanitización Lusha elimina api_key anidado', () => {
    const rawLusha = { data: { api_key: 'lusha-secret', remaining_credits: 800 } };
    const sanitized = sanitizeQuotaSyncResponse(rawLusha) as Record<string, unknown>;
    const data = sanitized['data'] as Record<string, unknown>;
    assert.equal(data['api_key'], '[REDACTED]');
    assert.equal(data['remaining_credits'], 800);
  });
});

describe('observabilidad — no se guardan headers ni Authorization', () => {
  it('redacta Authorization si aparece en respuesta', () => {
    const input = { Authorization: 'Bearer tok', credits: 100 };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    // Authorization tiene 'authorization' en lowercase que está en SENSITIVE_KEYS
    assert.equal(result['Authorization'], '[REDACTED]');
  });

  it('redacta apikey (sin guión) si aparece en respuesta', () => {
    const input = { apikey: 'my-key', remaining: 200 };
    const result = sanitizeQuotaSyncResponse(input) as Record<string, unknown>;
    assert.equal(result['apikey'], '[REDACTED]');
  });

  it('no guarda claves de request — sanitizeQuotaSyncResponse solo opera sobre la respuesta', () => {
    // No hay headers de request en el resultado; la función solo recibe el body
    const responseBody = { credits_remaining: 500 };
    const result = sanitizeQuotaSyncResponse(responseBody) as Record<string, unknown>;
    // No debe existir ningún campo de header de request
    assert.equal(result['Authorization'], undefined);
    assert.equal(result['api_key'], undefined);
  });
});
