/**
 * candidate-writer-pure-gates.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · ADAPTIVE-EARLY-STOP §§ 3, 4 y 5.
 *
 * Los criterios de admisión del writer que son DETERMINISTAS y libres de I/O,
 * extraídos de `candidate-writer.ts` **sin un solo cambio de comportamiento**
 * para que exista UNA sola implementación con DOS llamadores: el writer, que
 * decide qué se escribe, y el evaluador PRE-writer, que decide si la corrida
 * puede dejar de gastar.
 *
 * Por qué extraer y no copiar: el addendum lo prohíbe explícitamente («NO copiar
 * lógica»), y con razón. Una copia empieza idéntica y deja de serlo en el primer
 * parche que sólo toca a uno de los dos lados; entonces la parada temprana vuelve
 * a decidir el gasto con una semántica que el writer ya no comparte, que es
 * exactamente el defecto que este hilo lleva cerrando desde
 * STABLE-TARGET-WRITER-PARITY.
 *
 * Puro: sin I/O, sin reloj, sin proveedor, sin Supabase. Todo lo que vive aquí
 * depende únicamente de sus argumentos.
 */

import type { CandidateQualityLabel } from './types';

// ─── Content-page gate (Hito 16AB.43.28) ──────────────────────────────────────
//
// Detecta URLs cuyo path indica una página de contenido, artículo, caso de éxito
// o blog en lugar de una homepage corporativa de una empresa real.
// Operación completamente local — sin IA, sin llamadas externas.

const CONTENT_PAGE_PATH_PATTERNS = [
  'casos-exito',                          // /nosotros/casos-exito, /casos-exito
  'caso-de-exito',                        // /caso-de-exito-...
  'casos-de-exito',                       // /3-casos-de-exito-..., /casos-de-exito
  '/academia/',                           // /academia/conceptos/...
  '/actualidad/',                         // /actualidad/nuestros-expertos/...
  '/nuestros-expertos/',                  // /nuestros-expertos/...
  '/blog/',                               // artículos de blog
  '/articulo/',                           // artículos editoriales
  '/article/',                            // artículos en inglés
  '/guide/',                              // guías
  '/full-guide/',                         // guías completas
  'nearshore-software-development',       // artículos tipo "nearshore software development Colombia"
  '/case-study/',                         // caso de éxito en inglés
  '/case-studies/',                       // casos de éxito en inglés
  '/success-story/',                      // historia de éxito
  '/success-stories/',                    // historias de éxito
  '/press/',                              // sala de prensa
  '/press-release/',                      // comunicados de prensa
  '/press-releases/',
  '/comunicado/',                         // comunicados en español
  '/comunicados/',
  '/nouvelles/',                          // noticias en francés (p.ej. moodle.com/fr/nouvelles/...)
  '/historias/',                          // historias editoriales
];

const CONTENT_PAGE_NAME_PATTERNS = [
  /^casos\s+de\s+[eé]xito/i,             // "Casos de éxito Línea Datascan"
  /^caso\s+de\s+[eé]xito/i,              // "Caso de éxito ..."
  /^full\s+guide$/i,                     // "Full guide"
  /^fases\s+y\s+beneficios/i,            // "Fases y beneficios..."
  /^\d+\s+casos\s+de\s+[eé]xito/i,       // "3 casos de éxito..."
  /^nearshore\s+software/i,              // "Nearshore software development..."
];

/**
 * Retorna true si la URL tiene un path que indica página de contenido/artículo,
 * no una homepage corporativa.
 */
export function isContentPageUrl(website: string | null): boolean {
  if (!website) return false;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const pathname = new URL(url).pathname.toLowerCase();
    return CONTENT_PAGE_PATH_PATTERNS.some((p) => pathname.includes(p));
  } catch {
    return false;
  }
}

/**
 * Retorna true si el nombre del candidato parece un título de artículo/caso de éxito
 * en lugar del nombre de una empresa real.
 */
export function isContentPageName(name: string): boolean {
  return CONTENT_PAGE_NAME_PATTERNS.some((p) => p.test(name.trim()));
}

// ─── Path depth helper ────────────────────────────────────────────────────────

/**
 * Número de segmentos de path en la URL. Menor → más cercano a la raíz.
 * Se usa como tiebreaker en el ordenamiento de elegibles.
 */
export function pathDepth(website: string | null): number {
  if (!website) return 999;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const { pathname } = new URL(url);
    return pathname.split('/').filter((s) => s.length > 0).length;
  } catch {
    return 999;
  }
}

// ─── Official website gate ────────────────────────────────────────────────────
//
// Dominios que son directorios, catálogos, marketplaces o rankings.
// Un candidato cuyo dominio de website sea uno de estos no debe persistirse
// como empresa oficial, ya que no tiene sitio propio identificable.
// Hito 16AB.43.25.

const DIRECTORY_SOURCE_DOMAINS = new Set([
  // Catálogos de software
  'catalogodesoftware.com',
  'comparasoftware.com',
  'comparasoftware.co',
  'capterra.com',
  'capterra.co',
  'g2.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com',
  'softwareworld.co',
  'crozdesk.com',
  'alternativeto.net',
  'producthunt.com',
  'techbehemoths.com',
  'clutch.co',
  'goodfirms.co',
  'sortlist.com',
  'designrush.com',
  // Directorios empresariales
  'guiatic.com',
  'yelp.com',
  'paginasamarillas.com.co',
  'einforma.com',
  'einforma.co',
  'datacreditoempresas.com.co',
  'lasempresas.com.co',
  'connectamericas.com',
  // Plataformas sociales
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  // Portales de empleo
  'computrabajo.com',
  'indeed.com',
  'glassdoor.com',
  // Directorios de empresas globales (v1.16K-S)
  'kompass.com',
  'europages.com',
  'manta.com',
  'dnb.com',
]);

