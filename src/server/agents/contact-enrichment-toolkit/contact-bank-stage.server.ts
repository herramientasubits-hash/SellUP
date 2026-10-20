// AGENT2-CONTACT-BANK-1 — Banco de contactos por empresa (etapa de servidor)
//
// Corre después de «Primero HubSpot» y antes de Apollo. Busca las OTRAS fichas de SellUp que
// son la misma compañía (mismo número fiscal y país, mismo dominio o mismo ID de HubSpot), junta
// lo que ya se conoce de ellas y lo deja como candidatos `pending_review` de ESTA corrida.
//
// Qué fichas cuentan: las archivadas (la empresa volvió a entrar con otra ficha) y las del
// MISMO responsable. Nunca la ficha activa de otro vendedor: «una empresa, un vendedor».
//
// Falla ABIERTO para la búsqueda (cualquier error ⇒ «no satisfecho» y Apollo corre como
// siempre) y CERRADO para la privacidad (si no se pueden leer los bloqueos, no se inserta nada).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { buildDomainLookupSpellings } from './local-reviewable-candidate-reuse-gate';
import {
  CONTACT_BANK_TTL_DAYS,
  contactBankEntryIdentities,
  isSatisfiedByContactBank,
  selectContactBankCandidates,
  suppressionKey,
  type ContactBankCandidateRow,
  type ContactBankEntry,
  type ContactBankKnownPerson,
} from './contact-bank-core';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Topes de lectura: una compañía con más que esto ya tiene contactos de sobra. */
const MAX_SIBLING_ACCOUNTS = 20;
const MAX_ROWS = 300;
/** `findExistingAccountForCandidate` exige al menos esto para confiar en un número fiscal. */
const MIN_TAX_ID_LENGTH = 4;

export interface ContactBankRunRef {
  accountId: string | null;
  companyDomain: string | null;
  hubspotCompanyId: string | null;
}

export interface ContactBankAccount {
  id: string;
  ownerId: string | null;
  archivedAt: string | null;
  taxIdentifier: string | null;
  countryCode: string | null;
  domain: string | null;
  hubspotCompanyId: string | null;
}

export interface ContactBankEntriesQuery {
  siblingAccountIds: string[];
  domainSpellings: string[];
  /** Sólo se reutilizan búsquedas sin ficha (empresa sólo de HubSpot) que lanzó este vendedor. */
  ownerId: string | null;
  since: string;
}

export interface ContactBankStageDeps {
  loadRunRef?: (attemptId: string) => Promise<ContactBankRunRef | null>;
  loadAccount?: (accountId: string) => Promise<ContactBankAccount | null>;
  findSameCompanyAccounts?: (current: ContactBankAccount, run: ContactBankRunRef) => Promise<ContactBankAccount[]>;
  loadEntries?: (input: ContactBankEntriesQuery) => Promise<ContactBankEntry[]>;
  loadKnown?: (input: { accountId: string; attemptId: string }) => Promise<ContactBankKnownPerson[]>;
  loadDoNotContact?: (accountIds: string[]) => Promise<ContactBankKnownPerson[]>;
  loadSuppressedKeys?: (keys: string[]) => Promise<Set<string>>;
  insertRows?: (attemptId: string, rows: ContactBankCandidateRow[]) => Promise<{ error?: string }>;
  countRunRowsWithEmail?: (attemptId: string) => Promise<number>;
  now?: () => Date;
}

export type ContactBankStageResult =
  | {
      status: 'no_account' | 'no_same_company_accounts' | 'error';
      satisfied: false;
      inserted: 0;
      detail?: string;
    }
  | { status: 'done'; satisfied: boolean; inserted: number; relevantWithEmail: number; siblingAccounts: number };

/**
 * ¿Esta otra ficha puede aportar contactos? Sí si está archivada (la compañía volvió a entrar)
 * o si es del mismo responsable. Una ficha activa de OTRO vendedor nunca.
 */
export function isEligibleSameCompanyAccount(candidate: ContactBankAccount, current: ContactBankAccount): boolean {
  if (candidate.id === current.id) return false;
  if (candidate.archivedAt) return true;
  return (candidate.ownerId ?? null) === (current.ownerId ?? null);
}

// ── Lecturas por defecto (service role) ─────────────────────────────────────────

