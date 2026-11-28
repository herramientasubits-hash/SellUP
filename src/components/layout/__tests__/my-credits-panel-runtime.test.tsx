/** «Mis créditos» en el menú de cuenta: carga, estados y lo que ve la persona. */
import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { MyCreditsResult, MyCreditsRow } from '../../../modules/my-credits/core';

let next: () => Promise<MyCreditsResult | null> = async () => null;
let calls = 0;

mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh() {}, push() {} }) } });
mock.module('../../../modules/access/role-preview-actions', {
  namedExports: {
    getRolePreviewOptions: async () => [],
    startRolePreview: async () => ({ ok: true }),
    stopRolePreview: async () => ({ ok: true }),
  },
});
mock.module('../../../modules/my-credits/actions', {
  namedExports: {
    getMyCreditUsage: async () => {
      calls += 1;
      return next();
    },
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let panel: typeof import('../my-credits-panel');
let menu: typeof import('../account-menu');

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  panel = await import('../my-credits-panel');
  menu = await import('../account-menu');
});
beforeEach(() => {
  panel.resetMyCreditsCache();
  calls = 0;
});
afterEach(() => cleanup());

function row(overrides: Partial<MyCreditsRow> = {}): MyCreditsRow {
  return {
    providerKey: 'lusha',
    displayName: 'Lusha',
    unit: 'credits',
    used: 38,
    limit: 100,
    percent: 38,
    tone: 'normal',
    shared: false,
    ownUsed: null,
    exhausted: false,
    onExceed: 'block',
    periodType: 'monthly',
    extras: null,
    ...overrides,
  };
}

function result(rows: MyCreditsRow[], partial = false): MyCreditsResult {
  return { periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z', rows, partial };
}

describe('MyCreditsPanel', () => {
  it('muestra el mes, consumo / límite, la barra y cuándo se renueva (hora de Colombia)', async () => {
    next = async () => result([row()]);
    render(<panel.MyCreditsPanel />);
    assert.ok(await screen.findByText('Mis créditos · noviembre'));
    assert.ok(screen.getByText('38 / 100'));
    assert.ok(screen.getByText('38 %'));
    assert.ok(screen.getByRole('progressbar', { name: /Consumo de Lusha/ }));
    assert.ok(screen.getByText(/Se renueva el 30 de nov, 7:00/));
  });

  it('sin límite: solo «N usados», sin barra; USD con formato de la app', async () => {
    next = async () =>
      result([
        row({ providerKey: 'tavily', displayName: 'Tavily', used: 45, limit: null, percent: null }),
        row({ providerKey: 'anthropic', displayName: 'IA', unit: 'usd', used: 3.2, limit: 10, percent: 32 }),
      ]);
    render(<panel.MyCreditsPanel />);
    assert.ok(await screen.findByText('45 usados'));
    assert.ok(screen.getByText('US$3,20 / US$10,00'));
    assert.equal(screen.getAllByRole('progressbar').length, 1);
  });

  it('cupo compartido y extras del límite', async () => {
    next = async () =>
      result([row({ shared: true, ownUsed: 120, extras: { grantsForUser: 20, carriedIn: 30, topUps: 0 } })]);
    render(<panel.MyCreditsPanel />);
    assert.ok(await screen.findByText('Cupo de equipo · tú usaste 120'));
    assert.ok(screen.getByText('Incluye 20 aprobados para ti, 30 del mes anterior'));
  });

  it('al límite: con aprobación ofrece pedir más; con bloqueo remite al líder', async () => {
    next = async () =>
      result([
        row({ exhausted: true, tone: 'danger', percent: 100, used: 100, onExceed: 'require_approval' }),
        row({ providerKey: 'apollo', displayName: 'Apollo', exhausted: true, tone: 'danger', percent: 100, used: 100 }),
      ]);
    render(<panel.MyCreditsPanel />);
    const link = await screen.findByRole('link', { name: /Pedir más créditos/ });
    assert.equal(link.getAttribute('href'), '/credit-approvals');
    assert.ok(screen.getByText('Sin créditos este mes, habla con tu líder'));
  });

  it('sin filas: lo dice', async () => {
    next = async () => result([]);
    render(<panel.MyCreditsPanel />);
    assert.ok(await screen.findByText('Este mes aún no has usado créditos.'));
  });

  it('error: mensaje y «Reintentar» vuelve a consultar', async () => {
    next = async () => {
      throw new Error('boom');
    };
    render(<panel.MyCreditsPanel />);
    const retry = await screen.findByRole('button', { name: 'Reintentar' });
    assert.ok(screen.getByText('No pudimos cargar tus créditos.'));
    next = async () => result([row()]);
    fireEvent.click(retry);
    assert.ok(await screen.findByText('38 / 100'));
    assert.equal(calls, 2);
  });

  it('caché de 60 s: volver a abrir no consulta de nuevo', async () => {
    next = async () => result([row()]);
    const first = render(<panel.MyCreditsPanel />);
    await screen.findByText('38 / 100');
    first.unmount();
    render(<panel.MyCreditsPanel />);
    assert.ok(screen.getByText('38 / 100'));
    assert.equal(calls, 1);
  });
});

describe('AccountMenu con «Mis créditos»', () => {
  it('va entre la tarjeta de la persona y «Cerrar sesión»; un fallo no quita la salida', async () => {
    next = async () => {
      throw new Error('boom');
    };
    render(
      <menu.AccountMenu
        user={{ name: 'Elkin Garcia', email: 'egarcia@ubits.co' }}
        roleLabel="BD"
        onLogout={() => {}}
        creditsSlot={<panel.MyCreditsPanel />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cuenta de Elkin Garcia/ }));
    const credits = await screen.findByRole('region', { name: 'Mis créditos' });
    const logout = screen.getByText('Cerrar sesión');
    const name = screen.getByText('Elkin Garcia');
    assert.ok(name.compareDocumentPosition(credits) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(credits.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(await screen.findByText('No pudimos cargar tus créditos.'));
    assert.ok(screen.getByText('Cerrar sesión'));
  });
});
