/**
 * BR Receita CNPJ — the post-discovery ENRICHMENT ADAPTER. The seam that connects the published
 * monthly snapshot to the wizard's normal country-enrichment path.
 * Milestone: BR-SOURCE-FUNCTIONAL-CUT-B — runtime snapshot → published reader → Agent 1 adapter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ-ONLY, SNAPSHOT-ONLY. No Receita download, no provider, no credit, no
 * HubSpot, no live API. It reads exactly one thing: the single PUBLISHED
 * monthly run, through `readBrReceitaPublishedSnapshot`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── 🔴 CUT B2: a batch is pinned to a PUBLICATION, not to a month ───────────
 *
 * Binding a month is not enough. A month can be republished — run A superseded, run B published,
 * both `2026-08` — and an adapter bound to `2026-08` alone would read A for the first candidates
 * and B for the rest, because the published-run reader re-resolves "which run is published?" on
 * every call. So the batch path binds a `BrReceitaPinnedPublication` (month + run id, minted once
 * at the start of the run) and reads through `readBrReceitaPinnedSnapshot`, which never asks that
 * question. The unpinned, month-only path is retained for one-shot lookups and is unchanged.
 *
 * ── 🔴 The period is REQUIRED and is never inferred ─────────────────────────
 *
 * `SourceEnrichmentInput` has no period field, because every other validated source is
 * year-grained. Brazil is not: twelve publications share one year. An adapter that "used the
 * latest one" would be inventing a period at read time — the exact thing CUT A's reader contract
 * forbids, and the thing that would make an enrichment silently mix months.
 *
 * So the period is bound at CONSTRUCTION, by the caller that knows which month it is enriching
 * against. An unbound adapter is not an adapter that guesses: it is one that answers `skipped`
 * with `br_snapshot_period_not_configured`, every time, for every candidate. That is the
 * fail-closed direction, and it is why the registry can carry Brazil today without any month
 * being asserted on the wizard's behalf.
 *
 * ── 🔴 What this adapter may return ─────────────────────────────────────────
 *
 * Only fields already inside `BrReceitaCnpjSnapshotRawData`, which is GATE-3's closed allowlist
 * and GATE-5's output contract. Sócios, QSA, CPF, personal names, phones, e-mail and fine-grained
 * street address are not filtered out here — they DO NOT EXIST on the shape at all, because the
 * parser never built them. Non-emission is structural, not a rule this module remembers.
 *
 * The CNPJ itself never appears in the output. It goes IN as a lookup key and the reader returns
 * an identity-free projection, so there is nowhere for it to come back from.
 */

import {
  readBrReceitaPublishedSnapshot,
  type BrReceitaPublishedReadResult,
} from './br-receita-cnpj-published-snapshot-reader';
import {
  readBrReceitaPinnedSnapshot,
  type BrReceitaPinnedReadResult,
} from './br-receita-cnpj-pinned-snapshot-reader';
import type { BrReceitaPinnedPublication } from './br-receita-cnpj-pinned-publication';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
  type BrReceitaCnpjSnapshotRawData,
} from './br-receita-cnpj-types';
import { normalizeBrazilCnpj } from './br-cnpj';
import { parseSourcePeriod, sourcePeriodYear } from '../../source-period';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';
import type {
  SourceCapability,
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
} from '../../enrichment/types';

/**
 * What Brazil claims to do.
 *
 * 🔴 Deliberately NOT `commercial_signals` and NOT `prioritization`. Receita is a legal registry:
 * it says what a company IS, not whether it is worth contacting. Claiming a prioritization
 * capability would put a `priorityBoost` in the ranking path on the strength of a CNAE code,
 * which nobody decided. `priorityBoost` is 0 on every branch below.
 */
export const BR_RECEITA_ENRICHMENT_CAPABILITIES: SourceCapability[] = [
  'enrichment_after_discovery',
  'tax_id_validation',
];

/**
 * The `raw_data` keys this adapter is authorized to surface, as data.
 *
 * Recorded as a list so a test can assert the emitted signal set EQUALS it, rather than merely
 * "contains no CPF" — an allowlist proven by equality cannot be widened by an accident.
 */
export const BR_RECEITA_ENRICHMENT_SIGNAL_KEYS = [
  'registration_status_code',
  'registration_status_label',
  'cnae_main_code',
  'cnae_main_label',
  'cnae_secondary_codes',
  'company_size_code',
  'capital_social_value',
  'municipality_code',
  'municipality_name',
  'uf',
  'start_date',
  'matrix_branch_flag',
] as const;

