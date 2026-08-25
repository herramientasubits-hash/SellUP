/**
 * BR Receita CNPJ — the PINNED PUBLICATION. One publication, pinned once, for a whole Agent 1 run.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B2 — pin exact publication for the whole Agent 1 run.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY. One SELECT against `source_snapshot_runs`, projecting three
 * columns. No Supabase client is created here: one is injected. No CNPJ is
 * involved at any point — this module never sees, accepts or returns tax
 * material, and cannot: nothing on its surface takes an identity.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What CUT B1 fixed, and the race it left open ────────────────────────────
 *
 * CUT B1 froze the `source_period` once per run, so a run that started on 2026-08 could no longer
 * drift to 2026-09 mid-flight. That closed the CROSS-MONTH race and left the SAME-MONTH one wide
 * open, because the period is not the physical publication:
 *
 *     2026-08 / run A = published        Agent 1 starts, freezes "2026-08"
 *     candidate 1                    →   reader resolves the published run of 2026-08  → A
 *     ── meanwhile, a rebuild republishes the same month ──
 *     A → superseded, B → published, B is ALSO 2026-08
 *     candidate 2                    →   reader resolves the published run of 2026-08  → B
 *
 * Both reads are period-correct. Both are individually well-formed. Nothing errors. And the batch
 * is now half A and half B — two different physical extractions of the same month — which is the
 * exact outcome "one run = one photograph of Receita" exists to forbid. The reader re-resolving
 * "which run is published?" per candidate is the whole defect, and no amount of period freezing
 * reaches it.
 *
 * So the run-level decision is widened from a period to a PUBLICATION: period AND run id, chosen
 * together, once, from one query, before the first candidate is read.
 *
 * ── 🔴 Pinned ≠ still published ─────────────────────────────────────────────
 *
 * A pin records "this was the chosen publication when this run started". It does NOT assert "this
 * run must remain `published` for every candidate". After the pin exists, A may legitimately
 * become `superseded` and the run that pinned it MUST still finish reading A — a run that started
 * coherent and then broke because someone republished mid-flight is strictly worse than a run that
 * finishes on a slightly older, wholly coherent photograph. The NEXT run pins again and gets B.
 *
 * That is why the pinned reader does not re-check `publish_state`: re-checking it would resurrect
 * the very coupling this cut removes. The check belongs HERE, at pin time, once.
 *
 * ── 🔴 Unforgeable by construction ──────────────────────────────────────────
 *
 * `BrReceitaPinnedPublication` is a class with a PRIVATE constructor and a private nominal field,
 * so a caller cannot build one from a period plus a UUID string it happens to hold and cannot
 * satisfy the type with an object literal either — TypeScript's structural assignability stops at
 * the private member.
 *
 * That is the COMPILE-TIME half. TypeScript erases `private`, so `new (Cls as any)(…)` would still
 * mint a real instance at runtime and would then satisfy an `instanceof` guard — which would make
 * the guard theatre. So the constructor additionally demands a module-private mint token that no
 * caller outside this file can obtain. Forging a pin therefore fails in BOTH directions: the type
 * refuses it, and the runtime refuses it.
 *
 * The only way to obtain a pin is to resolve a publication that was `published` at that moment. A
 * run id therefore never enters the read path as an arbitrary caller-supplied string, which is what
 * made the per-candidate resolution look unavoidable in the first place.
 *
 * ── 🔴 What pinning will NOT do ─────────────────────────────────────────────
 *
 *   · no `latest imported_at`, no `latest created_at` — those order IMPORTS, not publications
 *   · no clock, no "current month" — a period is data, never derived from `Date`
 *   · no fallback to a `preparing` / `failed` / `superseded` / `rolled_back` run
 *   · no fallback to the PREVIOUS month when the newest publication is unusable: a malformed or
 *     ambiguous winner fails the run closed, it does not quietly demote it to an older month
 *   · no second query — the period and the run id come from ONE snapshot of the table, so there
 *     is no window between "which month?" and "which run of that month?" for a republication to
 *     slip through
 */

