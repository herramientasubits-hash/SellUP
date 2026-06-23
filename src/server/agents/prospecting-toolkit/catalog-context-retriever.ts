/**
 * Prospecting Toolkit — Catalog Context Retriever
 *
 * Dado país + industria + profundidad, retorna solo el contexto relevante
 * para esa ejecución del agente: máx. 6 fuentes, riesgos clave, reglas
 * operativas y un promptContext compacto listo para inyectar al LLM.
 *
 * Nunca retorna Lusha en recommendedSources.
 * Apollo solo aparece en modo "deep" como último recurso (P2).
 */

import type {
  CatalogContextInput,
  CatalogContextResult,
  CatalogSource,
  SearchDepth,
} from './types';
import {
  CATALOG_SOURCES,
  COUNTRY_RISKS,
  FISCAL_IDENTIFIERS,
  GLOBAL_RULES,
} from './source-catalog';

// ─── Constantes internas ──────────────────────────────────────────────────────

const LUSHA_KEY = 'global_lusha';
const APOLLO_KEY = 'global_apollo';
const OPENCORP_KEY = 'global_opencorporates';
const MAX_SOURCES = 6;
const MAX_RISKS = 5;

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2 };

// ─── Helpers puros ────────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function scoreSourceForIndustry(source: CatalogSource, normalizedIndustry: string): number {
  if (source.sectors.length === 0) return 0;
  return source.sectors.filter((kw) =>
    normalizedIndustry.includes(normalizeText(kw))
  ).length;
}

