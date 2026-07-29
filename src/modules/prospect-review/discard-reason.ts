// Q3F-5BB.11K-FIX — Discard reason contract (pure decision/normalization layer).
//
// Q3F-5BB.11K-EXECUTE surfaced a traceability defect: the Prospectos surface
// (Route A, the hardened `discardPendingReviewCandidateAction`) never collected
// a reason, so a discard from Prospectos landed `review_notes = null` even
// though the confirmation copy promised "Podrás conservar trazabilidad del
// descarte". The legacy batch-detail surface (Route B) DOES collect a reason.
// This module makes the reason a first-class, validated contract that BOTH the
// client panel and the server action share, so the two can never drift.
//
// Pure: no IO, no DB, no clients, no React. Every branch is unit-testable.
//
// The reason CATALOG (`DISCARD_REASONS` / `DiscardReasonKey`) deliberately stays
// where it already lives (`@/modules/prospect-batches/types` — plain types +
// consts, safe in both client and server graphs) and is re-exported here so the
// Prospectos surface never has to reach into the prospect-batches ACTION module.
// Route B keeps using the catalog directly; nothing about it changes.

import { DISCARD_REASONS, type DiscardReasonKey } from '@/modules/prospect-batches/types';

export { DISCARD_REASONS };
export type { DiscardReasonKey };

/** A reason shorter than this carries no traceability value. */
export const DISCARD_REASON_MIN_LENGTH = 3;
/** Upper bound so `review_notes` never receives an unbounded blob. */
export const DISCARD_REASON_MAX_LENGTH = 500;

/** Discriminated validation result. `reason` is the value safe to persist. */
export type DiscardReasonValidation =
  | { ok: true; reason: string }
  | { ok: false; code: 'empty' | 'too_short' | 'too_long' };

/**
 * Normalizes whitespace without rewriting the reviewer's wording: CRLF is
 * folded to LF, runs of 3+ blank lines collapse to one blank line, and the
 * result is trimmed. Nothing else about the content is touched (no escaping, no
 * casing, no truncation) — the value persisted is the value validated.
 */
function normalizeDiscardReason(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Composes the persisted reason from the selected catalog key + free text,
 * matching Route B's semantics exactly (`candidate-row-actions.tsx`):
 *   - predefined key, no text  → the label
 *   - predefined key + text    → "<label>: <text>"
 *   - 'other' (or no key)      → the free text alone (empty when there is none)
 * Returning '' (rather than throwing) keeps this usable for live UI gating —
 * `validateDiscardReason` is the single place that decides what is acceptable.
 */
export function composeDiscardReason(
  reasonKey: DiscardReasonKey | '',
  freeText: string,
): string {
  const text = typeof freeText === 'string' ? freeText.trim() : '';

  if (reasonKey && reasonKey !== 'other') {
    const label = DISCARD_REASONS.find((r) => r.value === reasonKey)?.label;
    if (!label) return text;
    return text ? `${label}: ${text}` : label;
  }

  return text;
}

/**
 * Validates an untrusted reason at the system boundary. Accepts `unknown` and
 * NEVER throws on a wrong type — a non-string (null / undefined / number /
 * object / array) is simply `empty`, the same fail-closed outcome as a blank
 * string. On success it returns the NORMALIZED value, which is what callers must
 * persist; length bounds are applied to that normalized value (500 valid, 501
 * rejected).
 */
export function validateDiscardReason(raw: unknown): DiscardReasonValidation {
  if (typeof raw !== 'string') return { ok: false, code: 'empty' };

  const reason = normalizeDiscardReason(raw);
  if (reason.length === 0) return { ok: false, code: 'empty' };
  if (reason.length < DISCARD_REASON_MIN_LENGTH) return { ok: false, code: 'too_short' };
  if (reason.length > DISCARD_REASON_MAX_LENGTH) return { ok: false, code: 'too_long' };

  return { ok: true, reason };
}
