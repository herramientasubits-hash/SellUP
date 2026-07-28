// Agente 2A — Apollo Phone Reveal: ref opaco en webhook_url (APOLLO-PHONE-ASYNC-21)
//
// Módulo PURO (sin red, sin env, sin Supabase, sin logs). Añade nuestro propio
// identificador opaco de correlación (`ref`) al `webhook_url` que enviamos a
// Apollo al iniciar un reveal asíncrono.
//
// POR QUÉ un ref propio (contrato confirmado por Apollo humano):
//   * Apollo NO garantiza que el payload del webhook traiga `request_id` ni
//     `phone_enrichment.request_id`. La estrategia robusta recomendada por Apollo
//     es agregar nuestro propio ref opaco a la `webhook_url`; Apollo refleja los
//     query params en el callback, así que el ref vuelve como query param y nos
//     permite correlacionar el resultado con el candidato correcto.
//
// Reglas de seguridad del ref y del token en query:
//   * El ref debe ser OPACO y no contener PII (ni email, ni teléfono, ni
//     LinkedIn, ni nombre/empresa). Se recomienda un UUID server-side (el mismo
//     `sellup_transaction_id` / X-Transaction-Id del intento).
//   * El `token` existente en la URL se PRESERVA. El token en query puede ser
//     visible para Apollo Support internamente: debe ser single-purpose,
//     rotatable y de bajo alcance (no se asume secreto end-to-end frente a
//     Apollo). Este módulo no imprime el token ni el ref.
//   * NO se pre-percent-encodea la URL completa: sólo se codifican los VALORES de
//     query (lo hace la URL API al serializar `searchParams`).

/** Nombre del query param del ref opaco de correlación en el webhook_url. */
export const WEBHOOK_REF_QUERY_PARAM = 'ref';

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Devuelve una copia del `webhookUrl` con el query param `ref=<opaqueRef>`
 * agregado, preservando el resto de query params (incluido `token`).
 *
 * Contrato:
 *   * Usa la URL API (nunca concatena strings ni pre-encodea la URL completa);
 *     `URLSearchParams.set` codifica sólo el valor del query.
 *   * Si `ref` ya existe se sobreescribe (idempotente por intento).
 *   * Entrada inválida (URL no parseable o ref vacío) ⇒ devuelve la URL original
 *     sin tocar (fail-safe: nunca rompe el start por un ref).
 */
export function appendOpaqueWebhookRef(
  webhookUrl: string,
  opaqueRef: string | null | undefined,
): string {
  const ref = clean(opaqueRef);
  if (!ref) return webhookUrl;
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return webhookUrl;
  }
  url.searchParams.set(WEBHOOK_REF_QUERY_PARAM, ref);
  return url.toString();
}

/** Extrae el ref opaco de una webhook_url ya construida (o null si no está). */
export function extractOpaqueWebhookRef(webhookUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return null;
  }
  return clean(url.searchParams.get(WEBHOOK_REF_QUERY_PARAM));
}
