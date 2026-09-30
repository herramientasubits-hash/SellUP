/**
 * tavily-query-plan.ts — plan de consultas de Tavily sobre la macro industria.
 *
 * AGENT1-TAVILY-V2-1 § 1.
 *
 * ── El defecto que este módulo cierra ────────────────────────────────────────
 *
 * Tavily armaba sus consultas con listas propias en `query-builder.ts`, anteriores
 * al catálogo de 12 macro industrias:
 *   · `isTechSector` comparaba por substring y `'tic'` está dentro de
 *     «Logís-tic-a» y «Farmacéu-tic-os», así que «Transporte & Logística» y
 *     «Salud & Farmacéuticos» recibían consultas de software;
 *   · las rondas 3 y 4 eran literales «consultor ERP CRM», «software ERP SaaS»
 *     para CUALQUIER industria;
 *   · sin subindustrias (el catálogo 2.0.0 ya no las tiene), la ronda 1 caía a las
 *     consultas del planner, fuera del tope de 4 por ronda.
 *
 * Aquí las consultas salen de `discovery.families` del catálogo — los mismos
 * términos calibrados que usa Apollo —, cada término viaja UNA vez por corrida y
 * el punto de arranque rota por lote: con 20 vendedores corriendo el mismo día,
 * cada lote empieza por consultas distintas en vez de pagar las mismas páginas.
 *
 * Módulo puro: sin red, sin base de datos, sin reloj. El mismo lote produce
 * siempre el mismo plan, así que un reintento es reproducible.
 */

import {
  resolveMacroIndustryByDisplayName,
  type MacroIndustryDefinition,
  type MacroIndustryKey,
} from '@/modules/macro-industry-catalog/macro-industries';

export const TAVILY_QUERY_PLAN_VERSION = 'tavily_macro_query_plan_v1';

export const TAVILY_QUERIES_PER_ROUND = 4;
export const TAVILY_PLAN_MAX_ROUNDS = 4;
const ADDITIONAL_CRITERIA_MAX_CHARS = 80;

// ─── País e idioma ────────────────────────────────────────────────────────────

/**
 * Los 20 países del asistente en el vocabulario del parámetro `country` de
 * Tavily (enum de `POST /search`, docs.tavily.com, verificado 2026-09-29).
 */
const TAVILY_COUNTRY_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
  CO: 'colombia',
  AR: 'argentina',
  MX: 'mexico',
  CL: 'chile',
  BR: 'brazil',
  PE: 'peru',
  UY: 'uruguay',
  EC: 'ecuador',
  PY: 'paraguay',
  BO: 'bolivia',
  VE: 'venezuela',
  GT: 'guatemala',
  HN: 'honduras',
  SV: 'el salvador',
  NI: 'nicaragua',
  CR: 'costa rica',
  PA: 'panama',
  DO: 'dominican republic',
  US: 'united states',
  ES: 'spain',
});

/**
 * Países donde la consulta que redactamos (términos del catálogo en español,
 * más algún término técnico en inglés) está en el idioma del país.
 *
 * Brasil y Estados Unidos quedan fuera a propósito: la doc de Tavily pide que
 * `language` coincida con el idioma de la consulta, y el catálogo no tiene
 * vocabulario en portugués ni un juego completo en inglés. Pedir `portuguese`
 * con una consulta en español contradiría el texto. Ahí sólo viaja `country`.
 */
const SPANISH_QUERY_COUNTRIES: ReadonlySet<string> = new Set([
  'CO', 'AR', 'MX', 'CL', 'PE', 'UY', 'EC', 'PY', 'BO', 'VE',
  'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'DO', 'ES',
]);

export type TavilyCountryTargeting = {
  /** Valor para `country`. `null` ⇒ no se envía (nunca un valor que Tavily rechace). */
  country: string | null;
  /** Valor para `language` (sólo realce, nunca `filter_by_language`). */
  language: 'spanish' | null;
};

export function resolveTavilyCountryTargeting(
  countryCode: string | null | undefined,
): TavilyCountryTargeting {
  const code = countryCode?.trim().toUpperCase() ?? '';
  const country = TAVILY_COUNTRY_BY_CODE[code] ?? null;
  if (!country) return { country: null, language: null };
  return { country, language: SPANISH_QUERY_COUNTRIES.has(code) ? 'spanish' : null };
}

// ─── Criterio adicional ───────────────────────────────────────────────────────

/**
 * El criterio adicional es texto libre del vendedor. Antes de meterlo en una
 * consulta pagada se le quitan operadores de búsqueda (`site:`, `filetype:`,
 * `-exclusión`) y comillas, que cambiarían el significado de la consulta, y se
 * acota a 80 caracteres sin cortar palabras.
 */
