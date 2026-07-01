// Tests — guard de cuenta archivada en createContact (Hito 17A.7C.3)
// Verifica la función pura checkAccountActiveForContact.
// Sin Supabase, sin red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkAccountActiveForContact } from '../account-active-guard';

describe('checkAccountActiveForContact', () => {
  // ── Cuenta no encontrada ──────────────────────────────────────────────────

  it('1. retorna error cuando account es null (no encontrada)', () => {
    const result = checkAccountActiveForContact(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, 'Cuenta no encontrada');
  });

  // ── Bloqueado por archived_at ─────────────────────────────────────────────

  it('2. bloquea creación cuando archived_at tiene fecha', () => {
    const result = checkAccountActiveForContact({
      archived_at: '2026-06-30T10:00:00.000Z',
      pipeline_status: 'active',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'No se puede crear un contacto en una cuenta archivada.');
    }
  });

  it('3. bloquea creación cuando archived_at es una fecha antigua', () => {
    const result = checkAccountActiveForContact({
      archived_at: '2024-01-01T00:00:00.000Z',
      pipeline_status: 'new',
    });
    assert.equal(result.ok, false);
  });

  // ── Bloqueado por pipeline_status ────────────────────────────────────────

  it('4. bloquea creación cuando pipeline_status es "archived" aunque archived_at sea null', () => {
    const result = checkAccountActiveForContact({
      archived_at: null,
      pipeline_status: 'archived',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, 'No se puede crear un contacto en una cuenta archivada.');
    }
  });

  // ── Ambas condiciones simultáneas ─────────────────────────────────────────

  it('5. bloquea cuando archived_at y pipeline_status = "archived" se combinan', () => {
    const result = checkAccountActiveForContact({
      archived_at: '2026-07-01T00:00:00.000Z',
      pipeline_status: 'archived',
    });
    assert.equal(result.ok, false);
  });

  // ── Cuentas activas (permitidas) ──────────────────────────────────────────

  it('6. permite creación en cuenta activa: archived_at null y pipeline_status "new"', () => {
    const result = checkAccountActiveForContact({
      archived_at: null,
      pipeline_status: 'new',
    });
    assert.equal(result.ok, true);
  });

  it('7. permite creación en cuenta activa: pipeline_status "active"', () => {
    const result = checkAccountActiveForContact({
      archived_at: null,
      pipeline_status: 'active',
    });
    assert.equal(result.ok, true);
  });

  it('8. permite creación en cuenta activa: pipeline_status "closed_won"', () => {
    const result = checkAccountActiveForContact({
      archived_at: null,
      pipeline_status: 'closed_won',
    });
    assert.equal(result.ok, true);
  });

  // ── Creación estándar sin metadata (no debe romperse) ────────────────────
  // El guard solo valida la cuenta; metadata es campo separado. Un account
  // activo sin metadata extra es siempre válido para el guard.

  it('9. cuenta activa válida independientemente de si el caller pasa metadata o no', () => {
    const activeAccount = { archived_at: null, pipeline_status: 'new' };
    const withMetadata = checkAccountActiveForContact(activeAccount);
    const withoutMetadata = checkAccountActiveForContact(activeAccount);
    assert.equal(withMetadata.ok, true);
    assert.equal(withoutMetadata.ok, true);
  });
});
