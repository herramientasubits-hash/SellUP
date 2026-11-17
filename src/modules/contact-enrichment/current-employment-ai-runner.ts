/**
 * «Verificar con IA» — orquestación de UN contacto con dependencias inyectadas
 * (CONTACT-CURRENT-EMPLOYMENT-AI-1). La acción del servidor conecta Supabase, Claude y el
 * registro de gasto; aquí sólo vive el orden y las reglas, para poder probarlo sin red.
 */

import type {
  AnthropicConversationResult,
  AnthropicRequestBody,
  AnthropicUsageTotals,
} from '@/server/agents/prospecting-toolkit/claude-classifier/anthropic-messages-client';
import {
  assessEmploymentAiResponse,
  buildEmploymentAiFollowUp,
  buildEmploymentAiRequest,
  readEmploymentAiSubmission,
  type EmploymentAiRejection,
  type EmploymentAiTarget,
} from './current-employment-ai-check';
import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  readCurrentEmploymentCheck,
  titleAfterEmploymentCheck,
  type CurrentEmploymentCheck,
  type CurrentEmploymentStatus,
} from './current-employment-check';

export interface EmploymentAiCandidate {
  id: string;
  fullName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
  countryName: string | null;
  enrichmentMetadata: Record<string, unknown>;
}

export type VerifyEmploymentWithAiStatus =
  | CurrentEmploymentStatus
  | 'candidate_not_found'
  | 'missing_name_or_company'
  | 'claude_not_configured'
  | 'claude_quota_exhausted'
  | 'provider_error';

export interface VerifyEmploymentWithAiResult {
  ok: boolean;
  status: VerifyEmploymentWithAiStatus;
  /** Motivo cuando quedó «sin verificar». */
  rejection: EmploymentAiRejection | null;
  check: CurrentEmploymentCheck | null;
}

export interface EmploymentAiPatch {
  enrichment_metadata: Record<string, unknown>;
  title?: string;
}

export interface EmploymentAiUsageEntry {
  model: string;
  usage: AnthropicUsageTotals | null;
  status: 'success' | 'error';
  errorCode: string | null;
  verdict: CurrentEmploymentStatus | null;
  rejection: EmploymentAiRejection | null;
}

export interface VerifyEmploymentWithAiDeps {
  nowIso: () => string;
  loadCandidate: (id: string) => Promise<EmploymentAiCandidate | null>;
  resolveModel: () => Promise<{ model: string } | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  runConversation: (body: AnthropicRequestBody) => Promise<AnthropicConversationResult>;
  persist: (id: string, patch: EmploymentAiPatch) => Promise<void>;
  logUsage: (entry: EmploymentAiUsageEntry) => Promise<void>;
}

function addUsage(a: AnthropicUsageTotals, b: AnthropicUsageTotals): AnthropicUsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    webFetchRequests: a.webFetchRequests + b.webFetchRequests,
  };
}

function fail(status: VerifyEmploymentWithAiStatus): VerifyEmploymentWithAiResult {
  return { ok: false, status, rejection: null, check: null };
}

/**
 * Qué se guarda. Un «sin verificar» de la IA nunca tapa una comprobación anterior que sí dijo
 * algo (de Apollo o de otra verificación): sólo se anota cuando no había nada.
 */
export function employmentAiPatch(
  candidate: EmploymentAiCandidate,
  check: CurrentEmploymentCheck,
): EmploymentAiPatch | null {
  const previous = readCurrentEmploymentCheck(candidate.enrichmentMetadata[CURRENT_EMPLOYMENT_METADATA_KEY]);
  if (check.status === 'unknown' && previous && previous.status !== 'unknown') return null;
  const patch: EmploymentAiPatch = {
    enrichment_metadata: { ...candidate.enrichmentMetadata, [CURRENT_EMPLOYMENT_METADATA_KEY]: check },
  };
  const title = titleAfterEmploymentCheck(check, candidate.title);
  if (title && title !== candidate.title) patch.title = title;
  return patch;
}

export async function verifyCandidateEmploymentWithAi(
  candidateId: string,
  deps: VerifyEmploymentWithAiDeps,
): Promise<VerifyEmploymentWithAiResult> {
  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return fail('candidate_not_found');
  if (!candidate.fullName?.trim() || !candidate.companyName?.trim()) return fail('missing_name_or_company');

  const active = await deps.resolveModel();
  if ('error' in active) return fail('claude_not_configured');
  if (!(await deps.checkQuota()).allowed) return fail('claude_quota_exhausted');

  const target: EmploymentAiTarget = {
    fullName: candidate.fullName.trim(),
    title: candidate.title,
    companyName: candidate.companyName.trim(),
    companyDomain: candidate.companyDomain,
    linkedinUrl: candidate.linkedinUrl,
    countryName: candidate.countryName,
  };
  const body = buildEmploymentAiRequest(target, active.model);

  let content: AnthropicConversationResult['content'];
  let usage: AnthropicUsageTotals;
  try {
    const first = await deps.runConversation(body);
    content = first.content;
    usage = first.usage;
    // Claude a veces escribe lo que encontró y se detiene: se le pide la entrega una vez más.
    if (!readEmploymentAiSubmission(content)) {
      const second = await deps.runConversation(buildEmploymentAiFollowUp(body, content));
      content = [...content, ...second.content];
      usage = addUsage(usage, second.usage);
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : 'unexpected_error';
    const partial = err && typeof err === 'object' && 'partialUsage' in err ? (err.partialUsage as AnthropicUsageTotals | null) : null;
    await deps.logUsage({ model: active.model, usage: partial, status: 'error', errorCode: code, verdict: null, rejection: null }).catch(() => undefined);
    return fail('provider_error');
  }

  const outcome = assessEmploymentAiResponse({ content, target, checkedAt: deps.nowIso() });
  await deps
    .logUsage({ model: active.model, usage, status: 'success', errorCode: null, verdict: outcome.check.status, rejection: outcome.rejection })
    .catch(() => undefined);

  const patch = employmentAiPatch(candidate, outcome.check);
  if (patch) await deps.persist(candidate.id, patch);
  return { ok: true, status: outcome.check.status, rejection: outcome.rejection, check: outcome.check };
}