function byPriority(a: CatalogSource, b: CatalogSource): number {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

/**
 * True si la fuente está habilitada para flujo automático del Agente 1.
 * Excluye fuentes pausadas, manuales, no conectadas o no aptas.
 */
function isSourceEnabledForAutomatedFlow(source: CatalogSource): boolean {
  if (source.connectionMode === 'not_connected') return false;
  if (source.aiFlowStatus === 'connected') return true;
  if (source.aiFlowStatus === 'source_guided') return true;
  return false;
}

// ─── Selección de fuentes ─────────────────────────────────────────────────────

function buildRecommendedSources(
  countryCode: string,
  normalizedIndustry: string,
  searchDepth: SearchDepth
): CatalogSource[] {
  const countryPool = CATALOG_SOURCES.filter(
    (s) =>
      s.key !== LUSHA_KEY &&
      s.countryCodes.includes(countryCode) &&
      isSourceEnabledForAutomatedFlow(s)
  );

  // Sector-matched country sources (relevant to the industry)
  const sectorMatched = countryPool
    .filter((s) => scoreSourceForIndustry(s, normalizedIndustry) > 0)
    .sort(byPriority);

  // Generic country sources (no sector constraint)
  const generic = countryPool
    .filter((s) => s.sectors.length === 0)
    .sort(byPriority);

  // Merge deduped: sector-matched first (more relevant), then generic
  const seen = new Set<string>();
  const merged: CatalogSource[] = [];
  for (const s of [...sectorMatched, ...generic]) {
    if (!seen.has(s.key)) {
      seen.add(s.key);
      merged.push(s);
    }
  }

  // Depth filter: basic=P0 only, standard=P0+P1, deep=all
  const depthFiltered = merged.filter((s) => {
    if (searchDepth === 'basic') return s.priority === 'P0';
    if (searchDepth === 'standard') return s.priority !== 'P2';
    return true;
  });

  const result = depthFiltered.slice(0, MAX_SOURCES);

  // In deep mode or when country has no sources, append global fallbacks
  const needsFallback = result.length === 0 || searchDepth === 'deep';
  if (needsFallback && result.length < MAX_SOURCES) {
    const alreadyIn = new Set(result.map((s) => s.key));

    const openCorp = CATALOG_SOURCES.find((s) => s.key === OPENCORP_KEY);
    if (openCorp && !alreadyIn.has(OPENCORP_KEY) && result.length < MAX_SOURCES) {
      result.push(openCorp);
      alreadyIn.add(OPENCORP_KEY);
    }

    // Apollo only if deep and still room — as explicit last resort
    if (searchDepth === 'deep') {
      const apollo = CATALOG_SOURCES.find((s) => s.key === APOLLO_KEY);
      if (apollo && !alreadyIn.has(APOLLO_KEY) && result.length < MAX_SOURCES) {
        result.push(apollo);
      }
    }
  }

  return result;
}

function buildSectorSources(
  countryCode: string,
  normalizedIndustry: string
): CatalogSource[] {
  return CATALOG_SOURCES.filter(
    (s) =>
      s.key !== LUSHA_KEY &&
      s.countryCodes.includes(countryCode) &&
      scoreSourceForIndustry(s, normalizedIndustry) > 0
  ).sort(byPriority);
}

// ─── Reglas sectoriales ───────────────────────────────────────────────────────

function getSectorRules(normalizedIndustry: string, countryCode: string): string[] {
  const rules: string[] = [];

  if (/salud|health|clinica|hospital|farmac|ips|eps|laboratorio/.test(normalizedIndustry)) {
    rules.push('Verificar habilitación en registro sectorial de salud (REPS en CO, equivalente en otros países).');
    rules.push('Distinguir IPS, EPS, proveedores de insumos y laboratorios antes de segmentar.');
  }

  if (/financiero|fintech|banca|banco|seguros|financial|insurance|aseguradora/.test(normalizedIndustry)) {
    rules.push('Usar registro de entidades supervisadas del regulador financiero del país.');
    rules.push('Incluir solo entidades formalmente autorizadas, no fintechs informales.');
  }

  if (/textil|manufactura textil|moda|clothing|garment|apparel|vestido|confeccion/.test(normalizedIndustry)) {
    rules.push('Incluir cámaras sectoriales (CANAIVE en MX, INEXMODA en CO) como fuente gremial.');
  }

  if (/automotriz|automotive|autopart/.test(normalizedIndustry)) {
    rules.push('Priorizar directorio AMIA (MX) o equivalente para OEM y Tier-1.');
  }

  if (/tecnolog|tech|software|saas|\bti\b|\btic\b/.test(normalizedIndustry)) {
    rules.push('Para tech B2G: SECOP II y equivalentes muestran proveedores activos en TIC.');
    rules.push('Validar que la empresa realmente presta servicios tech — muchas tienen objeto social genérico.');
  }

  return rules.slice(0, 3);
}

// ─── Notas de cobertura ───────────────────────────────────────────────────────

function buildCoverageNotes(
  countryCode: string,
  recommended: CatalogSource[],
  searchDepth: SearchDepth
): string[] {
  const notes: string[] = [];

  if (recommended.length === 0) {
    notes.push(`No se encontraron fuentes específicas para ${countryCode}. Se recomienda búsqueda manual.`);
    return notes;
  }

  const p0Count = recommended.filter((s) => s.priority === 'P0').length;
  if (p0Count === 0) {
    notes.push('No hay fuentes P0 para este país/sector. Cobertura puede ser limitada.');
  } else {
    notes.push(`${p0Count} fuente(s) P0 disponible(s) para este país.`);
  }

  if (searchDepth === 'basic') {
    notes.push('Modo basic: solo fuentes P0. Usar standard o deep para más cobertura.');
  } else if (searchDepth === 'deep') {
    notes.push('Modo deep: incluye fallback global si fuentes de país son insuficientes.');
  }

  const hasHighAutomation = recommended.some((s) => s.automationLevel === 'high');
  if (!hasHighAutomation) {
    notes.push('Ninguna fuente recomendada tiene automatización alta. Operación manual o semi-manual requerida.');
  }

  return notes;
}

// ─── Generación de promptContext ──────────────────────────────────────────────

function buildPromptContext(
  country: string,
  countryCode: string,
  industry: string,
  fiscalLabel: string | null,
  sources: CatalogSource[],
  risks: string[],
  rules: string[]
): string {
  const lines: string[] = [
    `País: ${country} (${countryCode})`,
    `Industria: ${industry}`,
  ];

  if (fiscalLabel) {
    lines.push(`Identificador fiscal: ${fiscalLabel}`);
  }

  lines.push('');
  lines.push('Fuentes recomendadas:');

  // Lusha never shown; Apollo labeled as fallback pagado
  sources
    .filter((s) => s.key !== LUSHA_KEY)
    .forEach((s, i) => {
      const tag = s.key === APOLLO_KEY ? ' [fallback pagado]' : '';
      lines.push(`${i + 1}. ${s.name}${tag} — ${s.recommendedUse}`);
    });

  if (risks.length > 0) {
    lines.push('');
    lines.push('Riesgos:');
    risks.slice(0, 3).forEach((r) => lines.push(`- ${r}`));
  }

  lines.push('');
  lines.push('Reglas:');
  rules.slice(0, 5).forEach((r) => lines.push(`- ${r}`));

  return lines.join('\n');
}

// ─── getCatalogContext — función principal ────────────────────────────────────

/**
 * Retorna el contexto de catálogo relevante para una ejecución del agente.
 *
 * No llama APIs externas. Puramente determinística sobre datos estáticos.
 *
 * @example
 * const ctx = getCatalogContext({ country: 'Colombia', countryCode: 'CO', industry: 'Tecnología' });
 * // ctx.promptContext → texto compacto listo para inyectar al LLM
 */
export function getCatalogContext(input: CatalogContextInput): CatalogContextResult {
  const countryCode = input.countryCode.toUpperCase().trim();
  const normalizedIndustry = normalizeText(input.industry);
  const searchDepth: SearchDepth = input.searchDepth ?? 'standard';

  const recommendedSources = buildRecommendedSources(countryCode, normalizedIndustry, searchDepth);
  const sectorSources = buildSectorSources(countryCode, normalizedIndustry);

  const countryRisks = (COUNTRY_RISKS[countryCode] ?? []).slice(0, MAX_RISKS);
  const risks =
    countryRisks.length > 0
      ? countryRisks
      : ['Datos B2B en este país tienen cobertura limitada en fuentes públicas. Validar manualmente.'];

  const sectorRules = getSectorRules(normalizedIndustry, countryCode);
  const operatingRules = [...GLOBAL_RULES, ...sectorRules];

  const coverageNotes = buildCoverageNotes(countryCode, recommendedSources, searchDepth);
  const fiscalIdentifierLabel = FISCAL_IDENTIFIERS[countryCode] ?? null;

  const promptContext = buildPromptContext(
    input.country,
    countryCode,
    input.industry,
    fiscalIdentifierLabel,
    recommendedSources,
    risks,
    operatingRules
  );

  return {
    country: input.country,
    countryCode,
    industry: input.industry,
    searchDepth,
    fiscalIdentifierLabel,
    recommendedSources,
    sectorSources,
    risks,
    operatingRules,
    coverageNotes,
    promptContext,
  };
}
