/**
 * Frame, IconChip y los tonos del sistema — contrato RUNTIME.
 *
 * El marco agrupa paneles sin sombra propia; el panel es la superficie con
 * sombra; el chip del icono toma su tinte del mapa único de `@/lib/tone`.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
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

let render: (typeof import('@testing-library/react'))['render'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let frame: typeof import('../frame');
let IconChip: (typeof import('../icon-chip'))['IconChip'];
let tone: typeof import('@/lib/tone');
let Users: (typeof import('@/icons'))['Users'];

const h = React.createElement;

before(async () => {
  ({ render, cleanup } = await import('@testing-library/react'));
  frame = await import('../frame');
  IconChip = (await import('../icon-chip')).IconChip;
  tone = await import('@/lib/tone');
  Users = (await import('@/icons')).Users;
});

afterEach(() => cleanup());

describe('Frame', () => {
  it('el marco envuelve cabecera, panel y pie, y solo el panel lleva sombra', () => {
    const { container } = render(
      h(
        frame.Frame,
        null,
        h(frame.FrameHeader, { title: 'Tareas', description: '12 tareas' }),
        h(frame.FramePanel, null, 'cuerpo'),
        h(frame.FrameFooter, null, 'pie'),
      ),
    );
    const marco = container.querySelector('[data-slot="frame"]')!;
    const panel = container.querySelector('[data-slot="frame-panel"]')!;
    assert.ok(marco.className.includes('rounded-2xl'));
    assert.ok(!marco.className.includes('shadow-'), 'el marco no tiene sombra');
    assert.ok(panel.className.includes('rounded-xl'));
    assert.ok(panel.className.includes('shadow-card'));
    assert.deepEqual(
      Array.from(marco.children, (c) => c.getAttribute('data-slot')),
      ['frame-header', 'frame-panel', 'frame-footer'],
    );
  });

  it('noPadding deja el panel sin padding para una tabla de borde a borde', () => {
    const { container } = render(h(frame.FramePanel, { noPadding: true, children: 'tabla' }));
    assert.ok(!container.querySelector('[data-slot="frame-panel"]')!.className.includes('p-5'));
  });
});

describe('tonos e IconChip', () => {
  it('cada mapa de tono cubre todos los tonos', () => {
    for (const mapa of [tone.TONE_CHIP, tone.TONE_TEXT, tone.TONE_FILL, tone.TONE_SOFT, tone.TONE_BADGE]) {
      assert.deepEqual(Object.keys(mapa).sort(), [...tone.TONES].sort());
    }
  });

  it('el chip toma el tinte de su tono y no se anuncia a lectores de pantalla', () => {
    const { container } = render(h(IconChip, { icon: Users, tone: 'warning' }));
    const chip = container.querySelector('[data-slot="icon-chip"]')!;
    for (const clase of tone.TONE_CHIP.warning.split(' ')) assert.ok(chip.className.includes(clase));
    assert.equal(chip.getAttribute('aria-hidden'), 'true');
    assert.ok(chip.querySelector('svg'));
  });
});
