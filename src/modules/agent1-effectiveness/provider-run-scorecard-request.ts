// AGENT1-PROVIDER-RUN-SCORECARD-1 — los parámetros de una consulta de la ficha.
//
// Vienen de una URL: son dato NO confiable. Se validan aquí, en un módulo puro,
// para que la ruta no tenga lógica y para poder probarlos sin servidor.

export const SCORECARD_MAX_WINDOW_DAYS = 93;

/** Un precio simulado no puede ser absurdo: acota errores de tipeo. */
const MAX_USD_PER_CREDIT = 10;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type ProviderRunScorecardRequest = {
  /** Inicio inclusivo, ISO. */
  dateFrom: string;
  /** Fin exclusivo, ISO. */
  dateTo: string;
  countryCode: string | null;
  industry: string | null;
  /** Precio simulado por proveedor; `null` = el de `provider_pricing_config`. */
  usdPerCreditOverride: { apollo: number | null; lusha: number | null };
};

export type ProviderRunScorecardRequestResult =
  | { ok: true; request: ProviderRunScorecardRequest }
  | { ok: false; error: string };

function parseDate(value: string | null): Date | null {
  if (!value || !DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function parsePrice(value: string | null): number | null | 'invalid' {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= MAX_USD_PER_CREDIT ? n : 'invalid';
}

function parseCode(value: string | null, pattern: RegExp): string | null | 'invalid' {
  if (value === null || value === '') return null;
  return pattern.test(value) ? value : 'invalid';
}

/**
 * `from` y `to` son fechas `YYYY-MM-DD`; `to` es exclusivo. Sin `to`, un día.
 */
export function parseProviderRunScorecardRequest(
  params: URLSearchParams,
): ProviderRunScorecardRequestResult {
  const from = parseDate(params.get('from'));
  if (!from) return { ok: false, error: '`from` debe ser una fecha YYYY-MM-DD' };

  const rawTo = params.get('to');
  const to = rawTo === null ? new Date(from.getTime() + 86_400_000) : parseDate(rawTo);
  if (!to) return { ok: false, error: '`to` debe ser una fecha YYYY-MM-DD' };
  if (to <= from) return { ok: false, error: '`to` debe ser posterior a `from`' };
  if (to.getTime() - from.getTime() > SCORECARD_MAX_WINDOW_DAYS * 86_400_000) {
    return { ok: false, error: `la ventana no puede superar ${SCORECARD_MAX_WINDOW_DAYS} días` };
  }

  const countryCode = parseCode(params.get('country'), /^[A-Z]{2}$/);
  if (countryCode === 'invalid')
    return { ok: false, error: '`country` debe ser un código ISO de 2 letras' };
  const industry = parseCode(params.get('industry'), /^[\p{L}\p{N} &/_-]{1,80}$/u);
  if (industry === 'invalid') return { ok: false, error: '`industry` no es válido' };

  const apollo = parsePrice(params.get('apollo_usd_per_credit'));
  const lusha = parsePrice(params.get('lusha_usd_per_credit'));
  if (apollo === 'invalid' || lusha === 'invalid') {
    return { ok: false, error: `el precio por crédito debe estar entre 0 y ${MAX_USD_PER_CREDIT}` };
  }

  return {
    ok: true,
    request: {
      dateFrom: from.toISOString(),
      dateTo: to.toISOString(),
      countryCode,
      industry,
      usdPerCreditOverride: { apollo, lusha },
    },
  };
}
