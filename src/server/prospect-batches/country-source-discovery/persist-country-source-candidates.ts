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
import { COUNTRY_SOURCE_PREPAID_DISCOVERY_LAYER } from '@/server/agents/prospecting-toolkit/structured-discovery-provenance';
import type { SourceDiscoveryCandidate } from '@/server/source-catalog/source-discovery-types';
import type { CountrySourceCompany } from './country-source-types';
import {
  claimGlobalIdentitiesForPersistedCandidates,
  type PersistedGlobalIdentityClaimOutcome,
} from '@/server/prospect-batches/global-identity-claims-store';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveCountrySourceCapability } from './country-source-capability';
import {
  CO_SIIS_DISCOVERY_BATCH_SOURCE,
  CO_SIIS_DISCOVERY_SOURCE_KEY,
  CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
} from './co-siis-discovery-adapter';

/**
 * Valor canónico de `metadata.discovery_layer` para esta capa gratuita.
 *
 * 🔴 IMPORTADO, no re-declarado: la frontera de persistencia es la que decide qué
 * capas son legítimas (`STRUCTURED_DISCOVERY_LAYERS`) y la que rechaza el resto.
 * Un literal propio aquí podría derivar del conjunto que valida, y entonces esta
 * capa escribiría una procedencia que el validador descarta en silencio.
 */
const COUNTRY_SOURCE_DISCOVERY_LAYER = COUNTRY_SOURCE_PREPAID_DISCOVERY_LAYER;

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
  /**
   * SOURCES-FREE-LAYER-IDENTITY-CLAIMS-1 — reclama las identidades (número fiscal,
   * dominio) de lo recién escrito. Por defecto, el reclamo global de siempre.
   */
  claimIdentities?: (
    client: SupabaseClient,
    batchId: string,
    candidateIds: readonly string[],
  ) => Promise<PersistedGlobalIdentityClaimOutcome>;
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
  sourceKey: string,
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
      sourceKey,
      sourceRecordId: company.recordIdentityKey,
      industryCode: company.industryCode,
    },
    metadata: {
      discovery_layer: COUNTRY_SOURCE_DISCOVERY_LAYER,
      macro_industry_key: macroIndustryKey,
      declared_industry: company.declaredIndustry,
      coarse_sector: company.coarseSector,
      // 🔴 Se deja dicho que NO hay web, en vez de omitir el campo: la ausencia
      // explícita es un dato para quien revise (§ 22(I)). Las fuentes colombianas
      // no publican web; SOURCES-MX-DENUE-MIX-WEB-DEDUPE-1: DENUE sí, y entonces se
      // guarda (el writer la lee de aquí y deriva el dominio) en vez de tirarla.
      website: company.domain ? `https://${company.domain}` : null,
      website_available: company.domain !== null,
      // SOURCES-MX-FREE-LAYER-RFC-1 — el número fiscal lo puso el registro oficial
      // por nombre (la fuente no lo publica). Ausente ⇒ venía de la fuente.
      ...(company.officialTaxIdLookup?.sourceKey
        ? {
            official_tax_id_lookup: {
              source_key: company.officialTaxIdLookup.sourceKey,
              confidence: company.officialTaxIdLookup.confidence,
            },
          }
        : {}),
    },
    reviewFlags: company.domain ? [] : ['missing_website'],
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

  // El `source_key` sale del país (co_siis_discovery / do_dgii_discovery). Un país
  // sin capacidad no llega aquí; el valor por defecto conserva a Colombia intacta.
  const sourceKey =
    resolveCountrySourceCapability(input.countryCode)?.sourceKey ?? CO_SIIS_DISCOVERY_SOURCE_KEY;

  try {
    const report = await writeStructuredSourceCandidatesPreview(client, {
      // 🔴 Escritura real. La autoriza el hito para la capa gratuita: sin ella,
      // una corrida con `residualGap = 0` no dejaría NADA para revisar y el
      // ahorro se pagaría con el resultado del usuario (§ 22(A)).
      dryRun: false,
      requestedByUserId: input.requestedByUserId,
      country: input.countryName,
      countryCode: input.countryCode,
      sourceKey,
      sourceProvider: CO_SIIS_DISCOVERY_SOURCE_PRIMARY,
      // 🔴 Defecto 1 — vocabulario de lote distinto al de candidato. El CHECK de
      // prospect_batches NO permite 'public_source' (sí el de source_primary);
      // el lote lo persiste Agente 1, así que su source es 'agent_1'.
      batchSource: CO_SIIS_DISCOVERY_BATCH_SOURCE,
      dataset: sourceKey,
      initiatedBy: 'agent_1',
      batchId: input.batchId ?? null,
      // La comprobación canónica de HubSpot YA corrió en la capa previa al pago,
      // por candidato y de sólo lectura. Repetirla aquí sería una segunda ronda
      // de llamadas para responder lo mismo.
      runHubspotCheck: false,
      metadata: {
        ...(input.metadata ?? {}),
        // Explícitos DESPUÉS del spread: la telemetría del caller no puede
        // sobrescribir de qué capa de discovery viene este lote.
        discovery_layer: COUNTRY_SOURCE_DISCOVERY_LAYER,
        macro_industry_key: input.macroIndustryKey,
      },
      candidates: input.companies.map((company) =>
        toSourceDiscoveryCandidate(company, input.macroIndustryKey, sourceKey),
      ),
    });

    // SOURCES-FREE-LAYER-IDENTITY-CLAIMS-1 — Prod 06-10 (RD): SADOTEL SAS (RNC
    // 131233686) entró por la capa gratuita en cf765b47 SIN reclamar su identidad,
    // y la misma empresa volvió a entrar por el rescate en 8c1dcf78 sin chocar con
    // nada. Lo que escribe la capa gratuita reclama como todo lo demás; si otro
    // candidato vivo ya la tiene, queda «duplicado» y no cuenta para la meta.
    const duplicatedElsewhere = await claimFreeLayerIdentities(
      client,
      report.batch.id,
      input.claimIdentities ?? claimWithServiceRole,
    );
    return {
      batchId: report.batch.id,
      writtenCount: Math.max(0, report.batch.totalCandidatesWritten - duplicatedElsewhere),
      skippedCount: report.batch.totalCandidatesSkipped + duplicatedElsewhere,
      failed: false,
    };
  } catch {
    return { batchId: input.batchId ?? null, writtenCount: 0, skippedCount: 0, failed: true };
  }
}

