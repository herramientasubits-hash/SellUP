/**
 * Agente 1 · Rescate con Claude — lo rescatado que ya no cabe en la búsqueda va al banco.
 *
 * Dueña 14-11: cada búsqueda entrega como máximo 10 empresas; las demás que Claude
 * rescate de Descartadas NO se quedan ahí: van al banco gratuito para búsquedas
 * futuras del mismo país × macro industria. Mismo formato que el sobrante de Tavily
 * (`pipeline_candidate_v1`): al sacarla, el escritor de siempre la vuelve a escribir
 * y vuelve a verificarla.
 *
 * Puro: sin env, sin I/O.
 */

import { buildCompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import { deriveGlobalIdentityClaims } from '@/server/agents/prospecting-toolkit/global-identity-claims';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import {
  COMPANY_BANK_MAX_PAYLOAD_BYTES,
  type CompanyBankDepositItem,
  type CompanyBankSourceProvider,
} from '@/server/prospect-batches/company-bank/company-bank-types';
import {
  PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
  projectCandidateForBank,
} from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';
import type { CompanyClassificationResult } from '../types';
import type { RescueDecision } from './rescue-decision';
import type { RescuableDispositionRow } from './rescue-dispositions';

/** Marca en `claude_rescue` de una descartada que se fue al banco (sale de Descartadas). */
export const BANKED_MARKER = 'banked' as const;

/** `source_primary` de la descartada → proveedor del banco (vocabulario cerrado de la 142). */
const SOURCE_TO_BANK: Readonly<Record<string, CompanyBankSourceProvider>> = {
  apollo: 'apollo',
  lusha: 'lusha',
  public_source: 'free_source',
  external_import: 'free_source',
};

/**
 * Lo que la IA confirmó: del sector pedido (`admit`) o de OTRA industria UBITS
 * (`reassign`, dueña 14-11: con el tope de 10 también va al banco, con su industria).
 */
type BankableDecision = Extract<RescueDecision, { kind: 'admit' } | { kind: 'reassign' }>;

/** El número fiscal que trae una fila del buscador gratuito (`tax:<número>`). */
function taxIdentifierOf(row: Pick<RescuableDispositionRow, 'provider_identifier'>): string | null {
  const id = row.provider_identifier ?? '';
  return id.startsWith('tax:') && id.length > 4 ? id.slice(4) : null;
}

function lowerBound(result: CompanyClassificationResult): number | null {
  const range = result.employeeRange as { min?: unknown } | null;
  return typeof range?.min === 'number' && Number.isFinite(range.min) ? range.min : null;
}

/**
 * La fila del banco para una descartada que Claude confirmó del sector pedido, o `null`
 * si no se puede guardar (sin dominio, sin país, sin macro o sin clave de identidad).
 */
export function buildDispositionBankItem(input: {
  row: RescuableDispositionRow & { source_primary?: string | null };
  result: CompanyClassificationResult;
  decision: BankableDecision;
  macroIndustryKey: string | null;
  industryName: string | null;
  decidedAt: string;
}): CompanyBankDepositItem | null {
  const { row, result, decision } = input;
  const countryCode = row.country_code?.toUpperCase() ?? null;
  const domain = row.domain ? normalizeDomain(row.domain) : null;
  if (!domain || !countryCode || !/^[A-Z]{2}$/.test(countryCode) || !input.macroIndustryKey) return null;

  const taxIdentifier = taxIdentifierOf(row);
  const claims = deriveGlobalIdentityClaims(
    buildCompanyIdentityEvidence({
      countryCode,
      taxId: null,
      taxIdentifier,
      domain,
      website: null,
      linkedinUrl: null,
      providerKey: null,
      providerEntityId: null,
      name: row.name,
    }),
  ).filter((claim) => claim.key.trim() !== '');
  if (claims.length === 0) return null;

  const sectorConfirmed = decision.kind === 'reassign' || decision.sectorConfirmed;
  const employees = decision.sizeConfirmed ? lowerBound(result) : null;
  const candidate: ProspectingPipelineCandidate = {
    name: row.name,
    originalName: null,
    website: `https://${domain}`,
    domain,
    country: countryCode,
    countryCode,
    industry: input.industryName ?? row.industry ?? '',
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: {
      confidenceScore: 0,
      fitScore: 0,
      dataCompletenessScore: 0,
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      breakdown: {
        existenceSignals: 0,
        websiteSignals: 0,
        duplicateSignals: 0,
        sourceSignals: 0,
        fitSignals: 0,
        completenessSignals: 0,
        penalties: 0,
      },
      reasons: ['banked_by_claude_rescue_over_delivery_cap'],
      warnings: [],
      blockers: [],
      metadata: {
        origin_disposition_id: row.id,
        origin_batch_id: row.batch_id,
        origin_source_primary: row.source_primary ?? null,
        origin_reason_code: row.reason_code,
        tax_identifier: taxIdentifier,
        claude_rescue_decided_at: input.decidedAt,
        claude_sector_confirmed: sectorConfirmed,
        ...(decision.kind === 'reassign' ? { claude_reassigned_from: row.industry ?? null } : {}),
        claude_size_confirmed: decision.sizeConfirmed,
      },
    },
    companySize: null,
    employeeCount: employees,
    companyLinkedInUrl: null,
    apolloOrganizationId: null,
    providerEnrichmentCapture: null,
    officialSourceIdentity: null,
  };
  const projected = projectCandidateForBank(candidate);
  if (!projected) return null;
  const payload = { kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: projected, requestedSubindustries: [] };
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > COMPANY_BANK_MAX_PAYLOAD_BYTES) return null;

  const ready = sectorConfirmed && decision.sizeConfirmed;
  return {
    countryCode,
    macroIndustryKey: input.macroIndustryKey,
    tier: ready ? 'ready' : 'to_complete',
    sourceProvider: SOURCE_TO_BANK[row.source_primary ?? ''] ?? 'tavily',
    claims,
    payload,
    missingFields: ready ? [] : ['company_size'],
    sourceBatchId: row.batch_id,
  };
}
