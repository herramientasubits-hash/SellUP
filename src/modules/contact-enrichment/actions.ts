'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveCompanyForContactEnrichment } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { startContactEnrichmentRun } from '@/server/agents/contact-enrichment-toolkit/contact-enrichment-runner';
import type { Agent2AInput, CompanyResolutionResult, ContactEnrichmentRunResult } from './types';

// ── Auth helper (patrón idéntico a prospect-batches/actions.ts) ───────────────

async function requireActiveUserForEnrichment(): Promise<{ internalUserId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (process.env.NODE_ENV === 'development') {
      const { data: devUser } = await supabase
        .from('internal_users')
        .select('id')
        .eq('access_status', 'active')
        .limit(1)
        .single();
      if (devUser) return { internalUserId: devUser.id };
    }
    redirect('/login');
  }

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) {
    if (process.env.NODE_ENV === 'development') {
      const { data: fallback } = await supabase
        .from('internal_users')
        .select('id')
        .eq('access_status', 'active')
        .limit(1)
        .single();
      if (fallback) return { internalUserId: fallback.id };
    }
    redirect('/login');
  }

  return { internalUserId: internalUser.id };
}

// ── Validación de input ───────────────────────────────────────

function validateAgent2AInput(input: unknown): Agent2AInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Input inválido');
  }

  const raw = input as Record<string, unknown>;
  const result: Agent2AInput = {};

  if (typeof raw.companyName === 'string' && raw.companyName.trim()) {
    result.companyName = raw.companyName.trim();
  }
  if (typeof raw.companyDomain === 'string' && raw.companyDomain.trim()) {
    result.companyDomain = raw.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  }
  if (typeof raw.companyCountryCode === 'string' && raw.companyCountryCode.trim()) {
    result.companyCountryCode = raw.companyCountryCode.trim().toUpperCase();
  }
  if (typeof raw.hubspotCompanyId === 'string' && raw.hubspotCompanyId.trim()) {
    result.hubspotCompanyId = raw.hubspotCompanyId.trim();
  }
  if (typeof raw.sellupAccountId === 'string' && raw.sellupAccountId.trim()) {
    result.sellupAccountId = raw.sellupAccountId.trim();
  }

  const hasIdentifier =
    result.companyName ||
    result.companyDomain ||
    result.hubspotCompanyId ||
    result.sellupAccountId;

  if (!hasIdentifier) {
    throw new Error('Debes proveer al menos un identificador: nombre, dominio, HubSpot ID o SellUp Account ID');
  }

  return result;
}

// ── Server Actions ────────────────────────────────────────────

export interface ResolveCompanyActionResult {
  success: boolean;
  data?: CompanyResolutionResult;
  error?: string;
}

export async function resolveContactEnrichmentCompanyAction(
  rawInput: unknown
): Promise<ResolveCompanyActionResult> {
  try {
    await requireActiveUserForEnrichment();
    const input = validateAgent2AInput(rawInput);
    const result = await resolveCompanyForContactEnrichment(input);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error resolviendo empresa';
    // No exponemos stack trace
    return { success: false, error: message };
  }
}

export interface StartEnrichmentRunActionResult {
  success: boolean;
  data?: ContactEnrichmentRunResult;
  error?: string;
}

export async function startContactEnrichmentRunAction(
  rawInput: unknown
): Promise<StartEnrichmentRunActionResult> {
  try {
    const { internalUserId } = await requireActiveUserForEnrichment();
    const input = validateAgent2AInput(rawInput);

    // Necesitamos la empresa confirmada — re-resolvemos o la recibimos serializada
    const raw = rawInput as Record<string, unknown>;
    const confirmedCompanyRaw = raw.confirmedCompany;

    if (!confirmedCompanyRaw || typeof confirmedCompanyRaw !== 'object') {
      throw new Error('Falta la empresa confirmada para iniciar el run');
    }

    const confirmedCompany = confirmedCompanyRaw as {
      source: 'sellup' | 'hubspot' | 'manual';
      name: string;
      domain?: string | null;
      countryCode?: string | null;
      hubspotCompanyId?: string;
      sellupAccountId?: string;
      matchConfidence: number;
    };

    if (!confirmedCompany.name?.trim()) {
      throw new Error('La empresa confirmada no tiene nombre');
    }

    const result = await startContactEnrichmentRun({
      confirmedCompany,
      originalInput: input,
      triggeredBy: internalUserId,
    });

    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error iniciando run de enriquecimiento';
    return { success: false, error: message };
  }
}
