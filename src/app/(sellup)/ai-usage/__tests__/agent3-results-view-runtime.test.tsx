/**
 * Auditoría del Agente 3 (21-10) — el tablero de resultados de Rumbo (Uso de IA → Por
 * agente): las cifras por enfoque, canal y país, el aviso cuando nadie marcó «La usé» y
 * las tasas con poca muestra apagadas. Sin base de datos.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/ruta?period=7d',
  pretendToBeVisual: true,
});
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}
copyWindowPropsToGlobal();

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildApproachResultsDashboard, type ApproachResultRow } from '@/server/agents/first-call/approach-results';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let view: typeof import('../agent3-results-view');

const h = React.createElement;

const row = (extra: Partial<ApproachResultRow>): ApproachResultRow => ({
  channel: 'call',
  countryCode: 'CO',
  mainApproach: 'problem',
  status: 'draft',
  usedApproach: null,
  outcome: null,
  ...extra,
});

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  view = await import('../agent3-results-view');
});
afterEach(() => cleanup());

describe('tablero de resultados de Rumbo', () => {
  it('sin preparaciones dice que no hubo y no muestra tablas', () => {
    render(h(view.Agent3ResultsView, { dashboard: buildApproachResultsDashboard([]) }));
    assert.ok(screen.getByText('Rumbo no preparó primeros contactos en este periodo'));
    assert.equal(screen.queryByText('Por enfoque'), null);
  });

  it('con preparaciones pero sin «La usé» lo dice y explica para qué sirve', () => {
    render(h(view.Agent3ResultsView, { dashboard: buildApproachResultsDashboard([row({}), row({ channel: 'email' })]) }));
    assert.ok(screen.getByText('Todavía nadie marcó «La usé»'));
    assert.ok(screen.getByText('Por enfoque'));
    assert.ok(screen.getByText('Por canal'));
    assert.ok(screen.getByText('Por país'));
  });

  it('cuenta por enfoque y canal, con la tasa de conversación', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ status: 'used', usedApproach: 'permission', outcome: 'meeting_booked' })),
      row({ status: 'used', usedApproach: 'permission', outcome: 'not_now' }),
      row({ status: 'used', usedApproach: 'insight', outcome: 'interested', channel: 'email', countryCode: 'MX' }),
    ];
    render(h(view.Agent3ResultsView, { dashboard: buildApproachResultsDashboard(rows, (c) => (c === 'CO' ? 'Colombia' : 'México')) }));
    assert.ok(screen.getAllByText('Directo y con permiso').length >= 1);
    assert.ok(screen.getByText('Colombia'));
    assert.ok(screen.getByText('México'));
    assert.ok(screen.getAllByText('83 %').length >= 1, '5 de 6 en Directo y con permiso');
    assert.equal(screen.queryByText('Todavía nadie marcó «La usé»'), null);
  });
});
