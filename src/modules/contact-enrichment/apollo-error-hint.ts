// Agente 2A — Apollo error hint sanitizer (APOLLO-PHONE-ASYNC-9)
//
// Pure, PII-free extraction of a SHORT, allowlisted, redacted reason from an
// Apollo error body/message. Apollo replies HTTP 422 to an async phone reveal
// started without a webhook Apollo accepts, but today we only persist the
// mechanical code (HTTP_422) and discard the body. This helper turns that body
// into a diagnosable hint WITHOUT ever storing raw bodies, payloads, secrets or
// personal data.
//
// Contract:
//   * input: an unknown error value — a raw body string, a JSON string, or an
//     already-parsed object.
//   * output: a sanitized string (<= 180 chars) or null when nothing safe
//     remains.
//   * from JSON/objects only allowlisted fields are read: error, message,
//     error_message, code, status. Anything else is dropped (never leaked raw).
//   * emails / URLs-with-query / long tokens (hex or alnum 32+) / phone numbers
//     / LinkedIn URLs are replaced by fixed placeholders.
//   * never returns the webhook token, an API key or a raw payload verbatim: any
//     webhook URL (which carries ?token=…) collapses to [redacted_url] and bare
//     long tokens collapse to [redacted_token].

/** Longitud máxima del hint persistido (evita bodies largos en metadata). */
export const APOLLO_ERROR_HINT_MAX_LENGTH = 180;

/** Únicos campos que se leen de un error JSON/objeto (nunca el payload crudo). */
const ALLOWLISTED_FIELDS = [
  'error',
  'message',
  'error_message',
  'code',
  'status',
] as const;

/** Intenta parsear JSON; devuelve undefined si no es JSON válido. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Extrae y concatena SOLO los campos allowlisted de un objeto de error. */
function extractFromObject(obj: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const field of ALLOWLISTED_FIELDS) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim());
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      parts.push(String(value));
    }
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

/**
 * Deriva el texto base a sanitizar. De objetos / JSON solo salen los campos
 * allowlisted; un JSON-objeto sin ninguno de esos campos devuelve null (no se
 * filtra el body crudo). Un string plano (no-JSON) SÍ es el mensaje/body y se
 * usa tal cual (luego se redacta).
 */
function extractRawText(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number' && Number.isFinite(input)) return String(input);

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const parsed = tryParseJson(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return extractFromObject(parsed as Record<string, unknown>);
    }
    // No es un objeto JSON: el string ES el mensaje/body de error.
    return trimmed;
  }

  if (typeof input === 'object' && !Array.isArray(input)) {
    return extractFromObject(input as Record<string, unknown>);
  }

  return null;
}

/**
 * Reemplaza patrones sensibles por placeholders fijos. El orden importa: los
 * patrones específicos (LinkedIn, email, URL con query) corren antes que los
 * genéricos (tokens largos, teléfonos) para no dejar residuos.
 */
function redactSensitive(text: string): string {
  return (
    text
      // LinkedIn (específico) antes que URL genérica.
      .replace(/https?:\/\/([a-z0-9-]+\.)*linkedin\.com\/\S*/gi, '[redacted_linkedin]')
      // Emails.
      .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[redacted_email]')
      // URLs con query (incluye webhook_url con ?token=…).
      .replace(/https?:\/\/\S*\?\S*/gi, '[redacted_url]')
      // Tokens largos / hex o alfanuméricos de 32+ (API keys, webhook tokens).
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted_token]')
      // Teléfonos (>= ~7 dígitos con separadores; no toca códigos cortos como 422).
      .replace(/\+?\d[\d().\-\s]{5,}\d/g, '[redacted_phone]')
  );
}

/**
 * Convierte un error de Apollo (body/message/objeto) en un hint corto, sin PII
 * y sin secretos, apto para provider_usage_logs.metadata. Devuelve null cuando
 * no queda nada seguro que reportar.
 */
export function sanitizeApolloErrorMessage(input: unknown): string | null {
  const raw = extractRawText(input);
  if (!raw) return null;

  const redacted = redactSensitive(raw);
  const collapsed = redacted.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;

  const truncated =
    collapsed.length > APOLLO_ERROR_HINT_MAX_LENGTH
      ? collapsed.slice(0, APOLLO_ERROR_HINT_MAX_LENGTH)
      : collapsed;

  return truncated.length > 0 ? truncated : null;
}
