// Agente 2A — Existing Contacts Reader
// Hito 17A.2A — Lee contactos existentes en SellUp y HubSpot para deduplicación.
// Solo lectura. No crea candidatos. No llama Apollo/Lusha.

import { createClient as createAdminClient } from '@supabase/supabase-js';
import type {
  ExistingContactSnapshot,
  ExistingContactsSourceResult,
  ExistingContactsCombined,
  ExistingContactsSnapshotResult,
} from '@/modules/contact-enrichment/types';
import { readHubSpotContactsForCompany } from '@/server/integrations/hubspot-contacts-reader';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Input ─────────────────────────────────────────────────────

export interface ExistingContactsReaderInput {
  accountId?: string | null;
  hubspotCompanyId?: string | null;
}

// ── Dependency injection (para tests) ─────────────────────────

export interface ExistingContactsReaderDeps {
  readSellUp?: (accountId: string) => Promise<ExistingContactsSourceResult>;
  readHubSpot?: (hubspotCompanyId: string) => Promise<ExistingContactsSourceResult>;
}

// ── SellUp contacts ───────────────────────────────────────────

async function defaultReadSellUpContacts(accountId: string): Promise<ExistingContactsSourceResult> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('contacts')
    .select(
      'id, first_name, last_name, full_name, email, phone, mobile_phone, linkedin_url, job_title'
    )
    .eq('account_id', accountId)
    .is('archived_at', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    return { status: 'error', contacts: [], count: 0, reason: error.message };
  }

  const contacts: ExistingContactSnapshot[] = (data ?? []).map((row) => {
    const phone = (row.phone as string | null)?.trim() || (row.mobile_phone as string | null)?.trim() || null;
    return {
      id: row.id as string,
      source: 'sellup',
      fullName: row.full_name as string,
      firstName: row.first_name as string | null,
      lastName: row.last_name as string | null,
      email: (row.email as string | null)?.trim().toLowerCase() || null,
      phone: phone || null,
      linkedinUrl: (row.linkedin_url as string | null)?.trim() || null,
      title: (row.job_title as string | null)?.trim() || null,
      completeness: {
        hasEmail: !!(row.email as string | null),
        hasPhone: !!(row.phone as string | null) || !!(row.mobile_phone as string | null),
        hasLinkedin: !!(row.linkedin_url as string | null),
      },
    };
  });

  return { status: 'success', contacts, count: contacts.length };
}

// ── Combine + dedup determinístico ────────────────────────────

function combineSnapshots(
  sellup: ExistingContactsSourceResult,
  hubspot: ExistingContactsSourceResult
): ExistingContactsCombined {
  const allContacts = [...sellup.contacts, ...hubspot.contacts];

  const seenEmails = new Set<string>();
  const seenLinkedins = new Set<string>();
  const seenNames = new Set<string>();
  const uniqueEmails: string[] = [];
  const uniqueLinkedins: string[] = [];
  const uniqueNames: string[] = [];
  let totalUnique = 0;

  for (const c of allContacts) {
    const emailKey = c.email?.toLowerCase().trim();
    const linkedinKey = c.linkedinUrl?.toLowerCase().trim().replace(/\/$/, '');
    const nameKey = c.fullName?.toLowerCase().trim();

    const newByEmail = emailKey && !seenEmails.has(emailKey);
    const newByLinkedin = linkedinKey && !seenLinkedins.has(linkedinKey);
    const newByName = !emailKey && !linkedinKey && nameKey && !seenNames.has(nameKey);

    if (newByEmail || newByLinkedin || newByName) {
      totalUnique++;
    }

    if (emailKey && !seenEmails.has(emailKey)) {
      seenEmails.add(emailKey);
      uniqueEmails.push(emailKey);
    }
    if (linkedinKey && !seenLinkedins.has(linkedinKey)) {
      seenLinkedins.add(linkedinKey);
      uniqueLinkedins.push(linkedinKey);
    }
    if (nameKey && !seenNames.has(nameKey)) {
      seenNames.add(nameKey);
      uniqueNames.push(c.fullName);
    }
  }

  const missingEmail = allContacts.filter((c) => !c.completeness.hasEmail).length;
  const missingPhone = allContacts.filter((c) => !c.completeness.hasPhone).length;
  const missingLinkedin = allContacts.filter((c) => !c.completeness.hasLinkedin).length;

  return {
    totalExistingContacts: totalUnique,
    existingContactNames: uniqueNames,
    existingEmails: uniqueEmails,
    existingLinkedinUrls: uniqueLinkedins,
    incompleteContacts: { missingEmail, missingPhone, missingLinkedin },
    sourceCounts: { sellup: sellup.count, hubspot: hubspot.count },
  };
}

// ── Función principal ─────────────────────────────────────────

/**
 * Lee contactos existentes de SellUp y HubSpot para construir el snapshot
 * de deduplicación antes de llamar a Apollo o Lusha.
 *
 * Si no hay accountId → SellUp skipped.
 * Si no hay hubspotCompanyId → HubSpot skipped.
 * Si HubSpot falla → error controlado, el run no se rompe.
 */
export async function readExistingContactsForCompany(
  input: ExistingContactsReaderInput,
  deps: ExistingContactsReaderDeps = {}
): Promise<ExistingContactsSnapshotResult> {
  const {
    readSellUp = defaultReadSellUpContacts,
    readHubSpot = readHubSpotContactsForCompany,
  } = deps;

  const sellupResult: ExistingContactsSourceResult = input.accountId
    ? await readSellUp(input.accountId)
    : {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: 'Sin account ID de SellUp',
      };

  const hubspotResult: ExistingContactsSourceResult = input.hubspotCompanyId
    ? await readHubSpot(input.hubspotCompanyId)
    : {
        status: 'skipped',
        contacts: [],
        count: 0,
        reason: 'Sin HubSpot Company ID',
      };

  const combined = combineSnapshots(sellupResult, hubspotResult);

  return { sellup: sellupResult, hubspot: hubspotResult, combined };
}
