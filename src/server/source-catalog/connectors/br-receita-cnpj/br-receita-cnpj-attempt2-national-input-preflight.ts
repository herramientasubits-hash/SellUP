/**
 * BR Receita CNPJ — ATTEMPT #2 NATIONAL INPUT PREFLIGHT (BR-SOURCE-ATTEMPT2-OPS § 6–§ 10, § 12).
 *
 * The join between the two sides that already existed and had never been connected on the benchmark
 * path:
 *
 *   EXPECTED — BR-SOURCE-14B.0K's publisher-derived 2026-07 part-identity inventory, imported from the
 *              canonical artifact and parsed by its own fail-closed parser. Not a second transcription,
 *              not a count literal, and not a period substitution: a period with no transcribed listing
 *              gets NO expectation, and the gate's `indeterminate` stands (§ 6).
 *
 *   OBSERVED — the metadata-derived inventory of the manifest THIS invocation selected, built by
 *              `buildBrazilReceitaObservedInputInventory` from `lstat`-level facts (§ 7).
 *
 * Both go into `evaluateBrazilReceitaNationalInputCompleteness` — 14B.0J's gate, unchanged — and its
 * result is what the benchmark's `nationalInputCompleteness` declaration carries. § 8 is explicit that
 * there must be no second completeness algorithm, so this module computes no verdict of its own: it
 * assembles inputs, calls the gate once, and reports what the gate said.
 *
 * ── Identity, reported alongside the verdict (§ 6, § 10) ────────────────────────
 * The expected side keeps its exact part IDENTITIES rather than collapsing to `expectedCount = 10`, so a
 * refused run can tell an owner WHICH ordinal is absent instead of only that one is. The identities are
 * evidence in the report; the verdict still comes from the gate alone.
 *
 * ── This module NEVER ───────────────────────────────────────────────────────────
 *   - imports `node:fs`, opens a file, stats a path, or performs a request. It is a pure function over
 *     records the caller already holds.
 *   - emits a path, a directory, a file name, a CNPJ or a join key.
 *   - authorizes an attempt, mutates the attempt ledger, or changes a cap.
 *   - reports `complete` because nothing contradicted it, or infers one period's inventory from another.
 *   - touches Supabase, a migration, the runtime, Agent 1, a provider, HubSpot or the UI.
 */

import {
  BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07,
  BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS,
  deriveBrazilReceitaExpectedPartKeys,
  deriveBrazilReceitaNationalExpectedInventory,
  parseBrazilReceitaPublisherInventory,
  type BrazilReceitaPublisherInventoryDocument,
  type BrazilReceitaPublisherInventoryStatus,
} from './br-receita-cnpj-14b0k-publisher-inventory';
import type { BrazilReceitaObservedInputInventoryResult } from './br-receita-cnpj-attempt2-observed-input-inventory';
import {
  BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE,
  BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE,
  BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES,
  brazilReceitaNationalInputSatisfiesAttempt2,
  evaluateBrazilReceitaNationalInputCompleteness,
  type BrazilReceitaNationalInputCompletenessResult,
} from './br-receita-cnpj-national-input-completeness';

// ─── Expected side ────────────────────────────────────────────────────────────

/**
 * The transcribed publisher listing for a period, or `null`.
 *
 * An explicit per-period lookup rather than a default: 14B.0K § 2 forbids inferring one month's
 * inventory from another, and a function that returned the 2026-07 document for 2026-08 would be doing
 * exactly that. `null` flows through the parser as `unavailable`, through the derivation as `null`, and
 * out of the gate as `indeterminate` — a refusal, at every step.
 */
export function brazilReceitaAttempt2PublisherInventoryForPeriod(
  period: string,
): BrazilReceitaPublisherInventoryDocument | null {
  if (typeof period !== 'string') return null;
  const normalized = period.trim();
  if (!BRAZIL_RECEITA_PUBLISHER_RESOLVED_PERIODS.includes(normalized)) return null;
  return BRAZIL_RECEITA_PUBLISHER_INVENTORY_2026_07;
}

// ─── Preflight ────────────────────────────────────────────────────────────────

