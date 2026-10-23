// Lecturas del alcance comercial para corridas y candidatos de contactos (ver ./candidate-scope).
// Sin 'use server' a propósito: son ayudantes del servidor, no acciones invocables desde el
// cliente. Cada acción que recibe un id del cliente los llama ANTES de leer o escribir.

import { createClient } from '@/lib/supabase/server';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { resolveScopedUserIds } from '@/modules/access/commercial-scope-logic';
import {
  isContactAccountInScope,
  type ContactAccountOwnership,
} from '@/modules/contacts/contact-scope';
import { isCandidateRunInScope, isContactRunInScope, type ContactRunScopeFacts } from './candidate-scope';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id mal formado no es de nadie: se trata como «no visible» sin consultar (evita el 22P02). */
function isUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

/** `null` = sin restricción (bandera apagada o admin), `[]` = nada, `[ids]` = esos usuarios. */
export async function resolveCandidateScopeIds(): Promise<string[] | null> {
  if (!isCommercialScopeEnabled()) return null;
  const scope = await resolveCommercialScope();
  if (!scope) return []; // autenticado sin alcance ⇒ nada, nunca todo
  return resolveScopedUserIds(scope);
}

const RUN_SCOPE_SELECT = 'triggered_by, account:accounts ( owner_id, created_by )';

function toFacts(row: unknown): ContactRunScopeFacts | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as { triggered_by?: string | null; account?: unknown };
  const rawAccount = Array.isArray(record.account) ? record.account[0] : record.account;
  const account = (rawAccount ?? null) as { owner_id?: string | null; created_by?: string | null } | null;
  return {
    triggered_by: record.triggered_by ?? null,
    account_owner_id: account?.owner_id ?? null,
    account_created_by: account?.created_by ?? null,
  };
}

async function canSeeRunWhere(
  supabase: SupabaseServerClient,
  column: 'id' | 'agent_run_id',
  value: string,
): Promise<boolean> {
  const scopeIds = await resolveCandidateScopeIds();
  if (scopeIds === null) return true;
  if (scopeIds.length === 0 || !isUuid(value)) return false;
  const { data, error } = await supabase
    .from('contact_enrichment_runs')
    .select(RUN_SCOPE_SELECT)
    .eq(column, value.trim())
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`canSeeContactEnrichmentRun: ${error.message}`);
  return isContactRunInScope(toFacts(data), scopeIds);
}

/** ¿Puede el usuario actual ver esta corrida de contactos? */
export function canSeeContactEnrichmentRun(
  supabase: SupabaseServerClient,
  runId: string,
): Promise<boolean> {
  return canSeeRunWhere(supabase, 'id', runId);
}

/** Igual, partiendo del `agent_run_id` (uso de proveedores de la corrida). */
export function canSeeContactEnrichmentRunByAgentRunId(
  supabase: SupabaseServerClient,
  agentRunId: string,
): Promise<boolean> {
  return canSeeRunWhere(supabase, 'agent_run_id', agentRunId);
}

/** ¿Puede el usuario actual ver (y por tanto actuar sobre) este candidato? */
export async function canSeeContactCandidate(
  supabase: SupabaseServerClient,
  candidateId: string,
): Promise<boolean> {
  const scopeIds = await resolveCandidateScopeIds();
  if (scopeIds === null) return true;
  if (scopeIds.length === 0 || !isUuid(candidateId)) return false;
  const { data, error } = await supabase
    .from('contact_enrichment_candidates')
    .select(`run:contact_enrichment_runs ( ${RUN_SCOPE_SELECT} )`)
    .eq('id', candidateId.trim())
    .maybeSingle();
  if (error) throw new Error(`canSeeContactCandidate: ${error.message}`);
  const run = (data as { run?: unknown } | null)?.run;
  return isContactRunInScope(toFacts(Array.isArray(run) ? run[0] : run), scopeIds);
}

async function canSeeTriggeredRow(
  supabase: SupabaseServerClient,
  table: 'contact_enrichment_requests' | 'contact_enrichment_bulk_runs',
  id: unknown,
): Promise<boolean> {
  const scopeIds = await resolveCandidateScopeIds();
  if (scopeIds === null) return true;
  if (scopeIds.length === 0 || typeof id !== 'string' || !isUuid(id)) return false;
  const { data, error } = await supabase
    .from(table)
    .select('triggered_by')
    .eq('id', id.trim())
    .maybeSingle();
  if (error) throw new Error(`canSeeTriggeredRow(${table}): ${error.message}`);
  return isCandidateRunInScope((data as { triggered_by?: string | null } | null)?.triggered_by, scopeIds);
}

/** ¿Puede el usuario actual lanzar/ver esta solicitud de búsqueda de contactos? */
export function canSeeContactEnrichmentRequest(
  supabase: SupabaseServerClient,
  requestId: unknown,
): Promise<boolean> {
  return canSeeTriggeredRow(supabase, 'contact_enrichment_requests', requestId);
}

/** ¿Puede el usuario actual ejecutar/ver esta búsqueda masiva? */
export function canSeeContactEnrichmentBulkRun(
  supabase: SupabaseServerClient,
  bulkRunId: unknown,
): Promise<boolean> {
  return canSeeTriggeredRow(supabase, 'contact_enrichment_bulk_runs', bulkRunId);
}

/**
 * ¿Puede el usuario actual ver este contacto OFICIAL? Misma regla que Contactos
 * (`@/modules/contacts/contact-scope`): el contacto hereda la visibilidad de su empresa.
 */
export async function canSeeOfficialContact(
  supabase: SupabaseServerClient,
  contactId: string,
): Promise<boolean> {
  const scopeIds = await resolveCandidateScopeIds();
  if (scopeIds === null) return true;
  if (scopeIds.length === 0 || !isUuid(contactId)) return false;
  const { data, error } = await supabase
    .from('contacts')
    .select('account:account_id ( owner_id, created_by )')
    .eq('id', contactId.trim())
    .maybeSingle();
  if (error) throw new Error(`canSeeOfficialContact: ${error.message}`);
  const raw = (data as { account?: unknown } | null)?.account;
  const account = (Array.isArray(raw) ? raw[0] : raw) as ContactAccountOwnership | null | undefined;
  return isContactAccountInScope(account ?? null, scopeIds);
}
