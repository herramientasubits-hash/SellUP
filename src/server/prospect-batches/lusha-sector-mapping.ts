/**
 * Lusha Sector Mapping — Q3F-5BB.1C
 *
 * Traduce sectores SellUp (provenientes del wizard del Agente 1) a los
 * `mainIndustriesIds` numéricos que exige el POST /v3/companies/prospecting
 * de Lusha V3.
 *
 * Reglas de diseño:
 *   - Puro: sin side effects, sin llamadas externas, sin env vars, sin I/O.
 *   - No importa nada de Lusha, Apollo, Tavily ni Supabase.
 *   - No ejecuta llamadas live ni escribe DB.
 *   - No está conectado al wizard todavía (Q3F-5BB.1C es repo-only).
 *
 * Metadata confirmada en Q3F-5BB.1B via
 *   GET /v3/companies/prospecting/filters/industriesLabels
 * (endpoint gratuito de metadata). Solo `mainIndustriesIds` (numéricos) es
 * aceptado por el POST de prospecting; `industriesLabels`, `sics` y `naics`
 * fueron rechazados en pruebas anteriores (Q3F-5Y / Q3F-5AA). `subIndustriesIds`
 * NO está soportado por el type actual de SellUp y se deja fuera del output
 * principal hasta confirmar con soporte o un live probe separado.
 */

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export type LushaSectorKey = 'healthcare' | 'education' | 'technology';

export type LushaMappingConfidence = 'high' | 'medium' | 'low' | 'none';

/** Sub-industria informativa (metadata Q3F-5BB.1B). NUNCA se envía al POST. */
export interface LushaSuggestedSubIndustry {
  value: string;
  id: number;
}

export interface LushaSectorMappingInput {
  /** Sector canonical del wizard (ej. "Educación", "Salud"). */
  sector?: string | null;
  /** Subsegmentos o criterios adicionales (ej. ["hospitales", "clínicas"]). */
  subsegments?: string[] | null;
}

export interface LushaSectorMappingResult {
  /** IDs numéricos listos para filters.companies.include.mainIndustriesIds. */
  mainIndustriesIds: number[];
  /** Sector único resuelto, o null si no hubo match o hubo múltiples. */
  matchedSector: LushaSectorKey | null;
  confidence: LushaMappingConfidence;
  /** Alias exactos que dispararon el match (normalizados). */
  matchedAliases: string[];
  /** Advertencias no bloqueantes (ambigüedad, sin match, etc.). */
  warnings: string[];
  /**
   * Sub-industrias sugeridas SOLO como metadata informativa.
   * No se usan para construir el filtro POST (ver buildLushaCompanyIndustryFilter).
   */
  suggestedSubIndustries: LushaSuggestedSubIndustry[];
}

/**
 * Filtro de industria para filters.companies.include.
 * Deliberadamente NO expone industriesLabels ni subIndustriesIds:
 * el POST de Lusha V3 solo acepta mainIndustriesIds numéricos.
 */
export interface LushaCompanyIndustryFilter {
  mainIndustriesIds?: number[];
}

// ─── Catálogo ────────────────────────────────────────────────────────────────

interface LushaSectorDefinition {
  key: LushaSectorKey;
  /** Etiqueta legible para UI (ES). */
  label: string;
  /** main_industry_id confirmado en Q3F-5BB.1B. */
  mainIndustryId: number;
  /** Alias en español e inglés (se normalizan antes de comparar). */
  aliases: readonly string[];
  /** Sub-industrias útiles (informativas). */
  suggestedSubIndustries: readonly LushaSuggestedSubIndustry[];
}

/**
 * Catálogo mínimo confirmado. Orden estable: healthcare, education, technology.
 * Los IDs provienen exclusivamente de metadata real (Q3F-5BB.1B); no se inventan.
 */
