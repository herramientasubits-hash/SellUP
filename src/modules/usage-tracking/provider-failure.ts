// ============================================================
// Por qué falló un proveedor, dicho claro (dueña 11-11)
// Claude sin saldo respondía «http_400» y nadie sabía qué pasaba. Este
// módulo puro lee el código, el estado HTTP y el texto que devolvió
// cualquier proveedor (Claude, Tavily, Apollo, Lusha, HubSpot…) y dice
// qué pasó en una frase: sin créditos, llave rechazada, demasiadas
// consultas, caído, tardó demasiado. Lo usan el registro de uso y las
// pantallas de los agentes.
// ============================================================

export type ProviderFailureKind =
  | 'out_of_credits'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'unknown';

export interface ProviderFailureInput {
  /** `anthropic`, `tavily`, `apollo`, `lusha`… */
  providerKey: string | null | undefined;
  /** Código guardado (`http_400`, `tavily_http_432`, `rate_limited`, `credits_exhausted`…). */
  errorCode?: string | null;
  /** Estado HTTP si se conoce aparte del código. */
  httpStatus?: number | null;
  /** Texto que devolvió el proveedor (cuerpo de la respuesta o mensaje). */
  rawMessage?: string | null;
}

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Código normalizado para guardar y filtrar. */
  code: string;
  /** Nombre del proveedor tal como lo ve el equipo. */
  providerName: string;
  /** La frase para la persona. */
  message: string;
  /** Lo que dijo el proveedor, limpio (sin JSON), si dijo algo. */
  detail: string | null;
}

/** Códigos normalizados que este módulo escribe en `error_code`. */
export const PROVIDER_FAILURE_CODES: Record<Exclude<ProviderFailureKind, 'unknown'>, string> = {
  out_of_credits: 'credits_exhausted',
  invalid_credentials: 'invalid_credentials',
  rate_limited: 'rate_limited',
  provider_unavailable: 'provider_unavailable',
  timeout: 'timeout',
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Claude',
  claude: 'Claude',
  openai: 'OpenAI',
  google: 'Google',
  gemini: 'Gemini',
  tavily: 'Tavily',
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  slack: 'Slack',
  migo: 'Migo',
};

export function providerDisplayName(providerKey: string | null | undefined): string {
  const key = (providerKey ?? '').trim().toLowerCase();
  if (!key) return 'El proveedor';
  if (PROVIDER_NAMES[key]) return PROVIDER_NAMES[key];
  const base = key.split(/[_\-.]/)[0];
  if (PROVIDER_NAMES[base]) return PROVIDER_NAMES[base];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const CREDIT_PATTERN =
  /credit balance|insufficient[_\s-]*(credits?|funds|balance)|out of credits|no (more )?credits|not enough credits|credits? (are )?(exhausted|depleted)|ran out of credits|quota (exceeded|exhausted)|exceeded (your|the) (plan|quota|credit|usage)|plan (usage )?limit|usage limit (exceeded|reached)|billing|payment required|sin cr[eé]ditos|saldo insuficiente/i;
const AUTH_PATTERN =
  /invalid[_\s-]*(x-)?api[_\s-]*key|api key (is )?(invalid|missing|revoked)|authentication[_\s-]*error|unauthori[sz]ed|invalid[_\s-]*auth|token[_\s-]*(revoked|expired)|permission[_\s-]*error|forbidden/i;
const RATE_PATTERN = /rate[_\s-]*limit|too many requests/i;
const OVERLOADED_PATTERN = /overloaded|service unavailable|temporarily unavailable|internal server error|bad gateway/i;

const CODE_KIND: Record<string, ProviderFailureKind> = {
  credits_exhausted: 'out_of_credits',
  insufficient_credits: 'out_of_credits',
  no_credits: 'out_of_credits',
  quota_exceeded: 'out_of_credits',
  out_of_credits: 'out_of_credits',
  invalid_credentials: 'invalid_credentials',
  invalid_api_key: 'invalid_credentials',
  invalid_auth: 'invalid_credentials',
  unauthorized: 'invalid_credentials',
  token_revoked: 'invalid_credentials',
  rate_limited: 'rate_limited',
  rate_limit: 'rate_limited',
  too_many_requests: 'rate_limited',
  provider_unavailable: 'provider_unavailable',
  overloaded: 'provider_unavailable',
  network_error: 'provider_unavailable',
  timeout: 'timeout',
  timed_out: 'timeout',
};

/** Estado HTTP escondido en el código (`http_400`, `tavily_http_432`, `apollo_422`). */
export function httpStatusFromCode(code: string | null | undefined): number | null {
  const match = /(?:^|_)(?:http_)?([1-5]\d{2})(?:$|_)/i.exec(code ?? '');
  return match ? Number(match[1]) : null;
}

/** Saca el mensaje legible de un cuerpo JSON de error (`{"error":{"message":…}}`). */
export function extractProviderDetail(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      const found = findMessage(parsed);
      if (found) return clip(found);
    } catch {
      // No era JSON completo (cortado): se usa tal cual.
    }
  }
  return clip(text);
}