export interface BrReceitaEnrichmentDeps {
  /** Returns the snapshot read client, or `null` when one cannot be built. */
  readonly getClient?: () => SnapshotReadClient<SnapshotIdentityRow> | null;
  /**
   * The published-run reader — the UNPINNED path, used only when no publication was pinned.
   * Injected so the whole adapter is testable offline.
   */
  readonly read?: typeof readBrReceitaPublishedSnapshot;
  /** The pinned reader — the path every Agent 1 run takes (CUT B2). */
  readonly readPinned?: typeof readBrReceitaPinnedSnapshot;
}

export interface BrReceitaEnrichmentConfig extends BrReceitaEnrichmentDeps {
  /**
   * The month to read, canonical `YYYY-MM`.
   *
   * 🔴 `undefined` is a real, supported state and it means "no month has been chosen": every
   * call then answers `skipped`. It does NOT mean "pick one".
   *
   * When `publication` is also bound, this MUST be that publication's month — it is derived from
   * the pin by the caller, and a disagreement between the two is a bug, not a preference to
   * resolve. Mismatch fail-closes rather than silently picking one of the two.
   */
  readonly sourcePeriod?: string;
  /**
   * The publication this adapter is pinned to, for the whole run (CUT B2).
   *
   * 🔴 Bound, the adapter reads EXACTLY this publication and never asks which run is currently
   * published — so a same-month republication mid-run cannot move it. Unbound, the adapter keeps
   * CUT B1 behaviour: it reads whichever run is published for the configured month, which is
   * correct for a one-shot lookup and NOT correct for a batch.
   */
  readonly publication?: BrReceitaPinnedPublication;
}

// ─── Output builders ────────────────────────────────────────────────────────

function baseOutput(): Pick<
  SourceEnrichmentOutput,
  'sourceKey' | 'matchedBy' | 'confidence' | 'priorityBoost'
> {
  return {
    sourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
    matchedBy: null,
    confidence: 0,
    priorityBoost: 0,
  };
}

function skipped(reason: string): SourceEnrichmentOutput {
  return { ...baseOutput(), status: 'skipped', reason };
}

function noMatch(reason: string): SourceEnrichmentOutput {
  return { ...baseOutput(), status: 'no_match', reason };
}

function errored(reason: string): SourceEnrichmentOutput {
  return { ...baseOutput(), status: 'error', reason };
}

/**
 * Projects the identity-free snapshot into the wizard's enrichment shape.
 *
 * 🔴 Built key by key from `BR_RECEITA_ENRICHMENT_SIGNAL_KEYS` rather than by spreading
 * `raw_data`. A spread would emit whatever the payload happens to carry, which is how a future
 * allowlist change silently becomes a disclosure. `source_row_index`, `parser_version`,
 * `source_file_name`, `import_batch_id` and the other provenance keys stay out: they describe the
 * IMPORT, not the company, and `source_file_name` in particular is operator-side detail.
 */
function matched(
  read: Pick<BrReceitaPublishedReadResult, 'snapshot' | 'snapshotRunId'>,
): SourceEnrichmentOutput {
  const snapshot = read.snapshot;
  if (snapshot === null) {
    return errored('published_read_returned_no_snapshot');
  }
  const raw: BrReceitaCnpjSnapshotRawData = snapshot.raw_data;

  const signals: Record<string, unknown> = {
    registration_status_code: raw.registration_status_code,
    registration_status_label: raw.registration_status_label,
    cnae_main_code: raw.cnae_main_code,
    cnae_main_label: raw.cnae_main_label,
    cnae_secondary_codes: [...raw.cnae_secondary_codes],
    company_size_code: raw.company_size_code,
    capital_social_value: raw.capital_social_value,
    municipality_code: raw.municipality_code,
    municipality_name: raw.municipality_name,
    uf: raw.uf,
    start_date: raw.start_date,
    matrix_branch_flag: raw.matrix_branch_flag,
  };

  return {
    sourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
    status: 'matched',
    // The lookup key WAS the fiscal identity, and the match was exact — so this is `tax_id`
    // rather than a name match. Nothing about the identity travels in the output; only the fact
    // that the identity is what resolved it.
    matchedBy: 'tax_id',
    confidence: 1,
    sourceYear: sourcePeriodYear(snapshot.source_period),
    priorityBoost: 0,
    signals,
    metadata: {
      // Provenance a reviewer needs to know WHICH publication answered.
      source_period: snapshot.source_period,
      snapshot_run_id: read.snapshotRunId,
      legal_name: snapshot.legal_name,
      human_review_required: raw.human_review_required,
      source_type: raw.source_type,
    },
  };
}

