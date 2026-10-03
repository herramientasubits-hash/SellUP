'use server';

// Pipeline — «Recorrido de la empresa». Las lecturas son SELECT. La ÚNICA
// escritura de la pantalla —mover de etapa, con el contexto que dejó la persona—
// pasa por `updateAccount` de `@/modules/accounts/actions` (`moveAccountStage`):
// el estado y las notas anexadas viajan en UNA sola llamada.
//
// Alcance comercial: la lista y el detalle salen de `getAccountsList` /
// `getAccountById`, que ya lo aplican. Las lecturas por lotes de abajo solo
// reciben ids que esas funciones devolvieron; nunca amplían el alcance.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getAccountAudit,
  getAccountById,
  getAccountsList,
  getAccountsSummary,
  updateAccount,
} from '@/modules/accounts/actions';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/modules/accounts/types';
import { getPipelineStage, resolveCurrentStage } from './stages';
import {
  appendStageNote,
  isStageNoteTextValid,
  type StageNoteKind,
} from './stage-notes';
import { getContactsByAccount } from '@/modules/contacts/actions';
import { getContactEnrichmentRunsByAccountId } from '@/modules/contact-enrichment/account-run-history-actions';
import {
  isAccountHubSpotSynced,
  safeAccountMetadata,
} from '@/modules/accounts/hubspot-company-sync-presentation';
import { readClaudeClassificationDisplay } from '@/components/prospect-batches/claude-classification-display';
import {
  buildAccountJourney,
  buildPipelineOverview,
  EMPTY_ACCOUNT_FACTS,
  isDecisionMaker,
  readApprovalMetadata,
  type OverviewAccountFacts,
} from './journey-read-model';
import type { AccountJourney, OriginCandidate, PipelineOverview } from './types';

// ============================================================
// Auth helper (igual que en accounts)
// ============================================================

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  return { internalUserId: internalUser.id };
}

// ============================================================
// Origen: prospecto → cuenta
// ============================================================

const ORIGIN_SELECT = `
  id, batch_id, source_primary, fit_score, confidence_score, data_completeness_score,
  estimated_cost_usd, tax_identifier, tax_identifier_type, record_origin,
  commercial_fit_status, reviewed_at, metadata,
  reviewer:internal_users!prospect_candidates_reviewed_by_fkey(full_name, email),
  batch:prospect_batches!prospect_candidates_batch_id_fkey(name, source)
`;

interface OriginRow {
  id: string;
  batch_id: string | null;
  source_primary: string | null;
  fit_score: number | null;
  confidence_score: number | null;
  data_completeness_score: number | null;
  estimated_cost_usd: number | null;
  tax_identifier: string | null;
  tax_identifier_type: string | null;
  record_origin: string | null;
  commercial_fit_status: string | null;
  reviewed_at: string | null;
  metadata: unknown;
  reviewer: { full_name: string | null; email: string } | null;
  batch: { name: string; source: string | null } | null;
}

function toOriginCandidate(row: OriginRow): OriginCandidate {
  const approval = readApprovalMetadata(row.metadata);
  return {
    id: row.id,
    batchId: row.batch_id,
    batchName: row.batch?.name ?? null,
    batchSource: row.batch?.source ?? null,
    sourcePrimary: row.source_primary,
    fitScore: row.fit_score,
    confidenceScore: row.confidence_score,
    dataCompletenessScore: row.data_completeness_score,
    estimatedCostUsd: row.estimated_cost_usd,
    taxIdentifier: row.tax_identifier,
    taxIdentifierType: row.tax_identifier_type,
    recordOrigin: row.record_origin,
    commercialFitStatus: row.commercial_fit_status,
    reviewedAt: row.reviewed_at,
    reviewerName: row.reviewer?.full_name ?? row.reviewer?.email ?? null,
    approvedAt: approval.approvedAt,
    hubspotAction: approval.hubspotAction,
    hubspotCompanyId: approval.hubspotCompanyId,
    claudeClassification: readClaudeClassificationDisplay(row.metadata),
  };
}