export function sanitizeTavilyAdditionalCriteria(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tokens = raw
    .replace(/["“”'‘’]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^-?[a-z]+:\S*$/i.test(token))
    .map((token) => token.replace(/^-+/, ''))
    .filter((token) => token.length > 0);

  let out = '';
  for (const token of tokens) {
    const next = out ? `${out} ${token}` : token;
    if (next.length > ADDITIONAL_CRITERIA_MAX_CHARS) break;
    out = next;
  }
  return out.length > 0 ? out : null;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

export type TavilyMacroQueryPlan = {
  version: typeof TAVILY_QUERY_PLAN_VERSION;
  macroKey: MacroIndustryKey;
  /** Términos distintos disponibles antes de cortar por el tope de rondas. */
  termCount: number;
  /** Desplazamiento aplicado a la lista intercalada de términos. */
  rotationOffset: number;
  /** Consultas por ronda, en orden de emisión. Nunca vacío por dentro. */
  rounds: string[][];
  additionalCriteriaApplied: boolean;
};

export type TavilyMacroQueryPlanInput = {
  /** Nombre visible de la industria tal como lo resuelve el catálogo. */
  industry: string;
  /** Nombre visible del país, tal como aparece en la consulta. */
  country: string;
  /** Clave estable del lote: fija la rotación. */
  seedKey: string;
  additionalCriteria: string | null | undefined;
};

/**
 * Intercala las familias del catálogo (f0[0], f1[0], f0[1], f1[1], …) para que
 * cualquier tramo de la lista mezcle los dominios comerciales de la macro. Sin
 * familias declaradas, usa `specific` en su orden.
 */
function interleaveDiscoveryTerms(definition: MacroIndustryDefinition): string[] {
  const families = definition.discovery.families ?? [];
  const sources = families.length > 0
    ? families.map((family) => [...family.terms])
    : [[...definition.discovery.specific]];

  const out: string[] = [];
  const seen = new Set<string>();
  const longest = Math.max(...sources.map((terms) => terms.length));
  for (let i = 0; i < longest; i++) {
    for (const terms of sources) {
      const term = terms[i];
      if (term && !seen.has(term)) {
        seen.add(term);
        out.push(term);
      }
    }
  }
  return out;
}

/** FNV-1a de 32 bits: determinista, sin dependencias y estable entre runtimes. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function redactQuery(definition: MacroIndustryDefinition, term: string, country: string): string {
  // Una entidad pública no es una «empresa», y un término que ya dice
  // «empresa …» no necesita repetirlo.
  const needsCompanyWord = definition.key !== 'government' && !/^empresa\b/i.test(term);
  return needsCompanyWord ? `empresa ${term} ${country}` : `${term} ${country}`;
}

/**
 * Plan de consultas para una corrida de Tavily. `null` cuando la industria no es
 * una de las 12 macro industrias: el llamador conserva el camino legacy.
 */
export function buildTavilyMacroQueryPlan(
  input: TavilyMacroQueryPlanInput,
): TavilyMacroQueryPlan | null {
  const definition = resolveMacroIndustryByDisplayName(input.industry);
  if (!definition) return null;

  const terms = interleaveDiscoveryTerms(definition);
  if (terms.length === 0) return null;

  const rotationOffset = stableHash(input.seedKey) % terms.length;
  const rotated = [...terms.slice(rotationOffset), ...terms.slice(0, rotationOffset)];
  const selected = rotated.slice(0, TAVILY_QUERIES_PER_ROUND * TAVILY_PLAN_MAX_ROUNDS);

  const criteria = sanitizeTavilyAdditionalCriteria(input.additionalCriteria);
  const country = input.country.trim();

  const rounds: string[][] = [];
  for (let start = 0; start < selected.length; start += TAVILY_QUERIES_PER_ROUND) {
    const round = selected
      .slice(start, start + TAVILY_QUERIES_PER_ROUND)
      .map((term, index) => {
        const base = redactQuery(definition, term, country);
        // Mitad de la ronda con criterio, mitad sin él: el criterio orienta sin
        // estrechar toda la ronda a un texto libre que nadie calibró.
        return criteria && index % 2 === 0 ? `${base} ${criteria}` : base;
      });
    rounds.push(round);
  }

  return {
    version: TAVILY_QUERY_PLAN_VERSION,
    macroKey: definition.key,
    termCount: terms.length,
    rotationOffset,
    rounds,
    additionalCriteriaApplied: criteria !== null,
  };
}
