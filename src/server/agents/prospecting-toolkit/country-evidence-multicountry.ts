/**
 * country-evidence-multicountry.ts — evidencia de país fuera de Colombia y Argentina.
 *
 * AGENT1-COUNTRY-EVIDENCE-MULTICOUNTRY-1.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * `evaluateCountryEvidence` sólo sabía mirar Colombia y Argentina. Para cualquier
 * otro país devolvía `weak` sin fuentes, y desde X6.2-A eso SÍ penaliza: la
 * política lo lee como `country_evidence_absent_survives_incomplete`, que no
 * cuenta hacia el objetivo, no autoriza gasto y —por ser `evidence_policy:*`— el
 * enrichment no puede rescatarlo (`isQualityBlockRecoverableByEnrichment`).
 *
 * Medido en Producción el 2026-09-29 (México × Tecnología, lote `41977202`):
 * 282 de 282 empresas de Apollo salieron con ese motivo, incluidas las 109 con
 * dominio `.mx`. Una corrida fuera de Colombia no podía aceptar a nadie.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────────────
 *
 * Aplica a cada país del mago la MISMA doctrina que Colombia, sin relajarla:
 *
 *   1. URL — el sufijo nativo del hostname (`resolveNativeCountryHostSuffix`,
 *      la misma regla del gate de compatibilidad) y, si no hay, un fragmento de
 *      ruta con el nombre o el locale del país (`/es-mx`, `-mexico`);
 *   2. texto — snippet + título mencionan el país, un gentilicio o una ciudad;
 *   3. consulta — sólo si nada de lo anterior, y sólo con el NOMBRE del país.
 *
 * Como en Colombia, a lo sumo UNA fuente de URL y UNA de texto.
 *
 * 🔴 Lo que NO hace: no cuenta el filtro de ubicación del proveedor como
 * evidencia. Una empresa `.com` sin mención del país sigue `weak` —igual que en
 * Colombia—. Cambiar eso es un cambio de criterio, no de paridad.
 *
 * 🔴 Más estricto que Colombia en un punto, a propósito: el texto y los
 * fragmentos de URL se comparan con LÍMITE DE PALABRA. `includes('lima')` casa
 * con «climate», y `includes('/usa')` con «/usability». Las ramas de Colombia y
 * Argentina no se tocan.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

import { resolveNativeCountryHostSuffix } from './country-compatibility';
import type { CountryEvidenceResult } from './country-evidence-gate';

export type CountryEvidenceSignals = {
  /** Nombre(s) del país. Cuentan en el texto y son lo ÚNICO que cuenta en la consulta. */
  readonly names: readonly string[];
  /** Gentilicios y ciudades. Sólo texto: una ciudad en la consulta no prueba nada nuevo. */
  readonly textSignals: readonly string[];
  /** Fragmentos de URL: locale y nombre del país en la ruta o en el nombre del host. */
  readonly urlFragments: readonly string[];
  /** Frases que contienen un nombre del país pero hablan de OTRO lugar. */
  readonly excludedPhrases?: readonly string[];
};

/** Fragmentos de URL a partir de los slugs del país y su locale. */
function fragments(locales: readonly string[], slugs: readonly string[]): readonly string[] {
  return [...locales, ...slugs.flatMap((slug) => [`/${slug}`, `-${slug}`])];
}

/**
 * Todo en minúsculas y SIN tildes: se compara contra texto normalizado.
 *
 * Criterios, los mismos para cada país:
 *   · un gentilicio que también es el nombre de un IDIOMA no se usa («español»);
 *   · una ciudad con homónimas relevantes en otros países del mago no se usa sola
 *     («santiago», «san josé», «la paz», «córdoba», «valencia» fuera de España);
 *   · «usa» es también un verbo en español: sólo cuenta en la URL.
 */