/**
 * Maps a PINNED read into the wizard's enrichment shape.
 *
 * Kept separate from the unpinned mapping on purpose: the two readers have different closed status
 * sets, and collapsing them into one `switch` over a widened union is how a status silently starts
 * falling through to the wrong branch.
 */
function fromPinnedRead(result: BrReceitaPinnedReadResult): SourceEnrichmentOutput {
  switch (result.status) {
    case 'FOUND':
      return matched(result);
    case 'NOT_IN_PINNED_PUBLICATION':
      return noMatch('establishment_absent_from_published_run');
    case 'INVALID_IDENTITY':
      return skipped(result.reason);
    case 'INVALID_PINNED_PUBLICATION':
      // 🔴 An error, NOT a `no_match`: "we could not trust the publication we were told to read"
      // is an operator-visible failure, and answering "this company is not in Receita" would be a
      // lie about the company.
      return errored(`br_pinned_publication_rejected:${result.reason}`);
    case 'CARDINALITY_VIOLATION':
      // Observable, never silently collapsed to one arbitrary row.
      return {
        ...baseOutput(),
        status: 'no_match',
        reason: result.reason,
        signals: {
          human_review_required: true,
          observed_count: result.observedCount,
        },
      };
    default:
      return errored('unexpected_pinned_read_status');
  }
}

// ─── The core ───────────────────────────────────────────────────────────────

/**
 * Enriches ONE candidate from the published Brazilian monthly snapshot.
 *
 * Guard order is load-bearing and mirrors the EC SCVS adapter: country, then configured period,
 * then identity — all BEFORE a client is built or a query is sent, so a candidate that cannot be
 * looked up never becomes a database round trip.
 *
 * Fail-soft: never throws. `fallbackBehavior: 'skip_without_blocking'` means the wizard must be
 * able to carry on, and a reader that threw would surface a driver error into a `catch` that
 * would probably log it.
 */
export async function enrichBrReceitaCnpjCandidate(
  input: SourceEnrichmentInput,
  config: BrReceitaEnrichmentConfig = {},
): Promise<SourceEnrichmentOutput> {
  // Guard 1 — Brazil only.
  if ((input.countryCode ?? '').toUpperCase() !== BR_RECEITA_CNPJ_COUNTRY_CODE) {
    return skipped('not_br_country');
  }

  // Guard 2 — the month must have been CHOSEN. Never inferred, never defaulted.
  //
  // 🔴 When a publication is pinned, the month comes FROM THE PIN and not from a second config
  // field that could disagree with it. `sourcePeriod` remains accepted alongside a pin because the
  // caller derives it from the pin for observability, and the two disagreeing is a bug — so it
  // fail-closes instead of quietly electing a winner.
  const pinned = config.publication;
  const parsedPeriod = parseSourcePeriod(
    pinned === undefined ? config.sourcePeriod : pinned.sourcePeriod,
  );
  if (!parsedPeriod.valid) {
    if (pinned !== undefined) {
      return skipped(`br_pinned_publication_period_${parsedPeriod.reason}`);
    }
    return skipped(
      config.sourcePeriod === undefined
        ? 'br_snapshot_period_not_configured'
        : `br_snapshot_period_${parsedPeriod.reason}`,
    );
  }
  if (
    pinned !== undefined &&
    config.sourcePeriod !== undefined &&
    config.sourcePeriod !== pinned.sourcePeriod
  ) {
    return skipped('br_snapshot_period_pin_mismatch');
  }

  // Guard 3 — an exact CNPJ is required. Receita is looked up by establishment identity, never
  // by name: a razão social is not an identity (§ 5.3 MEI/EI caveat) and a name match would be a
  // different, unapproved grain.
  const rawCandidateTaxId = input.candidateTaxId;
  if (rawCandidateTaxId === null || rawCandidateTaxId === undefined || rawCandidateTaxId.trim() === '') {
    return skipped('missing_cnpj');
  }
  const normalized = normalizeBrazilCnpj(rawCandidateTaxId);
  if (normalized.status !== 'valid') {
    // Reason is the normalizer's CATEGORY. The rejected value is never echoed.
    return skipped(`invalid_cnpj_${normalized.reason ?? 'invalid'}`);
  }

  const getClient = config.getClient;
  const read = config.read ?? readBrReceitaPublishedSnapshot;
  const readPinned = config.readPinned ?? readBrReceitaPinnedSnapshot;

  try {
    const client = getClient === undefined ? null : getClient();
    if (client === null) {
      return errored('br_snapshot_client_unavailable');
    }

    // ── The pinned path. No "which run is published?" question is asked here or below it. ──
    if (pinned !== undefined) {
      return fromPinnedRead(
        await readPinned({ client, publication: pinned, cnpj: rawCandidateTaxId }),
      );
    }

    const result = await read({
      client,
      sourcePeriod: parsedPeriod.sourcePeriod,
      cnpj: rawCandidateTaxId,
    });

    switch (result.status) {
      case 'FOUND':
        return matched(result);
      case 'NOT_IN_PUBLISHED_RUN':
        return noMatch('establishment_absent_from_published_run');
      case 'NO_PUBLISHED_RUN':
        // 🔴 NOT an error and NOT a reason to read another month. The requested period simply
        // has no publication; the honest answer is "no match in that month".
        return noMatch('br_period_has_no_published_run');
      case 'INVALID_PERIOD':
      case 'INVALID_IDENTITY':
        return skipped(result.reason);
      case 'AMBIGUOUS_PUBLISHED_RUN':
      case 'CARDINALITY_VIOLATION':
        // Observable, never silently collapsed to one arbitrary row — the same discipline the
        // EC SCVS adapter applies to RUC multiplicity.
        return {
          ...baseOutput(),
          status: 'no_match',
          reason: result.reason,
          signals: {
            human_review_required: true,
            observed_count: result.observedCount,
          },
        };
      default:
        return errored('unexpected_published_read_status');
    }
  } catch (error) {
    // 🔴 The message is NOT forwarded. `BrReceitaPublishedReadQueryError` carries a provider code
    // and nothing else, and any other error is reported by class name only.
    const name =
      typeof error === 'object' && error !== null && typeof (error as Error).name === 'string'
        ? (error as Error).name
        : 'non_error_thrown';
    return errored(`br_snapshot_read_failed:${name}`);
  }
}

