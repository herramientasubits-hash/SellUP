// apollo-industry-raw-label-ingestion.ts — Pure Apollo Organization Industry
// Raw-Label Ingestion Boundary (Q3F-5AP.1).
//
// Converts one provider execution result set (multiple Apollo organization
// industry observations) into a collision-safe, deterministically ordered
// collection of raw labels. Synchronous, pure, side-effect free.
//
// APP / DB layering (ARCH1 — app-dedup-primary, DB-constraint defense in
// depth): this boundary deterministically resolves normalized-key collision
// groups and selects the N3 representative BEFORE any persistence is
// attempted. The DB UNIQUE constraint pice_snapshot_normalized_key_uniq on
// public.provider_industry_concept_entries(snapshot_id, normalized_lookup_key)
// remains in place as a necessary backstop for persisted per-snapshot
// uniqueness and concurrent writers — it is not removed, weakened, or
// bypassed by this boundary.
//
// No server-only, no 'use server', no Supabase/DB import, no fetch, no
// provider client import, no env vars, no clock, no randomness, no logging,
// no usage/cost tracking, no AI. Zero production callers by design.

import { normalizeClassificationValue } from '@/modules/prospect-batches/import-classification/catalog-normalization';

// ── Input contract ────────────────────────────────────────────────────────
// Minimal structural type — intentionally NOT importing ApolloOrganization
// from the provider runtime client. TypeScript structural typing means the
// real Apollo organization shape is assignable here without coupling this
// pure domain module to provider/runtime code.

export interface ApolloOrganizationIndustryObservation {
  readonly industry?: string | null;
  readonly industries?: readonly string[] | null;
}

// ── Output contract ───────────────────────────────────────────────────────
// Narrow public output: only rawLabel is exposed. normalizedLookupKey is an
// internal grouping/ordering detail, not part of the public surface.

export interface ApolloIndustryRawLabel {
  readonly rawLabel: string;
}

// ── Deterministic, locale-independent lexical comparator ─────────────────
// Bare String#localeCompare is intentionally avoided: its collation can vary
// by runtime/locale configuration. This comparator uses ordinal UTF-16
// code-unit ordering, which is stable across environments. It is used both
// for N3 representative selection and for the O3 rawLabel tie-break.

function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface AcceptedCandidate {
  readonly rawLabel: string;
  readonly normalizedLookupKey: string;
}

function collectRawCandidates(
  organizations: readonly ApolloOrganizationIndustryObservation[],
): readonly unknown[] {
  const candidates: unknown[] = [];
  for (const organization of organizations) {
    candidates.push(organization?.industry);
    const industries = organization?.industries;
    if (Array.isArray(industries)) {
      for (const value of industries) {
        candidates.push(value);
      }
    }
  }
  return candidates;
}

function toAcceptedCandidate(candidate: unknown): AcceptedCandidate | null {
  if (typeof candidate !== 'string') return null;

  const trimmedRawLabel = candidate.trim();
  const normalizedLookupKey = normalizeClassificationValue(trimmedRawLabel);
  if (normalizedLookupKey === '') return null;

  return { rawLabel: trimmedRawLabel, normalizedLookupKey };
}

/**
 * N3 — for a normalized-key collision group, selects the lexicographically
 * smallest trimmed rawLabel as the representative. Independent of provider
 * encounter order.
 */
function selectRepresentative(group: readonly AcceptedCandidate[]): AcceptedCandidate {
  let representative = group[0];
  for (let i = 1; i < group.length; i += 1) {
    const candidate = group[i];
    if (compareOrdinal(candidate.rawLabel, representative.rawLabel) < 0) {
      representative = candidate;
    }
  }
  return representative;
}

/**
 * Pure ingestion boundary: converts one provider execution result set of
 * Apollo organization industry observations into a collision-safe, ordered
 * collection of raw labels.
 *
 * Dedup scope (per_provider_execution_result_set): all organizations passed
 * in one call share a single deduplication scope — not one organization at
 * a time.
 *
 * Scalar/array policy (C3): both organization.industry and every value in
 * organization.industries are considered candidates; the scalar is never
 * discarded merely because the array is present.
 *
 * This boundary does not deduplicate by canonical target (D4/out of scope):
 * it has no canonical industry information available.
 */
export function ingestApolloOrganizationIndustryRawLabels(
  organizations: readonly ApolloOrganizationIndustryObservation[],
): readonly ApolloIndustryRawLabel[] {
  const rawCandidates = collectRawCandidates(organizations);

  const groups = new Map<string, AcceptedCandidate[]>();
  for (const candidate of rawCandidates) {
    const accepted = toAcceptedCandidate(candidate);
    if (accepted === null) continue;

    const existingGroup = groups.get(accepted.normalizedLookupKey);
    if (existingGroup) {
      existingGroup.push(accepted);
    } else {
      groups.set(accepted.normalizedLookupKey, [accepted]);
    }
  }

  const representatives: AcceptedCandidate[] = [];
  for (const group of groups.values()) {
    representatives.push(selectRepresentative(group));
  }

  // O3 — normalized_lookup_key ASC, then rawLabel ASC, both using the same
  // ordinal comparator.
  representatives.sort((a, b) => {
    const keyComparison = compareOrdinal(a.normalizedLookupKey, b.normalizedLookupKey);
    if (keyComparison !== 0) return keyComparison;
    return compareOrdinal(a.rawLabel, b.rawLabel);
  });

  return representatives.map((representative) => ({ rawLabel: representative.rawLabel }));
}
