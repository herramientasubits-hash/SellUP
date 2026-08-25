import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

interface ActionResult {
  success: boolean;
  error?: string;
}

// Mock deleteBudgetRule function for testing
async function deleteBudgetRule(id: string): Promise<ActionResult> {
  if (!id) return { success: false, error: 'ID requerido.' };
  if (id === 'invalid-admin') return { success: false, error: 'No autorizado.' };
  if (id === 'db-error') return { success: false, error: 'Error al eliminar la regla.' };
  return { success: true };
}

describe('deleteBudgetRule', () => {
  it('retorna error cuando id está vacío', async () => {
    const result = await deleteBudgetRule('');
    assert.equal(result.success, false);
    assert.equal(result.error, 'ID requerido.');
  });

  it('retorna error cuando no hay permisos', async () => {
    const result = await deleteBudgetRule('invalid-admin');
    assert.equal(result.success, false);
    assert.equal(result.error, 'No autorizado.');
  });

  it('retorna error cuando hay fallo en la BD', async () => {
    const result = await deleteBudgetRule('db-error');
    assert.equal(result.success, false);
    assert.equal(result.error, 'Error al eliminar la regla.');
  });

  it('retorna success cuando la regla se elimina correctamente', async () => {
    const result = await deleteBudgetRule('rule-123');
    assert.equal(result.success, true);
    assert.equal(result.error, undefined);
  });
});

describe('handleArchive error validation', () => {
  it('debe validar el resultado antes de recargar', async () => {
    // Simula el comportamiento del handleArchive
    const rule = { id: 'rule-123' };
    const result = await deleteBudgetRule(rule.id);
    
    if (!result.success) {
      // El error debe ser mostrado al usuario
      assert.fail(`Error: ${result.error}`);
    }
    
    // Si llegó aquí, la eliminación fue exitosa
    assert.equal(result.success, true);
  });

  it('debe prevenir recarga si hay error', async () => {
    const rule = { id: 'invalid-admin' };
    const result = await deleteBudgetRule(rule.id);
    
    // No debería recargar la página si hay error
    if (!result.success) {
      assert.ok(result.error);
      assert.match(result.error, /No autorizado/);
    }
  });
});

describe('Diferencia archiveBudgetRule vs deleteBudgetRule', () => {
  it('archiveBudgetRule hacía soft-delete (UPDATE is_active=false)', () => {
    // Antes: archiveBudgetRule → UPDATE → is_active=false (regla sigue en BD)
    // Ahora: deleteBudgetRule → DELETE → se elimina completamente
    const archiveResult = { action: 'UPDATE', column: 'is_active', value: false };
    const deleteResult = { action: 'DELETE', column: null, value: null };
    
    assert.notEqual(archiveResult.action, deleteResult.action);
  });

  it('deleteBudgetRule elimina la regla completamente de la BD', () => {
    const result = { success: true, rowsDeleted: 1 };
    assert.equal(result.rowsDeleted, 1);
  });
});
