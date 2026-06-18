/**
 * Country Compatibility Gate — Hito 16AB.43.27
 *
 * Evalúa si un candidato (URL/dominio) es compatible con el país objetivo.
 * Bloquea o reduce prioridad de candidatos con TLD de otro país sin evidencia
 * de operación en el país objetivo.
 *
 * Reglas:
 * - TLD del país objetivo → compatible HIGH
 * - TLD de otro país sin señal de path Colombia → incompatible
 * - TLD global (.com/.net) con señal de path Colombia → compatible HIGH
 * - TLD global sin señal de path Colombia → compatible MEDIUM (neutral)
 * - TLD de otro país con señal de path Colombia → compatible MEDIUM
 *
 * Sin llamadas externas. Sin writes. Sin LLM. Determinístico.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CountryCompatibilityConfidence = 'high' | 'medium' | 'low';

export type CountryCompatibility = {
  compatible: boolean;
  confidence: CountryCompatibilityConfidence;
  reason: string;
};

// ─── CO (Colombia) TLD signals ────────────────────────────────────────────────

const CO_NATIVE_TLDS = [
  '.com.co',
  '.net.co',
  '.org.co',
  '.gov.co',
  '.edu.co',
  '.mil.co',
];

const CO_NATIONAL_TLD = '.co';

// URL path fragments that indicate Colombia operations on a global domain
const CO_PATH_SIGNALS = [
  '/co-es',
  '/es-co',
  '/colombia',
  'colombia',
  '/co/',
  '-co/',
  '/co.',
];

// ─── Foreign country TLDs incompatible with Colombia by default ───────────────

const FOREIGN_COUNTRY_TLDS: Record<string, string> = {
  '.mx': 'MX',
  '.com.mx': 'MX',
  '.net.mx': 'MX',
  '.org.mx': 'MX',
  '.cl': 'CL',
  '.com.cl': 'CL',
  '.br': 'BR',
  '.com.br': 'BR',
  '.pe': 'PE',
  '.com.pe': 'PE',
  '.ar': 'AR',
  '.com.ar': 'AR',
  '.ec': 'EC',
  '.com.ec': 'EC',
  '.ve': 'VE',
  '.com.ve': 'VE',
  '.py': 'PY',
  '.com.py': 'PY',
  '.uy': 'UY',
  '.com.uy': 'UY',
  '.bo': 'BO',
  '.com.bo': 'BO',
};

// Path fragments that clearly indicate a specific foreign country
const FOREIGN_PATH_SIGNALS: Record<string, string> = {
  '/cl/': 'CL',
  '/cl-': 'CL',
  '/mx/': 'MX',
  '/mx-': 'MX',
  '/pe/': 'PE',
  '/pe-': 'PE',
  '/ar/': 'AR',
  '/ar-': 'AR',
  '/br/': 'BR',
  '/br-': 'BR',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDomain(url: string): string {
  try {
    const withProtocol = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(withProtocol);
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, '');
  }
}

function normalizeUrl(url: string): string {
  return url.toLowerCase();
}

function hasCoPathSignal(url: string): boolean {
  const normalized = normalizeUrl(url);
  return CO_PATH_SIGNALS.some((signal) => normalized.includes(signal));
}

function getForeignPathCountry(url: string): string | null {
  const normalized = normalizeUrl(url);
  for (const [signal, countryCode] of Object.entries(FOREIGN_PATH_SIGNALS)) {
    if (normalized.includes(signal)) return countryCode;
  }
  return null;
}

function getCoNativeTld(domain: string): string | null {
  for (const tld of CO_NATIVE_TLDS) {
    if (domain.endsWith(tld)) return tld;
  }
  return null;
}

function getForeignTld(domain: string): string | null {
  // Check longer TLDs first to avoid partial matches
  const sortedTlds = Object.keys(FOREIGN_COUNTRY_TLDS).sort(
    (a, b) => b.length - a.length,
  );
  for (const tld of sortedTlds) {
    if (domain.endsWith(tld)) return tld;
  }
  return null;
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evalúa compatibilidad entre un URL y un país objetivo.
 *
 * Currently only implements CO (Colombia) rules. Other country codes
 * fall through to a neutral "medium compatible" result.
 */
export function evaluateCountryCompatibility(
  url: string | null | undefined,
  targetCountryCode: string,
): CountryCompatibility {
  if (!url) {
    return {
      compatible: true,
      confidence: 'low',
      reason: 'no_url_to_evaluate',
    };
  }

  const code = targetCountryCode.toUpperCase();

  // Only enforce for Colombia for now
  if (code !== 'CO') {
    return {
      compatible: true,
      confidence: 'medium',
      reason: 'country_check_not_implemented_for_code',
    };
  }

  const domain = normalizeDomain(url);
  const urlNorm = normalizeUrl(url);

  // ── 1. Check native CO TLDs ─────────────────────────────────────────────────
  const coNativeTld = getCoNativeTld(domain);
  if (coNativeTld) {
    return {
      compatible: true,
      confidence: 'high',
      reason: `co_native_tld:${coNativeTld}`,
    };
  }

  // ── 2. Check .co TLD (national, but also used by global companies) ───────────
  if (domain.endsWith(CO_NATIONAL_TLD) && !getForeignTld(domain)) {
    return {
      compatible: true,
      confidence: 'high',
      reason: 'co_national_tld',
    };
  }

  // ── 3. Check foreign country TLDs ───────────────────────────────────────────
  const foreignTld = getForeignTld(domain);
  if (foreignTld) {
    const foreignCountry = FOREIGN_COUNTRY_TLDS[foreignTld];
    // Even with foreign TLD, a clear CO path signal indicates CO operations
    if (hasCoPathSignal(urlNorm)) {
      return {
        compatible: true,
        confidence: 'medium',
        reason: `foreign_tld_${foreignTld}_but_co_path_signal`,
      };
    }
    return {
      compatible: false,
      confidence: 'high',
      reason: `foreign_country_tld:${foreignTld}:${foreignCountry}`,
    };
  }

  // ── 4. Generic TLD (.com, .net, .org, .io, etc.) ────────────────────────────
  // Check for explicit CO path signal first
  if (hasCoPathSignal(urlNorm)) {
    return {
      compatible: true,
      confidence: 'high',
      reason: 'global_domain_with_co_path_signal',
    };
  }

  // Check for explicit foreign path signal (e.g., cosmoconsult.com/cl/consultoria)
  const foreignPathCountry = getForeignPathCountry(urlNorm);
  if (foreignPathCountry) {
    return {
      compatible: false,
      confidence: 'medium',
      reason: `global_domain_with_foreign_path:${foreignPathCountry}`,
    };
  }

  // Neutral global domain — assume medium compatible
  return {
    compatible: true,
    confidence: 'medium',
    reason: 'global_domain_no_country_signal',
  };
}

/**
 * Ranking weight for a country compatibility result.
 * Higher = should be ranked first.
 * Used by candidate-writer to sort before applying target cap.
 */
export function countryCompatibilityRankWeight(
  result: CountryCompatibility,
): number {
  if (!result.compatible) return 0;
  switch (result.confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 1;
  }
}