type Admin = SupabaseClient;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toAccount(row: Record<string, unknown>): ContactBankAccount {
  return {
    id: String(row.id),
    ownerId: str(row.owner_id),
    archivedAt: str(row.archived_at),
    taxIdentifier: str(row.tax_identifier),
    countryCode: str(row.country_code),
    domain: str(row.domain),
    hubspotCompanyId: str(row.hubspot_company_id),
  };
}

const ACCOUNT_SELECT = 'id, owner_id, archived_at, tax_identifier, country_code, domain, hubspot_company_id';

async function defaultLoadRunRef(attemptId: string): Promise<ContactBankRunRef | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_runs')
    .select('account_id, company_domain, hubspot_company_id')
    .eq('id', attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    accountId: str(data.account_id),
    companyDomain: str(data.company_domain),
    hubspotCompanyId: str(data.hubspot_company_id),
  };
}

async function defaultLoadAccount(accountId: string): Promise<ContactBankAccount | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('accounts').select(ACCOUNT_SELECT).eq('id', accountId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toAccount(data as Record<string, unknown>) : null;
}

export function sameCompanyDomainSpellings(current: ContactBankAccount, run: ContactBankRunRef): string[] {
  return [...new Set([...buildDomainLookupSpellings(current.domain), ...buildDomainLookupSpellings(run.companyDomain)])];
}

async function defaultFindSameCompanyAccounts(
  current: ContactBankAccount,
  run: ContactBankRunRef,
): Promise<ContactBankAccount[]> {
  const admin = createSupabaseAdminClient();
  const found = new Map<string, ContactBankAccount>();
  const collect = (rows: unknown[] | null) => {
    for (const row of rows ?? []) {
      const account = toAccount(row as Record<string, unknown>);
      found.set(account.id, account);
    }
  };

  const taxId = current.taxIdentifier?.trim() ?? '';
  const country = current.countryCode?.trim() ?? '';
  if (taxId.length >= MIN_TAX_ID_LENGTH && country) {
    const { data, error } = await admin
      .from('accounts')
      .select(ACCOUNT_SELECT)
      .eq('tax_identifier', taxId)
      .eq('country_code', country)
      .limit(MAX_SIBLING_ACCOUNTS);
    if (error) throw new Error(error.message);
    collect(data);
  }

  const spellings = sameCompanyDomainSpellings(current, run);
  if (spellings.length > 0) {
    const { data, error } = await admin
      .from('accounts')
      .select(ACCOUNT_SELECT)
      .in('domain', spellings)
      .limit(MAX_SIBLING_ACCOUNTS);
    if (error) throw new Error(error.message);
    collect(data);
  }

  const hubspotId = current.hubspotCompanyId ?? run.hubspotCompanyId;
  if (hubspotId) {
    const { data, error } = await admin
      .from('accounts')
      .select(ACCOUNT_SELECT)
      .eq('hubspot_company_id', hubspotId)
      .limit(MAX_SIBLING_ACCOUNTS);
    if (error) throw new Error(error.message);
    collect(data);
  }

  return [...found.values()];
}

async function loadContactEntries(admin: Admin, siblingAccountIds: string[], since: string): Promise<ContactBankEntry[]> {
  if (siblingAccountIds.length === 0) return [];
  const { data, error } = await admin
    .from('contacts')
    .select(
      'id, account_id, first_name, last_name, full_name, job_title, department, seniority, email, linkedin_url, source, hubspot_contact_id, updated_at',
    )
    .in('account_id', siblingAccountIds)
    .in('contact_status', ['active', 'inactive'])
    .is('archived_at', null)
    .gte('updated_at', since)
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    origin: 'contact' as const,
    originId: String(row.id),
    originAccountId: str(row.account_id),
    source: str(row.source) ?? 'manual',
    sourceContactId: null,
    apolloPersonId: null,
    hubspotContactId: str(row.hubspot_contact_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    fullName: str(row.full_name),
    title: str(row.job_title),
    seniority: str(row.seniority),
    department: str(row.department),
    country: null,
    linkedinUrl: str(row.linkedin_url),
    email: str(row.email),
    confidence: null,
    foundAt: String(row.updated_at),
  }));
}