function findMessage(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error_message', 'detail', 'error_description', 'msg']) {
      if (typeof record[key] === 'string' && (record[key] as string).trim()) return (record[key] as string).trim();
    }
    for (const key of ['error', 'errors', 'data']) {
      const found = findMessage(record[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function clip(text: string, max = 240): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function kindFromStatus(providerKey: string, status: number | null, haystack: string): ProviderFailureKind | null {
  if (status === null) return null;
  if (status === 402) return 'out_of_credits';
  // Tavily: 432 = se acabó el plan; 433 = tope de pago por uso.
  if (providerKey === 'tavily' && (status === 432 || status === 433)) return 'out_of_credits';
  if (status === 401) return 'invalid_credentials';
  if (status === 403) return CREDIT_PATTERN.test(haystack) ? 'out_of_credits' : 'invalid_credentials';
  if (status === 429) return CREDIT_PATTERN.test(haystack) ? 'out_of_credits' : 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'provider_unavailable';
  return null;
}

/** Qué pasó con el proveedor, en una frase. Nunca lanza. */
export function describeProviderFailure(input: ProviderFailureInput): ProviderFailure {
  const providerKey = (input.providerKey ?? '').trim().toLowerCase();
  const providerName = providerDisplayName(providerKey);
  const rawCode = (input.errorCode ?? '').trim();
  const detail = extractProviderDetail(input.rawMessage);
  const haystack = `${rawCode} ${input.rawMessage ?? ''}`;
  const status = input.httpStatus ?? httpStatusFromCode(rawCode);

  const kind: ProviderFailureKind =
    // El texto del proveedor manda: Claude sin saldo responde 400.
    (CREDIT_PATTERN.test(input.rawMessage ?? '') ? 'out_of_credits' : null) ??
    CODE_KIND[rawCode.toLowerCase()] ??
    kindFromStatus(providerKey, status, haystack) ??
    (AUTH_PATTERN.test(input.rawMessage ?? '') ? 'invalid_credentials' : null) ??
    (RATE_PATTERN.test(input.rawMessage ?? '') ? 'rate_limited' : null) ??
    (OVERLOADED_PATTERN.test(input.rawMessage ?? '') ? 'provider_unavailable' : null) ??
    'unknown';

  const code = kind === 'unknown' ? rawCode || 'provider_error' : PROVIDER_FAILURE_CODES[kind];
  return { kind, code, providerName, message: providerFailureMessage(kind, providerName, rawCode), detail };
}

/** La frase para la persona según el tipo de falla. */
export function providerFailureMessage(kind: ProviderFailureKind, providerName: string, rawCode?: string | null): string {
  switch (kind) {
    case 'out_of_credits':
      return `${providerName} se quedó sin créditos. Pide a un administrador que recargue el saldo de ${providerName} y vuelve a intentarlo.`;
    case 'invalid_credentials':
      return `${providerName} rechazó la llave de acceso. Un administrador debe revisar la conexión en Integraciones.`;
    case 'rate_limited':
      return `${providerName} recibió demasiadas consultas seguidas. Espera un minuto y vuelve a intentarlo.`;
    case 'provider_unavailable':
      return `${providerName} no está respondiendo en este momento. Vuelve a intentarlo en unos minutos.`;
    case 'timeout':
      return `${providerName} tardó demasiado en responder. Vuelve a intentarlo.`;
    default:
      return rawCode
        ? `${providerName} devolvió un error (${rawCode}).`
        : `${providerName} devolvió un error.`;
  }
}

/** Frase + lo que dijo el proveedor, para guardar en `error_message`. */
export function providerFailureLogMessage(failure: ProviderFailure, max = 500): string {
  const text = failure.detail && !failure.message.includes(failure.detail)
    ? `${failure.message} Detalle: ${failure.detail}`
    : failure.message;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** ¿Es una falla que se arregla recargando o reconectando (no vale reintentar)? */
export function isBlockingProviderFailure(kind: ProviderFailureKind): boolean {
  return kind === 'out_of_credits' || kind === 'invalid_credentials';
}

/**
 * De los códigos de error de varias llamadas a un proveedor, la frase de la
 * falla que explica un resultado vacío (sin créditos, llave, caído, demasiadas
 * consultas, tardó). `null` si no hubo falla del proveedor: entonces el vacío
 * es real y se dice lo de siempre.
 */
export function providerFailureNotice(
  errorCodes: ReadonlyArray<string | null | undefined>,
  providerKey = 'anthropic',
): string | null {
  const failures = errorCodes
    .filter((code): code is string => !!code)
    .map((code) => describeProviderFailure({ providerKey, errorCode: code }))
    .filter((f) => f.kind !== 'unknown');
  if (failures.length === 0) return null;
  const blocking = failures.find((f) => isBlockingProviderFailure(f.kind));
  return (blocking ?? failures[0]).message;
}
