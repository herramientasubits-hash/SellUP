/**
 * runSourceDiscovery — Orquestador genérico de fuentes estructuradas (Hito 16AJ.2)
 *
 * Punto de entrada público para ejecutar discovery sobre cualquier fuente registrada.
 * Delega al adapter correspondiente via connector registry.
 *
 * Contrato de seguridad:
 *   NO escribe en Supabase. NO crea prospect_batches. NO crea prospect_candidates.
 *   NO toca HubSpot. NO toca Tavily. NO activa Agente 1.
 *   Solo lectura. Solo reporte en memoria.
 */

import type { SourceDiscoveryInput, SourceDiscoveryOutput } from './source-discovery-types';
import { SOURCE_DISCOVERY_REGISTRY } from './connector-registry';

/**
 * Ejecuta el discovery de candidatos para una fuente estructurada.
 *
 * Flujo:
 *   1. Busca el adapter en SOURCE_DISCOVERY_REGISTRY por sourceKey.
 *   2. Si no existe, devuelve error controlado sin lanzar excepción.
 *   3. Ejecuta el adapter — este llama el dry-run del conector.
 *   4. Limita candidates a input.limit si el adapter no lo hizo.
 *   5. Recalcula qualitySummary post-slice para coherencia.
 *   6. Devuelve SourceDiscoveryOutput — nunca escribe en DB.
 */
export async function runSourceDiscovery(
  input: SourceDiscoveryInput,
): Promise<SourceDiscoveryOutput> {
  const { sourceKey, limit } = input;

  const adapter = SOURCE_DISCOVERY_REGISTRY[sourceKey];

  if (!adapter) {
    return {
      sourceKey,
      sourceProvider: 'unknown',
      countryCode: input.countryCode,
      mode: input.mode ?? 'dry_run',
      recordsRead: 0,
      candidates: [],
      acceptedCount: 0,
      lowPriorityCount: 0,
      filteredOutCount: 0,
      warnings: [],
      errors: [
        `Source discovery adapter not found for sourceKey='${sourceKey}'. ` +
        `Available keys: ${Object.keys(SOURCE_DISCOVERY_REGISTRY).join(', ')}`,
      ],
      qualitySummary: {
        withTaxId: 0,
        withSector: 0,
        sectorUnknown: 0,
        withRegion: 0,
        withWebsite: 0,
      },
    };
  }

  const output = await adapter(input);

  // Post-slice: garantizar límite si el adapter devolvió más candidatos
  if (limit != null && output.candidates.length > limit) {
    const sliced = output.candidates.slice(0, limit);
    return {
      ...output,
      candidates: sliced,
      acceptedCount: sliced.filter((c) => c.qualityDecision === 'accepted').length,
      lowPriorityCount: sliced.filter((c) => c.qualityDecision === 'low_priority').length,
      qualitySummary: {
        withTaxId: sliced.filter((c) => c.taxId != null).length,
        withSector: sliced.filter((c) => c.sectorCode != null).length,
        sectorUnknown: sliced.filter((c) => c.sectorCode == null).length,
        withRegion: sliced.filter((c) => c.region != null).length,
        withWebsite: sliced.filter((c) => c.metadata?.website != null).length,
      },
    };
  }

  return output;
}