async function loadCandidateEntries(admin: Admin, query: ContactBankEntriesQuery): Promise<ContactBankEntry[]> {
  const { siblingAccountIds, domainSpellings, ownerId, since } = query;
  const runAccount = new Map<string, string | null>();
  if (siblingAccountIds.length > 0) {
    const { data, error } = await admin
      .from('contact_enrichment_runs')
      .select('id, account_id')
      .in('account_id', siblingAccountIds)
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) runAccount.set(String(row.id), str(row.account_id));
  }
  // Búsquedas sin ficha de SellUp (empresa sólo de HubSpot) del mismo dominio y del mismo vendedor.
  if (domainSpellings.length > 0 && ownerId) {
    const { data, error } = await admin
      .from('contact_enrichment_runs')
      .select('id, account_id')
      .is('account_id', null)
      .in('company_domain', domainSpellings)
      .eq('triggered_by', ownerId)
      .limit(MAX_ROWS);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) runAccount.set(String(row.id), null);
  }
  if (runAccount.size === 0) return [];

  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(
      'id, enrichment_run_id, first_name, last_name, full_name, title, seniority, department, country, linkedin_url, email, source, source_contact_id, apollo_person_id, matched_hubspot_contact_id, confidence, created_at',
    )
    .in('enrichment_run_id', [...runAccount.keys()])
    .eq('status', 'pending_review')
    .gte('created_at', since)
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    origin: 'candidate' as const,
    originId: String(row.id),
    originAccountId: runAccount.get(String(row.enrichment_run_id)) ?? null,
    source: str(row.source) ?? 'manual',
    sourceContactId: str(row.source_contact_id),
    apolloPersonId: str(row.apollo_person_id),
    hubspotContactId: str(row.matched_hubspot_contact_id),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    fullName: str(row.full_name),
    title: str(row.title),
    seniority: str(row.seniority),
    department: str(row.department),
    country: str(row.country),
    linkedinUrl: str(row.linkedin_url),
    email: str(row.email),
    confidence: typeof row.confidence === 'number' ? row.confidence : Number(row.confidence ?? 0),
    foundAt: String(row.created_at),
  }));
}

async function defaultLoadEntries(input: ContactBankEntriesQuery): Promise<ContactBankEntry[]> {
  const admin = createSupabaseAdminClient();
  const [contacts, candidates] = await Promise.all([
    loadContactEntries(admin, input.siblingAccountIds, input.since),
    loadCandidateEntries(admin, input),
  ]);
  return [...contacts, ...candidates];
}

/** Contactos de la empresa actual (cualquier estado) y candidatos pendientes de sus búsquedas. */
async function defaultLoadKnown(input: { accountId: string; attemptId: string }): Promise<ContactBankKnownPerson[]> {
  const admin = createSupabaseAdminClient();
  const [contacts, runs] = await Promise.all([
    admin.from('contacts').select('email, linkedin_url, source, hubspot_contact_id').eq('account_id', input.accountId).limit(MAX_ROWS),
    admin.from('contact_enrichment_runs').select('id').eq('account_id', input.accountId).limit(MAX_ROWS),
  ]);
  if (contacts.error) throw new Error(contacts.error.message);
  if (runs.error) throw new Error(runs.error.message);
  const runIds = [...new Set([input.attemptId, ...(runs.data ?? []).map((r) => String(r.id))])];
  const { data: candidates, error } = await admin
    .from('contact_enrichment_candidates')
    .select('email, linkedin_url, source, source_contact_id, enrichment_run_id, status')
    .in('enrichment_run_id', runIds)
    .limit(MAX_ROWS * 3);
  if (error) throw new Error(error.message);

  const known: ContactBankKnownPerson[] = (contacts.data ?? []).map((c) => ({
    email: str(c.email),
    linkedinUrl: str(c.linkedin_url),
    source: str(c.hubspot_contact_id) ? 'hubspot' : null,
    sourceContactId: str(c.hubspot_contact_id),
  }));
  for (const c of candidates ?? []) {
    // De esta corrida cuenta todo; de las anteriores, lo que la persona todavía tiene por revisar.
    if (String(c.enrichment_run_id) !== input.attemptId && c.status !== 'pending_review') continue;
    known.push({
      email: str(c.email),
      linkedinUrl: str(c.linkedin_url),
      source: str(c.source),
      sourceContactId: str(c.source_contact_id),
    });
  }
  return known;
}