import { BR_RECEITA_READABLE_PUBLISH_STATE } from './br-receita-cnpj-monthly-snapshot-read-contract';
import { parseSnapshotRunId } from './br-receita-cnpj-monthly-snapshot-run-handle';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from './br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from './br-receita-cnpj-types';
import { compareSourcePeriods, parseSourcePeriod } from '../../source-period';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';

/**
 * The three columns the pin projects.
 *
 * 🔴 Not `*` and not `imported_at`. `id` is the publication being pinned, `source_period` is the
 * month it publishes, and `publish_state` is re-read so the pin is validated against what the row
 * actually says rather than against the filter that was sent — holding a run id proves the run
 * exists, never that it is the published one.
 */
export const BR_RECEITA_PINNED_PUBLICATION_SELECT_COLUMNS =
  'id, source_period, publish_state' as const;

/**
 * Bounded probe window.
 *
 * One published run per month (migration 127's partial unique index) means a year of publications
 * is 12 rows. The window is sized so the greatest period is inside it under any realistic
 * retention, while a pathological table can never return an unbounded payload. The maximum is then
 * recomputed IN CODE rather than trusted from the server's sort, so the answer does not depend on
 * a collation for a string whose ordering the application already defines.
 */
export const BR_RECEITA_PINNED_PUBLICATION_PROBE_LIMIT = 12;

/**
 * Picks the greatest canonical period out of a set of publication rows. PURE.
 *
 * Shared with the period-only resolver so "which month is the current publication?" has exactly
 * ONE implementation of its policy, and the pin cannot drift from it. A row whose period is not
 * canonical `YYYY-MM` is DROPPED, never repaired: migration 127's CHECK makes it impossible, and
 * "impossible" is exactly the claim that quietly stops being true. Dropping can only ever narrow
 * the answer to an older, still-published month.
 */
export function pickGreatestCanonicalPeriod(
  rows: ReadonlyArray<{ readonly source_period?: unknown }>,
): string | null {
  let greatest: string | null = null;
  for (const row of rows) {
    const parsed = parseSourcePeriod(row.source_period);
    if (!parsed.valid) {
      continue;
    }
    if (greatest === null || compareSourcePeriods(parsed.sourcePeriod, greatest) > 0) {
      greatest = parsed.sourcePeriod;
    }
  }
  return greatest;
}

// ─── The pin ────────────────────────────────────────────────────────────────

/**
 * The mint token.
 *
 * 🔴 Module-private and never exported. It is what makes the private constructor a RUNTIME
 * guarantee rather than a compile-time hint: `private` is erased by the compiler, so a caller
 * willing to cast could otherwise construct a real, `instanceof`-passing instance around any run
 * id it liked — and the pinned reader would then scope a query by it.
 */
const PIN_MINT_TOKEN: unique symbol = Symbol('br-receita-pinned-publication-mint');

/** Thrown when something tries to construct a pin without going through `pin()`. */
export class BrReceitaPinnedPublicationForgeryError extends Error {
  constructor() {
    super(
      'a BrReceitaPinnedPublication may only be minted by resolving a published publication: a pin asserts that its run WAS published when the run started, which a caller-supplied period and run id cannot',
    );
    this.name = 'BrReceitaPinnedPublicationForgeryError';
  }
}


/**
 * ONE publication of the Brazilian monthly snapshot, pinned for the duration of ONE run.
 *
 * 🔴 A class rather than the plain record the rest of this connector prefers, for one reason: the
 * private constructor plus the private nominal field are what make the token UNFORGEABLE. A caller
 * holding `{ sourcePeriod: '2026-08', snapshotRunId: someUuid }` cannot pass it where a pin is
 * required, so "the run id came from a publication that was published" is a type-level fact rather
 * than a convention every future caller has to remember.
 *
 * 🔴 Contains a period and a run id and NOTHING else. No CNPJ, no `legal_name`, no `raw_data` — a
 * publication is a VERSION, and a version has no identity material in it (§ 8).
 */
export class BrReceitaPinnedPublication {
  /** Nominal marker. Its only job is to defeat structural assignability. */
  private readonly _pinnedPublicationBrand = true as const;

  /** Canonical `YYYY-MM`. Log-safe. */
  readonly sourcePeriod: string;

