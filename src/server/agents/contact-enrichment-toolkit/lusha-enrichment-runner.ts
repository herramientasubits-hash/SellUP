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
import { getLushaApiKey } from '@/server/services/lusha-connection';
import {
  diagnoseLushaCredentialResolution,
  lushaCredentialDiagnosticMessage,
  type LushaCredentialStage,
} from '@/server/services/lusha-credential-diagnostics';
import {
  enrichLushaContactsV3,
  searchLushaContactsV3,
  prospectLushaContactsV3,
  getLushaAccountUsage,
  extractLushaJobTitle,
  extractLushaCompanyName,
  extractLushaCompanyDomain,
  extractLushaLinkedinUrl,
  extractEmailInfoFromLushaEmails,
  extractLushaBilling,
} from '@/server/integrations/lusha-client';
import {
  resolveLushaMaxCandidatesPerRun,
  resolveLushaSearchTimeoutMs,
} from '@/lib/feature-flags.server';
import { normalizeDomain } from './company-consistency-checker';
import { normalizeLushaPersonName } from './lusha-people-adapter';
import { buildLushaPersonIdentityEvidence } from './lusha-person-identity-evidence';
import { resolveLushaDiscoveryMode, type LushaContactProspectingRequest } from './lusha-types';
import { classifyContactRelevance } from './contact-relevance-classifier';
import {
  createAgentRunStep,
  finishAgentRunStep,
  logProviderUsage,
  updateAgentRun,
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
  duplicatesSkipped?: number;
  rawResultsCount?: number;
  creditsUsed: number | null;
  emailDomain?: string | null;
  message: string;
  credentialDiagnostic?: {
    stage: LushaCredentialStage;
    recommendation: string;
    hasServiceRoleKey: boolean;
    adminClientCreated: boolean;
    vaultRpcOk: boolean;
    vaultSecretFound: boolean;
  } | null;
};

// ── DB helpers ─────────────────────────────────────────────────

function getAdminClient(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createAdminClient(url, key);
}

// ── Lusha Prospecting ICP targeting — 17B.4W / 17B.4W.2 ────────
//
// Department values for SellUp's ICP (HR / People / Talent / L&D).
// These are hint filters to reduce the Prospecting search universe before
// downstream role-relevance classification.
//
// Evidence (17B.4W.2 live calls):
//   - Request with snake_case slugs (human_resources, people, etc.) → 0 results.
//   - Request without department filter → 292 results.
//   - Live response departments field: ["Human Resources"] (title case, space).
//   Minimum defensible value based on live evidence: "Human Resources".
//   Other values omitted until confirmed from provider taxonomy.
//   Fine-grained role relevance is enforced downstream via classifyContactRelevance().
const SELLUP_ICP_LUSHA_DEPARTMENTS = [
  'Human Resources',
] as const;

/**
 * Checks FQDN from Prospecting response against expected company domain.
 * Company consistency for the pre-enrich stage (fqdn vs domain).
 */
