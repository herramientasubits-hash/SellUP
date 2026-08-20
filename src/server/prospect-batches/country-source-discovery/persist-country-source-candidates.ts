/**
 * persist-country-source-candidates.ts — las empresas GRATUITAS aceptadas entran
 * por la MISMA puerta que las de pago.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 13.
 *
 * ── 🔴 Nada de ruta privada de persistencia ──────────────────────────────────
 *
 * § 13 lo prohíbe explícitamente, así que aquí no se inserta ni una fila: se
 * delega en `writeStructuredSourceCandidatesPreview`, el writer genérico y
 * centralizado que las fuentes estructuradas del repo (Socrata Colombia, DENUE
 * México, cl_res Chile) ya usan en Producción. Ese writer es el que decide el
 * estado de aterrizaje, y lo decide igual para todas:
 *
 *   · `status = 'needs_review'` y `review_status = 'needs_manual_review'`,
 *     ambos forzados en el writer — un candidato de fuente NUNCA nace aprobado;
 *   · no crea cuentas ni empresas;
 *   · no escribe en HubSpot;
 *   · no ejecuta IA, Tavily, Apollo ni Lusha.
 *
 * Esto no es una promesa de este módulo: es una capacidad que el writer no tiene.
 *
 * ── Procedencia visible (§ 13) ───────────────────────────────────────────────
 *
 * `sourceTrace` deja dicho de qué fuente, qué registro y qué código CIIU vino
 * cada empresa, y `metadata` guarda el veredicto de precisión que la admitió. Un
 * revisor tiene que poder distinguir una empresa gratuita de una pagada sin
 * adivinarlo.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeStructuredSourceCandidatesPreview } from '@/server/agents/prospecting-toolkit/structured-source-candidate-writer';
import type { SourceDiscoveryCandidate } from '@/server/source-catalog/source-discovery-types';
import type { CountrySourceCompany } from './country-source-types';
import {
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
} from './co-siis-discovery-adapter';

export type PersistCountrySourceCandidatesInput = {
  companies: readonly CountrySourceCompany[];
  countryCode: string;
  countryName: string;
  macroIndustryKey: string;
  requestedByUserId: string;
  /** Lote existente al que anexar. `null` ⇒ el writer crea uno. */
  batchId?: string | null;
  /** Telemetría previa al pago, para que el lote la conserve. */
  metadata?: Record<string, unknown>;
};

export type PersistCountrySourceCandidatesResult = {
  batchId: string | null;
  writtenCount: number;
  skippedCount: number;
  failed: boolean;
};

function toSourceDiscoveryCandidate(
  company: CountrySourceCompany,
  macroIndustryKey: string,
): SourceDiscoveryCandidate {
  return {
    name: company.legalName ?? 'Sin nombre',
    legalName: company.legalName,
    taxId: company.taxId,
    taxIdentifierType: company.taxIdentifierType,
    country: null,
    countryCode: company.countryCode,
    city: company.city,
    region: company.region,
    sectorCode: company.industryCode,
    sectorDescription: company.declaredIndustry,
    sourcePrimary: CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
    sourceTrace: {
      sourceProvider: CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
      sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY,
      sourceRecordId: company.recordIdentityKey,
      industryCode: company.industryCode,
    },
    metadata: {
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: macroIndustryKey,
      declared_industry: company.declaredIndustry,
      coarse_sector: company.coarseSector,
      // 🔴 Se deja dicho que NO hay web, en vez de omitir el campo: la ausencia
      // explícita es un dato para quien revise (§ 22(I)).
      website: null,
      website_available: false,
    },
    reviewFlags: ['missing_website'],
    qualityDecision: 'accepted',
  };
}

/**
 * Persiste las empresas gratuitas aceptadas por la ingesta canónica de fuentes.
 *
 * Nunca lanza: un fallo de persistencia se reporta como `failed` y no puede
 * convertir en error una corrida que ya descubrió empresas válidas.
 */
export async function persistCountrySourceCandidates(
  client: SupabaseClient,
  input: PersistCountrySourceCandidatesInput,
): Promise<PersistCountrySourceCandidatesResult> {
  if (input.companies.length === 0) {
    return { batchId: input.batchId ?? null, writtenCount: 0, skippedCount: 0, failed: false };
  }

  try {
    const report = await writeStructuredSourceCandidatesPreview(client, {
      // 🔴 Escritura real. La autoriza el hito para la capa gratuita: sin ella,
      // una corrida con `residualGap = 0` no dejaría NADA para revisar y el
      // ahorro se pagaría con el resultado del usuario (§ 22(A)).
      dryRun: false,
      requestedByUserId: input.requestedByUserId,
      country: input.countryName,
      countryCode: input.countryCode,
      sourceKey: CO_SIIS_DISCOVERY_SOURCE_KEY,
      sourceProvider: CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
      dataset: CO_SIIS_DISCOVERY_SOURCE_KEY,
      initiatedBy: 'agent_1',
      batchId: input.batchId ?? null,
      // La comprobación canónica de HubSpot YA corrió en la capa previa al pago,
      // por candidato y de sólo lectura. Repetirla aquí sería una segunda ronda
      // de llamadas para responder lo mismo.
      runHubspotCheck: false,
      metadata: input.metadata,
      candidates: input.companies.map((company) =>
        toSourceDiscoveryCandidate(company, input.macroIndustryKey),
      ),
    });

    return {
      batchId: report.batch.id,
      writtenCount: report.batch.totalCandidatesWritten,
      skippedCount: report.batch.totalCandidatesSkipped,
      failed: false,
    };
  } catch {
    return { batchId: input.batchId ?? null, writtenCount: 0, skippedCount: 0, failed: true };
  }
}