  /**
   * The publication run id. A VERSION identifier, never an identity representation: it is minted
   * by `gen_random_uuid()` and is not derived from any CNPJ (§ 7, § 8). Safe as durable batch
   * provenance; never a telemetry label, a metric dimension or public copy.
   */
  readonly snapshotRunId: string;

  private constructor(mintToken: symbol, sourcePeriod: string, snapshotRunId: string) {
    if (mintToken !== PIN_MINT_TOKEN) {
      throw new BrReceitaPinnedPublicationForgeryError();
    }
    this.sourcePeriod = sourcePeriod;
    this.snapshotRunId = snapshotRunId;
    Object.freeze(this);
  }

  /**
   * Resolves and pins the CURRENT publication — once, at the start of a run.
   *
   * The filter is the published-run reader's coordinates minus the period itself: source, country
   * and `publish_state = 'published'`. Every row it can return is by definition the single
   * published run of some month, so "several rows" is normal and means "several months have a
   * publication" — NOT ambiguity. The ambiguity that matters is two published runs for the SAME
   * month; migration 127's partial unique index makes it impossible, which is exactly why it is
   * reported instead of assumed away.
   */
  static async pin(
    input: BrReceitaPinnedPublicationInput,
  ): Promise<BrReceitaPinnedPublicationResult> {
    const { data, error } = await input.client
      .from(BR_RECEITA_SNAPSHOT_RUNS_TABLE)
      .select(BR_RECEITA_PINNED_PUBLICATION_SELECT_COLUMNS)
      .eq('source_key', BR_RECEITA_CNPJ_SOURCE_KEY)
      .eq('country_code', BR_RECEITA_CNPJ_COUNTRY_CODE)
      .eq('publish_state', BR_RECEITA_READABLE_PUBLISH_STATE)
      .order('source_period', { ascending: false })
      .limit(BR_RECEITA_PINNED_PUBLICATION_PROBE_LIMIT);

    if (error) {
      throw new BrReceitaPinnedPublicationQueryError(codeOf(error));
    }
    if (data === null) {
      // A list query returns an array on success. A null payload with no error is a transport
      // state, not "nothing is published" — never converted into a domain answer.
      throw new BrReceitaPinnedPublicationQueryError(null);
    }

    const rows = data as unknown as ReadonlyArray<Record<string, unknown>>;
    if (rows.length === 0) {
      return failure('NO_PUBLISHED_PUBLICATION', 'no_published_publication_for_source');
    }

    const sourcePeriod = pickGreatestCanonicalPeriod(rows);
    if (sourcePeriod === null) {
      return failure('NO_PUBLISHED_PUBLICATION', 'published_rows_carry_no_canonical_period');
    }

    // 🔴 Only the winning month's rows. A malformed winner is NOT demoted to the month below it:
    // "the newest publication is unusable" and "an older publication is what this run wanted" are
    // different statements, and silently substituting the second for the first is how a run ends
    // up reading a month nobody chose.
    const winners = rows.filter((row) => {
      const parsed = parseSourcePeriod(row.source_period);
      return parsed.valid && parsed.sourcePeriod === sourcePeriod;
    });

    if (winners.length > 1) {
      return failure(
        'AMBIGUOUS_PUBLISHED_PUBLICATION',
        'more_than_one_published_run_for_period',
        winners.length,
      );
    }

    const winner = winners[0] as Record<string, unknown>;

    // 🔴 Re-checked against what the row SAYS, not against the filter that was sent.
    if (winner.publish_state !== BR_RECEITA_READABLE_PUBLISH_STATE) {
      return failure('AMBIGUOUS_PUBLISHED_PUBLICATION', 'resolved_run_is_not_published');
    }

    const parsedRunId = parseSnapshotRunId(winner.id);
    if (!parsedRunId.valid) {
      // Fail closed. `parseSnapshotRunId` already refuses anything that is not a canonical UUID,
      // so this branch cannot carry identity material into the reason either.
      return failure(
        'MALFORMED_PUBLICATION_RUN_ID',
        `published_run_id_${parsedRunId.reason}`,
      );
    }

    return {
      status: 'PINNED',
      reason: 'pinned_current_publication',
      publication: new BrReceitaPinnedPublication(
        PIN_MINT_TOKEN,
        sourcePeriod,
        parsedRunId.runId,
      ),
      observedCount: 1,
    };
  }
}