const SECTOR_CATALOG: readonly LushaSectorDefinition[] = [
  {
    key: 'healthcare',
    label: 'Salud',
    mainIndustryId: 11, // Healthcare
    aliases: [
      'salud',
      'healthcare',
      'health',
      'hospitales',
      'clinicas',
      'clinica',
      'medicina',
      'eps',
      'ips',
    ],
    suggestedSubIndustries: [
      { value: 'Hospitals & Clinics', id: 59 },
      { value: 'Medical Practices', id: 65 },
      { value: 'Mental Health', id: 64 },
      { value: 'Biotech Research', id: 106 },
    ],
  },
  {
    key: 'education',
    label: 'Educación',
    mainIndustryId: 6, // Education
    aliases: [
      'educacion',
      'education',
      'higher education',
      'universidad',
      'universidades',
      'colegios',
      'elearning',
      'e learning',
      'capacitacion',
      'training',
      'formacion',
    ],
    suggestedSubIndustries: [
      { value: 'E-Learning', id: 23 },
      { value: 'Higher Education', id: 24 },
      { value: 'Primary & Secondary', id: 25 },
      { value: 'Training', id: 26 },
    ],
  },
  {
    key: 'technology',
    label: 'Tecnología',
    mainIndustryId: 17, // Technology, Information & Media
    aliases: [
      'tecnologia',
      'technology',
      'software',
      'saas',
      'cloud',
      'cybersecurity',
      'ciberseguridad',
      'it services',
      'servicios ti',
      'telecom',
      'telecomunicaciones',
    ],
    suggestedSubIndustries: [
      { value: 'Software Development', id: 129 },
      { value: 'IT Consulting & Services', id: 103 },
      { value: 'Cybersecurity', id: 128 },
      { value: 'Telecom', id: 119 },
    ],
  },
];

// ─── Normalización ─────────────────────────────────────────────────────────

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Normaliza acentos, case y puntuación. Los guiones y signos se convierten en
 * espacios para que "e-learning" y "e learning" colapsen a la misma forma.
 */
