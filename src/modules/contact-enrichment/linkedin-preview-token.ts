// Agente 2A — Vista previa firmada de la búsqueda por LinkedIn (F2).
//
// La búsqueda por LinkedIn tiene dos pasos separados por una decisión del usuario: primero se
// enriquece la persona (Apollo → Lusha, con gasto) y se muestra la vista previa; después el
// usuario elige la empresa y recién ahí nace el run CON su account_id. Entre los dos pasos el
// resultado del proveedor viaja al navegador y vuelve, firmado con HMAC-SHA256:
//
//   - sin migración (no hace falta una tabla para guardar la vista previa);
//   - el navegador no puede cambiar lo que trajo el proveedor (nombre, email, LinkedIn, gasto):
//     cualquier cambio invalida la firma;
//   - la firma vale para el usuario que buscó y caduca a los 30 minutos;
//   - crear el candidato NO vuelve a llamar a ningún proveedor.
//
// La clave se deriva de SUPABASE_SERVICE_ROLE_KEY (secreto que sólo existe en el servidor) con
// una etiqueta propia, así que una firma de aquí no sirve para nada más. Sólo servidor.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const LINKEDIN_PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_VERSION = 1;
const KEY_LABEL = 'sellup:agent2a:linkedin-preview:v1';

export type LinkedinPreviewTokenError = 'malformed' | 'bad_signature' | 'expired' | 'wrong_user' | 'no_secret';

export interface LinkedinPreviewTokenEnvelope<T> {
  v: number;
  uid: string;
  exp: number;
  data: T;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function deriveKey(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret)).update(body).digest('base64url');
}

export function signLinkedinPreviewToken<T>(
  data: T,
  options: { userId: string; nowMs: number; secret: string | null | undefined },
): string {
  if (!options.secret) throw new Error('linkedin_preview_secret_missing');
  const envelope: LinkedinPreviewTokenEnvelope<T> = {
    v: TOKEN_VERSION,
    uid: options.userId,
    exp: options.nowMs + LINKEDIN_PREVIEW_TOKEN_TTL_MS,
    data,
  };
  const body = base64url(JSON.stringify(envelope));
  return `${body}.${sign(body, options.secret)}`;
}

export function verifyLinkedinPreviewToken<T>(
  token: unknown,
  options: { userId: string; nowMs: number; secret: string | null | undefined },
): { ok: true; data: T } | { ok: false; error: LinkedinPreviewTokenError } {
  if (!options.secret) return { ok: false, error: 'no_secret' };
  if (typeof token !== 'string') return { ok: false, error: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: 'malformed' };
  const [body, signature] = parts;

  const expected = Buffer.from(sign(body, options.secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, error: 'bad_signature' };
  }

  let envelope: LinkedinPreviewTokenEnvelope<T>;
  try {
    envelope = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkedinPreviewTokenEnvelope<T>;
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (!envelope || envelope.v !== TOKEN_VERSION || typeof envelope.exp !== 'number') {
    return { ok: false, error: 'malformed' };
  }
  if (envelope.uid !== options.userId) return { ok: false, error: 'wrong_user' };
  if (options.nowMs > envelope.exp) return { ok: false, error: 'expired' };
  return { ok: true, data: envelope.data };
}
