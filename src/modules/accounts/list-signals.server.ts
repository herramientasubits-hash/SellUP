import 'server-only';

/**
 * Las cifras y fechas de cada empresa de la «Lista de empresas» (dueño 17-11):
 * contactos aprobados / por revisar / rechazados, comentarios, última búsqueda
 * de contactos, última actividad (SellUp y HubSpot), próxima actividad agendada
 * y estado comercial en HubSpot.
 *
 * Con el cliente de la sesión (RLS): sólo lo que la persona puede ver. Si una
 * tabla o HubSpot no responden, se sigue sin ese dato: la lista nunca se rompe
 * por esto.
 */

import { createClient } from '@/lib/supabase/server';
import { fetchAllPagesInChunks, IN_FILTER_CHUNK_SIZE, type PageFetcher } from '@/lib/supabase/paginated-read';
import { readHubSpotAccountListSignals } from '@/server/integrations/hubspot-account-list-signals.server';
import {
  buildAccountListSignals,
  type AccountActivityRows,
  type AccountListSignals,
  type CandidateForCount,
  type HubSpotAccountSignal,
} from './list-signals';
import type { AccountListItem } from './types';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Columna JSON de la empresa a la que se reasignó un candidato. */
const REASSIGNED_ACCOUNT_PATH = 'enrichment_metadata->company_reassignment->>account_id';
const CANDIDATE_SELECT = `id, status, reviewed_at, enrichment_run_id, reassigned_account_id:${REASSIGNED_ACCOUNT_PATH}`;
/** Sólo cuentan los por revisar y los rechazados (los aprobados ya son contactos). */
const COUNTED_CANDIDATE_STATUSES = ['pending_review', 'discarded'];

interface CandidateRow {
  id: string;
  status: string;
  reviewed_at: string | null;
  enrichment_run_id: string | null;
  reassigned_account_id: string | null;
}

/** Lee por trozos de ids; con error, avisa en consola y devuelve lo leído. */
async function readChunks<T>(
  label: string,
  ids: readonly string[],
  build: (chunk: string[]) => PageFetcher<T>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const result = await fetchAllPagesInChunks<string, T>(ids, IN_FILTER_CHUNK_SIZE, build);
  if (result.error) console.error(`[accounts list-signals] ${label} read failed:`, result.error);
  return result.rows;
}

async function readActivityRows(
  supabase: Supabase,
  accounts: readonly AccountListItem[],
): Promise<AccountActivityRows> {
  const ids = accounts.map((account) => account.id);
  const fetcher = <T,>(query: (from: number, to: number) => unknown) =>
    query as unknown as PageFetcher<T>;

  const [contacts, runs, packs, comments, audit, reassigned] = await Promise.all([
    readChunks<{ account_id: string; created_at: string | null }>('contacts', ids, (chunk) =>
      fetcher((from, to) =>
        supabase
          .from('contacts')
          .select('account_id, created_at')
          .in('account_id', chunk)
          .is('archived_at', null)
          .order('id')
          .range(from, to),
      ),
    ),
    readChunks<{ id: string; account_id: string; status: string; created_at: string }>('contact_enrichment_runs', ids, (chunk) =>
      fetcher((from, to) =>
        supabase
          .from('contact_enrichment_runs')
          .select('id, account_id, status, created_at')
          .in('account_id', chunk)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
    ),
    readChunks<{ account_id: string; created_at: string | null }>('first_call_packs', ids, (chunk) =>
      fetcher((from, to) =>
        supabase.from('first_call_packs').select('account_id, created_at').in('account_id', chunk).order('id').range(from, to),
      ),
    ),
    readChunks<{ account_id: string; created_at: string | null }>('record_comments', ids, (chunk) =>
      fetcher((from, to) =>
        supabase.from('record_comments').select('account_id, created_at').in('account_id', chunk).order('id').range(from, to),
      ),
    ),
    readChunks<{ account_id: string; created_at: string | null }>('account_audit', ids, (chunk) =>
      fetcher((from, to) =>
        supabase.from('account_audit').select('account_id, created_at').in('account_id', chunk).order('id').range(from, to),
      ),
    ),
    // Candidatos que una persona reasignó a estas empresas desde la búsqueda de otra.
    readChunks<CandidateRow>('contact_enrichment_candidates (reasignados)', ids, (chunk) =>
      fetcher((from, to) =>
        supabase
          .from('contact_enrichment_candidates')
          .select(CANDIDATE_SELECT)
          .in(REASSIGNED_ACCOUNT_PATH, chunk)
          .in('status', COUNTED_CANDIDATE_STATUSES)
          .order('id')
          .range(from, to),
      ),
    ),
  ]);

  // Candidatos de las búsquedas de estas empresas (los que no se reasignaron a otra).
  const runAccount = new Map(runs.map((run) => [run.id, run.account_id]));
  const fromRuns = await readChunks<CandidateRow>('contact_enrichment_candidates', [...runAccount.keys()], (chunk) =>
    fetcher((from, to) =>
      supabase
        .from('contact_enrichment_candidates')
        .select(CANDIDATE_SELECT)
        .in('enrichment_run_id', chunk)
        .in('status', COUNTED_CANDIDATE_STATUSES)
        .order('id')
        .range(from, to),
    ),
  );

  const candidates: CandidateForCount[] = [...fromRuns, ...reassigned].map((row) => ({
    id: row.id,
    status: row.status,
    reviewedAt: row.reviewed_at,
    runAccountId: row.enrichment_run_id ? runAccount.get(row.enrichment_run_id) ?? null : null,
    reassignedAccountId: row.reassigned_account_id ?? null,
  }));

  return {
    accounts: accounts.map((account) => ({ id: account.id, created_at: account.created_at })),
    contacts,
    runs,
    candidates,
    packs,
    comments,
    audit,
  };
}

/** Las señales de cada empresa de la lista (por id). */
export async function loadAccountListSignals(
  accounts: readonly AccountListItem[],
): Promise<Record<string, AccountListSignals>> {
  if (accounts.length === 0) return {};

  const companyIdOf = new Map<string, string>();
  for (const account of accounts) {
    const companyId = account.hubspot_company_id?.trim();
    if (companyId) companyIdOf.set(account.id, companyId);
  }

  const emptyRows: AccountActivityRows = {
    accounts: accounts.map((account) => ({ id: account.id, created_at: account.created_at })),
    contacts: [],
    runs: [],
    candidates: [],
    packs: [],
    comments: [],
    audit: [],
  };

  const [rows, hubspotSignals] = await Promise.all([
    createClient()
      .then((supabase) => readActivityRows(supabase, accounts))
      .catch((error: unknown) => {
        console.error('[accounts list-signals] load failed:', error instanceof Error ? error.message : error);
        return emptyRows;
      }),
    readHubSpotAccountListSignals([...companyIdOf.values()]).catch(() => new Map<string, HubSpotAccountSignal>()),
  ]);

  // Sin Company ID: «No está en HubSpot». Con ID y sin lectura: no entra al mapa («Sin lectura»).
  const hubspot = new Map<string, HubSpotAccountSignal | 'not_linked'>();
  for (const account of accounts) {
    const companyId = companyIdOf.get(account.id);
    if (!companyId) {
      hubspot.set(account.id, 'not_linked');
      continue;
    }
    const signal = hubspotSignals.get(companyId);
    if (signal) hubspot.set(account.id, signal);
  }

  return buildAccountListSignals(rows, hubspot);
}
