'use server';

/**
 * Lusha → pending-review persistence — Server Action (Q3F-5BB.4)
 *
 * Runs a single Lusha company search from the "Generar con IA" wizard and
 * persists the results as a pending-review prospect batch + candidates. Thin
 * wrapper over the pure `persistLushaPendingReviewBatch` core:
 *   - Validates the authenticated, active user.
 *   - Validates + sanitizes the input with zod.
 *   - Injects the real Lusha search (same read-only `executeLushaPreview` core,
 *     so page=0 / size=10 / expectedMaxCredits=1 are inherited verbatim).
 *   - Injects DB writes SCOPED to prospect_batches + prospect_candidates using
 *     the RLS session client (bounded by `has_active_access`).
 *
 * Q3F-5BB.7 adds duplicate parity: before candidates are persisted, the pure core
 * runs the canonical SellUp + HubSpot duplicate checker and the active-candidate
 * guard through two READ-ONLY injected deps. Those checkers query accounts /
 * HubSpot / prospect_candidates for READS only — they never create or mutate a
 * record. Account/company creation, HubSpot writes and enrichment remain
 * impossible (no such dep exists).
 *
 * Hard limits (authorized scope Q3F-5BB.4 + Q3F-5BB.7):
 *   - DB writes limited to prospect_batches + prospect_candidates. Nothing else.
 *   - Does NOT create accounts/companies. Does NOT WRITE to HubSpot. Does NOT call
 *     enrichment / people search / Apollo / Tavily. Does NOT write
 *     provider_usage_logs or agent_runs.
 *   - Duplicate checks are read-only (SellUp accounts + HubSpot + active
 *     candidates) and run before insert to populate duplicate_status / matched ids.
 *   - No auto-run: invoked only from the explicit "Buscar con IA" click.
 *   - Never returns raw provider payloads or secrets.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isLushaPreviewEnabled } from '@/lib/feature-flags.server';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { searchLushaCompaniesV3 } from '@/server/integrations/lusha-client';
import {
  executeLushaPreview,
  LUSHA_PREVIEW_TIMEOUT_MS,
} from '@/server/prospect-batches/lusha-preview';
import {
  persistLushaPendingReviewBatch,
  buildLushaPendingReviewFailure,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewResult,
} from '@/server/prospect-batches/lusha-pending-review';
// Q3F-5BB.10C2 — read-only official-source resolvers (injected into the pure core)
// + server-side flag gate. Neither path carries a forbidden import substring.
import { buildLushaOfficialSourceResolvers } from '@/server/prospect-batches/lusha-official-source-resolvers';
import {
  guardLushaPreviewEnabled,
  buildLushaPendingReviewDisabledResult,
} from '@/modules/prospect-batches/lusha-preview-flag-guard';
// Q3F-5BB.11D — OBSERVATIONAL provider-routing wiring. The adapter is pure (no
// env, no provider client, no Supabase). The barrel exposes the pure 11B resolver
// + 11C metadata builder. This produces routing metadata + a safety assert ONLY;
// it never decides eligibility (resolveWizardLushaCriteria) nor replaces the
// server-side flag guard above.
import {
  buildLushaRoutingCriteria,
  buildLushaRoutingConfig,
  buildLushaObservationalRegistry,
  assertLushaRoutingPlanSafe,
} from '@/modules/prospect-batches/lusha-provider-routing-adapter';
import {
  resolveProviderRoutingPlan,
  buildProviderRoutingMetadata,
  type ProviderRoutingEnvironment,
} from '@/modules/prospect-batches/provider-routing';
// Read-only duplicate parity (Q3F-5BB.7). Both helpers query for READS only:
//   - checkCompanyDuplicate       → SellUp accounts + HubSpot (read-only checkers).
//   - fetchActiveCandidatesForGuard → active prospect_candidates prefetch (read-only).
// Neither can create/mutate anything; the pure core has no write dep for them.
import { checkCompanyDuplicate } from '@/server/agents/prospecting-toolkit/duplicate-checker';
import { fetchActiveCandidatesForGuard } from '@/server/agents/prospecting-toolkit/candidate-writer';

const GenerateInputSchema = z.object({
  countryCode: z.string().trim().min(2).max(4),
  sectorKey: z.string().trim().min(1).max(40),
  subIndustryId: z.number().int().positive().nullable().optional(),
  sizeBandKey: z.string().trim().max(20).nullable().optional(),
  searchText: z.string().trim().max(120).nullable().optional(),
});

export type GenerateLushaPendingReviewBatchInput = z.infer<typeof GenerateInputSchema>;

/** Client-facing result — never exposes raw provider payloads or secrets. */
export type GenerateLushaPendingReviewBatchActionResult = PersistLushaPendingReviewResult;

function invalidInputResult(): GenerateLushaPendingReviewBatchActionResult {
  return buildLushaPendingReviewFailure('Parámetros de búsqueda inválidos.', 'invalid_input');
}

/**
 * Resolve the runtime environment server-side (the pure routing adapter never
 * reads env). Mirrors the repo's Vercel/NODE_ENV convention; only used to gate
 * provider capability in the OBSERVATIONAL plan.
 */
function resolveRoutingEnvironment(): ProviderRoutingEnvironment {
  const vercelEnv = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  if (process.env.NODE_ENV === 'production') return 'production';
  return 'development';
}