export interface BrazilReceitaAttempt2NationalInputPreflightRequest {
  readonly period: string;
  /**
   * The observed-side scan for this invocation's manifest.
   *
   * `null` models a caller that has not inspected anything — which after this milestone is only the
   * `--readiness` path, and which the gate answers with `indeterminate`.
   */
  readonly observedInventory: BrazilReceitaObservedInputInventoryResult | null;
}

export interface BrazilReceitaAttempt2NationalInputPreflight {
  readonly period: string;
  /** Whose word the expectation is on. Never the run's own operator. */
  readonly expectedInventorySource: typeof BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE;
  readonly expectedInventoryStatus: BrazilReceitaPublisherInventoryStatus;
  /** `false` exactly when this period has no transcribed publisher listing. */
  readonly expectedInventoryDeclared: boolean;
  /** `false` exactly when nothing was inspected on the observed side. */
  readonly observedInventoryDeclared: boolean;
  /** Exact expected part identities per required family (§ 6). Empty when there is no expectation. */
  readonly expectedPartKeysByFamily: Readonly<Record<string, readonly string[]>>;
  /** Present, usable descriptors per required family — § 11's 10 + 10 check, as data. */
  readonly observedDescriptorCountsByFamily: Readonly<Record<string, number>>;
  /** 14B.0J's gate result, verbatim. The value the benchmark declaration must carry. */
  readonly completeness: BrazilReceitaNationalInputCompletenessResult;
  /** `verdict === 'complete' && inputScope === 'full_national'`, from the gate's own helper. */
  readonly satisfiesAttempt2: boolean;
  readonly requiredAttempt2InputScope: typeof BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE;
  /** Structural assertions (§ 19). No code path can change them. */
  readonly rowsRead: 0;
  readonly sourceReaderCalls: 0;
}

/**
 * Runs the national-input preflight for one invocation.
 *
 * The ORDER is the point. The expected side is resolved first, from the publisher and for the exact
 * declared period; the observed side is taken as given; the gate is called ONCE with both; and the
 * verdict is read back rather than recomputed. Nothing here can turn an absent expectation or an
 * uninspected manifest into a `complete` — both arrive at the gate as `null` and leave it as
 * `indeterminate`.
 */
export function evaluateBrazilReceitaAttempt2NationalInputPreflight(
  request: BrazilReceitaAttempt2NationalInputPreflightRequest,
): BrazilReceitaAttempt2NationalInputPreflight {
  const period = typeof request.period === 'string' ? request.period.trim() : '';
  const publisher = parseBrazilReceitaPublisherInventory(
    brazilReceitaAttempt2PublisherInventoryForPeriod(period),
    period,
  );
  const expected = deriveBrazilReceitaNationalExpectedInventory(publisher);

  const expectedPartKeysByFamily: Record<string, readonly string[]> = {};
  for (const family of BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES) {
    expectedPartKeysByFamily[family] = deriveBrazilReceitaExpectedPartKeys(publisher, family);
  }

  const observedScan = request.observedInventory ?? null;
  const observed = observedScan === null ? null : observedScan.observed;

  const completeness = evaluateBrazilReceitaNationalInputCompleteness({
    period,
    observed,
    expected,
  });

  const observedDescriptorCountsByFamily: Record<string, number> = {};
  for (const family of BRAZIL_RECEITA_NATIONAL_REQUIRED_FAMILIES) {
    observedDescriptorCountsByFamily[family] =
      observedScan?.requiredFamilyDescriptorCounts[family] ?? 0;
  }

  return {
    period,
    expectedInventorySource: BRAZIL_RECEITA_NATIONAL_EXPECTED_INVENTORY_SOURCE,
    expectedInventoryStatus: publisher.status,
    expectedInventoryDeclared: expected !== null,
    observedInventoryDeclared: observed !== null,
    expectedPartKeysByFamily: Object.freeze(expectedPartKeysByFamily),
    observedDescriptorCountsByFamily: Object.freeze(observedDescriptorCountsByFamily),
    completeness,
    satisfiesAttempt2: brazilReceitaNationalInputSatisfiesAttempt2(completeness),
    requiredAttempt2InputScope: BRAZIL_RECEITA_NATIONAL_REQUIRED_ATTEMPT_2_INPUT_SCOPE,
    rowsRead: 0,
    sourceReaderCalls: 0,
  };
}
