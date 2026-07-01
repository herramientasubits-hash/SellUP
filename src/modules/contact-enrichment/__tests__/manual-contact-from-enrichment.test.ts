// Tests — Hito 17A.7C
// Validates pure functions: form validation and dedup check.
// Server action is integration-level; pure functions cover the critical paths.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateManualContactInput,
  checkManualContactDuplicate,
} from '../manual-contact-from-enrichment-core';
import type { ExistingContactForDedup } from '../candidate-review-core';

// ── validateManualContactInput ─────────────────────────────────────────────

describe('validateManualContactInput', () => {
  it('rejects empty name', () => {
    const result = validateManualContactInput({
      full_name: '',
      job_title: 'VP',
      email: null,
      phone: null,
      linkedin_url: null,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('nombre')));
  });

  it('rejects whitespace-only name', () => {
    const result = validateManualContactInput({
      full_name: '   ',
      job_title: 'VP',
      email: null,
      phone: null,
      linkedin_url: null,
    });
    assert.equal(result.valid, false);
  });

  it('rejects name with no additional data', () => {
    const result = validateManualContactInput({
      full_name: 'Juan',
      job_title: null,
      email: null,
      phone: null,
      linkedin_url: null,
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('dato adicional')));
  });

  it('accepts name + job title', () => {
    const result = validateManualContactInput({
      full_name: 'Ana Martínez',
      job_title: 'VP de Talento',
      email: null,
      phone: null,
      linkedin_url: null,
    });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts name + email', () => {
    const result = validateManualContactInput({
      full_name: 'Ana Martínez',
      job_title: null,
      email: 'ana@empresa.com',
      phone: null,
      linkedin_url: null,
    });
    assert.equal(result.valid, true);
  });

  it('accepts name + phone', () => {
    const result = validateManualContactInput({
      full_name: 'Ana Martínez',
      job_title: null,
      email: null,
      phone: '+57 300 000 0000',
      linkedin_url: null,
    });
    assert.equal(result.valid, true);
  });

  it('accepts name + linkedin', () => {
    const result = validateManualContactInput({
      full_name: 'Ana Martínez',
      job_title: null,
      email: null,
      phone: null,
      linkedin_url: 'https://linkedin.com/in/ana',
    });
    assert.equal(result.valid, true);
  });
});

// ── checkManualContactDuplicate ────────────────────────────────────────────

const existing: ExistingContactForDedup[] = [
  { id: 'c1', email: 'ana@empresa.com', linkedin_url: null, full_name: 'Ana Martínez' },
  { id: 'c2', email: null, linkedin_url: 'https://linkedin.com/in/pedro', full_name: 'Pedro Gómez' },
  { id: 'c3', email: null, linkedin_url: null, full_name: 'Carlos López' },
];

describe('checkManualContactDuplicate', () => {
  it('detects email duplicate (case insensitive)', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'Ana X', email: 'ANA@EMPRESA.COM', linkedin_url: null },
      existing,
    );
    assert.equal(result.isDuplicate, true);
    assert.equal(result.contactId, 'c1');
    assert.equal(result.matchedBy, 'email');
  });

  it('detects linkedin duplicate (trailing slash normalized)', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'Pedro X', email: null, linkedin_url: 'https://linkedin.com/in/pedro/' },
      existing,
    );
    assert.equal(result.isDuplicate, true);
    assert.equal(result.contactId, 'c2');
    assert.equal(result.matchedBy, 'linkedin');
  });

  it('detects name duplicate when no email/linkedin provided', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'Carlos Lopez', email: null, linkedin_url: null },
      existing,
    );
    assert.equal(result.isDuplicate, true);
    assert.equal(result.contactId, 'c3');
    assert.equal(result.matchedBy, 'name');
  });

  it('does not match by name when email is provided but unmatched', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'Carlos Lopez', email: 'carlos@other.com', linkedin_url: null },
      existing,
    );
    assert.equal(result.isDuplicate, false);
  });

  it('returns no duplicate for fresh contact', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'María Nueva', email: 'maria@nueva.com', linkedin_url: null },
      existing,
    );
    assert.equal(result.isDuplicate, false);
  });

  it('returns no duplicate against empty list', () => {
    const result = checkManualContactDuplicate(
      { full_name: 'Ana Martínez', email: 'ana@empresa.com', linkedin_url: null },
      [],
    );
    assert.equal(result.isDuplicate, false);
  });
});
