/**
 * AiAnalyzingState (Thema · ai-interaction) — contrato RUNTIME: progreso,
 * espera indeterminada y variante de una línea.
 */
import '../../chat/__tests__/jsdom-setup';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let rtl: typeof import('@testing-library/react');
let AiAnalyzingState: (typeof import('../ai-analyzing-state'))['AiAnalyzingState'];

before(async () => {
  rtl = await import('@testing-library/react');
  ({ AiAnalyzingState } = await import('../ai-analyzing-state'));
});

afterEach(() => rtl.cleanup());

describe('AiAnalyzingState', () => {
  it('panel con progreso: titular, detalle, porcentaje y barra accesible', () => {
    rtl.render(<AiAnalyzingState title="Importando candidatos" progress={42.4} detail="12 en proceso" caption="Validando duplicados" />);
    const status = rtl.screen.getByRole('status');
    assert.equal(status.getAttribute('data-variant'), 'panel');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.match(status.textContent ?? '', /Importando candidatos/);
    assert.match(status.textContent ?? '', /12 en proceso42%/);
    assert.match(status.textContent ?? '', /Validando duplicados/);
    const bar = rtl.screen.getByRole('progressbar');
    assert.equal(bar.getAttribute('aria-valuenow'), '42');
    assert.equal((bar.firstElementChild as HTMLElement).style.transform, 'scaleX(0.42)');
  });

  it('el progreso se acota a 0–100', () => {
    const { rerender } = rtl.render(<AiAnalyzingState title="x" progress={140} />);
    assert.equal(rtl.screen.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    rerender(<AiAnalyzingState title="x" progress={-5} />);
    assert.equal(rtl.screen.getByRole('progressbar').getAttribute('aria-valuenow'), '0');
  });

  it('sin `progress` la espera es indeterminada: no hay barra ni porcentaje', () => {
    rtl.render(<AiAnalyzingState title="Generando empresas candidatas" caption="Procesando búsqueda con IA" />);
    assert.equal(rtl.screen.queryByRole('progressbar'), null);
    assert.doesNotMatch(rtl.screen.getByRole('status').textContent ?? '', /%/);
    assert.match(rtl.screen.getByRole('status').textContent ?? '', /Procesando búsqueda con IA/);
  });

  it('el titular nuevo se monta de nuevo (entra con su fundido)', () => {
    const { rerender } = rtl.render(<AiAnalyzingState title="Paso uno" />);
    const first = rtl.screen.getByText('Paso uno');
    rerender(<AiAnalyzingState title="Paso dos" />);
    assert.equal(first.isConnected, false);
    assert.match(rtl.screen.getByText('Paso dos').className, /chat-rise/);
  });

  it('variante inline: una línea con la chispa pequeña, sin marco ni barra', () => {
    const { container } = rtl.render(<AiAnalyzingState variant="inline" title="Buscando…" progress={50} caption="no se pinta" />);
    const status = rtl.screen.getByRole('status');
    assert.equal(status.getAttribute('data-variant'), 'inline');
    assert.equal(status.textContent, 'Buscando…');
    assert.equal(rtl.screen.queryByRole('progressbar'), null);
    assert.equal(container.querySelector('[data-slot="ai-spark-glyph"]')?.getAttribute('width'), '18');
    assert.doesNotMatch(status.className, /shimmer-mirror/);
  });

  it('la chispa pinta con los tokens de IA del tema y cada instancia tiene su degradado', () => {
    const { container } = rtl.render(
      <>
        <AiAnalyzingState title="a" />
        <AiAnalyzingState title="b" />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);
    assert.equal(new Set(ids).size, 2);
    assert.equal(container.querySelector('stop')?.getAttribute('stop-color'), 'var(--su-ai-stop-1)');
  });
});
