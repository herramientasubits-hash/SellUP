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
  '.es': 'ES',
  '.com.es': 'ES',
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

// ─── AGENT1-COUNTRY-COMPATIBILITY-MULTICOUNTRY-1 · reglas por país ────────────
//
// Hasta este corte el gate sólo tenía reglas para Colombia: para cualquier otro
// país devolvía `compatible: true` sin mirar nada, así que una corrida en México
// admitía un `.com.pe` o un `.com.co` sin rechazo. Esta tabla da a CADA país del
// mago sus dominios propios y sus señales de ruta.
//
// 🔴 Colombia NO pasa por aquí: conserva su rama de siempre, byte por byte (es el
// único país certificado en Producción).
//
// Criterios conservadores:
//   · `.co` desnudo NO cuenta como «extranjero» para los demás países: lo usan
//     muchas empresas globales. Sólo `.com.co`, `.gov.co`… son colombianos.
//   · En las rutas, `/es/` y `es-` son IDIOMA, no España: nunca se usan para
//     afirmar un país extranjero.

type CountryDomainRules = {
  /** Dominio nacional (`.mx`). Cualquier subdominio que termine así es nativo. */
  nationalTld: string;
  /** Segundo nivel nativo explícito (`.com.mx`, `.gob.mx`), para trazas. */
  nativeTlds: readonly string[];
  /** Señales de ruta que prueban operación en ESTE país sobre un dominio global. */
  pathSignals: readonly string[];
  /** Señales de ruta que, en OTRO país objetivo, apuntan a éste como extranjero. */
  foreignPathSignals: readonly string[];
};

export const COUNTRY_DOMAIN_RULES: Readonly<Record<string, CountryDomainRules>> = Object.freeze({
  CO: {
    nationalTld: '.co',
    nativeTlds: CO_NATIVE_TLDS,
    pathSignals: CO_PATH_SIGNALS,
    foreignPathSignals: ['/co/', '/es-co'],
  },
  MX: {
    nationalTld: '.mx',
    nativeTlds: ['.com.mx', '.net.mx', '.org.mx', '.gob.mx', '.edu.mx'],
    pathSignals: ['/mx/', '/mx-', '/es-mx', 'mexico'],
    foreignPathSignals: ['/mx/', '/mx-', '/es-mx'],
  },
  CL: {
    nationalTld: '.cl',
    nativeTlds: ['.gob.cl'],
    pathSignals: ['/cl/', '/cl-', '/es-cl', 'chile'],
    foreignPathSignals: ['/cl/', '/cl-', '/es-cl'],
  },
  AR: {
    nationalTld: '.ar',
    nativeTlds: ['.com.ar', '.gob.ar', '.gov.ar', '.org.ar'],
    pathSignals: ['/ar/', '/ar-', '/es-ar', 'argentina'],
    foreignPathSignals: ['/ar/', '/ar-', '/es-ar'],
  },
  BR: {
    nationalTld: '.br',
    nativeTlds: ['.com.br', '.gov.br', '.org.br'],
    pathSignals: ['/br/', '/br-', '/pt-br', 'brasil', 'brazil'],
    foreignPathSignals: ['/br/', '/br-', '/pt-br'],
  },
  PE: {
    nationalTld: '.pe',
    nativeTlds: ['.com.pe', '.gob.pe', '.org.pe'],
    pathSignals: ['/pe/', '/pe-', '/es-pe', 'peru'],
    foreignPathSignals: ['/pe/', '/pe-', '/es-pe'],
  },
  UY: {
    nationalTld: '.uy',
    nativeTlds: ['.com.uy', '.gub.uy'],
    pathSignals: ['/uy/', '/es-uy', 'uruguay'],
    foreignPathSignals: ['/uy/', '/es-uy'],
  },
  EC: {
    nationalTld: '.ec',
    nativeTlds: ['.com.ec', '.gob.ec'],
    pathSignals: ['/ec/', '/es-ec', 'ecuador'],
    foreignPathSignals: ['/ec/', '/es-ec'],
  },
  PY: {
    nationalTld: '.py',
    nativeTlds: ['.com.py', '.gov.py'],
    pathSignals: ['/py/', '/es-py', 'paraguay'],
    foreignPathSignals: ['/py/', '/es-py'],
  },
  BO: {
    nationalTld: '.bo',
    nativeTlds: ['.com.bo', '.gob.bo'],
    pathSignals: ['/bo/', '/es-bo', 'bolivia'],
    foreignPathSignals: ['/bo/', '/es-bo'],
  },
  VE: {
    nationalTld: '.ve',
    nativeTlds: ['.com.ve', '.gob.ve'],
    pathSignals: ['/ve/', '/es-ve', 'venezuela'],
    foreignPathSignals: ['/ve/', '/es-ve'],
  },
  GT: {
    nationalTld: '.gt',
    nativeTlds: ['.com.gt', '.gob.gt'],
    pathSignals: ['/gt/', '/es-gt', 'guatemala'],
    foreignPathSignals: ['/gt/', '/es-gt'],
  },
  HN: {
    nationalTld: '.hn',
    nativeTlds: ['.com.hn', '.gob.hn'],
    pathSignals: ['/hn/', '/es-hn', 'honduras'],
    foreignPathSignals: ['/hn/', '/es-hn'],
  },
  SV: {
    nationalTld: '.sv',
    nativeTlds: ['.com.sv', '.gob.sv'],
    pathSignals: ['/sv/', '/es-sv', 'elsalvador', 'el-salvador'],
    foreignPathSignals: ['/sv/', '/es-sv'],
  },
  NI: {
    nationalTld: '.ni',
    nativeTlds: ['.com.ni', '.gob.ni'],
    pathSignals: ['/ni/', '/es-ni', 'nicaragua'],
    foreignPathSignals: ['/ni/', '/es-ni'],
  },
  CR: {
    nationalTld: '.cr',
    nativeTlds: ['.co.cr', '.go.cr', '.fi.cr', '.ac.cr'],
    pathSignals: ['/cr/', '/es-cr', 'costarica', 'costa-rica'],
    foreignPathSignals: ['/cr/', '/es-cr'],
  },
  PA: {
    nationalTld: '.pa',
    nativeTlds: ['.com.pa', '.gob.pa'],
    pathSignals: ['/pa/', '/es-pa', 'panama'],
    foreignPathSignals: ['/pa/', '/es-pa'],
  },
  DO: {
    nationalTld: '.do',
    nativeTlds: ['.com.do', '.gob.do', '.gov.do'],
    pathSignals: ['/do/', '/es-do', 'dominicana'],
    foreignPathSignals: ['/es-do'],
  },
  US: {
    nationalTld: '.us',
    nativeTlds: ['.gov', '.mil'],
    pathSignals: ['/us/', '/en-us', 'usa', 'united-states'],
    foreignPathSignals: ['/us/', '/en-us'],
  },
  ES: {
    nationalTld: '.es',
    nativeTlds: ['.com.es', '.gob.es', '.org.es'],
    pathSignals: ['/es-es', 'espana', 'spain'],
    foreignPathSignals: ['/es-es'],
  },
});

