/**
 * A1-APOLLO-WIZARD-1 — contrato RUNTIME de la fila «Proveedor de búsqueda».
 *
 * Renderiza el componente real que el wizard monta debajo de la barra de
 * progreso y prueba lo que el hallazgo de QA visual pedía:
 *   - Tavily resuelto se nombra;
 *   - Apollo resuelto se nombra;
 *   - sin resolución dice «por definir», no un proveedor inventado;
 *   - un proveedor omitido conserva su nombre + aviso funcional;
 *   - nada del texto visible expone claves, flags, env vars, roles ni motivos
 *     técnicos de disponibilidad.
 *
 * No llama a ningún proveedor ni carga acción de servidor alguna.
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
import type { WizardProviderIndicator } from '@/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let WizardProviderIndicatorRow: (typeof import('../wizard-provider-indicator'))['WizardProviderIndicatorRow'];

function renderIndicator(indicator: WizardProviderIndicator) {
  return render(React.createElement(WizardProviderIndicatorRow, { indicator }));
}

function visibleText(): string {
  return screen.getByTestId('wizard-provider-indicator').textContent ?? '';
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  WizardProviderIndicatorRow = (await import('../wizard-provider-indicator'))
    .WizardProviderIndicatorRow;
});

afterEach(() => {
  cleanup();
});

describe('WizardProviderIndicatorRow — proveedor resuelto', () => {
  it('nombra Tavily cuando el servidor resolvió tavily', () => {
    renderIndicator({ status: 'resolved', provider: 'tavily' });
    assert.match(visibleText(), /Proveedor de búsqueda:\s*Tavily/);
  });

  it('nombra Apollo cuando el servidor resolvió apollo_organizations', () => {
    renderIndicator({ status: 'resolved', provider: 'apollo_organizations' });
    assert.match(visibleText(), /Proveedor de búsqueda:\s*Apollo/);
  });

  it('nombra Lusha cuando la ruta moderna corre por Lusha', () => {
    renderIndicator({ status: 'resolved', provider: 'lusha' });
    assert.match(visibleText(), /Proveedor de búsqueda:\s*Lusha/);
  });

  it('un proveedor resuelto no lleva aviso de indisponibilidad', () => {
    renderIndicator({ status: 'resolved', provider: 'tavily' });
    assert.doesNotMatch(visibleText(), /no disponible/i);
  });
});

describe('WizardProviderIndicatorRow — sin resolución', () => {
  it('dice «por definir» en lugar de inventar un proveedor', () => {
    renderIndicator({ status: 'unresolved', provider: null });
    assert.match(visibleText(), /Proveedor de búsqueda:\s*por definir/);
  });

  it('no nombra ningún proveedor mientras no haya resolución', () => {
    renderIndicator({ status: 'unresolved', provider: null });
    const text = visibleText();
    for (const name of [/Tavily/, /Apollo/, /Lusha/]) {
      assert.doesNotMatch(text, name);
    }
  });
});

describe('WizardProviderIndicatorRow — proveedor no disponible', () => {
  it('conserva el nombre visible y agrega el aviso funcional', () => {
    renderIndicator({ status: 'unavailable', provider: 'apollo_organizations' });
    const text = visibleText();
    assert.match(text, /Apollo/);
    assert.match(text, /no disponible en este momento/i);
  });

  it('sin proveedor seleccionado muestra «no disponible» sin nombrar a nadie', () => {
    renderIndicator({ status: 'unavailable', provider: null });
    const text = visibleText();
    assert.match(text, /Proveedor de búsqueda:\s*no disponible/);
    for (const name of [/Tavily/, /Apollo/, /Lusha/]) {
      assert.doesNotMatch(text, name);
    }
  });

  it('el aviso no explica la causa técnica de la omisión', () => {
    renderIndicator({ status: 'unavailable', provider: 'apollo_organizations' });
    const text = visibleText();
    for (const forbidden of [
      /credencial/i,
      /capability/i,
      /presupuesto/i,
      /permiso/i,
      /deshabilitad/i,
    ]) {
      assert.doesNotMatch(text, forbidden);
    }
  });
});

describe('WizardProviderIndicatorRow — sin datos técnicos sensibles', () => {
  /** Todo estado posible del indicador, incluidos los degradados. */
  const ALL_STATES: WizardProviderIndicator[] = [
    { status: 'resolved', provider: 'tavily' },
    { status: 'resolved', provider: 'apollo_organizations' },
    { status: 'resolved', provider: 'lusha' },
    { status: 'unresolved', provider: null },
    { status: 'unavailable', provider: 'apollo_organizations' },
    { status: 'unavailable', provider: null },
  ];

  const FORBIDDEN: RegExp[] = [
    // Variables de entorno y flags
    /ENABLE_/,
    /AGENT1_/,
    /process\.env/,
    /feature\s*flag/i,
    /\bflag\b/i,
    // Claves y credenciales
    /api[\s_-]?key/i,
    /\btoken\b/i,
    /\bvault\b/i,
    /service[_\s]role/i,
    // Roles y permisos
    /\badmin\b/i,
    /commercial_manager/i,
    // Claves técnicas internas
    /apollo_organizations/,
    /blocked_lusha_disabled/,
    /default_ai/,
    /capability_unavailable/,
    /provider_not_configured/,
  ];

  it('ningún estado renderiza datos técnicos sensibles', () => {
    for (const state of ALL_STATES) {
      renderIndicator(state);
      const text = visibleText();
      for (const forbidden of FORBIDDEN) {
        assert.doesNotMatch(
          text,
          forbidden,
          `estado ${state.status}/${String(state.provider)} filtró ${forbidden}`,
        );
      }
      cleanup();
    }
  });

  it('el indicador es una sola línea de texto (no crece el alto del wizard)', () => {
    renderIndicator({ status: 'unavailable', provider: 'apollo_organizations' });
    const node = screen.getByTestId('wizard-provider-indicator');
    assert.equal(node.tagName, 'P');
    assert.equal(node.querySelectorAll('br').length, 0);
    assert.equal(node.querySelectorAll('div').length, 0);
  });

  it('usa tokens de tema, no colores fijos (funciona en claro y oscuro)', () => {
    renderIndicator({ status: 'resolved', provider: 'tavily' });
    const html = screen.getByTestId('wizard-provider-indicator').outerHTML;
    assert.match(html, /text-muted-foreground/);
    assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(html, /rgba?\(/);
  });
});