export const COUNTRY_EVIDENCE_SIGNALS: Readonly<Record<string, CountryEvidenceSignals>> =
  Object.freeze({
    MX: {
      names: ['mexico'],
      textSignals: ['mexicano', 'mexicana', 'cdmx', 'ciudad de mexico', 'monterrey', 'guadalajara', 'queretaro', 'tijuana', 'puebla'],
      urlFragments: fragments(['/es-mx', '/mx-es'], ['mexico']),
      excludedPhrases: ['new mexico', 'nuevo mexico'],
    },
    CL: {
      names: ['chile'],
      textSignals: ['chileno', 'chilena', 'santiago de chile', 'valparaiso', 'vina del mar'],
      urlFragments: fragments(['/es-cl', '/cl-es'], ['chile']),
    },
    BR: {
      names: ['brasil', 'brazil'],
      textSignals: ['brasileiro', 'brasileira', 'brazilian', 'sao paulo', 'rio de janeiro', 'belo horizonte', 'curitiba', 'porto alegre'],
      urlFragments: fragments(['/pt-br', '/br-pt'], ['brasil', 'brazil']),
    },
    PE: {
      names: ['peru'],
      textSignals: ['peruano', 'peruana', 'lima', 'arequipa'],
      urlFragments: fragments(['/es-pe', '/pe-es'], ['peru']),
    },
    UY: {
      names: ['uruguay'],
      textSignals: ['uruguayo', 'uruguaya', 'montevideo'],
      urlFragments: fragments(['/es-uy', '/uy-es'], ['uruguay']),
    },
    EC: {
      names: ['ecuador'],
      textSignals: ['ecuatoriano', 'ecuatoriana', 'quito', 'guayaquil'],
      urlFragments: fragments(['/es-ec', '/ec-es'], ['ecuador']),
    },
    PY: {
      names: ['paraguay'],
      textSignals: ['paraguayo', 'paraguaya', 'asuncion'],
      urlFragments: fragments(['/es-py', '/py-es'], ['paraguay']),
    },
    BO: {
      names: ['bolivia'],
      textSignals: ['boliviano', 'boliviana', 'cochabamba', 'santa cruz de la sierra'],
      urlFragments: fragments(['/es-bo', '/bo-es'], ['bolivia']),
    },
    VE: {
      names: ['venezuela'],
      textSignals: ['venezolano', 'venezolana', 'caracas', 'maracaibo'],
      urlFragments: fragments(['/es-ve', '/ve-es'], ['venezuela']),
    },
    GT: {
      names: ['guatemala'],
      textSignals: ['guatemalteco', 'guatemalteca'],
      urlFragments: fragments(['/es-gt', '/gt-es'], ['guatemala']),
    },
    HN: {
      names: ['honduras'],
      textSignals: ['hondureno', 'hondurena', 'tegucigalpa', 'san pedro sula'],
      urlFragments: fragments(['/es-hn', '/hn-es'], ['honduras']),
    },
    SV: {
      names: ['el salvador'],
      textSignals: ['salvadoreno', 'salvadorena', 'san salvador'],
      urlFragments: fragments(['/es-sv', '/sv-es'], ['el-salvador', 'elsalvador']),
    },
    NI: {
      names: ['nicaragua'],
      textSignals: ['nicaraguense', 'managua'],
      urlFragments: fragments(['/es-ni', '/ni-es'], ['nicaragua']),
    },
    CR: {
      names: ['costa rica'],
      textSignals: ['costarricense'],
      urlFragments: fragments(['/es-cr', '/cr-es'], ['costa-rica', 'costarica']),
    },
    PA: {
      names: ['panama'],
      textSignals: ['panameno', 'panamena'],
      urlFragments: fragments(['/es-pa', '/pa-es'], ['panama']),
      excludedPhrases: ['panama city beach', 'panama city, florida', 'panama city, fl'],
    },
    DO: {
      names: ['republica dominicana', 'dominican republic'],
      textSignals: ['dominicana', 'dominicano', 'santo domingo'],
      urlFragments: fragments(['/es-do', '/do-es'], ['republica-dominicana', 'dominicana']),
    },
    US: {
      names: ['estados unidos', 'united states', 'eeuu', 'ee.uu'],
      textSignals: ['new york', 'miami', 'chicago', 'houston', 'los angeles', 'san francisco', 'dallas', 'atlanta', 'boston', 'seattle', 'texas', 'california', 'florida'],
      urlFragments: fragments(['/en-us', '/us-en'], ['usa', 'united-states']),
    },
    ES: {
      names: ['espana', 'spain'],
      textSignals: ['madrid', 'barcelona', 'sevilla', 'valencia', 'bilbao'],
      urlFragments: fragments(['/es-es'], ['espana', 'spain']),
    },
  });

// ─── Comparación ──────────────────────────────────────────────────────────────

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `term` aparece como palabra (o frase) completa en `text`. */
function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:$|[^a-z0-9])`).test(text);
}

/** El fragmento aparece en la URL y NO continúa en letras o dígitos. */
function containsUrlFragment(url: string, fragment: string): boolean {
  return new RegExp(`${escapeRegExp(fragment)}(?:$|[^a-z0-9])`).test(url);
}

function withoutExcludedPhrases(text: string, signals: CountryEvidenceSignals): string {
  let out = text;
  for (const phrase of signals.excludedPhrases ?? []) {
    out = out.split(phrase).join(' ');
  }
  return out;
}

// ─── Evaluación ───────────────────────────────────────────────────────────────

/** `null` si el país no tiene reglas aquí (el llamador decide qué devolver). */
export function evaluateMulticountryEvidence(input: {
  hostname: string | null;
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
  targetCountryCode: string;
}): CountryEvidenceResult | null {
  const signals = COUNTRY_EVIDENCE_SIGNALS[input.targetCountryCode];
  if (!signals) return null;

  const sources: string[] = [];

  // 1. URL — primero el sufijo del hostname, después los fragmentos.
  const hostSuffix =
    input.hostname === null
      ? null
      : resolveNativeCountryHostSuffix(input.hostname, input.targetCountryCode);
  if (hostSuffix !== null) {
    sources.push(`url:${hostSuffix}`);
  } else {
    const url = normalizeForSearch(input.website ?? input.domain ?? '');
    const fragment = signals.urlFragments.find((f) => containsUrlFragment(url, f));
    if (fragment !== undefined) sources.push(`url:${fragment}`);
  }

  // 2. Snippet + título.
  const text = withoutExcludedPhrases(
    normalizeForSearch(`${input.sourceSnippet ?? ''} ${input.sourceTitle ?? ''}`),
    signals,
  );
  const textSignal = [...signals.names, ...signals.textSignals].find((term) =>
    containsTerm(text, term),
  );
  if (textSignal !== undefined) sources.push(`text:${textSignal}`);

  if (sources.length > 0) {
    return { evidenceLevel: 'strong', evidenceSources: sources, warning: null };
  }

  // 3. ¿El país sólo viene de la consulta?
  const query = withoutExcludedPhrases(normalizeForSearch(input.queryText ?? ''), signals);
  if (signals.names.some((name) => containsTerm(query, name))) {
    return {
      evidenceLevel: 'query_only',
      evidenceSources: ['query_text'],
      warning:
        'País no confirmado por evidencia del sitio — solo presente en la query de búsqueda',
    };
  }

  return {
    evidenceLevel: 'weak',
    evidenceSources: [],
    warning: 'País no confirmado por ninguna evidencia del candidato',
  };
}
