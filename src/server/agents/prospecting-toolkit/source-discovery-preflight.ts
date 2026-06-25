/**
 * source-discovery-preflight — Hito 16AJ.4
 *
 * Helper read-only que ejecuta un preflight de fuentes estructuradas para
 * Agente 1. Sirve para saber, antes de activar escritura desde fuentes:
 *   - Qué fuente estructurada aplica por país.
 *   - Cuántos registros/candidatos potenciales devuelve.
 *   - Qué calidad tienen.
 *   - Si falta credencial.
 *   - Qué warnings hay.
 *
 * Contrato de seguridad:
 *   NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 *   NO toca HubSpot. NO toca Tavily. NO activa Agente 1.
 *   Solo lectura. Solo reporte en memoria. Siempre mode=dry_run.
 *   Límite máximo preflight: 5 candidatos.
 *   cl_chilecompra descartado del MVP (requiere ticket, cobertura B2G limitada).
 */

import { runSourceDiscovery } from '@/server/source-catalog/run-source-discovery';

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export interface SourceDiscoveryPreflightInput {
  countryCode: string;
  country?: string;
  industry?: string;
  targetCount?: number;
  searchDepth?: 'basic' | 'standard';
  enabled?: boolean;
  sourceKey?: string | null;
}

export interface SourceDiscoveryPreflightSample {
  name: string;
  taxId?: string | null;
  countryCode?: string | null;
  city?: string | null;
  region?: string | null;
  sectorDescription?: string | null;
  sourcePrimary?: string | null;
  qualityDecision?: string | null;
}

export interface SourceDiscoveryPreflightResult {
  enabled: boolean;
  selectedSourceKey: string | null;
  status: 'skipped' | 'success' | 'warning' | 'error';
  recordsRead: number;
  candidatesCount: number;
  acceptedCount: number;
  lowPriorityCount: number;
  filteredOutCount: number;
  qualitySummary: {
    withTaxId: number;
    withSector: number;
    sectorUnknown: number;
    withRegion: number;
    withWebsite: number;
  };
  warnings: string[];
  errors: string[];
  samples: SourceDiscoveryPreflightSample[];
}

// ── Mapa estático país → fuente ────────────────────────────────────────────────
//
// cl_chilecompra descartado del MVP: requiere ticket/API key, cobertura B2G limitada.
// No pertenece al catálogo activo. Solo cl_res para CL en MVP.

const COUNTRY_SOURCE_MAP: Record<string, string> = {
  CO: 'co_rues',
  MX: 'mx_denue',
  CL: 'cl_res',
  // PE: Perú no usa fuente estructurada — discovery por Agente 1 / Tavily / web IA
};

const PREFLIGHT_LIMIT = 5; // máximo hard en este hito
const EMPTY_QUALITY = { withTaxId: 0, withSector: 0, sectorUnknown: 0, withRegion: 0, withWebsite: 0 };

// ── runAgentSourceDiscoveryPreflight ──────────────────────────────────────────
//
// Función pública. Selecciona fuente por país (o usa sourceKey explícito),
// ejecuta runSourceDiscovery en dry_run y devuelve resumen seguro.
// Nunca escribe en DB. Nunca lanza excepción — captura y retorna status=error.

export async function runAgentSourceDiscoveryPreflight(
  input: SourceDiscoveryPreflightInput,
): Promise<SourceDiscoveryPreflightResult> {
  const skipped: SourceDiscoveryPreflightResult = {
    enabled: false,
    selectedSourceKey: null,
    status: 'skipped',
    recordsRead: 0,
    candidatesCount: 0,
    acceptedCount: 0,
    lowPriorityCount: 0,
    filteredOutCount: 0,
    qualitySummary: EMPTY_QUALITY,
    warnings: [],
    errors: [],
    samples: [],
  };

  if (!input.enabled) return skipped;

  // Selección de fuente: explícita > mapa estático
  const resolvedSourceKey = input.sourceKey ?? COUNTRY_SOURCE_MAP[input.countryCode?.toUpperCase()] ?? null;

  if (!resolvedSourceKey) {
    return {
      ...skipped,
      enabled: true,
      status: 'skipped',
      warnings: [`No hay fuente estructurada registrada para countryCode='${input.countryCode}'.`],
    };
  }

  console.info('[source-discovery-preflight] start', {
    countryCode: input.countryCode,
    selectedSourceKey: resolvedSourceKey,
    limit: PREFLIGHT_LIMIT,
    mode: 'dry_run',
  });

  try {
    const output = await runSourceDiscovery({
      sourceKey: resolvedSourceKey,
      countryCode: input.countryCode,
      criteria: {
        country: input.country,
        industry: input.industry ?? null,
      },
      limit: PREFLIGHT_LIMIT,
      mode: 'dry_run',
    });

    const peWarnings: string[] = input.countryCode?.toUpperCase() === 'PE' ? [
      'Perú: el sector se infiere de búsqueda web/IA. No hay CIIU oficial disponible.',
    ] : [];

    const hasErrors = output.errors.length > 0;
    const hasWarnings = output.warnings.length > 0 || peWarnings.length > 0;

    const status: SourceDiscoveryPreflightResult['status'] =
      hasErrors ? 'error' : hasWarnings ? 'warning' : 'success';

    const samples: SourceDiscoveryPreflightSample[] = output.candidates.slice(0, PREFLIGHT_LIMIT).map((c) => ({
      name: c.name,
      taxId: c.taxId ?? null,
      countryCode: c.countryCode ?? null,
      city: c.city ?? null,
      region: c.region ?? null,
      sectorDescription: c.sectorDescription ?? null,
      sourcePrimary: c.sourcePrimary ?? null,
      qualityDecision: c.qualityDecision ?? null,
    }));

    console.info('[source-discovery-preflight] complete', {
      countryCode: input.countryCode,
      selectedSourceKey: resolvedSourceKey,
      status,
      recordsRead: output.recordsRead,
      candidatesCount: output.candidates.length,
      acceptedCount: output.acceptedCount,
      errorsCount: output.errors.length,
      warningsCount: output.warnings.length,
    });

    const mergedWarnings = [...peWarnings, ...output.warnings];

    return {
      enabled: true,
      selectedSourceKey: resolvedSourceKey,
      status,
      recordsRead: output.recordsRead,
      candidatesCount: output.candidates.length,
      acceptedCount: output.acceptedCount,
      lowPriorityCount: output.lowPriorityCount,
      filteredOutCount: output.filteredOutCount,
      qualitySummary: output.qualitySummary,
      warnings: mergedWarnings,
      errors: output.errors,
      samples,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado en preflight';
    console.error('[source-discovery-preflight] error', {
      countryCode: input.countryCode,
      selectedSourceKey: resolvedSourceKey,
      error: msg,
    });

    return {
      enabled: true,
      selectedSourceKey: resolvedSourceKey,
      status: 'error',
      recordsRead: 0,
      candidatesCount: 0,
      acceptedCount: 0,
      lowPriorityCount: 0,
      filteredOutCount: 0,
      qualitySummary: EMPTY_QUALITY,
      warnings: [],
      errors: [msg],
      samples: [],
    };
  }
}