export type BrReceitaPinnedPublicationStatus =
  /** A publication was pinned. `publication` is the token the whole run must read through. */
  | 'PINNED'
  /** Nothing is published for this source/country. Fail closed; enrich nothing. */
  | 'NO_PUBLISHED_PUBLICATION'
  /** Two publications claim the same month. Index-impossible, therefore reported. */
  | 'AMBIGUOUS_PUBLISHED_PUBLICATION'
  /** The winning publication's id is not a canonical run id. Fail closed, never demoted. */
  | 'MALFORMED_PUBLICATION_RUN_ID';

export interface BrReceitaPinnedPublicationResult {
  readonly status: BrReceitaPinnedPublicationStatus;
  /** A CATEGORY, always safe to log. Never a driver message, never identity. */
  readonly reason: string;
  /** The token, on `PINNED` only. `null` on every refusal — there is no partial pin. */
  readonly publication: BrReceitaPinnedPublication | null;
  /** How many publications were observed for the winning month. */
  readonly observedCount: number | null;
}

export interface BrReceitaPinnedPublicationInput {
  readonly client: SnapshotReadClient<SnapshotIdentityRow>;
}

/**
 * Thrown when the injected client reports a transport/PostgREST failure.
 *
 * 🔴 Carries the provider's `code` only. No filter on this module's query contains identity, but
 * forwarding driver messages is the habit that leaks one on the module next door.
 */
export class BrReceitaPinnedPublicationQueryError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(
      `br receita publication pin failed${code === null ? '' : ` (${code})`}`,
    );
    this.name = 'BrReceitaPinnedPublicationQueryError';
    this.code = code;
  }
}

function codeOf(error: { code?: string } | null): string | null {
  return error && typeof error.code === 'string' ? error.code : null;
}

function failure(
  status: Exclude<BrReceitaPinnedPublicationStatus, 'PINNED'>,
  reason: string,
  observedCount: number | null = null,
): BrReceitaPinnedPublicationResult {
  return { status, reason, publication: null, observedCount };
}

/**
 * Runtime proof that a value really is a pin this module minted.
 *
 * The private field and private constructor make forgery impossible in TypeScript, and the mint
 * token makes it impossible at runtime too. This guard covers the remaining boundary where neither
 * applies: a plain object that never went through the constructor at all — a `JSON.parse`, an `as`
 * cast of a literal, a value that crossed a serialization edge. The pinned reader calls it, so a
 * forged pin is refused BEFORE any query rather than turned into a run-scoped read against a
 * caller-chosen run id.
 */
export function isBrReceitaPinnedPublication(
  value: unknown,
): value is BrReceitaPinnedPublication {
  return value instanceof BrReceitaPinnedPublication;
}

/**
 * Functional face of `BrReceitaPinnedPublication.pin`, so callers and test seams stay functional
 * like every other module in this connector.
 */
export function pinBrReceitaPublication(
  input: BrReceitaPinnedPublicationInput,
): Promise<BrReceitaPinnedPublicationResult> {
  return BrReceitaPinnedPublication.pin(input);
}

/**
 * The contract this module satisfies, as data — so a test asserts the policy rather than a
 * reviewer re-reading the query every time it changes.
 */
export const BR_RECEITA_PINNED_PUBLICATION_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B2',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  requiredPublishStateAtPinTime: BR_RECEITA_READABLE_PUBLISH_STATE,
  pinnedOncePerRun: true,
  pinsPeriodAndRunTogether: true,
  resolvedFromASingleQuery: true,
  /** After pinning, the run may become `superseded` and the pinning run still reads it. */
  survivesPinnedRunBecomingSuperseded: true,
  /** The pinned reader must NOT re-check which run is published. */
  reChecksPublishStatePerCandidate: false,
  ordersByImportedAt: false,
  ordersByCreatedAt: false,
  derivesPeriodFromClock: false,
  fallsBackToUnpublishedRun: false,
  fallsBackToPreviousPeriodOnMalformedWinner: false,
  forgeableByArbitraryCaller: false,
  involvesTaxIdentity: false,
} as const;
