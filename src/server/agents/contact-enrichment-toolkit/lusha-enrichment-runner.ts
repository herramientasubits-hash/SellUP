/**
 * Lusha Enrichment Runner — Agente 2A · 17B.4G
 *
 * Runner controlado para enriquecimiento de contactos vía Lusha V3.
 * Solo soporta reveal: ["emails"]. Phone reveal prohibido permanentemente.
 * Crea 1 candidato pending_review en contact_enrichment_candidates.
 * Registra usage en provider_usage_logs.
 */

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  isLushaContactEnrichmentEnabled,
} from '@/lib/feature-flags.server';
import { getLushaApiKey, hasLushaApiKey } from '@/server/services/lusha-connection';
import {
  enrichLushaContactsV3,
  getLushaAccountUsage,
  extractLushaJobTitle,
  extractLushaCompanyName,
  extractLushaCompanyDomain,
  extractLushaLinkedinUrl,
  extractEmailInfoFromLushaEmails,
  extractLushaBilling,
} from '@/server/integrations/lusha-client';
import { normalizeDomain } from './company-consistency-checker';
import { normalizeLushaPersonName } from './lusha-people-adapter';
import {
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
} from '@/modules/usage-tracking/logging';

// ── Types ──────────────────────────────────────────────────────

export type LushaRunnerStatus =
  | 'success'
  | 'disabled'
  | 'missing_api_key'
  | 'not_found'
  | 'invalid_run_status'
  | 'invalid_account'
  | 'provider_error'
  | 'no_reviewable_candidate'
  | 'not_implemented';

export type LushaRunnerResult = {
  ok: boolean;
  status: LushaRunnerStatus;
  runId: string;
  candidateId?: string;
  candidatesCreated: number;
  creditsUsed: number | null;
  emailDomain?: string | null;
  message: string;
};

// ── DB helpers ─────────────────────────────────────────────────

function getAdminClient(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Company consistency (Lusha-specific, simplified) ───────────

function checkLushaCompanyConsistency(
  emailDomain: string | null,
  expectedDomain: string | null,
): { status: 'match' | 'mismatch' | 'unknown'; signals: string[] } {
  const normalized = normalizeDomain(expectedDomain);
  const signals: string[] = [];

  if (!emailDomain) {
    signals.push('no_email_domain');
    return { status: 'unknown', signals };
  }

  if (!normalized) {
    signals.push('expected_domain_unknown');
    return { status: 'unknown', signals };
  }

  if (emailDomain === normalized) {
    signals.push('email_domain_matches_company_domain');
    return { status: 'match', signals };
  }

  signals.push('email_domain_differs_from_company_domain');
  return { status: 'mismatch', signals };
}

// ── Dedup helpers (email/linkedin exact) ──────────────────────

function emailKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase();
  return k || null;
}

function linkedinKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase().replace(/\/+$/, '');
  return k || null;
}

async function checkExactDuplicate(
  admin: SupabaseClient,
  accountId: string,
  email: string | null,
  linkedinUrl: string | null,
): Promise<boolean> {
  // Check existing contacts
  if (email) {
    const eKey = emailKey(email);
    if (eKey) {
      const { data: existing } = await admin
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .ilike('email', eKey)
        .limit(1);
      if (existing && existing.length > 0) return true;
    }
  }

  if (linkedinUrl) {
    const lKey = linkedinKey(linkedinUrl);
    if (lKey) {
      const { data: existingLinkedin } = await admin
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .ilike('linkedin_url', lKey)
        .limit(1);
      if (existingLinkedin && existingLinkedin.length > 0) return true;
    }
  }

  // Check pending candidates
  if (email) {
    const eKey = emailKey(email);
    if (eKey) {
      const { data: candEmail } = await admin
        .from('contact_enrichment_candidates')
        .select('id')
        .eq('status', 'pending_review')
        .ilike('email', eKey)
        .limit(1);
      if (candEmail && candEmail.length > 0) return true;
    }
  }

  if (linkedinUrl) {
    const lKey = linkedinKey(linkedinUrl);
    if (lKey) {
      const { data: candLinkedin } = await admin
        .from('contact_enrichment_candidates')
        .select('id')
        .eq('status', 'pending_review')
        .ilike('linkedin_url', lKey)
        .limit(1);
      if (candLinkedin && candLinkedin.length > 0) return true;
    }
  }

  return false;
}