/** ¿El dominio pertenece al país `code`? Devuelve el sufijo que lo prueba. */
function nativeSuffixFor(domain: string, code: string): string | null {
  const rules = COUNTRY_DOMAIN_RULES[code];
  if (!rules) return null;
  const explicit = [...rules.nativeTlds]
    .sort((a, b) => b.length - a.length)
    .find((tld) => domain.endsWith(tld));
  if (explicit) return explicit;
  // `.co` desnudo es ambiguo (uso global): sólo Colombia lo reclama, y no aquí.
  if (code !== 'CO' && domain.endsWith(rules.nationalTld)) return rules.nationalTld;
  return null;
}

/** El país EXTRANJERO (≠ objetivo) al que pertenece el dominio, si alguno. */
function foreignCountryOfDomain(
  domain: string,
  targetCode: string,
): { code: string; tld: string } | null {
  let best: { code: string; tld: string } | null = null;
  for (const code of Object.keys(COUNTRY_DOMAIN_RULES)) {
    if (code === targetCode) continue;
    const tld = nativeSuffixFor(domain, code) ?? (code === 'CO' ? getCoNativeTld(domain) : null);
    if (tld && (best === null || tld.length > best.tld.length)) best = { code, tld };
  }
  return best;
}

function evaluateNonColombia(url: string, code: string): CountryCompatibility {
  const rules = COUNTRY_DOMAIN_RULES[code];
  if (!rules) {
    // País fuera del mago: el comportamiento de siempre (neutral).
    return {
      compatible: true,
      confidence: 'medium',
      reason: 'country_check_not_implemented_for_code',
    };
  }
  const domain = normalizeDomain(url);
  const urlNorm = normalizeUrl(url);
  const hasTargetPath = rules.pathSignals.some((signal) => urlNorm.includes(signal));

  // Más largo gana: `.com.co` (extranjero) no puede leerse como `.co` genérico.
  const native = nativeSuffixFor(domain, code);
  const foreign = foreignCountryOfDomain(domain, code);
  if (native && (!foreign || native.length >= foreign.tld.length)) {
    return { compatible: true, confidence: 'high', reason: `native_tld:${native}` };
  }
  if (foreign) {
    if (hasTargetPath) {
      return {
        compatible: true,
        confidence: 'medium',
        reason: `foreign_tld_${foreign.tld}_but_target_path_signal`,
      };
    }
    return {
      compatible: false,
      confidence: 'high',
      reason: `foreign_country_tld:${foreign.tld}:${foreign.code}`,
    };
  }
  if (hasTargetPath) {
    return {
      compatible: true,
      confidence: 'high',
      reason: 'global_domain_with_target_path_signal',
    };
  }
  for (const [otherCode, otherRules] of Object.entries(COUNTRY_DOMAIN_RULES)) {
    if (otherCode === code) continue;
    if (otherRules.foreignPathSignals.some((signal) => urlNorm.includes(signal))) {
      return {
        compatible: false,
        confidence: 'medium',
        reason: `global_domain_with_foreign_path:${otherCode}`,
      };
    }
  }
  return { compatible: true, confidence: 'medium', reason: 'global_domain_no_country_signal' };
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evalúa compatibilidad entre un URL y un país objetivo.
 *
 * Colombia usa sus reglas históricas. Los demás países del mago usan
 * `COUNTRY_DOMAIN_RULES`; un país fuera de la tabla sigue siendo neutral.
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

  // AGENT1-COUNTRY-COMPATIBILITY-MULTICOUNTRY-1 — cada país con sus reglas.
  // Colombia sigue por su rama de siempre, abajo, sin cambios.
  if (code !== 'CO') {
    return evaluateNonColombia(url, code);
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