// ─── The adapter ────────────────────────────────────────────────────────────

/**
 * Builds a Brazil enrichment adapter bound to ONE period.
 *
 * This is the integration point a caller that knows its month uses. Called with no period — as
 * the registry does — it produces an adapter that fail-closes on every candidate rather than one
 * that picks a month.
 */
export function createBrReceitaCnpjEnrichmentAdapter(
  config: BrReceitaEnrichmentConfig = {},
): SourceEnrichmentAdapter {
  return {
    sourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
    supportedCapabilities: BR_RECEITA_ENRICHMENT_CAPABILITIES,
    enrichCandidate: (input: SourceEnrichmentInput) =>
      enrichBrReceitaCnpjCandidate(input, config),
  };
}

/**
 * Builds a Brazil enrichment adapter pinned to ONE publication — the factory every Agent 1 run
 * uses (CUT B2).
 *
 * The month is DERIVED from the publication rather than passed alongside it, so the two cannot
 * disagree at this seam at all. Bound this way, the adapter reads exactly the pinned run for every
 * candidate: a same-month republication mid-run does not move it, and the run that pinned A
 * finishes on A even after A becomes `superseded` (§ 4).
 */
export function createBrReceitaCnpjPinnedEnrichmentAdapter(
  publication: BrReceitaPinnedPublication,
  deps: BrReceitaEnrichmentDeps = {},
): SourceEnrichmentAdapter {
  return createBrReceitaCnpjEnrichmentAdapter({
    ...deps,
    publication,
    sourcePeriod: publication.sourcePeriod,
  });
}

/**
 * The pinning contract this adapter satisfies, as data.
 */
export const BR_RECEITA_ENRICHMENT_PIN_CONTRACT = {
  milestone: 'BR-SOURCE-FUNCTIONAL-CUT-B2',
  appliesToSourceKey: BR_RECEITA_CNPJ_SOURCE_KEY,
  periodDerivedFromPin: true,
  resolvesPublishedRunPerCandidate: false,
  acceptsRunIdAsPlainString: false,
  failsClosedOnPeriodPinMismatch: true,
  requiresExactCnpj: true,
  resolvesIdentityByName: false,
} as const;

/**
 * The registry entry.
 *
 * 🔴 Deliberately UNBOUND. Registering Brazil makes the source REACHABLE by the normal
 * country-enrichment path; it does not assert which month the wizard is enriching against, and
 * nothing in this cut is entitled to decide that. Until a caller binds a period through
 * `createBrReceitaCnpjEnrichmentAdapter`, every call answers
 * `skipped / br_snapshot_period_not_configured` — visible, greppable and honest, rather than a
 * source that quietly reads whatever month happens to be published.
 */
export const brReceitaCnpjEnrichmentAdapter: SourceEnrichmentAdapter =
  createBrReceitaCnpjEnrichmentAdapter();