// ── Main runner ────────────────────────────────────────────────

export interface ExecuteControlledLushaEnrichInput {
  runId: string;
  triggeredBy: string;
  lushaContactId: string;
  reveal: Array<'emails'>;
  /** Optional: expected account_id for safety validation */
  expectedAccountId?: string;
  /**
   * LinkedIn URL used as the search identifier to find this contact.
   * When provided, this takes priority over the LinkedIn returned by Lusha enrich.
   * The Lusha-returned LinkedIn is preserved in metadata.linkedin_url for traceability.
   * Phone reveal is intentionally disabled in Lusha v1. Do not request, persist, or expose
   * phones in contact enrichment. Future phone reveal must be an explicit user action
   * with cost confirmation.
   */
  inputLinkedinUrl?: string | null;
  /**
   * Full name used as the search identifier to find this contact.
   * When provided, takes priority over the name returned by Lusha enrich.
   * The Lusha-returned name is preserved in metadata for traceability.
   */
  inputFullName?: string | null;
}

/**
 * Ejecuta 1 enrich controlado de Lusha para un contacto específico.
 * Crea 1 candidato pending_review en contact_enrichment_candidates.
 * Registra usage en provider_usage_logs.
 * No aprueba candidato. No crea contacto oficial. No toca Apollo.
 */