async function defaultLoadDoNotContact(accountIds: string[]): Promise<ContactBankKnownPerson[]> {
  if (accountIds.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select('email, linkedin_url')
    .in('account_id', accountIds)
    .eq('contact_status', 'do_not_contact')
    .limit(MAX_ROWS);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({ email: str(c.email), linkedinUrl: str(c.linkedin_url) }));
}

async function defaultLoadSuppressedKeys(keys: string[]): Promise<Set<string>> {
  const suppressed = new Set<string>();
  if (keys.length === 0) return suppressed;
  const ids = [...new Set(keys.map((k) => k.slice(k.indexOf('::') + 2)))];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('provider_suppressions')
    .select('provider, provider_person_id, suppressed_at')
    .in('provider_person_id', ids);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (row.suppressed_at) suppressed.add(`${row.provider}::${row.provider_person_id}`);
  }
  return suppressed;
}

async function defaultInsertRows(attemptId: string, rows: ContactBankCandidateRow[]): Promise<{ error?: string }> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('contact_enrichment_candidates')
    .insert(rows.map((row) => ({ ...row, enrichment_run_id: attemptId })));
  return { error: error?.message };
}

async function defaultCountRunRowsWithEmail(attemptId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from('contact_enrichment_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('enrichment_run_id', attemptId)
    .eq('status', 'pending_review')
    .not('email', 'is', null)
    .neq('email', '');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ── Etapa ───────────────────────────────────────────────────────────────────────

export async function runContactBankStage(
  input: { attemptId: string },
  deps: ContactBankStageDeps = {},
): Promise<ContactBankStageResult> {
  const {
    loadRunRef = defaultLoadRunRef,
    loadAccount = defaultLoadAccount,
    findSameCompanyAccounts = defaultFindSameCompanyAccounts,
    loadEntries = defaultLoadEntries,
    loadKnown = defaultLoadKnown,
    loadDoNotContact = defaultLoadDoNotContact,
    loadSuppressedKeys = defaultLoadSuppressedKeys,
    insertRows = defaultInsertRows,
    countRunRowsWithEmail = defaultCountRunRowsWithEmail,
    now = () => new Date(),
  } = deps;

  try {
    const run = await loadRunRef(input.attemptId);
    if (!run?.accountId) return { status: 'no_account', satisfied: false, inserted: 0 };
    const current = await loadAccount(run.accountId);
    if (!current) return { status: 'no_account', satisfied: false, inserted: 0 };

    const siblings = (await findSameCompanyAccounts(current, run)).filter((a) => isEligibleSameCompanyAccount(a, current));
    const domainSpellings = sameCompanyDomainSpellings(current, run);
    if (siblings.length === 0 && domainSpellings.length === 0) {
      return { status: 'no_same_company_accounts', satisfied: false, inserted: 0 };
    }

    const today = now();
    const since = new Date(today.getTime() - CONTACT_BANK_TTL_DAYS * DAY_MS).toISOString();
    const siblingAccountIds = siblings.map((a) => a.id);
    const entries = await loadEntries({ siblingAccountIds, domainSpellings, ownerId: current.ownerId, since });

    let inserted = 0;
    if (entries.length > 0) {
      const [known, doNotContact, suppressedProviderKeys] = await Promise.all([
        loadKnown({ accountId: current.id, attemptId: input.attemptId }),
        loadDoNotContact([current.id, ...siblingAccountIds]),
        loadSuppressedKeys(entries.flatMap((e) => contactBankEntryIdentities(e).map(suppressionKey))),
      ]);
      const selection = selectContactBankCandidates({
        entries,
        known,
        blocklist: { doNotContact, suppressedProviderKeys },
        now: today,
      });
      if (selection.rows.length > 0) {
        const { error } = await insertRows(input.attemptId, selection.rows);
        if (error) return { status: 'error', satisfied: false, inserted: 0, detail: error };
        inserted = selection.rows.length;
      }
    }

    // Lo que ya había en la corrida (HubSpot o un reintento) también cuenta para «bastan», pero
    // sólo si el banco aportó algo: si no, el mérito no es suyo y Apollo corre como siempre.
    const relevantWithEmail = await countRunRowsWithEmail(input.attemptId);
    return {
      status: 'done',
      satisfied: inserted > 0 && isSatisfiedByContactBank(relevantWithEmail),
      inserted,
      relevantWithEmail,
      siblingAccounts: siblings.length,
    };
  } catch (err) {
    return { status: 'error', satisfied: false, inserted: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}
