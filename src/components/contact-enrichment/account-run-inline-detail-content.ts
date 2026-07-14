// Agente 2A — Account Agents Tab: Inline Run Detail (Hito 17B.4X.7C.3E.4)
//
// Pure content resolver for the inline-expandable run detail on the
// account "Agentes" tab. Reuses the same Lusha branch classification and
// copy as the full-page run viewer (run-viewer-branch-classifier.ts,
// contact-enrichment-empty-state-copy.ts) so the two surfaces never
// disagree about what a run means. No Supabase, no network, no React.
//
// Deliberately excludes every field already rendered by the card summary
// (provider, status, attempt, date, estimated/real cost, credits used,
// candidate count) — see account-agents-run-history.tsx for those.

import { classifyLushaRunViewerBranch, type LushaRunViewerBranch } from '@/modules/contact-enrichment/run-viewer-branch-classifier';
import type { ContactEnrichmentRunProviderUsage } from '@/modules/contact-enrichment/run-viewer-types';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import { getLushaEmptyStateCopy } from './contact-enrichment-empty-state-copy';

export type AccountRunInlineDetailKind =
  | 'lusha_credentials_missing'
  | 'lusha_company_context_error'
  | 'lusha_provider_error'
  | 'lusha_empty_after_filtering'
  | 'lusha_has_candidates'
  | 'lusha_not_yet_executed'
  | 'generic_failed'
  | 'no_detail_available';

export interface AccountRunInlineDetailContent {
  kind: AccountRunInlineDetailKind;
  headline: string;
  detail: string;
  /** Only set for lusha_empty_after_filtering — raw provider results before relevance filtering. */
  rawResultsCount?: number;
  /** Only set for lusha_empty_after_filtering — whether a phone reveal call was made. */
  phoneRevealEnabled?: boolean;
}

export interface ResolveAccountRunInlineDetailInput {
  run: Pick<AccountContactEnrichmentRun, 'intendedProvider' | 'status' | 'summaryError'>;
  /** provider_usage_logs rows for provider_key='lusha' on this run's agent_run_id. */
  lushaUsageRows: ContactEnrichmentRunProviderUsage[];
  candidatesCount: number;
}

const STATIC_BRANCH_CONTENT: Partial<
  Record<LushaRunViewerBranch, { kind: AccountRunInlineDetailKind; headline: string; detail: string }>
> = {
  credentials_missing: {
    kind: 'lusha_credentials_missing',
    headline: 'Lusha no está disponible o no tiene credenciales configuradas',
    detail: 'No se ejecutó el proveedor y no se crearon candidatos.',
  },
  company_context_error: {
    kind: 'lusha_company_context_error',
    headline: 'Sin contexto de empresa suficiente',
    detail:
      'No se pudo resolver suficiente contexto de la empresa para ejecutar Lusha. No se crearon candidatos.',
  },
  has_candidates: {
    kind: 'lusha_has_candidates',
    headline: 'Candidatos listos para revisión',
    detail:
      'Lusha encontró candidato(s) con email corporativo. No se crearon contactos finales: requieren aprobación humana.',
  },
  not_yet_executed: {
    kind: 'lusha_not_yet_executed',
    headline: 'Intento no ejecutado todavía',
    detail: 'Este intento no llegó a ejecutar Lusha.',
  },
};

/** Pure — resolves what the inline expansion should show for a single
 *  account run, given the (lazily-fetched) provider usage rows for that
 *  run's agent_run_id. Never includes a field already shown by the card
 *  summary. */
export function resolveAccountRunInlineDetailContent({
  run,
  lushaUsageRows,
  candidatesCount,
}: ResolveAccountRunInlineDetailInput): AccountRunInlineDetailContent {
  const branch = classifyLushaRunViewerBranch({ run, lushaUsageRows, candidatesCount });
  const latestUsage = lushaUsageRows.at(-1) ?? null;

  if (branch === 'provider_error') {
    return {
      kind: 'lusha_provider_error',
      headline: 'Error del proveedor',
      detail:
        latestUsage?.errorMessage ??
        'No fue posible completar la búsqueda con Lusha. El proveedor devolvió un error durante la búsqueda.',
    };
  }

  if (branch === 'empty_after_filtering') {
    const copy = getLushaEmptyStateCopy({
      rawResultsCount: latestUsage?.rawResultsCount ?? 0,
      creditsUsed: latestUsage?.creditsUsed ?? null,
    });
    return {
      kind: 'lusha_empty_after_filtering',
      headline: copy.headline,
      detail: copy.detail,
      rawResultsCount: latestUsage?.rawResultsCount ?? 0,
      phoneRevealEnabled: latestUsage?.phoneRevealEnabled ?? false,
    };
  }

  const staticContent = STATIC_BRANCH_CONTENT[branch];
  if (staticContent) return staticContent;

  // branch === 'not_lusha' — Apollo runs, legacy rows with no provider, or
  // any run this classifier does not otherwise recognize. No persisted
  // Apollo branch classifier exists yet (only Lusha's), so this is a safe,
  // honest fallback rather than a fabricated Apollo-specific message.
  if (run.status === 'failed') {
    return {
      kind: 'generic_failed',
      headline: 'Este run falló',
      detail: run.summaryError
        ? `Motivo registrado: ${run.summaryError}`
        : 'No hay un motivo adicional registrado para este run.',
    };
  }

  return {
    kind: 'no_detail_available',
    headline: 'Sin detalle adicional',
    detail: 'No hay detalle adicional disponible para este run.',
  };
}
