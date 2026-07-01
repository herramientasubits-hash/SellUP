// Tests — dedup y label del picker de cuentas (Hito 17A.7D.1)
// Cubre dedupAccountsForPicker y accountPickerLabel.
// Sin Supabase, sin red — lógica pura.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupAccountsForPicker,
  accountPickerLabel,
  type PickerRow,
} from '../account-picker-dedup';

// ── Helpers ───────────────────────────────────────────────────────────────────

function row(overrides: Partial<PickerRow> & Pick<PickerRow, 'id' | 'name'>): PickerRow {
  return {
    domain: null,
    hubspot_company_id: null,
    ...overrides,
  };
}

// ── dedupAccountsForPicker ────────────────────────────────────────────────────

describe('dedupAccountsForPicker', () => {
  // 1. Filtra correctamente (sin archived): la función recibe filas ya filtradas
  //    por la query (archived_at IS NULL + pipeline_status != 'archived').
  //    Si la query es correcta, aquí nunca llegan archivadas.

  it('1. retorna vacío cuando no hay filas', () => {
    const result = dedupAccountsForPicker([]);
    assert.deepEqual(result, []);
  });

  it('2. retorna la fila única sin dominio tal cual', () => {
    const result = dedupAccountsForPicker([row({ id: 'a1', name: 'Acme' })]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'a1');
    assert.equal(result[0].domain, null);
  });

  it('3. excluye duplicados por dominio — mantiene solo el primero', () => {
    const rows: PickerRow[] = [
      row({ id: 'active-1', name: 'Siesa', domain: 'siesa.com' }),
      row({ id: 'active-2', name: 'Siesa Corp', domain: 'siesa.com' }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'active-1');
  });

  it('4. prefiere la fila con hubspot_company_id cuando hay duplicado por dominio', () => {
    const rows: PickerRow[] = [
      row({ id: 'no-hubspot', name: 'Siesa', domain: 'siesa.com', hubspot_company_id: null }),
      row({ id: 'with-hubspot', name: 'Siesa', domain: 'siesa.com', hubspot_company_id: 'hs-123' }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'with-hubspot');
  });

  it('5. normaliza el dominio a minúsculas para comparar', () => {
    const rows: PickerRow[] = [
      row({ id: 'a', name: 'Siesa', domain: 'Siesa.COM' }),
      row({ id: 'b', name: 'Siesa B', domain: 'siesa.com' }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 1);
  });

  it('6. cuentas sin dominio no se deducan entre sí — todas se incluyen', () => {
    const rows: PickerRow[] = [
      row({ id: 'x1', name: 'Empresa A', domain: null }),
      row({ id: 'x2', name: 'Empresa B', domain: null }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 2);
  });

  it('7. mezcla de cuentas con y sin dominio se procesa correctamente', () => {
    const rows: PickerRow[] = [
      row({ id: 'with-domain', name: 'TechCo', domain: 'techco.io' }),
      row({ id: 'no-domain-1', name: 'Sin dominio A', domain: null }),
      row({ id: 'no-domain-2', name: 'Sin dominio B', domain: null }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 3);
    const ids = result.map((r) => r.id);
    assert.ok(ids.includes('with-domain'));
    assert.ok(ids.includes('no-domain-1'));
    assert.ok(ids.includes('no-domain-2'));
  });

  it('8. cuentas con dominios distintos no se deducan', () => {
    const rows: PickerRow[] = [
      row({ id: 'a', name: 'Alfa', domain: 'alfa.com' }),
      row({ id: 'b', name: 'Beta', domain: 'beta.com' }),
    ];
    const result = dedupAccountsForPicker(rows);
    assert.equal(result.length, 2);
  });
});

// ── accountPickerLabel ────────────────────────────────────────────────────────

describe('accountPickerLabel', () => {
  it('9. muestra solo el nombre cuando no hay dominio', () => {
    const label = accountPickerLabel({ id: 'a', name: 'Siesa', domain: null });
    assert.equal(label, 'Siesa');
  });

  it('10. muestra nombre · dominio cuando hay dominio', () => {
    const label = accountPickerLabel({ id: 'a', name: 'Siesa', domain: 'siesa.com' });
    assert.equal(label, 'Siesa · siesa.com');
  });

  it('11. nunca expone el id (UUID) en el label', () => {
    const id = '6c681e39-5296-41df-a775-650d6981d771';
    const label = accountPickerLabel({ id, name: 'Siesa', domain: null });
    assert.ok(!label.includes(id));
  });
});
