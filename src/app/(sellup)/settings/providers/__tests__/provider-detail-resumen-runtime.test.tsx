/**
 * Pestaña «Resumen» del panel de un proveedor — RENDER REAL: lo que enseña con
 * datos, lo que dice cuando no hay actividad y que las acciones sugeridas
 * llevan a la pestaña que prometen. Sin red, sin Supabase.
 */

import '@/components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeBudgetLog, makeRow, makeRule, makeUsageLog } from './provider-detail-fixtures';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let TabResumen: (typeof import('../detail/tab-resumen'))['TabResumen'];

type Props = React.ComponentProps<typeof TabResumen>;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ TabResumen } = await import('../detail/tab-resumen'));
});
afterEach(() => cleanup());

function renderTab(overrides: Partial<Props> = {}) {
  const navigated: string[] = [];
  const props: Props = {
    row: makeRow(),
    ms: 'active',
    usageLogs: [],
    syncLogs: [],
    providerRules: [makeRule('r1')],
    loadingDetail: false,
    onNavigate: (tab) => navigated.push(tab),
    ...overrides,
  };
  const view = render(<TabResumen {...props} />);
  return { ...view, navigated };
}

const sectionTitles = () =>
  Array.from(document.querySelectorAll('section h3')).map((h) => h.textContent);

describe('«Resumen» — con datos', () => {
  it('se arma con secciones del sistema, no con cajas propias', () => {
    renderTab({ usageLogs: [makeUsageLog('u1')] });
    assert.deepEqual(sectionTitles(), [
      'Proveedor',
      'Consumo y cuota',
      'Actividad reciente',
      'Salud del proveedor',
    ]);
  });

  it('la cuota se reparte en usados, reservados y disponibles, y suman la cuota', () => {
    renderTab();
    const bar = screen.getByRole('img', { name: 'Uso de la cuota: 17%' });
    assert.equal(bar.querySelectorAll('[data-slot="distribution-segment"]').length, 3);
    const legend = bar.parentElement?.textContent ?? '';
    assert.match(legend, /Usados/);
    assert.match(legend, /Reservados/);
    assert.match(legend, /Disponibles/);
    // 68 usados + 12 reservados + 320 disponibles = 400 de cuota
    assert.match(legend, /68 cr/);
    assert.match(legend, /12 cr/);
    assert.match(legend, /320 cr/);
  });

  it('sin créditos reservados no se inventa el tramo', () => {
    renderTab({ row: makeRow({ reservedCredits: 0 }) });
    const bar = screen.getByRole('img', { name: /Uso de la cuota/ });
    assert.equal(bar.querySelectorAll('[data-slot="distribution-segment"]').length, 2);
    assert.doesNotMatch(bar.parentElement?.textContent ?? '', /Reservados/);
  });

  it('sin cuota de créditos no hay barra', () => {
    renderTab({ row: makeRow({ providerMonthlyCreditsAllowance: null }) });
    assert.equal(screen.queryByRole('img', { name: /Uso de la cuota/ }), null);
  });

  it('la actividad reciente es una línea de tiempo de tres eventos, con su tasa de éxito', () => {
    renderTab({
      usageLogs: [
        makeUsageLog('u1'),
        makeUsageLog('u2', { status: 'error', operationKey: 'people_enrich' }),
        makeUsageLog('u3'),
        makeUsageLog('u4'),
      ],
    });
    const items = document.querySelectorAll('[data-slot="timeline-item"]');
    assert.equal(items.length, 3);
    assert.equal(items[1].getAttribute('data-tone'), 'negative');
    assert.equal(items[0].getAttribute('data-tone'), 'positive');
    assert.match(document.body.textContent ?? '', /Tasa de éxito: 75% \(3\/4 ops\)/);
  });

  it('sin registros de uso cae a las evaluaciones de presupuesto', () => {
    renderTab({
      row: makeRow({
        recentBudgetCheckLogs: [makeBudgetLog('b1'), makeBudgetLog('b2', { allowed: false })],
      }),
    });
    const items = document.querySelectorAll('[data-slot="timeline-item"]');
    assert.equal(items.length, 2);
    assert.equal(items[1].getAttribute('data-tone'), 'negative');
    assert.doesNotMatch(document.body.textContent ?? '', /Tasa de éxito/);
  });
});

describe('«Resumen» — vacíos y carga', () => {
  it('sin actividad lo dice', () => {
    renderTab();
    assert.ok(screen.getByText('Sin operaciones registradas aún.'));
    assert.equal(document.querySelectorAll('[data-slot="timeline-item"]').length, 0);
  });

  it('un proveedor que no se mide no enseña actividad ni sugiere acciones', () => {
    const { navigated } = renderTab({
      ms: 'not_measured',
      row: makeRow({ measurementStatus: 'not_measured', providerMonthlyCreditsAllowance: null }),
      providerRules: [],
    });
    assert.ok(screen.getByText('Este proveedor no genera actividad medida en SellUp.'));
    assert.ok(screen.getByText('Sin acciones críticas por ahora.'));
    assert.equal(screen.queryByRole('button'), null);
    assert.deepEqual(navigated, []);
  });

  it('mientras carga el detalle avisa, sin mostrar el vacío', () => {
    renderTab({ loadingDetail: true });
    assert.ok(screen.getByText('Cargando actividad...'));
    assert.equal(screen.queryByText('Sin operaciones registradas aún.'), null);
  });
});

describe('«Resumen» — acciones sugeridas', () => {
  it('con todo en orden no sugiere nada', () => {
    renderTab();
    assert.ok(screen.getByText('Sin acciones críticas por ahora.'));
  });

  it('🔴 cada acción lleva a su pestaña', () => {
    const { navigated } = renderTab({
      row: makeRow({
        quotaSyncError: 'HTTP 401',
        providerMonthlyCreditsAllowance: null,
        providerMonthlyUsdAllowance: null,
      }),
      providerRules: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar logs de sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configurar cuota' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear regla de presupuesto' }));
    assert.deepEqual(navigated, ['logs', 'presupuesto', 'presupuesto']);
  });

  it('el error de sincronización se lee en «Salud del proveedor»', () => {
    renderTab({ row: makeRow({ quotaSyncError: 'HTTP 401' }) });
    const health = screen.getByRole('heading', { name: 'Salud del proveedor' }).closest('section');
    assert.match(health?.textContent ?? '', /Estado sync\s*Error/);
    assert.match(health?.textContent ?? '', /HTTP 401/);
  });
});