function normalizeText(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve true si `normalizedHaystack` contiene `normalizedAlias` como frase
 * completa delimitada por límites de palabra (evita matches dentro de palabras,
 * ej. alias "eps" no debe matchear "epson").
 */
function containsAlias(normalizedHaystack: string, normalizedAlias: string): boolean {
  if (normalizedHaystack.length === 0 || normalizedAlias.length === 0) return false;
  if (normalizedHaystack === normalizedAlias) return true;
  return ` ${normalizedHaystack} `.includes(` ${normalizedAlias} `);
}

// ─── Matching interno ─────────────────────────────────────────────────────

interface SectorMatch {
  key: LushaSectorKey;
  mainIndustryId: number;
  /** Alias que matchearon (normalizados, sin duplicados). */
  aliases: string[];
  /** true si el match provino del campo `sector` (señal fuerte). */
  fromSector: boolean;
  /** true si el match provino de algún subsegmento. */
  fromSubsegment: boolean;
  suggestedSubIndustries: readonly LushaSuggestedSubIndustry[];
}

function matchSector(
  definition: LushaSectorDefinition,
  normalizedSector: string,
  normalizedSubsegments: string[],
): SectorMatch | null {
  const aliases = new Set<string>();
  let fromSector = false;
  let fromSubsegment = false;

  for (const alias of definition.aliases) {
    if (normalizedSector && containsAlias(normalizedSector, alias)) {
      aliases.add(alias);
      fromSector = true;
    }
    for (const subsegment of normalizedSubsegments) {
      if (containsAlias(subsegment, alias)) {
        aliases.add(alias);
        fromSubsegment = true;
      }
    }
  }

  if (aliases.size === 0) return null;

  return {
    key: definition.key,
    mainIndustryId: definition.mainIndustryId,
    aliases: [...aliases],
    fromSector,
    fromSubsegment,
    suggestedSubIndustries: definition.suggestedSubIndustries,
  };
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Resuelve el mapping de sectores SellUp a mainIndustriesIds de Lusha V3.
 * Puro y determinístico. Nunca inventa IDs.
 */
export function resolveLushaMainIndustryMapping(
  input: LushaSectorMappingInput,
): LushaSectorMappingResult {
  const normalizedSector = normalizeText(input.sector ?? '');
  const normalizedSubsegments = (input.subsegments ?? [])
    .map((value) => normalizeText(value ?? ''))
    .filter((value) => value.length > 0);

  const matches: SectorMatch[] = [];
  for (const definition of SECTOR_CATALOG) {
    const match = matchSector(definition, normalizedSector, normalizedSubsegments);
    if (match) matches.push(match);
  }

  if (matches.length === 0) {
    return {
      mainIndustriesIds: [],
      matchedSector: null,
      confidence: 'none',
      matchedAliases: [],
      warnings: ['no_sector_match'],
      suggestedSubIndustries: [],
    };
  }

  const mainIndustriesIds = matches.map((match) => match.mainIndustryId);
  const matchedAliases = matches.flatMap((match) => match.aliases);
  const suggestedSubIndustries = matches.flatMap((match) => [...match.suggestedSubIndustries]);
  const warnings: string[] = [];

  // Múltiples sectores contradictorios/mezclados → devolver ambos IDs con warning.
  if (matches.length > 1) {
    warnings.push(`multiple_sectors_matched: ${matches.map((match) => match.key).join(', ')}`);
    return {
      mainIndustriesIds,
      matchedSector: null,
      confidence: 'medium',
      matchedAliases,
      warnings,
      suggestedSubIndustries,
    };
  }

  // Sector único.
  const [single] = matches;
  let confidence: LushaMappingConfidence;
  if (single.fromSector) {
    // Señal fuerte: el campo `sector` matcheó directamente.
    confidence = 'high';
  } else {
    // Señal más débil: solo un subsegmento matcheó.
    confidence = 'low';
    warnings.push(`sector_matched_via_subsegment_only: ${single.key}`);
  }

  return {
    mainIndustriesIds,
    matchedSector: single.key,
    confidence,
    matchedAliases,
    warnings,
    suggestedSubIndustries,
  };
}

/**
 * Construye el filtro de industria para filters.companies.include.
 * Devuelve SOLO mainIndustriesIds. Nunca industriesLabels ni subIndustriesIds.
 * Si no hay IDs, devuelve un objeto vacío (no se envía un array vacío al POST).
 */
export function buildLushaCompanyIndustryFilter(
  mapping: Pick<LushaSectorMappingResult, 'mainIndustriesIds'>,
): LushaCompanyIndustryFilter {
  if (!mapping.mainIndustriesIds || mapping.mainIndustriesIds.length === 0) {
    return {};
  }
  return { mainIndustriesIds: [...mapping.mainIndustriesIds] };
}

// ─── Accesores públicos para UI (Q3F-5BB.3) ──────────────────────────────────

/**
 * Opción de sector lista para poblar un selector de UI. Deriva exclusivamente
 * del catálogo confirmado (Q3F-5BB.1B). Puro y determinístico.
 */
export interface LushaSectorOption {
  key: LushaSectorKey;
  label: string;
  mainIndustryId: number;
  /** Palabras clave (normalizadas) para validar match de industria en preview. */
  matchKeywords: string[];
  /** Sub-industrias seleccionables. `id` va en subIndustriesIds. */
  subIndustries: LushaSuggestedSubIndustry[];
}

/**
 * Devuelve los sectores soportados por el preview de Lusha en orden estable
 * (Salud, Educación, Tecnología). No inventa sectores ni IDs.
 */
export function getLushaSectorOptions(): LushaSectorOption[] {
  return SECTOR_CATALOG.map((definition) => ({
    key: definition.key,
    label: definition.label,
    mainIndustryId: definition.mainIndustryId,
    matchKeywords: [...definition.aliases],
    subIndustries: definition.suggestedSubIndustries.map((sub) => ({ ...sub })),
  }));
}

/**
 * Resuelve una opción de sector por su key canónica. Devuelve null si la key
 * no pertenece al catálogo soportado.
 */
export function resolveLushaSectorOption(key: string | null | undefined): LushaSectorOption | null {
  if (!key) return null;
  const definition = SECTOR_CATALOG.find((entry) => entry.key === key);
  if (!definition) return null;
  return {
    key: definition.key,
    label: definition.label,
    mainIndustryId: definition.mainIndustryId,
    matchKeywords: [...definition.aliases],
    subIndustries: definition.suggestedSubIndustries.map((sub) => ({ ...sub })),
  };
}

/**
 * Comprueba que una sub-industria pertenezca al sector indicado. Se usa para
 * bloquear combinaciones inválidas (ej. sub de Educación con sector Salud)
 * ANTES de construir el request POST. Puro.
 */
export function isSubIndustryValidForSector(
  key: string | null | undefined,
  subIndustryId: number | null | undefined,
): boolean {
  if (subIndustryId === null || subIndustryId === undefined) return false;
  const option = resolveLushaSectorOption(key);
  if (!option) return false;
  return option.subIndustries.some((sub) => sub.id === subIndustryId);
}