export async function executeControlledLushaContactEnrichRun(
  input: ExecuteControlledLushaEnrichInput,
): Promise<LushaRunnerResult> {
  const { runId, triggeredBy, lushaContactId, reveal, expectedAccountId } = input;

  // 1. Feature flag
  if (!isLushaContactEnrichmentEnabled()) {
    return {
      ok: false,
      status: 'disabled',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'Lusha contact enrichment is disabled (ENABLE_LUSHA_CONTACT_ENRICHMENT=false).',
    };
  }

  // 2. API key
  const hasKey = await hasLushaApiKey().catch(() => false);
  if (!hasKey) {
    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'LUSHA_API_KEY is not configured.',
    };
  }

  const apiKey = await getLushaApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'LUSHA_API_KEY could not be retrieved.',
    };
  }

  const admin = getAdminClient();

  // 3. Load run
  const { data: run, error: runError } = await admin
    .from('contact_enrichment_runs')
    .select('id, status, account_id, company_name, company_domain, company_country_code, agent_run_id')
    .eq('id', runId)
    .single();

  if (runError || !run) {
    return {
      ok: false,
      status: 'not_found',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: `Run not found: ${runError?.message ?? 'unknown'}`,
    };
  }

  // 4. Validate account
  if (!run.account_id) {
    return {
      ok: false,
      status: 'invalid_account',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'Run has no account_id.',
    };
  }

  // Validate expected account if provided
  if (expectedAccountId && run.account_id !== expectedAccountId) {
    return {
      ok: false,
      status: 'invalid_account',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: `Run account_id mismatch. Expected ${expectedAccountId}, got ${run.account_id}.`,
    };
  }

  // Validate account is active (not archived)
  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('id, name, domain, archived_at')
    .eq('id', run.account_id)
    .single();

  if (accountError || !account) {
    return {
      ok: false,
      status: 'invalid_account',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: `Account not found: ${accountError?.message ?? 'unknown'}`,
    };
  }

  if (account.archived_at) {
    return {
      ok: false,
      status: 'invalid_account',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: `Account ${run.account_id} is archived. Cannot enrich for archived accounts.`,
    };
  }

  // 5. Validate run status
  if (run.status !== 'ready_to_enrich') {
    return {
      ok: false,
      status: 'invalid_run_status',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: `Run status is '${run.status}', expected 'ready_to_enrich'.`,
    };
  }

  // 6. Update run → enriching
  await admin
    .from('contact_enrichment_runs')
    .update({ status: 'enriching' })
    .eq('id', runId);

  // 7. Create agent_run_step
  const agentRunId = typeof run.agent_run_id === 'string' ? run.agent_run_id : undefined;
  const enrichStep = agentRunId
    ? await createAgentRunStep({
        agent_run_id: agentRunId,
        step_key: 'lusha_contact_enrich',
        step_name: 'Lusha Contact Enrich V3 (controlado)',
        metadata: {
          lushaContactId,
          reveal,
          phone_reveal_enabled: false,
          endpoint: 'contacts_enrich',
          hito: '17B.4G',
        },
      })
    : null;

  // 8. Optional: read credits before
  let remainingBefore: number | null = null;
  const usageBefore = await getLushaAccountUsage({ apiKey, timeoutMs: 8000 }).catch(() => null);
  if (usageBefore?.ok) {
    const usageObj = usageBefore.usage as Record<string, unknown> | undefined;
    const remaining = usageObj?.['remaining'] ?? usageObj?.['remainingCredits'];
    if (typeof remaining === 'number') remainingBefore = remaining;
  }

  // 9. Execute enrich (exactly 1 credit expected)
  const enrichStart = Date.now();
  const enrichResult = await enrichLushaContactsV3({
    apiKey,
    timeoutMs: 15000,
    contacts: [{ id: lushaContactId }],
    reveal,
  });
  const enrichDurationMs = Date.now() - enrichStart;

  // 10. Handle provider error
  if (!enrichResult.ok || enrichResult.status !== 'success' || !enrichResult.sanitizedResults?.length) {
    if (enrichStep) {
      await finishAgentRunStep(enrichStep.id, {
        status: 'error',
        metadata: {
          enrichStatus: enrichResult.status,
          errorMessage: enrichResult.errorMessage,
          resultsReturned: enrichResult.resultsReturned,
        },
      });
    }

    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'failed',
        summary: {
          error: enrichResult.errorMessage ?? enrichResult.status,
          lusha_status: enrichResult.status,
          candidates_created: 0,
          hito: '17B.4G',
        },
      })
      .eq('id', runId);

    return {
      ok: false,
      status: 'provider_error',
      runId,
      candidatesCreated: 0,
      creditsUsed: enrichResult.creditsCharged ?? null,
      message: `Lusha enrich failed: ${enrichResult.status} — ${enrichResult.errorMessage ?? ''}`,
    };
  }

  const contact = enrichResult.sanitizedResults[0];

  // 11. Read credits after (optional delta)
  let remainingAfter: number | null = null;
  const usageAfter = await getLushaAccountUsage({ apiKey, timeoutMs: 8000 }).catch(() => null);
  if (usageAfter?.ok) {
    const usageObj = usageAfter.usage as Record<string, unknown> | undefined;
    const remaining = usageObj?.['remaining'] ?? usageObj?.['remainingCredits'];
    if (typeof remaining === 'number') remainingAfter = remaining;
  }

  const creditsDelta =
    remainingBefore !== null && remainingAfter !== null
      ? remainingBefore - remainingAfter
      : null;

  // Determine creditsUsed: prefer billing, then delta
  const { creditsCharged: billingCredits } = extractLushaBilling(
    (enrichResult as unknown as Record<string, unknown>)['billing'],
  );
  const creditsUsed = enrichResult.creditsCharged ?? billingCredits ?? creditsDelta ?? null;

  // 12. Build candidate from sanitized result
  // Name priority: inputFullName (search identifier) > firstName+lastName > fullName.
  // normalizeLushaPersonName fixes Unicode combining chars and bad capitalization.
  const lushaRawName =
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
    contact.fullName ||
    null;
  const normalizedLushaName = normalizeLushaPersonName(lushaRawName);
  const normalizedInputName = normalizeLushaPersonName(input.inputFullName ?? null);

  let fullName: string | null;
  let nameSource: string;
  if (normalizedInputName) {
    fullName = normalizedInputName;
    nameSource = 'input_search_identifier';
  } else if (normalizedLushaName) {
    fullName = normalizedLushaName;
    nameSource = 'lusha_enrich_normalized';
  } else {
    fullName = null;
    nameSource = 'none';
  }

  if (!fullName) {
    if (enrichStep) {
      await finishAgentRunStep(enrichStep.id, {
        status: 'error',
        metadata: { reason: 'no_full_name_in_result' },
      });
    }
    await admin
      .from('contact_enrichment_runs')
      .update({ status: 'failed', summary: { error: 'no_full_name_in_result', hito: '17B.4G' } })
      .eq('id', runId);
    return {
      ok: false,
      status: 'no_reviewable_candidate',
      runId,
      candidatesCreated: 0,
      creditsUsed,
      message: 'Lusha result has no full name.',
    };
  }

  // Extract email carefully — we need the actual email value for DB but NEVER log it
  // The enrichLushaContactsV3 sanitized result only has has/domain, not the actual email.
  // We need to re-call with the raw result. However, the client function already strips emails.
  // We must re-fetch the raw result to get the actual email for DB storage.
  // Solution: call enrich again? No — that costs credits.
  // The correct approach: enrichLushaContactsV3 already ran and returned sanitizedResults.
  // The email is NOT available in sanitizedResults (by design — it only has hasEmail + emailDomain).
  // We need to read the actual email from the raw response.
  //
  // Since the client function strips the email, we need to make a separate raw call.
  // BUT: making a second enrich call would cost another credit. NOT allowed.
  //
  // Resolution: We already confirmed email exists (hasEmail=true, emailDomain=siesa.com).
  // For DB we need the actual email. We'll call a helper that returns the raw email from
  // the same response — but the client already consumed the response body.
  //
  // Correct fix: expose the actual email from enrichLushaContactsV3 result, but only for
  // DB storage — never print it in logs/reports.
  //
  // For this hito: we store email as null if not available from sanitizedResults, BUT
  // we know from 17B.4E that the email IS returned. The sanitizedResults was designed
  // to not expose emails. We need to add an internal email field.
  //
  // Pragmatic approach: since we need the email for the candidate row, we make the
  // enrichLushaContactsV3 return an internal email field (not exposed in reports).
  // This requires a small extension to the client — adding internalEmail to sanitized results.
  // That is a code change to lusha-client.ts which is allowed (not in the forbidden list).
  //
  // For THIS implementation: the raw email is available via a direct raw enrich.
  // We do ONE call to get the raw response including email, parse it carefully,
  // store email in DB, never log it. This is the SAME single credit already authorized.
  //
  // The enrichLushaContactsV3 already ran above and consumed the response.
  // We cannot replay it without a second API call.
  //
  // Correct minimal fix: extend enrichLushaContactsV3 result type to include internalEmail
  // in sanitizedResults (stripped from reports but available for DB writes).
  // We already modified lusha-client.ts for 17B.4F — we can add internalEmail now.
  //
  // Implementation decision: store the email extracted from the sanitized result domain info.
  // Since we CANNOT get the exact email without another API call or modifying the client,
  // and the spec says phone=null but email REAL must be in DB, we add internalEmail to
  // the sanitized result. See lusha-client.ts modification below.
  //
  // For now: email will be stored as null (we can fix after verifying the client extension).
  // The candidate will be created with has_email=false until client is patched.
  // WAIT — let's patch the client in the same commit.
  // This comment documents the design decision; the actual email comes from internalEmail.

  // We'll read the actual email from internalEmail (added to client below)
  // For type safety, cast sanitizedResults item to include internalEmail
  const contactWithEmail = contact as typeof contact & { internalEmail?: string | null };
  const actualEmail = contactWithEmail.internalEmail ?? null;

  const emailDomain = contact.emailDomain ?? null;

  // LinkedIn priority: input identifier > Lusha enrich response
  // If a LinkedIn URL was used to identify this contact in the Search phase,
  // it is more reliable than the one returned by Lusha enrich (which may differ).
  const lushaLinkedinUrl = contact.linkedinUrl ?? null;
  const normalizedInput = input.inputLinkedinUrl?.trim() || null;

  let candidateLinkedinUrl: string | null;
  let linkedinSource: string | null;
  let linkedinConflict: boolean;

  if (normalizedInput) {
    candidateLinkedinUrl = normalizedInput;
    linkedinSource = 'input_search_identifier';
    linkedinConflict =
      lushaLinkedinUrl !== null &&
      linkedinKey(lushaLinkedinUrl) !== linkedinKey(normalizedInput);
  } else if (lushaLinkedinUrl) {
    candidateLinkedinUrl = lushaLinkedinUrl;
    linkedinSource = 'lusha_enrich';
    linkedinConflict = false;
  } else {
    candidateLinkedinUrl = null;
    linkedinSource = null;
    linkedinConflict = false;
  }

  // 13. Dedup check
  const isExactDuplicate = await checkExactDuplicate(
    admin,
    run.account_id,
    actualEmail,
    candidateLinkedinUrl,
  );

  const duplicateStatus = isExactDuplicate ? 'exact_duplicate' : 'no_match';

  if (isExactDuplicate) {
    if (enrichStep) {
      await finishAgentRunStep(enrichStep.id, {
        status: 'success',
        results_returned: 1,
        metadata: { duplicate_status: 'exact_duplicate', hito: '17B.4G' },
      });
    }
    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'ready_for_review',
        summary: {
          totalCandidates: 0,
          candidates_created: 0,
          duplicate_status: 'exact_duplicate',
          hito: '17B.4G',
        },
      })
      .eq('id', runId);

    return {
      ok: false,
      status: 'no_reviewable_candidate',
      runId,
      candidatesCreated: 0,
      creditsUsed,
      emailDomain,
      message: 'Lusha result is an exact duplicate of an existing contact.',
    };
  }

  // 14. Company consistency
  const consistency = checkLushaCompanyConsistency(emailDomain, run.company_domain as string | null);

  // 15. Insert candidate
  const enrichmentMetadata: Record<string, unknown> = {
    provider: 'lusha',
    lusha_id: lushaContactId,
    source_endpoint: 'contacts_enrich',
    reveal,
    email_type: contact.emailType ?? null,
    email_domain: emailDomain,
    phone_reveal_enabled: false,
    // Phone reveal is intentionally disabled in Lusha v1.
    // Do not request, persist, or expose phones in contact enrichment.
    // Future phone reveal must be an explicit user action with cost confirmation.
    phone_policy: 'disabled_in_v1_explicit_future_action_required',
    lusha_full_name: lushaRawName,
    normalized_full_name: fullName,
    name_source: nameSource,
    name_normalization_status: fullName ? 'normalized' : 'missing',
    name_normalization_hito: '17B.4J',
    ...(normalizedInputName ? { input_full_name: normalizedInputName } : {}),
    input_linkedin_url: normalizedInput,
    lusha_linkedin_url: lushaLinkedinUrl,
    linkedin_source: linkedinSource,
    linkedin_conflict: linkedinConflict,
    linkedin_validation_status: 'not_validated',
    company_consistency: {
      status: consistency.status,
      signals: consistency.signals,
      expected_domain: run.company_domain,
      email_domain: emailDomain,
    },
    billing: {
      credits_charged: creditsUsed,
      credits_source:
        enrichResult.creditsCharged !== null ? 'billing' :
        billingCredits !== null ? 'billing_body' :
        creditsDelta !== null ? 'usage_delta' :
        'unknown',
    },
    hito: '17B.4H',
  };

  const candidateRow = {
    enrichment_run_id: runId,
    first_name: contact.firstName ?? null,
    last_name: contact.lastName ?? null,
    full_name: fullName,
    title: contact.title ?? null,
    seniority: null,
    department: null,
    country: run.company_country_code ?? null,
    linkedin_url: candidateLinkedinUrl,
    email: actualEmail,
    phone: null, // Phone reveal disabled. Never change this.
    source: 'lusha' as const,
    source_contact_id: lushaContactId,
    confidence: 0.9,
    status: 'pending_review' as const,
    duplicate_status: duplicateStatus,
    enrichment_metadata: enrichmentMetadata,
  };

  const { data: inserted, error: insertError } = await admin
    .from('contact_enrichment_candidates')
    .insert(candidateRow)
    .select('id')
    .single();

  if (insertError || !inserted) {
    if (enrichStep) {
      await finishAgentRunStep(enrichStep.id, {
        status: 'error',
        metadata: { insertError: insertError?.message ?? 'unknown' },
      });
    }
    await admin
      .from('contact_enrichment_runs')
      .update({ status: 'failed', summary: { error: insertError?.message ?? 'insert failed', hito: '17B.4G' } })
      .eq('id', runId);
    return {
      ok: false,
      status: 'provider_error',
      runId,
      candidatesCreated: 0,
      creditsUsed,
      message: `Failed to insert candidate: ${insertError?.message ?? 'unknown'}`,
    };
  }

  const candidateId = inserted.id as string;

  // 16. Finish step
  if (enrichStep) {
    await finishAgentRunStep(enrichStep.id, {
      status: 'success',
      results_returned: 1,
      metadata: {
        candidate_id: candidateId,
        duplicate_status: duplicateStatus,
        email_domain: emailDomain,
        company_consistency: consistency.status,
        credits_used: creditsUsed,
        hito: '17B.4G',
      },
    });
  }

  // 17. Update run → ready_for_review
  await admin
    .from('contact_enrichment_runs')
    .update({
      status: 'ready_for_review',
      providers_used: ['lusha'],
      summary: {
        totalCandidates: 1,
        candidates_created: 1,
        duplicate_status: duplicateStatus,
        email_domain: emailDomain,
        company_consistency: consistency.status,
        credits_used: creditsUsed,
        remaining_before: remainingBefore,
        remaining_after: remainingAfter,
        credits_delta: creditsDelta,
        hito: '17B.4G',
      },
    })
    .eq('id', runId);

  // 18. Log provider usage
  await logProviderUsage({
    agent_run_id: agentRunId,
    agent_run_step_id: enrichStep?.id,
    provider_key: 'lusha',
    operation_key: 'lusha_contact_enrich',
    credits_used: creditsUsed ?? undefined,
    results_returned: 1,
    estimated_cost_usd: 0,
    status: 'success',
    triggered_by: triggeredBy,
    duration_ms: enrichDurationMs,
    metadata: {
      endpoint: 'contacts_enrich',
      reveal,
      phone_reveal_enabled: false,
      lusha_request_id: enrichResult.requestId ?? null,
      email_domain: emailDomain,
      credits_source:
        enrichResult.creditsCharged !== null ? 'billing' :
        billingCredits !== null ? 'billing_body' :
        creditsDelta !== null ? 'usage_delta' :
        'unknown',
      remaining_before: remainingBefore,
      remaining_after: remainingAfter,
      credits_delta: creditsDelta,
      hito: '17B.4G',
    },
  });

  return {
    ok: true,
    status: 'success',
    runId,
    candidateId,
    candidatesCreated: 1,
    creditsUsed,
    emailDomain,
    message: `Lusha candidate created: ${candidateId}. email_domain=${emailDomain ?? 'unknown'}. company_consistency=${consistency.status}.`,
  };
}

/**
 * Skeleton compatibility alias — preserved for callers from 17B.3.
 * Not used in live flows yet.
 */
export type { LushaRunnerResult as LushaRunnerResultCompat };

export async function executeContactEnrichmentLushaRun(
  runId: string,
  triggeredBy: string,
): Promise<LushaRunnerResult> {
  if (!isLushaContactEnrichmentEnabled()) {
    return {
      ok: false,
      status: 'disabled',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'Lusha contact enrichment is disabled (ENABLE_LUSHA_CONTACT_ENRICHMENT=false).',
    };
  }

  const hasKey = await hasLushaApiKey().catch(() => false);
  if (!hasKey) {
    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: 'LUSHA_API_KEY is not configured. Store the key via the settings panel.',
    };
  }

  return {
    ok: false,
    status: 'not_implemented' as LushaRunnerStatus,
    runId,
    candidatesCreated: 0,
    creditsUsed: null,
    message: 'Use executeControlledLushaContactEnrichRun for live enrichment.',
  };
}