/**
 * El prospecto del que salió la cuenta: `prospect_candidates.converted_account_id`
 * y, si no hay, `accounts.metadata.converted_from_candidate_id`.
 */
async function loadOriginCandidate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  fallbackCandidateId: string | null,
): Promise<OriginCandidate | null> {
  const byConversion = await supabase
    .from('prospect_candidates')
    .select(ORIGIN_SELECT)
    .eq('converted_account_id', accountId)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (byConversion.error) throw new Error(`getAccountOriginCandidate: ${byConversion.error.message}`);
  if (byConversion.data) return toOriginCandidate(byConversion.data as unknown as OriginRow);

  if (!fallbackCandidateId) return null;
  const byMetadata = await supabase
    .from('prospect_candidates')
    .select(ORIGIN_SELECT)
    .eq('id', fallbackCandidateId)
    .maybeSingle();
  if (byMetadata.error) throw new Error(`getAccountOriginCandidate: ${byMetadata.error.message}`);
  return byMetadata.data ? toOriginCandidate(byMetadata.data as unknown as OriginRow) : null;
}

function readConvertedFromCandidateId(metadata: Record<string, unknown>): string | null {
  const value = metadata.converted_from_candidate_id;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** `null` si la cuenta no existe o está fuera del alcance de quien mira. */
export async function getAccountOriginCandidate(accountId: string): Promise<OriginCandidate | null> {
  await requireActiveUser();
  const account = await getAccountById(accountId);
  if (!account) return null;
  const supabase = await createClient();
  return loadOriginCandidate(
    supabase,
    accountId,
    readConvertedFromCandidateId(safeAccountMetadata(account.metadata)),
  );
}

// ============================================================
// Recorrido de una empresa
// ============================================================

/** `null` si la cuenta no existe o está fuera del alcance de quien mira. */
export async function getAccountJourney(accountId: string): Promise<AccountJourney | null> {
  await requireActiveUser();
  const account = await getAccountById(accountId);
  if (!account) return null;

  const supabase = await createClient();
  const [audit, contacts, runs, origin] = await Promise.all([
    getAccountAudit(accountId),
    getContactsByAccount(accountId),
    getContactEnrichmentRunsByAccountId(accountId),
    loadOriginCandidate(
      supabase,
      accountId,
      readConvertedFromCandidateId(safeAccountMetadata(account.metadata)),
    ),
  ]);

  return buildAccountJourney({ account, origin, contacts, runs, audit, now: new Date() });
}

// ============================================================
// Resumen del pipeline
// ============================================================

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const BATCH_SIZE = 100;

export async function getPipelineOverview(): Promise<PipelineOverview> {
  await requireActiveUser();
  const [accounts, summary] = await Promise.all([getAccountsList(), getAccountsSummary()]);
  const ids = accounts.map((account) => account.id);
  const facts = new Map<string, OverviewAccountFacts>(
    ids.map((id) => [id, { ...EMPTY_ACCOUNT_FACTS }]),
  );

  if (ids.length > 0) {
    const supabase = await createClient();
    await Promise.all(
      chunk(ids, BATCH_SIZE).map(async (batchIds) => {
        const [audit, contacts, runs, hubspot] = await Promise.all([
          supabase
            .from('account_audit')
            .select('account_id, created_at')
            .eq('action_type', 'account_status_changed')
            .in('account_id', batchIds),
          supabase
            .from('contacts')
            .select('account_id, role_in_account, phone_revealed_at')
            .in('account_id', batchIds),
          supabase
            .from('contact_enrichment_runs')
            .select('account_id, status, created_at')
            .in('account_id', batchIds)
            .order('created_at', { ascending: false }),
          // Solo las columnas de HubSpot, y solo para ids que `getAccountsList`
          // ya devolvió con el alcance aplicado.
          supabase.from('accounts').select('id, hubspot_company_id, metadata').in('id', batchIds),
        ]);
        if (audit.error) throw new Error(`getPipelineOverview audit: ${audit.error.message}`);
        if (contacts.error) throw new Error(`getPipelineOverview contacts: ${contacts.error.message}`);
        if (runs.error) throw new Error(`getPipelineOverview runs: ${runs.error.message}`);
        if (hubspot.error) throw new Error(`getPipelineOverview hubspot: ${hubspot.error.message}`);

        for (const row of audit.data ?? []) {
          const current = facts.get(row.account_id);
          if (!current) continue;
          if (!current.lastStatusChangeAt || row.created_at > current.lastStatusChangeAt) {
            facts.set(row.account_id, { ...current, lastStatusChangeAt: row.created_at });
          }
        }
        for (const row of contacts.data ?? []) {
          const current = facts.get(row.account_id);
          if (!current) continue;
          const decision = isDecisionMaker(row);
          facts.set(row.account_id, {
            ...current,
            contactsTotal: current.contactsTotal + 1,
            decisionMakersTotal: current.decisionMakersTotal + (decision ? 1 : 0),
            decisionMakersWithPhone:
              current.decisionMakersWithPhone + (decision && row.phone_revealed_at ? 1 : 0),
          });
        }
        // Las corridas vienen de la más reciente a la más antigua: la primera por cuenta manda.
        const seenRun = new Set<string>();
        for (const row of runs.data ?? []) {
          if (seenRun.has(row.account_id)) continue;
          seenRun.add(row.account_id);
          const current = facts.get(row.account_id);
          if (current) facts.set(row.account_id, { ...current, lastRunStatus: row.status });
        }
        for (const row of hubspot.data ?? []) {
          const current = facts.get(row.id);
          if (!current) continue;
          facts.set(row.id, {
            ...current,
            hubspotSynced: isAccountHubSpotSynced(row.hubspot_company_id, safeAccountMetadata(row.metadata)),
          });
        }
      }),
    );
  }

  return buildPipelineOverview({
    accounts,
    facts,
    archivedTotal: summary.archived,
    now: new Date(),
  });
}

// ============================================================
// Mover de etapa, con contexto
// ============================================================

/** Los estados a los que una persona puede mover una empresa (archivar es otra acción). */
const MOVABLE_STATUSES: readonly PipelineStatus[] = [
  'new',
  'ready_for_research',
  'research_in_progress',
  'ready_for_outreach',
];

export interface StageMoveNoteInput {
  kind: StageNoteKind;
  text: string;
}

export type MoveAccountStageResult = { success: true } | { success: false; error: string };

async function currentUserName(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('internal_users')
    .select('full_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return (data?.full_name as string | null) ?? (data?.email as string | null) ?? null;
}

/**
 * Mueve la empresa de etapa y, si la persona dejó contexto (lo que pegó, o el
 * motivo de mover sin acción), lo ANEXA a `accounts.notes` con su cabecera. Una
 * sola `updateAccount` con el estado y las notas: si falla, no se mueve nada.
 * Respeta el alcance comercial (`getAccountById`).
 */
export async function moveAccountStage(
  accountId: string,
  status: PipelineStatus,
  note?: StageMoveNoteInput | null,
): Promise<MoveAccountStageResult> {
  await requireActiveUser();
  if (!MOVABLE_STATUSES.includes(status)) return { success: false, error: 'Etapa no válida.' };
  if (note && !isStageNoteTextValid(note.text)) {
    return { success: false, error: 'Escribe al menos 10 caracteres para dejar el contexto.' };
  }

  const account = await getAccountById(accountId);
  if (!account) return { success: false, error: 'No encontramos esa empresa.' };
  if (account.archived_at || account.pipeline_status === 'archived') {
    return { success: false, error: 'La empresa está archivada.' };
  }

  if (!note) return updateAccount(accountId, { pipeline_status: status });

  const { stageId } = resolveCurrentStage(status);
  const notes = appendStageNote(account.notes, {
    kind: note.kind,
    text: note.text,
    stageName: stageId ? getPipelineStage(stageId).name : PIPELINE_STATUS_LABELS[status],
    statusLabel: PIPELINE_STATUS_LABELS[status],
    at: new Date(),
    author: await currentUserName(),
  });
  return updateAccount(accountId, { pipeline_status: status, notes });
}
