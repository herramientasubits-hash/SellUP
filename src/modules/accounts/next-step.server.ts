import 'server-only';

/**
 * Los datos para el «siguiente paso» de cada empresa de la lista, en lotes: contactos,
 * la última corrida del Agente 2, si el Agente 3 está trabajando y si ya preparó.
 * Con el cliente de la sesión (RLS): sólo lo que la persona puede ver. Si una tabla no
 * responde, se sigue sin ese dato: la lista nunca se rompe por esto.
 */

import { createClient } from '@/lib/supabase/server';
import { resolveAccountNextStep, type AccountNextStepKey } from './next-step';
import type { AccountListItem } from './types';

const BATCH_SIZE = 100;
const PAGE_SIZE = 1000;
const IN_PROGRESS_MAX_AGE_MS = 10 * 60 * 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Lee todas las filas (PostgREST corta en 1.000 por pedido). */
async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await query(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[accounts next-step] ${label} read failed:`, error.message);
      return rows;
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readBatch(supabase: Supabase, ids: string[]) {
  const [contacts, runs, packs, running] = await Promise.all([
    readAll<{ account_id: string }>(
      (from, to) => supabase.from('contacts').select('account_id').in('account_id', ids).order('id').range(from, to),
      'contacts',
    ),
    readAll<{ account_id: string; status: string; created_at: string }>(
      (from, to) =>
        supabase
          .from('contact_enrichment_runs')
          .select('account_id, status, created_at')
          .in('account_id', ids)
          .order('created_at', { ascending: false })
          .range(from, to),
      'contact_enrichment_runs',
    ),
    readAll<{ account_id: string }>(
      (from, to) =>
        supabase
          .from('first_call_packs')
          .select('account_id')
          .in('account_id', ids)
          .in('status', ['draft', 'needs_review', 'used'])
          .order('id')
          .range(from, to),
      'first_call_packs',
    ),
    // El Agente 3 trabajando ahora: una investigación «en curso» reciente (las caídas
    // se cierran a los 5 minutos; con margen, no se cuenta una de hace más de 10).
    readAll<{ account_id: string }>(
      (from, to) =>
        supabase
          .from('account_research_briefs')
          .select('account_id')
          .in('account_id', ids)
          .eq('status', 'running')
          .gte('created_at', new Date(Date.now() - IN_PROGRESS_MAX_AGE_MS).toISOString())
          .order('id')
          .range(from, to),
      'account_research_briefs',
    ),
  ]);
  return { contacts, runs, packs, running };
}

/** El siguiente paso de cada empresa de la lista (por id). */
export async function loadAccountNextSteps(accounts: readonly AccountListItem[]): Promise<Record<string, AccountNextStepKey>> {
  const result: Record<string, AccountNextStepKey> = {};
  if (accounts.length === 0) return result;
  const supabase = await createClient();
  const contactsTotal = new Map<string, number>();
  const lastRun = new Map<string, string>();
  const prepared = new Set<string>();
  const inProgress = new Set<string>();

  try {
    const batches = await Promise.all(chunk(accounts.map((a) => a.id), BATCH_SIZE).map((ids) => readBatch(supabase, ids)));
    for (const batch of batches) {
      for (const row of batch.contacts) contactsTotal.set(row.account_id, (contactsTotal.get(row.account_id) ?? 0) + 1);
      // Vienen de la más reciente a la más antigua: la primera por empresa manda.
      for (const row of batch.runs) if (!lastRun.has(row.account_id)) lastRun.set(row.account_id, row.status);
      for (const row of batch.packs) prepared.add(row.account_id);
      for (const row of batch.running) inProgress.add(row.account_id);
    }
  } catch (error) {
    console.error('[accounts next-step] load failed:', error instanceof Error ? error.message : error);
  }

  for (const account of accounts) {
    result[account.id] = resolveAccountNextStep({
      archived: account.pipeline_status === 'archived',
      contactsTotal: contactsTotal.get(account.id) ?? 0,
      lastEnrichmentStatus: lastRun.get(account.id) ?? null,
      firstContactInProgress: inProgress.has(account.id),
      firstContactPrepared: prepared.has(account.id),
    });
  }
  return result;
}
