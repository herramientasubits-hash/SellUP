/**
 * Pestañas «Logs» y «Consumo» del panel de un proveedor — RENDER REAL de sus
 * secciones y contrato de sus filtros y rankings. Sin red, sin Supabase.
 */

import '@/components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FilterOptions } from '../provider-consumption-types';
import type {
  ProviderOperationBreakdownRow,
  ProviderUserConsumptionBreakdownRow,
} from '../provider-consumption-types';
import { makeBudgetLog, makeRow, makeUsageLog } from './provider-detail-fixtures';

let render: (typeof import('@testing-library/react'))['render'];
let renderHook: (typeof import('@testing-library/react'))['renderHook'];
let act: (typeof import('@testing-library/react'))['act'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let logs: typeof import('../detail/logs-sections');
let breakdown: typeof import('../detail/consumption-breakdown');
let filterBar: typeof import('../detail/usage-filter-bar');

before(async () => {
  ({ render, renderHook, act, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  logs = await import('../detail/logs-sections');
  breakdown = await import('../detail/consumption-breakdown');
  filterBar = await import('../detail/usage-filter-bar');
});
afterEach(() => cleanup());

// ── Logs ──────────────────────────────────────────────────────────────────────

const manyLogs = (count: number) => Array.from({ length: count }, (_, i) => makeUsageLog(`u${i}`));
const bodyRows = () => document.querySelectorAll('tbody tr').length;

describe('«Logs» — registros de uso', () => {
  it('enseña los diez primeros y despliega el resto a petición', () => {
    render(<logs.UsageLogsSection logs={manyLogs(13)} loading={false} isNotMeasured={false} hasActiveFilters={false} />);
    assert.equal(bodyRows(), 10);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 3 más' }));
    assert.equal(bodyRows(), 13);
    fireEvent.click(screen.getByRole('button', { name: 'Contraer' }));
    assert.equal(bodyRows(), 10);
  });

  it('con diez o menos no ofrece desplegar', () => {
    render(<logs.UsageLogsSection logs={manyLogs(10)} loading={false} isNotMeasured={false} hasActiveFilters={false} />);
    assert.equal(screen.queryByRole('button'), null);
  });

  it('🔴 el usuario se enseña por su nombre, nunca por su identificador', () => {
    const log = makeUsageLog('u1', {
      triggeredBy: '7b0f6a52-1111-2222-3333-444455556666',
      userDisplay: { primary: 'Ana Torres' } as never,
      agentDisplay: 'Agente 1',
    });
    render(<logs.UsageLogsSection logs={[log]} loading={false} isNotMeasured={false} hasActiveFilters={false} />);
    const text = document.body.textContent ?? '';
    assert.match(text, /Ana Torres/);
    assert.match(text, /Agente 1/);
    assert.doesNotMatch(text, /7b0f6a52/);
  });

  it('vacío sin filtros y vacío por filtros dicen cosas distintas', () => {
    const { unmount } = render(
      <logs.UsageLogsSection logs={[]} loading={false} isNotMeasured={false} hasActiveFilters={false} />,
    );
    assert.ok(screen.getByText('Sin logs recientes.'));
    unmount();
    render(<logs.UsageLogsSection logs={[]} loading={false} isNotMeasured={false} hasActiveFilters />);
    assert.ok(screen.getByText('No hay logs para los filtros seleccionados.'));
  });

  it('un proveedor que no se mide no enseña tabla aunque lleguen registros', () => {
    render(<logs.UsageLogsSection logs={manyLogs(2)} loading={false} isNotMeasured hasActiveFilters={false} />);
    assert.ok(screen.getByText('Este proveedor no genera actividad medida en SellUp.'));
    assert.equal(document.querySelector('table'), null);
  });

  it('mientras carga avisa, sin tabla ni vacío', () => {
    render(<logs.UsageLogsSection logs={[]} loading isNotMeasured={false} hasActiveFilters={false} />);
    assert.ok(screen.getByText('Cargando actividad...'));
    assert.equal(screen.queryByText('Sin logs recientes.'), null);
  });
});

describe('«Logs» — sincronización y evaluaciones', () => {
  it('el estado de la sincronización es un distintivo, no un texto de color', () => {
    render(<logs.SyncStatusSection row={makeRow({ quotaSyncError: 'HTTP 500' })} />);
    assert.match(document.body.textContent ?? '', /Estado de sync\s*Error de sync/);
    assert.ok(document.querySelector('[data-slot="badge"], [class*="bg-destructive"]'));
  });

  it('sin sincronización lo dice', () => {
    render(<logs.SyncStatusSection row={makeRow({ quotaSyncedAt: null })} />);
    const text = document.body.textContent ?? '';
    assert.match(text, /Sin sync/);
    assert.match(text, /Última sync\s*Sin registro/);
  });

  it('las evaluaciones son una línea de tiempo con su resultado', () => {
    const budgetLogs = [makeBudgetLog('b1'), makeBudgetLog('b2', { allowed: false }), makeBudgetLog('b3', { reason: 'cerca del límite' })];
    render(<logs.BudgetEvaluationsSection budgetLogs={budgetLogs} isNotMeasured={false} />);
    const items = Array.from(document.querySelectorAll('[data-slot="timeline-item"]'));
    assert.deepEqual(items.map((item) => item.getAttribute('data-tone')), ['positive', 'negative', 'warning']);
    assert.match(items[0].textContent ?? '', /Permitido/);
    assert.match(items[1].textContent ?? '', /Habría bloqueado/);
    assert.match(items[2].textContent ?? '', /Alerta/);
  });

  it('enseña cinco evaluaciones y despliega el resto', () => {
    const budgetLogs = Array.from({ length: 7 }, (_, i) => makeBudgetLog(`b${i}`));
    render(<logs.BudgetEvaluationsSection budgetLogs={budgetLogs} isNotMeasured={false} />);
    assert.equal(document.querySelectorAll('[data-slot="timeline-item"]').length, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar 2 evaluaciones más' }));
    assert.equal(document.querySelectorAll('[data-slot="timeline-item"]').length, 7);
  });

  it('sin evaluaciones lo dice', () => {
    render(<logs.BudgetEvaluationsSection budgetLogs={[]} isNotMeasured={false} />);
    assert.ok(screen.getByText('Sin evaluaciones recientes.'));
  });
});

// ── Consumo: rankings ─────────────────────────────────────────────────────────

function op(overrides: Partial<ProviderOperationBreakdownRow>): ProviderOperationBreakdownRow {
  return {
    operationKey: 'people_search',
    totalCalls: 10,
    successCalls: 10,
    errorCalls: 0,
    totalCredits: 40,
    unknownCreditOperations: 0,
    hasUnknownCredits: false,
    totalCostUsd: 0.35,
    hasUnknownCost: false,
    creditsPercentage: 80,
    ...overrides,
  };
}

function user(overrides: Partial<ProviderUserConsumptionBreakdownRow>): ProviderUserConsumptionBreakdownRow {
  return {
    userId: 'u-1',
    fullName: 'Ana Torres',
    email: 'ana@example.com',
    totalCalls: 5,
    totalCredits: 30,
    unknownCreditOperations: 0,
    hasUnknownCredits: false,
    totalCostUsd: 0.2,
    hasUnknownCost: false,
    lastActivityAt: null,
    ...overrides,
  };
}

describe('«Consumo» — rankings', () => {
  it('compara créditos cuando los hay, con su porcentaje', () => {
    const ranking = breakdown.buildOperationRanking('apollo', [op({}), op({ operationKey: 'x', totalCredits: 10, creditsPercentage: 20 })]);
    assert.equal(ranking?.metric, 'credits');
    assert.deepEqual(ranking?.items.map((item) => [item.value, item.meta]), [[40, '80%'], [10, '20%']]);
    assert.equal(breakdown.formatRankingValue('credits')(1200), `${(1200).toLocaleString()} cr`);
  });

  it('sin créditos compara el costo en USD (proveedores de IA)', () => {
    const ranking = breakdown.buildOperationRanking('anthropic', [op({ totalCredits: 0, totalCostUsd: 1.5 })]);
    assert.equal(ranking?.metric, 'cost');
    assert.equal(ranking?.items[0].value, 1.5);
    assert.equal(breakdown.formatRankingValue('cost')(1.5), '$1.5000');
  });

  it('sin créditos ni costo no hay ranking', () => {
    assert.equal(breakdown.buildOperationRanking('apollo', [op({ totalCredits: 0, totalCostUsd: 0 })]), null);
    assert.equal(breakdown.buildUserRanking([]), null);
  });

  it('🔴 un subtotal con consumo sin determinar se marca «parcial», no se da por cerrado', () => {
    const ranking = breakdown.buildOperationRanking('apollo', [op({ hasUnknownCredits: true, unknownCreditOperations: 2 })]);
    assert.equal(ranking?.items[0].meta, '80% · parcial');
    const users = breakdown.buildUserRanking([user({ hasUnknownCredits: true, unknownCreditOperations: 1 })]);
    assert.equal(users?.items[0].meta, 'parcial');
  });

  it('🔴 el ranking de usuarios nunca enseña un identificador', () => {
    const ranking = breakdown.buildUserRanking([
      user({}),
      user({ userId: '7b0f6a52-1111', fullName: null, email: null }),
      user({ userId: null, fullName: null, email: null }),
    ]);
    assert.deepEqual(ranking?.items.map((item) => item.label), [
      'Ana Torres',
      'Usuario no disponible',
      'Sin usuario identificado',
    ]);
  });
});

// ── Filtros ───────────────────────────────────────────────────────────────────

const OPTIONS: FilterOptions = {
  providers: [],
  agents: [],
  statuses: [],
  hasTriggeredBy: true,
  users: [
    { id: 'u-1', full_name: 'Ana', email: null, role_key: 'seller', group_id: 'g-child' },
    { id: 'u-2', full_name: 'Luis', email: null, role_key: 'admin', group_id: 'g-other' },
  ],
  roles: [
    { key: 'seller', label: 'Vendedor' },
    { key: 'admin', label: 'Admin' },
  ],
  groups: [
    { id: 'g-root', name: 'Ventas', parent_group_id: null, depth: 0 },
    { id: 'g-child', name: 'Ventas CO', parent_group_id: 'g-root', depth: 1 },
    { id: 'g-other', name: 'Soporte', parent_group_id: null, depth: 0 },
  ],
  usersScopedToActive: true,
} as FilterOptions;

describe('filtros de consumo y logs', () => {
  it('«Todos» quita el filtro', () => {
    const { result } = renderHook(() => filterBar.useUsageFilters({ initial: { status: 'error' }, options: OPTIONS }));
    act(() => result.current.setFilter('status', 'all'));
    assert.deepEqual(result.current.filters, {});
  });

  it('en Logs «Todo el período» quita el filtro de período', () => {
    const { result } = renderHook(() => filterBar.useUsageFilters({ initial: { period: '7d' }, options: OPTIONS }));
    act(() => result.current.setFilter('period', 'all'));
    assert.deepEqual(result.current.filters, {});
  });

  it('🔴 en Consumo «Todo el período» se queda elegido: el rótulo no puede decir «mes» sobre el acumulado', () => {
    const { result } = renderHook(() =>
      filterBar.useUsageFilters({ initial: { period: 'current_month' }, options: OPTIONS, keepAllPeriod: true }),
    );
    act(() => result.current.setFilter('period', 'all'));
    assert.deepEqual(result.current.filters, { period: 'all' });
  });

  it('cambiar de rol suelta al usuario que no tiene ese rol', () => {
    const { result } = renderHook(() => filterBar.useUsageFilters({ initial: { user: 'u-1' }, options: OPTIONS }));
    act(() => result.current.onRoleChange('admin'));
    assert.deepEqual(result.current.filters, { role: 'admin' });
  });

  it('cambiar de grupo conserva al usuario de un subgrupo y suelta al de fuera', () => {
    const inside = renderHook(() => filterBar.useUsageFilters({ initial: { user: 'u-1' }, options: OPTIONS }));
    act(() => inside.result.current.onGroupChange('g-root'));
    assert.deepEqual(inside.result.current.filters, { user: 'u-1', groupId: 'g-root' });

    const outside = renderHook(() => filterBar.useUsageFilters({ initial: { user: 'u-2' }, options: OPTIONS }));
    act(() => outside.result.current.onGroupChange('g-root'));
    assert.deepEqual(outside.result.current.filters, { groupId: 'g-root' });
  });

  it('los usuarios visibles son los del rol y el grupo (con sus subgrupos) elegidos', () => {
    assert.deepEqual(filterBar.scopeUsersToFilters({ groupId: 'g-root' }, OPTIONS).map((u) => u.id), ['u-1']);
    assert.deepEqual(filterBar.scopeUsersToFilters({ role: 'admin' }, OPTIONS).map((u) => u.id), ['u-2']);
    assert.deepEqual(filterBar.scopeUsersToFilters({ role: 'admin', groupId: 'g-root' }, OPTIONS), []);
    assert.equal(filterBar.scopeUsersToFilters({}, OPTIONS).length, 2);
  });

  it('la barra enseña el período por defecto de cada pestaña', () => {
    const state = { filters: {}, setFilter: () => {}, onRoleChange: () => {}, onGroupChange: () => {} };
    const { unmount } = render(<filterBar.UsageFilterBar {...state} options={OPTIONS} defaultPeriod="current_month" />);
    assert.match(screen.getByRole('group', { name: 'Filtros' }).textContent ?? '', /Mes actual/);
    unmount();
    render(<filterBar.UsageFilterBar {...state} options={OPTIONS} defaultPeriod="all" />);
    assert.match(screen.getByRole('group', { name: 'Filtros' }).textContent ?? '', /Todo el período/);
  });
});
