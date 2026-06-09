/**
 * Artifact input hashing utilities — Hotfix 16AB.23.4 / 16AB.23.5
 *
 * Deterministic SHA-256 fingerprints for each pipeline stage's inputs.
 * An artifact is only reusable when its stored inputHash matches the one
 * computed from the current inputs. Order-independent: candidate arrays
 * are sorted by stable key before hashing.
 *
 * 16AB.23.5: computeVerificationCandidateInputHash now includes
 * anthropicSearchAuditVersion so all pre-audit verification artifacts are
 * invalidated and must be re-verified with the new audit trail.
 * Discovery, prefilter, and dedup artifacts are NOT affected.
 */

import { createHash } from 'crypto';
import { SEARCH_AUDIT_VERSION } from './web-search-audit';
import { EVIDENCE_PROVENANCE_VERSION } from '../url-canonicalizer';
import type { DiscoveryCandidate, VerifiedCandidateResult } from './ms-types';

export const CURRENT_ARTIFACT_VERSION = 1;

// ─── String normalizers ───────────────────────────────────────────────────────

/** Normalize a URL to bare domain (lowercase, no www). */
export function normalizeDomain(url?: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, '');
  }
}

/** Normalize a company name: lowercase, collapse whitespace, strip common legal suffixes. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(s\.a\.s?\.?|s\.a\.|ltda\.?|inc\.?|llc\.?|corp\.?|\bsa\b)\b/gi, '')
    .trim();
}

// ─── Candidate identity ───────────────────────────────────────────────────────

/**
 * Stable 16-hex identity key for a candidate.
 * Priority: normalized domain → normalized name.
 * Never uses array index — survives reordering.
 */
export function computeCandidateKey(c: { name: string; website?: string | null }): string {
  const domain = normalizeDomain(c.website);
  const identity = domain || normalizeName(c.name);
  return createHash('sha256').update(identity).digest('hex').slice(0, 16);
}

// ─── Core hash primitive ──────────────────────────────────────────────────────

/**
 * Deep-normalize a plain object for stable hashing:
 * - Sort all object keys alphabetically (recursive)
 * - Undefined → null
 * - Arrays are preserved in the order the caller provides
 *   (callers must sort arrays themselves when order is semantic-independent)
 */
function deepNormalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepNormalize);
  const obj = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = deepNormalize(obj[k]);
  }
  return sorted;
}

/** Produce a 16-hex-char deterministic hash of any serializable object. */
export function computeArtifactInputHash(input: Record<string, unknown>): string {
  const normalized = deepNormalize(input);
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .slice(0, 16);
}

// ─── Per-stage input hash functions ──────────────────────────────────────────

/**
 * Stage 3 prefilter — depends on the SET of discovered candidates (order-independent).
 * Changing even one candidate key triggers recomputation.
 */
export function computePrefilterInputHash(
  candidates: DiscoveryCandidate[],
  pipelineVersion: string
): string {
  return computeArtifactInputHash({
    pipelineVersion,
    stage: 'stage3_prefilter',
    candidateKeys: candidates.map(computeCandidateKey).sort(),
  });
}

/**
 * Stage 4 external dedup — depends on the SET of prefilterd candidates.
 * Changing the pool (new or removed candidates) triggers re-dedup.
 */
export function computeDedupInputHash(
  prefilteredCandidates: DiscoveryCandidate[],
  pipelineVersion: string
): string {
  return computeArtifactInputHash({
    pipelineVersion,
    stage: 'stage4_dedup',
    candidateEntries: prefilteredCandidates
      .map((c) => ({ key: computeCandidateKey(c), domain: normalizeDomain(c.website), name: normalizeName(c.name) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
}

/**
 * Stage 5 per-candidate verification.
 * Changes when: candidate data changes, model changes, pipeline version changes,
 * or the search audit schema version changes (16AB.23.5: SEARCH_AUDIT_VERSION).
 *
 * Adding anthropicSearchAuditVersion invalidates all pre-audit verification
 * artifacts (Simetrik, Truora, B-Secure, etc.) so they must be re-verified
 * with the new audit trail. Discovery/prefilter/dedup are NOT affected.
 *
 * Excludes evidence_url (unstable deep links) and notes (metadata only).
 */
export function computeVerificationCandidateInputHash(
  c: DiscoveryCandidate,
  country: string,
  pipelineVersion: string,
  model: string
): string {
  return computeArtifactInputHash({
    pipelineVersion,
    model,
    stage: 'stage5_verification',
    country,
    anthropicSearchAuditVersion: SEARCH_AUDIT_VERSION,
    evidenceProvenanceVersion: EVIDENCE_PROVENANCE_VERSION,
    candidateKey: computeCandidateKey(c),
    name: normalizeName(c.name),
    domain: normalizeDomain(c.website),
    city: c.city ?? null,
    sector: c.sector,
    description: c.description ?? null,
    evidence_source: c.evidence_source ?? null,
  });
}

/**
 * Stage 6 selection — depends on the SET of accepted verified candidates and requested count.
 * If new verified candidates appear the selection must be recomputed.
 */
export function computeSelectionInputHash(
  acceptedVerified: VerifiedCandidateResult[],
  requestedCount: number,
  pipelineVersion: string
): string {
  return computeArtifactInputHash({
    pipelineVersion,
    stage: 'stage6_selection',
    requestedCount,
    candidateKeys: acceptedVerified
      .map((v) =>
        computeCandidateKey({ name: v.resolved_name ?? v.original_name, website: v.official_website })
      )
      .sort(),
  });
}
