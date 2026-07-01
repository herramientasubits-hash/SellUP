// Pure functions — Hito 17A.7C
// No React, no network, no 'use server'. Safe to import from unit tests.

import {
  emailKey,
  linkedinKey,
  nameKey,
  findDuplicateContact,
  type ExistingContactForDedup,
} from './candidate-review-core';

// ── Input ──────────────────────────────────────────────────────────────────

export type { ExistingContactForDedup };

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManualContactInput(input: {
  full_name: string;
  job_title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
}): ValidationResult {
  const errors: string[] = [];

  const name = input.full_name?.trim() ?? '';
  if (!name) {
    errors.push('El nombre completo es obligatorio.');
  }

  const hasEmail = !!emailKey(input.email);
  const hasPhone = !!(input.phone?.trim());
  const hasLinkedin = !!linkedinKey(input.linkedin_url);
  const hasJobTitle = !!(input.job_title?.trim());

  if (!hasEmail && !hasPhone && !hasLinkedin && !hasJobTitle) {
    errors.push(
      'Proporciona al menos un dato adicional: cargo, email, teléfono o LinkedIn.',
    );
  }

  return { valid: errors.length === 0, errors };
}

// ── Dedup ──────────────────────────────────────────────────────────────────

export function checkManualContactDuplicate(
  input: { full_name: string; email?: string | null; linkedin_url?: string | null },
  existing: ExistingContactForDedup[],
): { isDuplicate: boolean; contactId?: string; matchedBy?: string } {
  const match = findDuplicateContact(
    { email: input.email ?? null, linkedin_url: input.linkedin_url ?? null, full_name: input.full_name },
    existing,
  );
  if (!match) return { isDuplicate: false };
  return { isDuplicate: true, contactId: match.contactId, matchedBy: match.matchedBy };
}
