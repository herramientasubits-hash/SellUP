/**
 * Shell = anatomía del playground de UX (flux-ui), decisión 27-10-2026.
 *
 * Contrato ESTÁTICO: el menú lateral mide 288px y se pliega a un riel de
 * 72px deslizándose (no salta), sus secciones despliegan con la altura
 * animada (Collapsible, no `{isOpen && …}`) y la cabecera mide 60px con el
 * botón de plegar junto a la ruta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYOUT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(join(LAYOUT, file), 'utf8');

describe('menú lateral: 288px ↔ riel de 72px, deslizándose', () => {
  const shell = read('app-shell.tsx');

  it('el hueco y el panel viajan juntos en 300ms con la curva del cajón', () => {
    assert.ok(shell.includes('transition-[width,left] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'));
    assert.match(shell, /collapsed \? "w-18" : "w-72"/);
    assert.match(shell, /collapsed \? "-left-54" : "left-0"/, 'plegado, el panel queda detrás del riel');
    assert.ok(!shell.includes('"w-16"'), 'el riel ya no es de 64px');
    assert.ok(!shell.includes('page-atmosphere'), 'el marco va plano, como el playground');
  });

  it('el estado se pliega solo en ventana angosta y responde a ⌘B', () => {
    const context = read('sidebar-context.tsx');
    assert.ok(context.includes('(max-width: 1199px)'));
    assert.ok(context.includes('event.metaKey || event.ctrlKey'));
    assert.ok(context.includes('sellup-sidebar-collapsed'), 'sigue recordando la elección');
  });
});

describe('menú lateral: filas y secciones del playground', () => {
  const sidebar = read('app-sidebar.tsx');

  it('las secciones despliegan con Collapsible (altura animada), no montándose de golpe', () => {
    assert.ok(sidebar.includes('<Collapsible'));
    assert.ok(sidebar.includes('<CollapsibleContent'));
    assert.ok(!/\{isOpen && \(/.test(sidebar));
  });

  it('fila de 36px, activa en azul al 10% con la marca en el borde', () => {
    assert.ok(sidebar.includes('h-9 w-full min-w-0 items-center gap-3 rounded-lg px-1.5'));
    assert.ok(sidebar.includes('bg-primary/10 text-primary'));
    assert.ok(sidebar.includes('before:w-0.75'));
    assert.ok(sidebar.includes('size-6.5'), 'icono en baldosa de 26px');
  });

  it('plegado, el panel queda inerte detrás del riel', () => {
    assert.ok(sidebar.includes('inert={collapsed}'));
    assert.ok(sidebar.includes('fixed inset-y-0 left-0 z-20 w-18'));
  });

  it('el riel: iconos de 20px en botones de 40px', () => {
    const rail = read('sidebar-icon-rail.tsx');
    assert.ok(rail.includes('size-10'));
    assert.ok(rail.includes('size-5 shrink-0'));
    assert.ok(rail.includes('gap-2.5'));
  });
});

describe('cabecera: 60px, plegar + ruta, buscador al centro', () => {
  const header = read('app-header.tsx');

  it('mide 60px y el botón de plegar va junto a la ruta', () => {
    assert.ok(header.includes('h-15'));
    assert.ok(header.includes('onClick={onMenuClick}'));
    assert.ok(header.includes('HEADER_ICON_BUTTON'));
  });

  it('los botones de icono se tiñen de azul con su menú abierto', () => {
    const icon = read('header-icon.ts');
    assert.ok(icon.includes('size-8'));
    assert.ok(icon.includes('data-[popup-open]:bg-primary/10'));
  });
});