/**
 * Retorna true si el dominio pertenece a un directorio/catálogo/marketplace,
 * lo que indica que el candidato no tiene sitio oficial propio identificable.
 */
export function isDirectorySourceDomain(domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (DIRECTORY_SOURCE_DOMAINS.has(d)) return true;
  for (const entry of DIRECTORY_SOURCE_DOMAINS) {
    if (d.endsWith(`.${entry}`)) return true;
  }
  return false;
}

// ─── Quality label → estado persistido ────────────────────────────────────────

/**
 * Mapeo:
 *   high_quality_new → needs_review
 *   needs_review     → needs_review
 *   duplicate        → duplicate
 *   insufficient_data→ needs_review (con nota, se conserva para trazabilidad)
 *   discard          → null (no se crea candidato)
 */
export function mapQualityLabelToStatus(label: CandidateQualityLabel): string | null {
  switch (label) {
    case "high_quality_new":
      return "needs_review";
    case "needs_review":
      return "needs_review";
    case "duplicate":
      return "duplicate";
    case "insufficient_data":
      return "needs_review";
    case "discard":
      return null;
    default:
      return "needs_review";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalización del nombre que se persiste en `prospect_candidates.normalized_name`
 * y que alimenta al Active Duplicate Guard. Movida aquí sin cambios (§ 3) porque
 * el evaluador PRE-writer necesita construir EXACTAMENTE la misma entrada de
 * guard que el writer.
 */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// ─── § 4 y § 5 — orden, dedupe intra-lote y cupo ──────────────────────────────

/**
 * Lo MÍNIMO que hace falta para ordenar un candidato como lo ordena el writer.
 *
 * Se declara como estructura y no como el `EligibleEntry` del writer a propósito:
 * el evaluador PRE-writer no tiene —ni necesita— el candidato entero, y exigirlo
 * habría obligado a construir uno falso para poder compartir el comparador.
 */
export type WriterEligibleRankSignals = {
  businessFitRankingBonus: number;
  sourceUrlRankingBonus: number;
  countryCompatWeight: number;
  confidenceScore: number | null;
  website: string | null;
};

/**
 * Prioridad del writer (Hito 16AB.43.27 / 16AB.43.28 / 16AB.43.29):
 *   1) score compuesto de encaje desc (business fit + calidad de URL + país),
 *   2) confianza desc,
 *   3) profundidad de path asc (más cerca de la raíz, mejor).
 *
 * Idéntica, literal, a la que aplicaba el `sort` de Pass 2.
 */
export function compareWriterEligibleRank(
  a: WriterEligibleRankSignals,
  b: WriterEligibleRankSignals,
): number {
  const aComposite = a.businessFitRankingBonus + a.sourceUrlRankingBonus + a.countryCompatWeight * 10;
  const bComposite = b.businessFitRankingBonus + b.sourceUrlRankingBonus + b.countryCompatWeight * 10;
  const compositeDiff = bComposite - aComposite;
  if (compositeDiff !== 0) return compositeDiff;
  const scoreDiff = (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  return pathDepth(a.website) - pathDepth(b.website);
}

/**
 * § 4 — dedupe intra-lote por identidad canónica, sobre una lista YA ordenada.
 *
 * Política de ganador: la primera aparición en el orden recibido, que es
 * exactamente lo que hace Pass 2.5 del writer sobre la lista ya rankeada. Una
 * entrada sin `identityKey` nunca se deduplica —no hay identidad con la que
 * colisionar— y por eso siempre gana.
 *
 * Devuelve los índices, no las entradas, para que los dos llamadores puedan
 * quedarse con su propia estructura sin que este módulo la conozca.
 */
export function selectIntraBatchIdentityWinnerIndexes(
  identityKeys: readonly (string | null)[],
): { winners: number[]; losers: number[] } {
  const seen = new Set<string>();
  const winners: number[] = [];
  const losers: number[] = [];
  for (let index = 0; index < identityKeys.length; index++) {
    const key = identityKeys[index];
    if (!key) {
      winners.push(index);
      continue;
    }
    if (seen.has(key)) {
      losers.push(index);
      continue;
    }
    seen.add(key);
    winners.push(index);
  }
  return { winners, losers };
}

/**
 * § 5 — orden del CUPO: primero lo que cuenta hacia el objetivo.
 *
 * El defecto que cierra: el cupo se aplicaba sobre el lote ordenado por ENCAJE
 * (`businessFit + sourceUrl + countryCompat`), así que con el cupo igual al
 * objetivo un candidato COMPLETO podía quedar desplazado por uno de revisión con
 * mejor encaje. Para Agente 1 el objetivo declarado es encontrar empresas
 * ELEGIBLES, no empresas con buen encaje: un `needs_review` que expulsa a un
 * `complete_valid` reduce el resultado de la corrida por construcción.
 *
 * Lo que NO cambia: el cupo total, ni el orden de encaje DENTRO de cada grupo.
 * Es una partición estable en dos, no un criterio de orden nuevo.
 */
export function orderByCompleteFirst<T>(
  entries: readonly T[],
  isCompleteValid: (entry: T) => boolean,
): T[] {
  const complete: T[] = [];
  const reviewOnly: T[] = [];
  for (const entry of entries) {
    if (isCompleteValid(entry)) complete.push(entry);
    else reviewOnly.push(entry);
  }
  return [...complete, ...reviewOnly];
}
