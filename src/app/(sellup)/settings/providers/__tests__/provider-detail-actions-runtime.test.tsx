/**
 * Las secciones del panel de un proveedor que disparan algo — la cuota, las
 * reglas de presupuesto y la conexión — RENDER REAL. Lo que se fija aquí es el
 * contrato de seguridad de un panel que maneja presupuesto y créditos: cada
 * botón llama SOLO al callback que le toca, y desconectar o eliminar no pasa
 * sin confirmación. Sin red, sin Supabase.
 */

import '@/components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import { makeRow, makeRule } from './provider-detail-fixtures';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let QuotaSection: (typeof import('../detail/quota-section'))['QuotaSection'];
let getQuotaButtonLabel: (typeof import('../detail/quota-section'))['getQuotaButtonLabel'];
let RuleList: (typeof import('../detail/rule-list'))['RuleList'];
let ConnectionControls: (typeof import('../detail/connection-controls'))['ConnectionControls'];

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ QuotaSection, getQuotaButtonLabel } = await import('../detail/quota-section'));
  ({ RuleList } = await import('../detail/rule-list'));
  ({ ConnectionControls } = await import('../detail/connection-controls'));
});
afterEach(() => cleanup());

// ── Cuota ─────────────────────────────────────────────────────────────────────

function renderQuota(overrides: Partial<React.ComponentProps<typeof QuotaSection>> = {}) {
  const calls: string[] = [];
  render(
    <QuotaSection
      row={makeRow()}
      isSyncing={false}
      syncFeedback={null}
      onEditQuota={() => calls.push('edit')}
      onSync={() => calls.push('sync')}
      {...overrides}
    />,
  );
  return calls;
}

describe('«Cuota del proveedor»', () => {
  it('enseña la fuente, los créditos y lo disponible', () => {
    renderQuota();
    const text = document.body.textContent ?? '';
    assert.match(text, /Fuente\s*Configuración manual/);
    assert.match(text, /Créditos mensuales\s*400 cr/);
    assert.match(text, /Presupuesto USD\s*No configurado/);
    assert.match(text, /Créditos disponibles\s*332 cr/);
  });

  it('🔴 «Editar cuota» y «Sincronizar» llaman cada uno a lo suyo, una vez', () => {
    const calls = renderQuota();
    fireEvent.click(screen.getByRole('button', { name: 'Editar cuota manual' }));
    assert.deepEqual(calls, ['edit']);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar con API' }));
    assert.deepEqual(calls, ['edit', 'sync']);
  });

  it('🔴 mientras sincroniza el botón queda apagado: no se dispara dos veces', () => {
    const calls = renderQuota({ isSyncing: true });
    const button = screen.getByRole('button', { name: 'Sincronizando…' }) as HTMLButtonElement;
    assert.equal(button.disabled, true);
    fireEvent.click(button);
    assert.deepEqual(calls, []);
  });

  it('🔴 Anthropic no ofrece sincronizar: su API no da la cuota', () => {
    renderQuota({ row: makeRow({ providerKey: 'anthropic' }) });
    assert.equal(screen.queryByRole('button', { name: /Sincronizar/ }), null);
    assert.ok(screen.getByRole('button', { name: 'Editar presupuesto USD' }));
    assert.match(document.body.textContent ?? '', /requiere Admin API key/);
  });

  it('🔴 un proveedor que no se mide no ofrece ninguna acción', () => {
    renderQuota({ row: makeRow({ measurementStatus: 'not_measured' }) });
    assert.ok(screen.getByText('Este proveedor no tiene cuota de medición configurada.'));
    assert.equal(screen.queryByRole('button'), null);
  });

  it('tras un error de sincronización lo avisa y ofrece reintentar', () => {
    renderQuota({ row: makeRow({ quotaSource: 'sync_error', quotaSyncError: 'HTTP 429' }) });
    assert.match(screen.getByRole('alert').textContent ?? '', /HTTP 429/);
    assert.ok(screen.getByRole('button', { name: 'Reintentar sincronización' }));
  });

  it('el resultado de la sincronización se lee bajo los botones', () => {
    renderQuota({ syncFeedback: { ok: true, msg: 'Cuota sincronizada con la API del proveedor.' } });
    assert.match(screen.getByRole('status').textContent ?? '', /Cuota sincronizada/);
  });

  it('el rótulo del botón depende del proveedor y de si ya tiene cuota', () => {
    assert.equal(getQuotaButtonLabel('lusha', makeRow()), 'Editar cuota');
    assert.equal(
      getQuotaButtonLabel('apollo', makeRow({ providerMonthlyCreditsAllowance: null })),
      'Configurar cuota manual',
    );
    assert.equal(getQuotaButtonLabel('apollo', makeRow({ measurementStatus: 'not_measured' })), null);
  });
});

// ── Reglas ────────────────────────────────────────────────────────────────────

function renderRules(rules: BudgetRuleRow[], overrides: Partial<React.ComponentProps<typeof RuleList>> = {}) {
  const calls: string[] = [];
  render(
    <RuleList
      rules={rules}
      togglingId={null}
      deletingId={null}
      onEdit={(rule) => calls.push(`edit:${rule.id}`)}
      onToggle={(rule) => calls.push(`toggle:${rule.id}`)}
      onRequestDelete={(rule) => calls.push(`delete:${rule.id}`)}
      onCreate={() => calls.push('create')}
      {...overrides}
    />,
  );
  return calls;
}

