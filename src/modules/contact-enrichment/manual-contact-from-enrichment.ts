// Server action — Hito 17A.7C
// Crea un contacto oficial (source='manual') desde el empty state Apollo.
// No toca Apollo, Lusha, HubSpot, ni contact_enrichment_candidates.
// Funciones puras separadas en manual-contact-from-enrichment-core.ts.

'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { logContactAudit } from '@/modules/contacts/actions';
import type { ExistingContactForDedup } from './candidate-review-core';
import {
  validateManualContactInput,
  checkManualContactDuplicate,
} from './manual-contact-from-enrichment-core';

// ── Input ──────────────────────────────────────────────────────────────────

export interface ManualContactFromEnrichmentInput {
  account_id: string;
  full_name: string;
  job_title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
  /** Trazabilidad del run que originó el CTA. */
  contact_enrichment_run_id: string;
  company_name?: string | null;
  company_domain?: string | null;
}

// ── Result ─────────────────────────────────────────────────────────────────

export type ManualContactFromEnrichmentResult =
  | { ok: true; contactId: string }
  | { ok: false; errorCode: 'VALIDATION' | 'DUPLICATE' | 'DB_ERROR' | 'AUTH_ERROR'; message: string; duplicateContactId?: string };

// ── Auth helper ────────────────────────────────────────────────────────────

async function requireActiveUser(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

// ── Server action ──────────────────────────────────────────────────────────

export async function createManualContactFromEnrichmentEmptyState(
  input: ManualContactFromEnrichmentInput,
): Promise<ManualContactFromEnrichmentResult> {
  let internalUserId: string;
  try {
    ({ internalUserId } = await requireActiveUser());
  } catch {
    return { ok: false, errorCode: 'AUTH_ERROR', message: 'Sesión no válida.' };
  }

  // Validate
  const validation = validateManualContactInput(input);
  if (!validation.valid) {
    return { ok: false, errorCode: 'VALIDATION', message: validation.errors.join(' ') };
  }

  const supabase = await createClient();

  // Verify account exists
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', input.account_id)
    .single();
  if (!account) {
    return { ok: false, errorCode: 'VALIDATION', message: 'Cuenta no encontrada.' };
  }

  // Load existing contacts for dedup
  const { data: existing } = await supabase
    .from('contacts')
    .select('id, email, linkedin_url, full_name')
    .eq('account_id', input.account_id)
    .is('archived_at', null);

  const existingContacts = (existing ?? []) as ExistingContactForDedup[];

  // Dedup check
  const dupCheck = checkManualContactDuplicate(
    { full_name: input.full_name, email: input.email ?? null, linkedin_url: input.linkedin_url ?? null },
    existingContacts,
  );
  if (dupCheck.isDuplicate) {
    const label =
      dupCheck.matchedBy === 'email'
        ? 'email'
        : dupCheck.matchedBy === 'linkedin'
          ? 'LinkedIn'
          : 'nombre';
    return {
      ok: false,
      errorCode: 'DUPLICATE',
      message: `Ya existe un contacto con el mismo ${label} en esta cuenta.`,
      duplicateContactId: dupCheck.contactId,
    };
  }

  const fullName = input.full_name.trim();
  const parts = fullName.split(' ');
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;

  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  const linkedinUrl = input.linkedin_url?.trim() || null;
  const jobTitle = input.job_title?.trim() || null;
  const notes = input.notes?.trim() || null;

  const metadata: Record<string, unknown> = {
    created_from: 'contact_enrichment_empty_state',
    contact_enrichment_run_id: input.contact_enrichment_run_id,
    apollo_result_empty: true,
  };
  if (input.company_name) metadata.company_name = input.company_name;
  if (input.company_domain) metadata.company_domain = input.company_domain;

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      account_id: input.account_id,
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      linkedin_url: linkedinUrl,
      job_title: jobTitle,
      notes,
      source: 'manual' as const,
      contact_status: 'active' as const,
      is_primary: false,
      metadata,
      created_by: internalUserId,
      updated_by: internalUserId,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, errorCode: 'DB_ERROR', message: error.message };
  }

  await logContactAudit({
    contactId: data.id,
    accountId: input.account_id,
    actorUserId: internalUserId,
    actionType: 'contact_created',
    details: {
      full_name: fullName,
      source: 'manual',
      created_from: 'contact_enrichment_empty_state',
      contact_enrichment_run_id: input.contact_enrichment_run_id,
    },
  });

  return { ok: true, contactId: data.id };
}
