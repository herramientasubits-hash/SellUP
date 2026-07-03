/**
 * Tests — 17A.9H.1: Habilitar aprobación UI para candidatos HubSpot-only
 *
 * Pure unit tests. No DOM, no network. Uses Node.js built-in test runner.
 *
 * Sections:
 *   A — canApprove: regla de habilitación del botón Aprobar
 *   B — copy header: texto de acción según contexto de cuenta
 *   C — bloque de aviso inferior según contexto
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Espejo de la lógica extraída del componente:
 *   disabled={busy || (!candidate.account_id && !candidate.hubspot_company_id)}
 */
function canApprove(candidate: Pick<PendingContactCandidate, 'account_id' | 'hubspot_company_id'>): boolean {
  return !!(candidate.account_id || candidate.hubspot_company_id);
}

/**
 * Espejo del copy del header de acción.
 */
function headerCopy(candidate: Pick<PendingContactCandidate, 'account_id' | 'hubspot_company_id'>): string {
  if (candidate.account_id) return 'Al aprobar se creará un contacto oficial en SellUp.';
  if (candidate.hubspot_company_id) return 'Al aprobar, SellUp creará o vinculará la cuenta automáticamente.';
  return 'Sin cuenta SellUp asociada: no se puede aprobar.';
}

/**
 * Tipo de bloque de aviso inferior.
 */
function noticeBand(candidate: Pick<PendingContactCandidate, 'account_id' | 'hubspot_company_id'>): 'hubspot_only' | 'no_account' | 'ready' {
  if (candidate.account_id) return 'ready';
  if (candidate.hubspot_company_id) return 'hubspot_only';
  return 'no_account';
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const withAccountId = { account_id: 'acc-001', hubspot_company_id: null };
const withHubspotOnly = { account_id: null, hubspot_company_id: '22546623550' };
const withBoth = { account_id: 'acc-001', hubspot_company_id: '22546623550' };
const withNeither = { account_id: null, hubspot_company_id: null };

// ── A — canApprove ────────────────────────────────────────────────────────────

describe('A — canApprove: regla de habilitación del botón Aprobar', () => {
  it('A1 habilitado con account_id presente', () => {
    assert.equal(canApprove(withAccountId), true);
  });

  it('A2 habilitado con hubspot_company_id aunque account_id sea null (HubSpot-only)', () => {
    assert.equal(canApprove(withHubspotOnly), true);
  });

  it('A3 habilitado cuando ambos están presentes', () => {
    assert.equal(canApprove(withBoth), true);
  });

  it('A4 deshabilitado cuando ni account_id ni hubspot_company_id están presentes', () => {
    assert.equal(canApprove(withNeither), false);
  });

  it('A5 Tania Espinosa (caso real): account_id null + hubspot_company_id 22546623550 → habilitado', () => {
    const tania = { account_id: null, hubspot_company_id: '22546623550' };
    assert.equal(canApprove(tania), true);
  });
});

// ── B — copy del header ───────────────────────────────────────────────────────

describe('B — copy del header de acción', () => {
  it('B1 con account_id: copy de contacto oficial', () => {
    assert.equal(headerCopy(withAccountId), 'Al aprobar se creará un contacto oficial en SellUp.');
  });

  it('B2 HubSpot-only: copy de creación/vinculación automática de cuenta', () => {
    assert.equal(
      headerCopy(withHubspotOnly),
      'Al aprobar, SellUp creará o vinculará la cuenta automáticamente.',
    );
  });

  it('B3 sin ninguno: copy de error bloqueante', () => {
    assert.equal(headerCopy(withNeither), 'Sin cuenta SellUp asociada: no se puede aprobar.');
  });

  it('B4 con ambos: prevalece account_id (copy de contacto oficial)', () => {
    assert.equal(headerCopy(withBoth), 'Al aprobar se creará un contacto oficial en SellUp.');
  });
});

// ── C — bloque de aviso inferior ──────────────────────────────────────────────

describe('C — bloque de aviso inferior según contexto', () => {
  it('C1 con account_id: banda ready (revisión humana estándar)', () => {
    assert.equal(noticeBand(withAccountId), 'ready');
  });

  it('C2 HubSpot-only: banda hubspot_only con texto de creación automática', () => {
    assert.equal(noticeBand(withHubspotOnly), 'hubspot_only');
  });

  it('C3 sin ninguno: banda no_account (bloqueante)', () => {
    assert.equal(noticeBand(withNeither), 'no_account');
  });

  it('C4 con ambos: banda ready', () => {
    assert.equal(noticeBand(withBoth), 'ready');
  });
});