/**
 * El reclamo SIEMPRE con el cliente de service_role de la factoría aprobada.
 * `claim_company_identities` es SECURITY INVOKER y la tabla de reclamos sólo
 * admite service_role (RLS): con el cliente de la sesión del asistente devolvía
 * 403 y no reclamaba nada (Prod 06-10 19:01Z, RD 0abfa194, aviso de la sesión RD).
 * Apollo y el rescate ya reclaman así.
 */
const claimWithServiceRole: NonNullable<PersistCountrySourceCandidatesInput['claimIdentities']> = (
  _sessionClient,
  batchId,
  candidateIds,
) => claimGlobalIdentitiesForPersistedCandidates(createSupabaseAdminClient(), batchId, candidateIds);

/**
 * Reclama las identidades de las filas de la capa gratuita del lote y devuelve
 * cuántas chocaron con otro candidato vivo (ya quedaron `duplicate`). Nunca
 * lanza: un fallo deja todo como estaba (degradación cerrada del reclamo).
 */
async function claimFreeLayerIdentities(
  client: SupabaseClient,
  batchId: string | null,
  claim: NonNullable<PersistCountrySourceCandidatesInput['claimIdentities']>,
): Promise<number> {
  if (!batchId) return 0;
  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .select('id')
      .eq('batch_id', batchId)
      .eq('source_primary', CO_SIIS_DISCOVERY_SOURCE_PRIMARY);
    if (error || !Array.isArray(data) || data.length === 0) return 0;
    const ids = (data as Array<{ id?: unknown }>)
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return 0;
    const outcome = await claim(client, batchId, ids);
    if (outcome.degraded) {
      // Nunca en silencio: sin reclamo, la misma empresa puede entrar dos veces.
      console.warn('[free-layer] identity claim degraded', { batchId, candidates: ids.length });
      return 0;
    }
    return outcome.claimedElsewhere.length;
  } catch (err) {
    console.warn('[free-layer] identity claim failed', {
      batchId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
