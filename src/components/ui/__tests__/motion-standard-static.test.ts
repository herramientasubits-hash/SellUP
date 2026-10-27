/**
 * Movimiento = estándar de @ubits/flux-ui (decisión 27-10-2026).
 *
 * Contrato ESTÁTICO de las primitivas: lo que se abre o se despliega anima al
 * entrar y al salir, con los mismos tiempos que el playground de UX:
 * 100ms menús/listas/modales, 150ms tooltips, 200ms paneles y desplegables.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(UI, file), 'utf8');
const GLOBALS = readFileSync(join(UI, '..', '..', 'app', 'globals.css'), 'utf8');

describe('desplegables: la altura viaja, no salta', () => {
  it('Collapsible anima la altura al abrir y al cerrar', () => {
    const src = read('collapsible.tsx');
    assert.ok(src.includes('h-(--collapsible-panel-height)'));
    assert.ok(src.includes('transition-[height,opacity] duration-200 ease-out'));
    assert.ok(src.includes('data-starting-style:h-0'));
    assert.ok(src.includes('data-ending-style:h-0'), 'sin esto, al cerrar desaparece de golpe');
  });

  it('Accordion anima la altura y su flecha gira (no cambia de ícono)', () => {
    const src = read('accordion.tsx');
    assert.ok(src.includes('h-(--accordion-panel-height)'));
    assert.ok(src.includes('data-ending-style:h-0'));
    assert.ok(src.includes('group-aria-expanded/accordion-trigger:rotate-180'));
    assert.ok(!src.includes('ChevronUp'), 'una sola flecha que gira');
    assert.ok(!src.includes('--radix-accordion-content-height'), 'variable de Radix: Base UI no la emite');
  });
});

describe('ventanas flotantes: 100ms y desde donde se abren', () => {
  for (const file of ['popover.tsx', 'dropdown-menu.tsx', 'select.tsx', 'dialog.tsx', 'alert-dialog.tsx']) {
    it(`${file} entra y sale en 100ms`, () => {
      const src = read(file);
      assert.ok(src.includes('data-open:animate-in'), 'entrada');
      assert.ok(src.includes('data-closed:animate-out'), 'salida');
      assert.ok(src.includes('duration-100'));
      assert.ok(!/ duration-(150|200|300|500) /.test(src), 'otro tiempo para la misma familia');
    });
  }

  it('Popover crece desde su disparador, como los menús', () => {
    const src = read('popover.tsx');
    assert.ok(src.includes('origin-(--transform-origin)'));
    assert.ok(src.includes('data-[side=bottom]:slide-in-from-top-2'));
  });

  it('Select se abre debajo del campo para poder animar', () => {
    const src = read('select.tsx');
    assert.match(src, /alignItemWithTrigger = false/);
  });
});

describe('paneles laterales: fade + 2.5rem en 200ms', () => {
  it('Sheet entra y sale igual que en flux-ui', () => {
    const src = read('sheet.tsx');
    assert.ok(src.includes('transition duration-200 ease-in-out'));
    assert.ok(src.includes('data-[side=right]:data-starting-style:translate-x-10'));
    assert.ok(!src.includes('translate-x-full'), 'ya no recorre su ancho entero');
    assert.ok(!src.includes('duration-500'));
  });
});

describe('reducir movimiento', () => {
  it('globals.css respeta la preferencia del sistema en todo, menos en los spinners', () => {
    assert.ok(GLOBALS.includes('*:not(.animate-spin)'));
    assert.ok(GLOBALS.includes('transition-duration: 0.01ms !important'));
    assert.ok(GLOBALS.includes('animation-duration: 0.01ms !important'));
  });

  it('su-fade-in termina en transform: none (no rompe hijos fixed)', () => {
    const block = GLOBALS.slice(GLOBALS.indexOf('@keyframes su-fade-in'), GLOBALS.indexOf('@keyframes su-fade-in') + 260);
    assert.ok(block.includes('transform: none'));
  });
});
