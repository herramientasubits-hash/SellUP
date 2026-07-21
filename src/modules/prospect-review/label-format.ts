// Q3F-5AZ.2C — Display-label helpers for the review queue UI.
//
// Pure, React-free label maps so the queue never surfaces raw enum tokens
// (e.g. `web_ai`, `derived_status`) to reviewers. Kept in its own module (no
// 'use client', no JSX) so it can be unit-tested directly.

/** Human-readable source labels. Unknown values pass through unchanged. */
const SOURCE_PRIMARY_LABELS: Record<string, string> = {
  web_ai: 'Fuente web / IA',
};

/** Human-readable classification-source labels. Unknown values pass through. */
const CLASSIFICATION_SOURCE_LABELS: Record<string, string> = {
  derived_status: 'Clasificación automática',
};

/** Maps a `source_primary` value to a friendly label; null/empty → em dash. */
export function formatSourceLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return SOURCE_PRIMARY_LABELS[value] ?? value;
}

/** Maps a `classification_source` value to a friendly label; null/empty → em dash. */
export function formatClassificationLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return CLASSIFICATION_SOURCE_LABELS[value] ?? value;
}