describe('reglas de presupuesto de un alcance', () => {
  it('cada regla dice su alcance, su estado, su límite y qué hace al excederse', () => {
    renderRules([makeRule('r1'), makeRule('r2', { is_active: false, scopeLabel: 'Ventas', on_exceed: 'alert' })]);
    const rows = screen.getAllByRole('listitem');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent ?? '', /Toda la organización/);
    assert.match(rows[0].textContent ?? '', /Activa/);
    assert.match(rows[0].textContent ?? '', /500/);
    assert.match(rows[0].textContent ?? '', /Mensual/);
    assert.match(rows[0].textContent ?? '', /Bloquear/);
    assert.match(rows[1].textContent ?? '', /Inactiva/);
    assert.match(rows[1].textContent ?? '', /Alertar/);
  });

  it('🔴 los tres botones de una regla llaman a su callback con ESA regla', () => {
    const calls = renderRules([makeRule('r1'), makeRule('r2', { is_active: false })]);
    const second = screen.getAllByRole('listitem')[1];
    const button = (name: string) =>
      Array.from(second.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === name);
    fireEvent.click(button('Editar regla')!);
    fireEvent.click(button('Activar regla')!);
    fireEvent.click(button('Eliminar regla')!);
    assert.deepEqual(calls, ['edit:r2', 'toggle:r2', 'delete:r2']);
  });

  it('🔴 pulsar la papelera solo PIDE eliminar: la confirmación va aparte', () => {
    const calls = renderRules([makeRule('r1')]);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));
    assert.deepEqual(calls, ['delete:r1']);
  });

  it('la regla que se está cambiando o eliminando apaga su botón', () => {
    renderRules([makeRule('r1')], { togglingId: 'r1', deletingId: 'r1' });
    assert.equal((screen.getByRole('button', { name: 'Desactivar regla' }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole('button', { name: 'Eliminar regla' }) as HTMLButtonElement).disabled, true);
    assert.equal((screen.getByRole('button', { name: 'Editar regla' }) as HTMLButtonElement).disabled, false);
  });

  it('sin reglas invita a crear la primera', () => {
    const calls = renderRules([]);
    assert.ok(screen.getByText('Sin reglas configuradas para este alcance.'));
    fireEvent.click(screen.getByRole('button', { name: 'Crear primera regla' }));
    assert.deepEqual(calls, ['create']);
  });

  it('sin opciones de formulario no ofrece crear', () => {
    renderRules([], { onCreate: undefined });
    assert.equal(screen.queryByRole('button'), null);
  });
});

// ── Conexión ──────────────────────────────────────────────────────────────────

function renderConnection(overrides: Partial<React.ComponentProps<typeof ConnectionControls>> = {}) {
  const calls: string[] = [];
  render(
    <ConnectionControls
      isPending={false}
      hasCredential
      feedback={null}
      showKeyForm={false}
      apiKeyInput=""
      keyPlaceholder="••••••••"
      onApiKeyChange={(value) => calls.push(`key:${value}`)}
      onToggleKeyForm={() => calls.push('toggle-key')}
      onCancelKeyForm={() => calls.push('cancel-key')}
      onSaveKey={() => calls.push('save-key')}
      showDisconnectConfirm={false}
      disconnectTitle="¿Desconectar el proveedor?"
      disconnectDescription="Se eliminarán las credenciales almacenadas."
      onRequestDisconnect={() => calls.push('request-disconnect')}
      onCancelDisconnect={() => calls.push('cancel-disconnect')}
      onDisconnect={() => calls.push('disconnect')}
      onTest={() => calls.push('test')}
      {...overrides}
    />,
  );
  return calls;
}

describe('controles de conexión', () => {
  it('🔴 probar, cambiar la clave y pedir desconectar llaman cada uno a lo suyo', () => {
    const calls = renderConnection();
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar API key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    assert.deepEqual(calls, ['test', 'toggle-key', 'request-disconnect']);
  });

  it('🔴 «Desconectar» no desconecta: solo abre la confirmación', () => {
    const calls = renderConnection();
    fireEvent.click(screen.getByRole('button', { name: 'Desconectar' }));
    assert.equal(calls.includes('disconnect'), false);
    assert.equal(screen.queryByRole('alertdialog'), null);
  });

  it('🔴 la confirmación es un diálogo y solo su botón desconecta', () => {
    const calls = renderConnection({ showDisconnectConfirm: true });
    const dialog = screen.getByRole('alertdialog');
    assert.match(dialog.textContent ?? '', /¿Desconectar el proveedor\?/);
    assert.match(dialog.textContent ?? '', /Se eliminarán las credenciales almacenadas\./);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desconexión' }));
    assert.deepEqual(calls, ['disconnect']);
  });

  it('cancelar la confirmación no desconecta', () => {
    const calls = renderConnection({ showDisconnectConfirm: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    assert.deepEqual(calls, ['cancel-disconnect']);
  });

  it('sin credencial no se puede probar ni desconectar', () => {
    renderConnection({ hasCredential: false });
    assert.equal((screen.getByRole('button', { name: 'Probar conexión' }) as HTMLButtonElement).disabled, true);
    assert.equal(screen.queryByRole('button', { name: 'Desconectar' }), null);
  });

  it('el formulario de la clave no guarda una clave vacía', () => {
    const calls = renderConnection({ showKeyForm: true, apiKeyInput: '   ' });
    const save = screen.getByRole('button', { name: 'Guardar API key' }) as HTMLButtonElement;
    assert.equal(save.disabled, true);
    fireEvent.click(save);
    assert.deepEqual(calls, []);
  });

  it('🔴 la clave se escribe en un campo de contraseña, con su etiqueta', () => {
    const calls = renderConnection({ showKeyForm: true, apiKeyInput: 'abc' });
    const input = screen.getByLabelText('Nueva API key') as HTMLInputElement;
    assert.equal(input.type, 'password');
    assert.equal(input.autocomplete, 'new-password');
    fireEvent.change(input, { target: { value: 'abcd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar API key' }));
    assert.deepEqual(calls, ['key:abcd', 'save-key']);
  });
});