function checkProspectingFqdnConsistency(
  fqdn: string | null,
  expectedDomain: string | null,
): { ok: boolean; status: 'match' | 'mismatch' | 'unknown'; fqdn: string | null; expectedDomain: string | null } {
  const normalizedExpected = normalizeDomain(expectedDomain);
  const normalizedFqdn = normalizeDomain(fqdn);

  if (!normalizedFqdn) {
    return { ok: false, status: 'unknown', fqdn, expectedDomain };
  }
  if (!normalizedExpected) {
    // Cannot verify — allow through (email domain check post-enrich will catch mismatches)
    return { ok: true, status: 'unknown', fqdn, expectedDomain };
  }
  const matches = normalizedFqdn === normalizedExpected;
  return { ok: matches, status: matches ? 'match' : 'mismatch', fqdn, expectedDomain };
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
  accountId: string | null,
  email: string | null,
  linkedinUrl: string | null,
  snapshotEmails?: string[],
  snapshotLinkedinUrls?: string[],
): Promise<boolean> {
  // Check SellUp contacts — only when account_id is present
  if (accountId) {
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
  }

  // Check HubSpot snapshot (used when account_id is null — HubSpot-only company)
  if (!accountId && snapshotEmails && email) {
    const eKey = emailKey(email);
    if (eKey && snapshotEmails.some((e) => emailKey(e) === eKey)) return true;
  }
  if (!accountId && snapshotLinkedinUrls && linkedinUrl) {
    const lKey = linkedinKey(linkedinUrl);
    if (lKey && snapshotLinkedinUrls.some((u) => linkedinKey(u) === lKey)) return true;
  }

  // Check pending candidates (no account_id filter needed)
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

  // 2. API key — same pattern as checkLushaAccountUsageAction.
  // getLushaApiKey can throw when Supabase env vars are missing; treat as missing key.
  let apiKey: string | null = null;
  try {
    apiKey = await getLushaApiKey();
  } catch {
    // Supabase client couldn't be initialized — treat as missing key
  }
  if (!apiKey) {
    const diag = await diagnoseLushaCredentialResolution({
      runId,
      triggeredBy,
      source: 'runner',
    }).catch(() => null);
    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      creditsUsed: null,
      message: diag
        ? `Lusha no disponible: ${lushaCredentialDiagnosticMessage(diag)}`
        : 'Lusha API key not configured (sellup_prospecting_lusha_api_key not found in Vault).',
      credentialDiagnostic: diag
        ? {
            stage: diag.stage,
            recommendation: diag.recommendation,
            hasServiceRoleKey: diag.checks.hasServiceRoleKey,
            adminClientCreated: diag.checks.adminClientCreated,
            vaultRpcOk: diag.checks.vaultRpcOk,
            vaultSecretFound: diag.checks.vaultSecretFound,
          }
        : null,
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

export type { LushaRunnerResult as LushaRunnerResultCompat };

/**
 * Ejecuta búsqueda+enriquecimiento Lusha para un run en ready_to_enrich.
 * Busca contactos en la empresa (por nombre/dominio), enriquece con email,
 * deduplica y crea candidatos pending_review.
 *
 * Paridad con Apollo: mismo flujo run/candidato/revisión/aprobación.
 * NO crea contactos finales. NO toca HubSpot. NO revela teléfonos.
 * Gated por ENABLE_LUSHA_CONTACT_ENRICHMENT.
 */
export async function executeContactEnrichmentLushaRun(
  runId: string,
  triggeredBy: string,
): Promise<LushaRunnerResult> {
  // 1. Feature flag
  if (!isLushaContactEnrichmentEnabled()) {
    return {
      ok: false,
      status: 'disabled',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: 'Lusha contact enrichment is disabled (ENABLE_LUSHA_CONTACT_ENRICHMENT=false).',
    };
  }

  // 2. API key — same pattern as checkLushaAccountUsageAction (getLushaApiKey directly,
  // avoids has_vault_secret RPC path that can silently return false).
  // getLushaApiKey can throw (e.g. enrichment_configuration_unavailable) when Supabase
  // env vars are missing — treat any throw as missing credentials.
  let apiKey: string | null = null;
  try {
    apiKey = await getLushaApiKey();
  } catch {
    // Supabase client couldn't be initialized — treat as missing key
  }
  if (!apiKey) {
    const diag = await diagnoseLushaCredentialResolution({
      runId,
      triggeredBy,
      source: 'runner',
    }).catch(() => null);

    // Best-effort: mark run as failed so UI doesn't show "Listo para enriquecer"
    try {
      const adminForUpdate = getAdminClient();
      await adminForUpdate
        .from('contact_enrichment_runs')
        .update({
          status: 'failed',
          summary: {
            error: 'missing_api_key',
            hito: '17B.4L',
            credential_diagnostic: diag
              ? { stage: diag.stage, ok: diag.ok }
              : null,
          },
        })
        .eq('id', runId);
    } catch { /* no admin client available in this env — skip run update */ }

    return {
      ok: false,
      status: 'missing_api_key',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: diag
        ? `Lusha no disponible: ${lushaCredentialDiagnosticMessage(diag)}`
        : 'Lusha API key not configured (sellup_prospecting_lusha_api_key not found in Vault).',
      credentialDiagnostic: diag
        ? {
            stage: diag.stage,
            recommendation: diag.recommendation,
            hasServiceRoleKey: diag.checks.hasServiceRoleKey,
            adminClientCreated: diag.checks.adminClientCreated,
            vaultRpcOk: diag.checks.vaultRpcOk,
            vaultSecretFound: diag.checks.vaultSecretFound,
          }
        : null,
    };
  }

  const admin = getAdminClient();
  const timeoutMs = resolveLushaSearchTimeoutMs();
  const maxCandidates = resolveLushaMaxCandidatesPerRun();

  // 3. Load run (include summary for snapshot-based dedup)
  const { data: run, error: runError } = await admin
    .from('contact_enrichment_runs')
    .select('id, status, account_id, company_name, company_domain, company_country_code, agent_run_id, summary')
    .eq('id', runId)
    .single();

  if (runError || !run) {
    return {
      ok: false,
      status: 'not_found',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: `Run not found: ${runError?.message ?? 'unknown'}`,
    };
  }

  // 4. Validate run status
  if (run.status !== 'ready_to_enrich') {
    return {
      ok: false,
      status: 'invalid_run_status',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: `Run status is '${run.status}', expected 'ready_to_enrich'.`,
    };
  }

  // 5. Account validation — conditional on account_id presence.
  //    Paridad con Apollo: account_id null = empresa resuelta desde HubSpot (sin cuenta SellUp aún).
  //    Apollo nunca valida account_id; usa company_name/domain del run directamente.
  //    Lusha hace lo mismo: si account_id está presente, validar no-archivada;
  //    si es null, continuar con company context del run (HubSpot-only path).
  if (run.account_id) {
    const { data: account, error: accountError } = await admin
      .from('accounts')
      .select('id, archived_at')
      .eq('id', run.account_id)
      .single();

    if (accountError || !account) {
      await admin
        .from('contact_enrichment_runs')
        .update({ status: 'failed', summary: { error: 'account_not_found', hito: '17B.4S' } })
        .eq('id', runId);
      return {
        ok: false,
        status: 'invalid_account',
        runId,
        candidatesCreated: 0,
        duplicatesSkipped: 0,
        rawResultsCount: 0,
        creditsUsed: null,
        message: `Account not found: ${accountError?.message ?? 'unknown'}`,
      };
    }

    if (account.archived_at) {
      await admin
        .from('contact_enrichment_runs')
        .update({ status: 'failed', summary: { error: 'account_archived', hito: '17B.4S' } })
        .eq('id', runId);
      return {
        ok: false,
        status: 'invalid_account',
        runId,
        candidatesCreated: 0,
        duplicatesSkipped: 0,
        rawResultsCount: 0,
        creditsUsed: null,
        message: `Account ${run.account_id} is archived. Cannot enrich for archived accounts.`,
      };
    }
  }

  // Resolve company resolution source for traceability
  const runSummary = (run.summary && typeof run.summary === 'object' ? run.summary : {}) as Record<string, unknown>;
  const companyResolutionSource = (runSummary['company_resolution_source'] as string | undefined) ?? (run.account_id ? 'sellup' : 'hubspot');
  const isHubSpotOnly = !run.account_id;

  // Extract snapshot for dedup (HubSpot contacts from existing_contacts_snapshot)
  const combined = (runSummary['existing_contacts_snapshot'] as Record<string, unknown> | undefined)?.['combined'] as Record<string, unknown> | undefined;
  const snapshotEmails = Array.isArray(combined?.['existing_emails']) ? (combined!['existing_emails'] as string[]) : [];
  const snapshotLinkedinUrls = Array.isArray(combined?.['existing_linkedin_urls']) ? (combined!['existing_linkedin_urls'] as string[]) : [];

  // 6. Update run → enriching
  await admin
    .from('contact_enrichment_runs')
    .update({ status: 'enriching' })
    .eq('id', runId);

  const agentRunId = typeof run.agent_run_id === 'string' ? run.agent_run_id : undefined;
  const companyName = typeof run.company_name === 'string' ? run.company_name : null;
  const companyDomain = typeof run.company_domain === 'string' ? run.company_domain : null;

  // 7. Capability routing — 17B.4V guard promoted to 17B.4W prospecting
  //    /v3/contacts/search requires a person identifier — company-only is HTTP 400 (17B.4D).
  //    company_first_discovery → /v3/contacts/prospecting (17B.4W).
  //    invalid_search_context → terminal error (no usable identity).
  const discoveryMode = resolveLushaDiscoveryMode({
    companyName: companyName ?? undefined,
    companyDomain: companyDomain ?? undefined,
  });

  if (discoveryMode === 'company_first_discovery') {
    // ── 17B.4W: Lusha Contact Prospecting V3 ─────────────────────
    // Endpoint confirmed from migration guide: POST /v3/contacts/prospecting.
    // Company filter field names (names, domains) derived — not live-confirmed as of 17B.4W.

    const prospectStep = agentRunId
      ? await createAgentRunStep({
          agent_run_id: agentRunId,
          step_key: 'lusha_contact_prospecting',
          step_name: 'Lusha Contact Prospecting V3',
          provider_key: 'lusha',
          metadata: {
            companyName,
            companyDomain,
            discovery_mode: 'company_first_discovery',
            capability: 'contact_prospecting',
            endpoint_family: 'v3_contacts_prospecting',
            hito: '17B.4W',
          },
        })
      : null;

    const companyInclude: Record<string, string[]> = {};
    if (companyName) companyInclude['names'] = [companyName];
    if (companyDomain) companyInclude['domains'] = [companyDomain];

    const prospectRequest: LushaContactProspectingRequest = {
      filters: {
        contacts: {
          include: {
            departments: [...SELLUP_ICP_LUSHA_DEPARTMENTS],
          },
        },
        companies: {
          include: companyInclude,
        },
      },
      pagination: { page: 0, size: 25 },
    };

    const prospectStart = Date.now();
    const prospectResult = await prospectLushaContactsV3({ apiKey, timeoutMs, request: prospectRequest });
    const prospectDurationMs = Date.now() - prospectStart;
    const rawProspectCount = prospectResult.resultsReturned;

    // Path A — provider error
    if (!prospectResult.ok) {
      const safeErrorMsg = `${prospectResult.status}: ${prospectResult.errorMessage ?? ''}`.slice(0, 500).trim();

      if (prospectStep) {
        await finishAgentRunStep(prospectStep.id, {
          status: 'error',
          results_returned: 0,
          error_message: safeErrorMsg,
          duration_ms: prospectDurationMs,
          metadata: {
            searchStatus: prospectResult.status,
            resultsReturned: 0,
            httpStatus: prospectResult.httpStatus ?? null,
            requestId: prospectResult.requestId ?? null,
            discovery_mode: 'company_first_discovery',
            capability: 'contact_prospecting',
            hito: '17B.4U',
          },
        });
      }

      await admin
        .from('contact_enrichment_runs')
        .update({
          status: 'failed',
          providers_used: ['lusha'],
          summary: {
            provider: 'lusha',
            search_status: prospectResult.status,
            error_stage: 'prospecting',
            operation: 'contact_prospecting',
            discovery_mode: 'company_first_discovery',
            http_status: prospectResult.httpStatus ?? null,
            request_id: prospectResult.requestId ?? null,
            error_message: (prospectResult.errorMessage ?? '').slice(0, 300) || null,
            raw_results: 0,
            candidates_created: 0,
            totalCandidates: 0,
            hito: '17B.4W',
          },
        })
        .eq('id', runId);

      if (agentRunId) {
        await updateAgentRun(agentRunId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: `Lusha prospecting failed: ${prospectResult.status}`,
          metadata: {
            provider: 'lusha',
            stage: 'contact_prospecting',
            contact_enrichment_run_id: runId,
            search_status: prospectResult.status,
            http_status: prospectResult.httpStatus ?? null,
            discovery_mode: 'company_first_discovery',
            hito: '17B.4W',
          },
        });
      }

      await logProviderUsage({
        agent_run_id: agentRunId,
        agent_run_step_id: prospectStep?.id,
        provider_key: 'lusha',
        operation_key: 'lusha_contact_prospecting',
        credits_used: undefined,
        results_returned: 0,
        estimated_cost_usd: 0,
        status: 'error',
        triggered_by: triggeredBy,
        error_code: prospectResult.status,
        error_message: (prospectResult.errorMessage ?? '').slice(0, 300) || undefined,
        duration_ms: prospectDurationMs,
        metadata: {
          endpoint_family: 'v3_contacts_prospecting',
          discovery_mode: 'company_first_discovery',
          capability: 'contact_prospecting',
          http_status: prospectResult.httpStatus ?? null,
          request_id: prospectResult.requestId ?? null,
          hito: '17B.4W',
        },
      });

      return {
        ok: false,
        status: 'provider_error',
        runId,
        candidatesCreated: 0,
        duplicatesSkipped: 0,
        rawResultsCount: 0,
        creditsUsed: null,
        message: `Lusha prospecting failed: ${prospectResult.status} — ${prospectResult.errorMessage ?? ''}`,
      };
    }

    // Path B — no results
    if (prospectResult.contacts.length === 0) {
      if (prospectStep) {
        await finishAgentRunStep(prospectStep.id, {
          status: 'success',
          results_returned: 0,
          duration_ms: prospectDurationMs,
          metadata: {
            searchStatus: prospectResult.status,
            resultsReturned: 0,
            discovery_mode: 'company_first_discovery',
            hito: '17B.4W',
          },
        });
      }

      await admin
        .from('contact_enrichment_runs')
        .update({
          status: 'ready_for_review',
          providers_used: ['lusha'],
          summary: {
            totalCandidates: 0,
            candidates_created: 0,
            raw_results: rawProspectCount,
            search_status: prospectResult.status,
            discovery_mode: 'company_first_discovery',
            hito: '17B.4W',
          },
        })
        .eq('id', runId);

      if (agentRunId) {
        await updateAgentRun(agentRunId, {
          status: 'completed',
          finished_at: new Date().toISOString(),
          results_generated: 0,
        });
      }

      return {
        ok: true,
        status: 'no_reviewable_candidate',
        runId,
        candidatesCreated: 0,
        duplicatesSkipped: 0,
        rawResultsCount: rawProspectCount,
        creditsUsed: null,
        message: `Lusha prospecting returned no results: ${prospectResult.status}`,
      };
    }

    // Path C — results: filter → enrich → candidates
    if (prospectStep) {
      await finishAgentRunStep(prospectStep.id, {
        status: 'success',
        results_returned: rawProspectCount,
        duration_ms: prospectDurationMs,
        metadata: {
          searchStatus: prospectResult.status,
          resultsReturned: rawProspectCount,
          totalAvailable: prospectResult.totalAvailable ?? null,
          discovery_mode: 'company_first_discovery',
          hito: '17B.4W',
        },
      });
    }

    // 1. Company consistency (fqdn vs expected domain)
    const fqdnConsistent = prospectResult.contacts.filter((c) => {
      const chk = checkProspectingFqdnConsistency(c.fqdn, companyDomain);
      return chk.ok;
    });

    // 2. Role relevance — title must match HR/People/Learning ICP
    //    Pass dummy quality signals so classifyContactRelevance evaluates role only.
    const roleRelevant = fqdnConsistent.filter((c) => {
      const cls = classifyContactRelevance({
        fullName: c.name ?? 'A B',
        title: c.jobTitle,
        email: 'pending@enrich.lusha',
      });
      return cls.matchedCategory !== null;
    });

    // 3. Pre-enrich dedup by LinkedIn (when available from prospecting response)
    const seenLinkedins = new Set<string>(
      snapshotLinkedinUrls.map((u) => linkedinKey(u)).filter(Boolean) as string[],
    );
    const preDeduped = roleRelevant.filter((c) => {
      if (!c.linkedinUrl) return true;
      const k = linkedinKey(c.linkedinUrl);
      if (!k) return true;
      if (seenLinkedins.has(k)) return false;
      seenLinkedins.add(k);
      return true;
    });

    // 4. Limit before enrich
    const selectedForEnrich = preDeduped.slice(0, maxCandidates);

    let prospectCandidatesCreated = 0;
    let prospectDuplicatesSkipped = 0;
    let prospectTotalCredits: number | null = null;

    // Accumulate prospecting call credits (charged at prospecting stage, not per enrich).
    if (prospectResult.prospectingCreditsCharged !== null && prospectResult.prospectingCreditsCharged !== undefined) {
      prospectTotalCredits = (prospectTotalCredits ?? 0) + prospectResult.prospectingCreditsCharged;
    }

    const enrichStep = agentRunId
      ? await createAgentRunStep({
          agent_run_id: agentRunId,
          step_key: 'lusha_contact_enrich_batch',
          step_name: 'Lusha Contact Enrich V3 batch (prospecting)',
          metadata: {
            candidatesToEnrich: selectedForEnrich.length,
            reveal: ['emails'],
            phone_reveal_enabled: false,
            discovery_mode: 'company_first_discovery',
            prospecting_credits: prospectResult.prospectingCreditsCharged ?? null,
            hito: '17B.4W',
          },
        })
      : null;

    for (const candidate of selectedForEnrich) {
      // Skip enrich if provider signals email is not revealable for this person.
      // canRevealEmail=true when canReveal includes field="emails" (credits=0 is still eligible).
      if (!candidate.canRevealEmail && !candidate.hasWorkEmail) {
        prospectDuplicatesSkipped += 1;
        continue;
      }

      const enrichResult = await enrichLushaContactsV3({
        apiKey,
        timeoutMs,
        contacts: [{ id: candidate.contactId }],
        reveal: ['emails'],
      });

      if (!enrichResult.ok || !enrichResult.sanitizedResults?.length) continue;

      const contact = enrichResult.sanitizedResults[0];
      const contactWithEmail = contact as typeof contact & { internalEmail?: string | null };
      const actualEmail = contactWithEmail.internalEmail ?? null;
      const emailDomain = contact.emailDomain ?? null;

      const { creditsCharged: billingCredits } = extractLushaBilling(
        (enrichResult as unknown as Record<string, unknown>)['billing'],
      );
      const stepCredits = enrichResult.creditsCharged ?? billingCredits ?? null;
      if (stepCredits !== null) {
        prospectTotalCredits = (prospectTotalCredits ?? 0) + stepCredits;
      }

      const lushaRawName = candidate.name ?? null;
      const normalizedName = normalizeLushaPersonName(lushaRawName);
      if (!normalizedName) continue;

      // 17B.4W.6 — Person identity evidence (observabilidad, NO bloqueante).
      // Compara la identidad de prospecting usada para pedir el enrich contra
      // la identidad devuelta por ESTA iteración de enrich. No cambia si el
      // candidato se crea, ni la precedencia de email/LinkedIn.
      const enrichFullName =
        [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
        contact.fullName ||
        null;
      const personIdentityEvidence = buildLushaPersonIdentityEvidence({
        prospectContactId: candidate.contactId,
        prospectFullName: lushaRawName,
        prospectLinkedinUrl: candidate.linkedinUrl ?? null,
        enrichContactId: contact.id ?? null,
        enrichFullName,
        enrichLinkedinUrl: contact.linkedinUrl ?? null,
      });

      const candidateLinkedinUrl = candidate.linkedinUrl ?? contact.linkedinUrl ?? null;
      const linkedinSource = candidate.linkedinUrl
        ? 'lusha_prospecting'
        : contact.linkedinUrl
          ? 'lusha_enrich'
          : null;

      const isDuplicate = await checkExactDuplicate(
        admin,
        run.account_id,
        actualEmail,
        candidateLinkedinUrl,
        snapshotEmails,
        snapshotLinkedinUrls,
      );
      if (isDuplicate) {
        prospectDuplicatesSkipped += 1;
        continue;
      }

      // Post-enrich company consistency via email domain
      const emailConsistency = checkLushaCompanyConsistency(emailDomain, companyDomain);
      if (emailConsistency.status === 'mismatch') {
        prospectDuplicatesSkipped += 1;
        continue;
      }

      const enrichmentMetadata: Record<string, unknown> = {
        provider: 'lusha',
        lusha_contact_id: candidate.contactId,
        source_endpoint: 'v3_contacts_prospecting',
        discovery_mode: 'company_first_discovery',
        capability: 'contact_prospecting',
        endpoint_family: 'v3_contacts_prospecting',
        reveal: ['emails'],
        email_type: contact.emailType ?? null,
        email_domain: emailDomain,
        phone_reveal_enabled: false,
        phone_policy: 'disabled_in_v1_explicit_future_action_required',
        lusha_full_name: lushaRawName,
        normalized_full_name: normalizedName,
        name_source: 'lusha_prospecting_normalized',
        name_normalization_hito: '17B.4W',
        prospecting_job_title: candidate.jobTitle,
        prospecting_fqdn: candidate.fqdn,
        prospecting_department: candidate.department ?? null,
        prospecting_seniority: candidate.seniority ?? null,
        can_reveal_email: candidate.canRevealEmail,
        input_linkedin_url: candidate.linkedinUrl ?? null,
        lusha_linkedin_url: contact.linkedinUrl ?? null,
        linkedin_source: linkedinSource,
        company_consistency: {
          status: emailConsistency.status,
          signals: emailConsistency.signals,
          expected_domain: companyDomain,
          email_domain: emailDomain,
          fqdn: candidate.fqdn,
          context_source: companyResolutionSource,
        },
        company_resolution_source: companyResolutionSource,
        is_hubspot_only: isHubSpotOnly,
        // Person identity consistency evidence (17B.4W.6). Observabilidad
        // determinista — sin heurística de email, sin fuzzy, sin IA.
        person_identity: personIdentityEvidence,
        billing: { credits_charged: stepCredits, credits_source: 'billing' },
        hito: '17B.4W',
      };

      const { error: insertError } = await admin
        .from('contact_enrichment_candidates')
        .insert({
          enrichment_run_id: runId,
          first_name: null,
          last_name: null,
          full_name: normalizedName,
          title: candidate.jobTitle ?? null,
          seniority: candidate.seniority ?? null,
          department: candidate.department ?? null,
          country: run.company_country_code ?? null,
          linkedin_url: candidateLinkedinUrl,
          email: actualEmail,
          phone: null,
          source: 'lusha' as const,
          source_contact_id: candidate.contactId,
          confidence: 0.9,
          status: 'pending_review' as const,
          duplicate_status: 'no_match',
          enrichment_metadata: enrichmentMetadata,
        });

      if (!insertError) prospectCandidatesCreated += 1;
    }

    await logProviderUsage({
      agent_run_id: agentRunId,
      agent_run_step_id: enrichStep?.id,
      provider_key: 'lusha',
      operation_key: 'lusha_contact_prospecting',
      credits_used: prospectTotalCredits ?? undefined,
      results_returned: prospectCandidatesCreated,
      estimated_cost_usd: 0,
      status: prospectCandidatesCreated > 0 ? 'success' : 'error',
      triggered_by: triggeredBy,
      metadata: {
        endpoint_family: 'v3_contacts_prospecting',
        discovery_mode: 'company_first_discovery',
        capability: 'contact_prospecting',
        reveal: ['emails'],
        phone_reveal_enabled: false,
        raw_results: rawProspectCount,
        fqdn_consistent: fqdnConsistent.length,
        role_relevant: roleRelevant.length,
        selected_for_enrich: selectedForEnrich.length,
        candidates_created: prospectCandidatesCreated,
        duplicates_skipped: prospectDuplicatesSkipped,
        hito: '17B.4W',
      },
    });

    if (enrichStep) {
      await finishAgentRunStep(enrichStep.id, {
        status: 'success',
        results_returned: prospectCandidatesCreated,
        metadata: {
          candidates_created: prospectCandidatesCreated,
          duplicates_skipped: prospectDuplicatesSkipped,
          credits_used: prospectTotalCredits,
          discovery_mode: 'company_first_discovery',
          hito: '17B.4W',
        },
      });
    }

    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'ready_for_review',
        providers_used: ['lusha'],
        summary: {
          totalCandidates: prospectCandidatesCreated,
          candidates_created: prospectCandidatesCreated,
          duplicates_skipped: prospectDuplicatesSkipped,
          raw_results: rawProspectCount,
          credits_used: prospectTotalCredits,
          discovery_mode: 'company_first_discovery',
          hito: '17B.4W',
        },
      })
      .eq('id', runId);

    if (agentRunId) {
      await updateAgentRun(agentRunId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        results_generated: prospectCandidatesCreated,
      });
    }

    return {
      ok: prospectCandidatesCreated > 0,
      status: prospectCandidatesCreated > 0 ? 'success' : 'no_reviewable_candidate',
      runId,
      candidatesCreated: prospectCandidatesCreated,
      duplicatesSkipped: prospectDuplicatesSkipped,
      rawResultsCount: rawProspectCount,
      creditsUsed: prospectTotalCredits,
      message: `Lusha prospecting: ${prospectCandidatesCreated} candidate(s) created, ${prospectDuplicatesSkipped} filtered/skipped.`,
    };
  }

  if (discoveryMode === 'invalid_search_context') {
    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'failed',
        providers_used: ['lusha'],
        summary: {
          error: 'invalid_search_context',
          discovery_mode: discoveryMode,
          hito: '17B.4V',
        },
      })
      .eq('id', runId);

    if (agentRunId) {
      await updateAgentRun(agentRunId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: 'Invalid search context: no person identifier and no company identity.',
        metadata: {
          provider: 'lusha',
          discovery_mode: discoveryMode,
          hito: '17B.4V',
        },
      });
    }

    return {
      ok: false,
      status: 'not_implemented',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: 'Invalid search context: neither person identifier nor company identity is available.',
    };
  }

  // 8. Search Lusha for contacts at this company
  const searchStep = agentRunId
    ? await createAgentRunStep({
        agent_run_id: agentRunId,
        step_key: 'lusha_contact_search',
        step_name: 'Lusha Contact Search V3 (company)',
        provider_key: 'lusha',
        metadata: {
          companyName,
          companyDomain,
          hito: '17B.4K',
        },
      })
    : null;

  const searchStart = Date.now();
  const searchResult = await searchLushaContactsV3({
    apiKey,
    timeoutMs,
    contacts: [
      {
        ...(companyName ? { companyName } : {}),
        ...(companyDomain ? { companyDomain } : {}),
      },
    ],
  });
  const searchDurationMs = Date.now() - searchStart;

  const rawResultsCount = searchResult.resultsReturned ?? 0;

  // Path A — provider error: real failure, not a no-results case.
  // Must terminate with failed status; must NOT continue to candidate flow.
  if (!searchResult.ok) {
    const safeErrorMsg = `${searchResult.status}: ${searchResult.errorMessage ?? ''}`.slice(0, 500).trim();

    if (searchStep) {
      await finishAgentRunStep(searchStep.id, {
        status: 'error',
        results_returned: 0,
        error_message: safeErrorMsg,
        duration_ms: searchDurationMs,
        metadata: {
          searchStatus: searchResult.status,
          resultsReturned: 0,
          httpStatus: searchResult.httpStatus ?? null,
          requestId: searchResult.requestId ?? null,
          hito: '17B.4U',
        },
      });
    }

    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'failed',
        providers_used: ['lusha'],
        summary: {
          provider: 'lusha',
          search_status: searchResult.status,
          error_stage: 'search',
          operation: 'contacts_search',
          http_status: searchResult.httpStatus ?? null,
          request_id: searchResult.requestId ?? null,
          error_message: (searchResult.errorMessage ?? '').slice(0, 300) || null,
          raw_results: 0,
          candidates_created: 0,
          totalCandidates: 0,
          hito: '17B.4U',
        },
      })
      .eq('id', runId);

    if (agentRunId) {
      await updateAgentRun(agentRunId, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: `Lusha search failed: ${searchResult.status}`,
        metadata: {
          provider: 'lusha',
          stage: 'contact_search',
          contact_enrichment_run_id: runId,
          search_status: searchResult.status,
          http_status: searchResult.httpStatus ?? null,
          hito: '17B.4U',
        },
      });
    }

    await logProviderUsage({
      agent_run_id: agentRunId,
      agent_run_step_id: searchStep?.id,
      provider_key: 'lusha',
      operation_key: 'lusha_contact_search',
      credits_used: undefined,
      results_returned: 0,
      estimated_cost_usd: 0,
      status: 'error',
      triggered_by: triggeredBy,
      error_code: searchResult.status,
      error_message: (searchResult.errorMessage ?? '').slice(0, 300) || undefined,
      duration_ms: searchDurationMs,
      metadata: {
        endpoint: 'contacts_search',
        http_status: searchResult.httpStatus ?? null,
        request_id: searchResult.requestId ?? null,
        search_status: searchResult.status,
        hito: '17B.4U',
      },
    });

    return {
      ok: false,
      status: 'provider_error',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount: 0,
      creditsUsed: null,
      message: `Lusha search failed: ${searchResult.status} — ${searchResult.errorMessage ?? ''}`,
    };
  }

  // Path B — provider responded OK but found no contacts (not an error).
  if (!searchResult.sanitizedResults?.length) {
    if (searchStep) {
      await finishAgentRunStep(searchStep.id, {
        status: 'success',
        results_returned: 0,
        duration_ms: searchDurationMs,
        metadata: {
          searchStatus: searchResult.status,
          resultsReturned: 0,
          hito: '17B.4K',
        },
      });
    }

    await admin
      .from('contact_enrichment_runs')
      .update({
        status: 'ready_for_review',
        providers_used: ['lusha'],
        summary: {
          totalCandidates: 0,
          candidates_created: 0,
          raw_results: rawResultsCount,
          search_status: searchResult.status,
          hito: '17B.4K',
        },
      })
      .eq('id', runId);

    if (agentRunId) {
      await updateAgentRun(agentRunId, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        results_generated: 0,
      });
    }

    return {
      ok: true,
      status: 'no_reviewable_candidate',
      runId,
      candidatesCreated: 0,
      duplicatesSkipped: 0,
      rawResultsCount,
      creditsUsed: null,
      message: `Lusha search returned no results: ${searchResult.status}`,
    };
  }

  // Path C — provider returned contacts; finish step as success and continue.
  if (searchStep) {
    await finishAgentRunStep(searchStep.id, {
      status: 'success',
      results_returned: rawResultsCount,
      duration_ms: searchDurationMs,
      metadata: {
        searchStatus: searchResult.status,
        resultsReturned: rawResultsCount,
        hito: '17B.4K',
      },
    });
  }

  // 8. Enrich up to maxCandidates results
  const candidates = searchResult.sanitizedResults.filter((c) => c.id).slice(0, maxCandidates);
  let candidatesCreated = 0;
  let duplicatesSkipped = 0;
  let totalCreditsUsed: number | null = null;
  const enrichStep = agentRunId
    ? await createAgentRunStep({
        agent_run_id: agentRunId,
        step_key: 'lusha_contact_enrich_batch',
        step_name: 'Lusha Contact Enrich V3 batch (company)',
        metadata: {
          candidatesToEnrich: candidates.length,
          reveal: ['emails'],
          phone_reveal_enabled: false,
          hito: '17B.4K',
        },
      })
    : null;

  for (const candidate of candidates) {
    if (!candidate.id) continue;

    const enrichResult = await enrichLushaContactsV3({
      apiKey,
      timeoutMs,
      contacts: [{ id: candidate.id }],
      reveal: ['emails'],
    });

    if (!enrichResult.ok || !enrichResult.sanitizedResults?.length) continue;

    const contact = enrichResult.sanitizedResults[0];
    const contactWithEmail = contact as typeof contact & { internalEmail?: string | null };
    const actualEmail = contactWithEmail.internalEmail ?? null;
    const emailDomain = contact.emailDomain ?? null;

    // Accumulate credits
    const { creditsCharged: billingCredits } = extractLushaBilling(
      (enrichResult as unknown as Record<string, unknown>)['billing'],
    );
    const stepCredits = enrichResult.creditsCharged ?? billingCredits ?? null;
    if (stepCredits !== null) {
      totalCreditsUsed = (totalCreditsUsed ?? 0) + stepCredits;
    }

    // Name normalization
    const lushaRawName =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
      contact.fullName || null;
    const normalizedName = normalizeLushaPersonName(lushaRawName);
    if (!normalizedName) continue;

    // LinkedIn priority: search result > enrich result
    const searchLinkedin = candidate.linkedinUrl ?? null;
    const enrichLinkedin = contact.linkedinUrl ?? null;
    const candidateLinkedinUrl = searchLinkedin || enrichLinkedin || null;
    const linkedinSource = searchLinkedin ? 'lusha_search' : enrichLinkedin ? 'lusha_enrich' : null;

    // Dedup check — pass snapshot for HubSpot-only dedup
    const isDuplicate = await checkExactDuplicate(
      admin,
      run.account_id,
      actualEmail,
      candidateLinkedinUrl,
      snapshotEmails,
      snapshotLinkedinUrls,
    );
    if (isDuplicate) {
      duplicatesSkipped += 1;
      continue;
    }

    const consistency = checkLushaCompanyConsistency(emailDomain, companyDomain);

    const enrichmentMetadata: Record<string, unknown> = {
      provider: 'lusha',
      lusha_id: candidate.id,
      source_endpoint: 'contacts_enrich',
      reveal: ['emails'],
      email_type: contact.emailType ?? null,
      email_domain: emailDomain,
      phone_reveal_enabled: false,
      phone_policy: 'disabled_in_v1_explicit_future_action_required',
      lusha_full_name: lushaRawName,
      normalized_full_name: normalizedName,
      name_source: 'lusha_enrich_normalized',
      name_normalization_status: 'normalized',
      name_normalization_hito: '17B.4K',
      input_linkedin_url: searchLinkedin,
      lusha_linkedin_url: enrichLinkedin,
      linkedin_source: linkedinSource,
      linkedin_conflict: searchLinkedin && enrichLinkedin
        ? linkedinKey(searchLinkedin) !== linkedinKey(enrichLinkedin)
        : false,
      company_consistency: {
        status: consistency.status,
        signals: consistency.signals,
        expected_domain: companyDomain,
        email_domain: emailDomain,
        context_source: companyResolutionSource,
      },
      company_resolution_source: companyResolutionSource,
      is_hubspot_only: isHubSpotOnly,
      billing: { credits_charged: stepCredits, credits_source: 'billing' },
      hito: '17B.4S',
    };

    const { error: insertError } = await admin
      .from('contact_enrichment_candidates')
      .insert({
        enrichment_run_id: runId,
        first_name: contact.firstName ?? null,
        last_name: contact.lastName ?? null,
        full_name: normalizedName,
        title: contact.title ?? null,
        seniority: null,
        department: null,
        country: run.company_country_code ?? null,
        linkedin_url: candidateLinkedinUrl,
        email: actualEmail,
        phone: null,
        source: 'lusha' as const,
        source_contact_id: candidate.id,
        confidence: 0.9,
        status: 'pending_review' as const,
        duplicate_status: 'no_match',
        enrichment_metadata: enrichmentMetadata,
      });

    if (!insertError) {
      candidatesCreated += 1;
    }
  }

  // 9. Log usage
  await logProviderUsage({
    agent_run_id: agentRunId,
    agent_run_step_id: enrichStep?.id,
    provider_key: 'lusha',
    operation_key: 'lusha_contact_enrich',
    credits_used: totalCreditsUsed ?? undefined,
    results_returned: candidatesCreated,
    estimated_cost_usd: 0,
    status: candidatesCreated > 0 ? 'success' : 'error',
    triggered_by: triggeredBy,
    metadata: {
      endpoint: 'contacts_enrich',
      reveal: ['emails'],
      phone_reveal_enabled: false,
      raw_results: rawResultsCount,
      candidates_created: candidatesCreated,
      duplicates_skipped: duplicatesSkipped,
      hito: '17B.4K',
    },
  });

  if (enrichStep) {
    await finishAgentRunStep(enrichStep.id, {
      status: candidatesCreated > 0 ? 'success' : 'success',
      results_returned: candidatesCreated,
      metadata: {
        candidates_created: candidatesCreated,
        duplicates_skipped: duplicatesSkipped,
        credits_used: totalCreditsUsed,
        hito: '17B.4K',
      },
    });
  }

  // 10. Update run → ready_for_review
  await admin
    .from('contact_enrichment_runs')
    .update({
      status: 'ready_for_review',
      providers_used: ['lusha'],
      summary: {
        totalCandidates: candidatesCreated,
        candidates_created: candidatesCreated,
        duplicates_skipped: duplicatesSkipped,
        raw_results: rawResultsCount,
        credits_used: totalCreditsUsed,
        hito: '17B.4K',
      },
    })
    .eq('id', runId);

  // 11. Close agent_run as completed
  if (agentRunId) {
    await updateAgentRun(agentRunId, {
      status: 'completed',
      finished_at: new Date().toISOString(),
      results_generated: candidatesCreated,
    });
  }

  return {
    ok: candidatesCreated > 0,
    status: candidatesCreated > 0 ? 'success' : 'no_reviewable_candidate',
    runId,
    candidatesCreated,
    duplicatesSkipped,
    rawResultsCount,
    creditsUsed: totalCreditsUsed,
    message: `Lusha company run: ${candidatesCreated} candidate(s) created, ${duplicatesSkipped} duplicate(s) skipped.`,
  };
}
