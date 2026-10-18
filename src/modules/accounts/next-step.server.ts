import 'server-only';

/**
 * Los datos para el «siguiente paso» de cada empresa de la lista, en lotes: contactos,
 * la última corrida del Agente 2 y las preparaciones del Agente 3 con su resultado.
 * Con el cliente de la sesión (RLS): sólo lo que la persona puede ver. Si una tabla no
 * responde, se sigue sin ese dato: la lista nunca se rompe por esto.
 */

import { createClient } from '@/lib/supabase/server';
import { resolveAccountNextStep, type AccountNextStepKey, type AccountNextStepPack } from './next-step';
import type { AccountListItem } from './types';

const BATCH_SIZE = 100;
const PAGE_SIZE = 1000;

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
  const [contacts, runs, packs] = await Promise.all([
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
    readAll<{ account_id: string; status: string; created_at: string; outcome: { result?: unknown } | null }>(
      (from, to) =>
        supabase
          .from('first_call_packs')
          .select('account_id, status, created_at, outcome:pack->outcome')
          .in('account_id', ids)
          .order('id')
          .range(from, to),
      'first_call_packs',
    ),
  ]);
  return { contacts, runs, packs };
}

/** El siguiente paso de cada empresa de la lista (por id). */
export async function loadAccountNextSteps(accounts: readonly AccountListItem[]): Promise<Record<string, AccountNextStepKey>> {
  const result: Record<string, AccountNextStepKey> = {};
  if (accounts.length === 0) return result;
  const supabase = await createClient();
  const contactsTotal = new Map<string, number>();
  const lastRun = new Map<string, string>();
  const packs = new Map<string, AccountNextStepPack[]>();

  try {
    const batches = await Promise.all(chunk(accounts.map((a) => a.id), BATCH_SIZE).map((ids) => readBatch(supabase, ids)));
    for (const batch of batches) {
      for (const row of batch.contacts) contactsTotal.set(row.account_id, (contactsTotal.get(row.account_id) ?? 0) + 1);
      // Vienen de la más reciente a la más antigua: la primera por empresa manda.
      for (const row of batch.runs) if (!lastRun.has(row.account_id)) lastRun.set(row.account_id, row.status);
      for (const row of batch.packs) {
        const list = packs.get(row.account_id) ?? [];
        const outcome = typeof row.outcome?.result === 'string' ? row.outcome.result : null;
        packs.set(row.account_id, [...list, { status: row.status, createdAt: row.created_at, outcome }]);
      }
    }
  } catch (error) {
    console.error('[accounts next-step] load failed:', error instanceof Error ? error.message : error);
  }

  for (const account of accounts) {
    result[account.id] = resolveAccountNextStep({
      archived: account.pipeline_status === 'archived',
      contactsTotal: contactsTotal.get(account.id) ?? 0,
      lastEnrichmentStatus: lastRun.get(account.id) ?? null,
      packs: packs.get(account.id) ?? [],
    });
  }
  return result;
}
