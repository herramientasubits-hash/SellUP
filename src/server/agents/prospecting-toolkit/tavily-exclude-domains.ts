/**
 * tavily-exclude-domains.ts — qué dominios le pedimos a Tavily que NO devuelva.
 *
 * AGENT1-TAVILY-V2-1 § 2.
 *
 * Tavily no pagina ni sabe qué empresas ya vimos: la misma consulta devuelve las
 * mismas páginas. Su única palanca es `exclude_domains` (máx. 150 por búsqueda,
 * docs.tavily.com). Cada dominio que excluimos es un hueco que Tavily llena con
 * un resultado distinto, sin costo adicional: la búsqueda `basic` sigue costando
 * 1 crédito.
 *
 * Se excluyen, en este orden de prioridad:
 *   1. ruido fijo que el filtro local descartaría de todos modos (redes,
 *      bolsas de empleo, directorios, estudios de mercado) — pagar por verlo
 *      sólo quita cupo;
 *   2. dominios ya vistos en rondas anteriores de ESTA corrida;
 *   3. dominios ya sugeridos por el Agente 1 en corridas previas del mismo país
 *      e industria (memoria negativa), que el escritor rechazaría por novedad.
 *
 * Módulo puro: recibe conjuntos, devuelve una lista acotada y determinista.
 */

import { normalizeDomain } from './normalization';

/** Tope documentado de `exclude_domains` en `POST /search`. */
export const TAVILY_EXCLUDE_DOMAINS_MAX = 150;

/**
 * Ruido fijo. Dominios raíz: el filtro local (`noise-filter.ts`) sigue siendo la
 * defensa para subdominios y variantes que Tavily no excluya por sí solo.
 */
export const TAVILY_STATIC_EXCLUDE_DOMAINS: readonly string[] = Object.freeze([
  // redes y plataformas (LinkedIn tiene su propia búsqueda dirigida)
  'linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com', 'x.com',
  'twitter.com', 'tiktok.com', 'pinterest.com', 'wikipedia.org',
  // bolsas de empleo
  'computrabajo.com', 'indeed.com', 'glassdoor.com', 'elempleo.com',
  'bumeran.com', 'occ.com.mx',
  // directorios y bases de empresas
  'kompass.com', 'dnb.com', 'zoominfo.com', 'rocketreach.co', 'europages.com',
  'crunchbase.com', 'empresite.eleconomista.es', 'paginasamarillas.com.co',
  'einforma.co', 'datacreditoempresas.com.co', 'lasempresas.com.co',
  'capterra.com', 'g2.com', 'clutch.co',
  // estudios de mercado, comercio exterior y repositorios académicos
  'statista.com', 'fortunebusinessinsights.com', 'mordorintelligence.com',
  'seair.co.in', 'sciencedirect.com', 'researchgate.net',
  // AGENT1-TAVILY-FREE-CREDITS-1 — ruido visto en Prod 01-10: excluirlo en la
  // búsqueda hace que Tavily llene esos huecos con resultados útiles.
  'opcionempleo.cl', 'opcionempleo.com', 'jobsora.com', 'laborum.cl', 'trabajando.com',
  'dateas.com', 'licitador.co', 'elhospital.com',
]);

export type TavilyExcludeDomainsInput = {
  /** Dominios vistos en rondas anteriores de esta corrida, en orden de aparición. */
  seenThisRun: Iterable<string>;
  /**
   * AGENT1-TAVILY-QUERY-SPACE-1 — dominios que ya trajeron las celdas de ESTA
   * ronda en corridas anteriores. Excluirlos es lo que hace que volver a una
   * celda devuelva resultados nuevos (paginar por exclusión).
   */
  cellDomains?: Iterable<string>;
  /** Dominios de la memoria negativa del país e industria. */
  negativeMemory: Iterable<string>;
  /**
   * AGENT1-TAVILY-QUERY-SPACE-1 — país de la corrida. La memoria negativa es
   * GLOBAL (todas las empresas entregadas por SellUp) y crece cada día; con 150
   * huecos, los primeros deben ser los que esta búsqueda sí podría devolver: los
   * del dominio del país. Prod 30-09 (fb530d9b): 412 dominios ya no cabían.
   */
  countryCode?: string | null;
};

/** Terminaciones de dominio propias del país, además de `.<cc>`. */
const EXTRA_COUNTRY_SUFFIXES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  US: ['.gov', '.us'],
});

export function isCountryDomain(domain: string, countryCode: string | null | undefined): boolean {
  const code = countryCode?.trim().toUpperCase() ?? '';
  if (code.length !== 2) return false;
  const suffixes = [`.${code.toLowerCase()}`, ...(EXTRA_COUNTRY_SUFFIXES[code] ?? [])];
  return suffixes.some((suffix) => domain.endsWith(suffix));
}

/** Los del país primero, conservando el orden dentro de cada grupo. */
export function prioritizeCountryDomains(
  domains: Iterable<string>,
  countryCode: string | null | undefined,
): string[] {
  const local: string[] = [];
  const rest: string[] = [];
  for (const raw of domains) {
    const domain = normalizeDomain(raw);
    if (!domain) continue;
    (isCountryDomain(domain, countryCode) ? local : rest).push(domain);
  }
  return [...local, ...rest];
}

export type TavilyExcludeDomainsResult = {
  domains: string[];
  staticCount: number;
  seenThisRunCount: number;
  negativeMemoryCount: number;
  cellDomainsCount: number;
  /** Dominios vistos o de memoria que no cupieron por el tope de 150. */
  truncatedCount: number;
};

export function buildTavilyExcludeDomains(input: TavilyExcludeDomainsInput): TavilyExcludeDomainsResult {
  const out: string[] = [];
  const seen = new Set<string>();
  let truncatedCount = 0;

  /** Cuántos dominios NUEVOS de `source` entraron a la lista. */
  const addAll = (source: Iterable<string>): number => {
    let added = 0;
    for (const raw of source) {
      const domain = normalizeDomain(raw);
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      if (out.length >= TAVILY_EXCLUDE_DOMAINS_MAX) {
        truncatedCount++;
        continue;
      }
      out.push(domain);
      added++;
    }
    return added;
  };

  const staticCount = addAll(TAVILY_STATIC_EXCLUDE_DOMAINS);
  const seenThisRunCount = addAll(input.seenThisRun);
  const cellDomainsCount = addAll(input.cellDomains ?? []);
  const negativeMemoryCount = addAll(prioritizeCountryDomains(input.negativeMemory, input.countryCode));

  return { domains: out, staticCount, seenThisRunCount, cellDomainsCount, negativeMemoryCount, truncatedCount };
}