/**
 * Executes the Lusha search once and persists the results as pending-review
 * prospects. Returns counts + safe billing metadata for the confirmation UI.
 */
export async function generateLushaPendingReviewBatchAction(
  rawInput: GenerateLushaPendingReviewBatchInput,
): Promise<GenerateLushaPendingReviewBatchActionResult> {
  // Q3F-5BB.10C2 — server-side ENABLE_LUSHA_PREVIEW gate (P0). When the flag is
  // off, `guardLushaPreviewEnabled` returns the disabled result WITHOUT running
  // the callback — so no Lusha client is built, no search runs, and nothing is
  // written, even on a direct call that bypasses the UI gate.
  return guardLushaPreviewEnabled(
    isLushaPreviewEnabled(),
    buildLushaPendingReviewDisabledResult,
    async () => runGenerateLushaPendingReviewBatch(rawInput),
  );
}

async function runGenerateLushaPendingReviewBatch(
  rawInput: GenerateLushaPendingReviewBatchInput,
): Promise<GenerateLushaPendingReviewBatchActionResult> {
  // Auth: active internal user (RLS-scoped session). Redirects to /login if not.
  const { internalUserId } = await requireActiveUser();

  const parsed = GenerateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return invalidInputResult();
  }

  // Q3F-5BB.11D — OBSERVATIONAL provider-routing plan. We are already inside the
  // guard's run() (flag ON), so Lusha is enabled here. Build the pure plan,
  // assert it is safe (never Apollo/Tavily; selected must be Lusha), and derive
  // the additive routing metadata. This does NOT gate execution or eligibility —
  // it only annotates the batch/candidates. If the plan is unsafe the assert
  // throws and the outer try/catch fails the request closed (never a fallback).
  const environment = resolveRoutingEnvironment();
  const routingPlan = resolveProviderRoutingPlan(
    buildLushaRoutingCriteria({
      countryCode: parsed.data.countryCode,
      sectorKey: parsed.data.sectorKey,
    }),
    buildLushaRoutingConfig({ environment, lushaEnabled: true }),
    buildLushaObservationalRegistry(),
  );
  assertLushaRoutingPlanSafe(routingPlan);
  const routingMetadata = buildProviderRoutingMetadata(routingPlan, {
    environment,
    fallbackAllowed: false,
    fallbackReason: 'lusha_intent_never_chains',
  });

  const supabase = await createClient();

  try {
    const result = await persistLushaPendingReviewBatch(
      {
        // Lusha runs through the read-only preview core → guardrails inherited.
        runSearch: (input) =>
          executeLushaPreview(
            {
              resolveApiKey: () => getLushaApiKey(),
              searchCompanies: (apiKey, request) =>
                searchLushaCompaniesV3({
                  apiKey,
                  timeoutMs: LUSHA_PREVIEW_TIMEOUT_MS,
                  request,
                }),
            },
            input,
          ),
        // Write dep #1 — prospect_batches ONLY.
        insertBatch: async (row: LushaPendingReviewBatchRow) => {
          const { data, error } = await supabase
            .from('prospect_batches')
            .insert(row)
            .select('id')
            .single();
          if (error || !data) {
            throw new Error(`No se pudo crear el lote: ${error?.message ?? 'sin datos'}`);
          }
          return { id: data.id as string };
        },
        // Write dep #2 — prospect_candidates ONLY.
        insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
          const { data, error } = await supabase
            .from('prospect_candidates')
            .insert(rows)
            .select('id');
          if (error) {
            throw new Error(`No se pudieron crear los candidatos: ${error.message}`);
          }
          return { insertedCount: data?.length ?? 0 };
        },
        // Read-only dep #1 — canonical SellUp + HubSpot duplicate checker.
        checkCompanyDuplicate: (dupInput) => checkCompanyDuplicate(dupInput),
        // Read-only dep #2 — active prospect_candidates prefetch for the guard.
        // Uses the RLS-bounded session client; degrades gracefully (returns []).
        fetchActiveCandidates: async (domains, countryCode) => {
          const prefetch = await fetchActiveCandidatesForGuard(
            supabase,
            domains,
            countryCode,
          );
          return prefetch.records;
        },
        // Read-only official-source resolvers (Q3F-5BB.10C2). Today: Colombia
        // (co_siis) name→NIT via an approved service-role read. Best-effort:
        // yields [] when a safe client is unavailable → enrichment fails soft.
        officialSourceResolvers: buildLushaOfficialSourceResolvers(),
      },
      parsed.data,
      { internalUserId },
      // Q3F-5BB.11D — additive OBSERVATIONAL routing metadata (never gates).
      { routingMetadata, routingPlan },
    );

    // Safe server-side log — no secrets, no raw payload, no PII.
    console.warn('[lusha-pending-review]', {
      status: result.status,
      createdCandidatesCount: result.createdCandidatesCount,
      skippedCount: result.skippedCount,
      creditsCharged: result.creditsCharged,
      resultsReturned: result.resultsReturned,
      country: parsed.data.countryCode,
      sector: parsed.data.sectorKey,
    });

    if (result.status === 'success') {
      // Refresh the Prospectos list so the new candidates appear.
      revalidatePath('/accounts');
    }

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return buildLushaPendingReviewFailure(
      'No fue posible guardar los prospectos. Intenta de nuevo.',
      msg.slice(0, 200),
    );
  }
}
