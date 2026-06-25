/**
 * runPeWebInferredDryRun — Perú Web/IA Sector Inferred Dry Run
 *
 * Adapter de discovery para Perú basado en búsqueda web/IA.
 * El sector es inferido, no oficial.
 *
 * Reglas de seguridad:
 *   - NO importa módulos de sunat-peru/
 *   - NO descarga padron_reducido_ruc.zip
 *   - NO llama Migo
 *   - NO llama Tavily real
 *   - NO escribe en Supabase
 *   - NO crea candidatos reales
 *
 * Esta implementación es una puerta de activación (gate).
 * La ejecución real de web search + inferencia IA se implementará
 * en un hito posterior (web search adapter).
 */

import type {
  PeWebInferredDryRunInput,
  PeWebInferredDryRunReport,
  PeCandidateMetadata,
} from './types';

function buildEmptyMetadata(): PeCandidateMetadata {
  return {
    sector_inferred: null,
    sector_confidence_score: null,
    sector_source: 'inferred_web_ai',
    confidence_label: 'sector_inferred',
    ciiu_status: 'unavailable_for_mvp',
    official_ciiu_available: false,
    inference_method: null,
    inference_evidence: [],
    human_review_required: true,
    legal_validation_source: 'pe_sunat_bulk',
    legal_validation_mode: 'offline_snapshot_or_worker',
    legal_validation_status: 'pending_snapshot_validation',
    legal_validation: {
      source: 'pe_sunat_bulk',
      status: 'pending_snapshot_validation',
      validated_at: null,
      ruc_match: false,
      name_match: false,
    },
  };
}

export async function runPeWebInferredDryRun(
  input?: PeWebInferredDryRunInput,
): Promise<PeWebInferredDryRunReport> {
  const warnings: string[] = [
    'Perú usa sector inferido vía web/IA — no hay CIIU oficial disponible para MVP.',
    'Revisión humana obligatoria antes de conversión de candidatos Perú.',
    'La validación legal requiere snapshot SUNAT offline (pe_sunat_bulk).',
  ];

  const errors: string[] = [];

  return {
    recordsRead: 0,
    acceptedCount: 0,
    lowPriorityCount: 0,
    filteredOutCount: 0,
    warnings,
    errors,
    samples: [],
  };
}

export { buildEmptyMetadata };
export type { PeCandidateMetadata };
