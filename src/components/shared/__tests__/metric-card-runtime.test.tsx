/**
 * MetricCard (anatomía de Thema) — contrato RUNTIME: contenido, estados y tono.
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
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let MetricCard: (typeof import('../metric-card'))['MetricCard'];

const h = React.createElement;

/** El acento vertical es el primer `span[aria-hidden]` de la cabecera. */
function accentBar(container: HTMLElement): HTMLElement {
  const bar = container.querySelector('span[aria-hidden]');
  assert.ok(bar, 'la tarjeta debe pintar su acento vertical');
  return bar as HTMLElement;
}

function tintedIcon(className: string): React.ReactElement {
  return h('span', { className, 'data-testid': 'icon' }, h('svg'));
}

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  MetricCard = (await import('../metric-card')).MetricCard;
});

afterEach(() => {
  cleanup();
});

describe('MetricCard — contenido', () => {
  it('muestra el título, el valor y la descripción', () => {
    render(h(MetricCard, { title: 'Cuentas activas', value: '128', description: 'Sobre 300 cuentas' }));

    assert.ok(screen.getByText('Cuentas activas'));
    assert.ok(screen.getByText('128'));
    assert.ok(screen.getByText('Sobre 300 cuentas'));
  });

  it('muestra el subtítulo junto al valor', () => {
    render(h(MetricCard, { title: 'Créditos', value: 68, subtitle: 'de 366' }));

    assert.ok(screen.getByText('de 366'));
  });

  it('pinta la píldora de variación con signo cuando delta es positivo', () => {
    render(h(MetricCard, { title: 'Conversión', value: '12%', delta: 8 }));

    assert.ok(screen.getByText('+8%'));
  });

  it('pinta la píldora con el signo menos cuando delta es negativo', () => {
    render(h(MetricCard, { title: 'Conversión', value: '12%', delta: -5 }));

    assert.ok(screen.getByText('-5%'));
  });

  it('deltaLabel sustituye al porcentaje calculado', () => {
    render(h(MetricCard, { title: 'Conversión', value: '12%', delta: 8, deltaLabel: '8 más que ayer' }));

    assert.ok(screen.getByText('8 más que ayer'));
    assert.equal(screen.queryByText('+8%'), null);
  });

  it('sin delta ni deltaLabel no pinta píldora', () => {
    const { container } = render(h(MetricCard, { title: 'Conversión', value: '12%' }));

    assert.equal(container.querySelector('.rounded-full.border'), null);
  });

  it('pinta el pie cuando recibe footer', () => {
    render(h(MetricCard, { title: 'Lotes', value: 3, footer: 'Actualizado hace 2 h' }));

    assert.ok(screen.getByText('Actualizado hace 2 h'));
  });

  it('pinta las acciones y el gráfico que recibe', () => {
    render(
      h(MetricCard, {
        title: 'Lotes',
        value: 3,
        actions: h('button', { type: 'button' }, 'Ver'),
        chart: h('svg', { 'data-testid': 'chart' }),
      }),
    );

    assert.ok(screen.getByRole('button', { name: 'Ver' }));
    assert.ok(screen.getByTestId('chart'));
  });
});

describe('MetricCard — estados', () => {
  it('loading pinta el esqueleto con aria-busy y no el contenido', () => {
    const { container } = render(h(MetricCard, { title: 'Lotes', value: 3, loading: true }));

    assert.ok(container.querySelector('[aria-busy="true"]'));
    assert.equal(screen.queryByText('Lotes'), null);
    assert.equal(screen.queryByText('3'), null);
  });

  it('error pinta el mensaje con role="alert" y oculta el valor', () => {
    render(h(MetricCard, { title: 'Lotes', value: 3, error: 'No se pudo cargar' }));

    assert.equal(screen.getByRole('alert').textContent, 'No se pudo cargar');
    assert.ok(screen.getByText('Lotes'));
    assert.equal(screen.queryByText('3'), null);
  });

  it('error tiñe el acento de destructivo cuando no hay tono explícito', () => {
    const { container } = render(h(MetricCard, { title: 'Lotes', value: 3, error: 'Falló' }));

    assert.ok(accentBar(container).classList.contains('bg-destructive'));
  });

  it('hint pinta el botón «Qué mide …» con el título de la tarjeta', () => {
    render(h(MetricCard, { title: 'Conversión', value: '12%', hint: 'Aprobados sobre revisados' }));

    assert.ok(screen.getByRole('button', { name: 'Qué mide Conversión' }));
  });

  it('sin hint no pinta el botón de información', () => {
    render(h(MetricCard, { title: 'Conversión', value: '12%' }));

    assert.equal(screen.queryByRole('button'), null);
  });
});

describe('MetricCard — tono', () => {
  it('sin icono ni tono el acento es el primario', () => {
    const { container } = render(h(MetricCard, { title: 'Lotes', value: 3 }));

    assert.ok(accentBar(container).classList.contains('bg-primary'));
  });

  const INFERRED: ReadonlyArray<[string, string]> = [
    ['bg-success/10', 'bg-success'],
    ['bg-warning/15 text-warning', 'bg-warning'],
    ['bg-destructive/10', 'bg-destructive'],
    ['bg-info/10', 'bg-info'],
    ['text-muted-foreground', 'bg-border-strong'],
  ];
  for (const [iconClass, barClass] of INFERRED) {
    it(`deduce el acento ${barClass} de un icono teñido con ${iconClass}`, () => {
      const { container } = render(h(MetricCard, { title: 'Lotes', value: 3, icon: tintedIcon(iconClass) }));

      assert.ok(accentBar(container).classList.contains(barClass));
    });
  }

  it('deduce el tono del hijo del icono cuando el tinte va por dentro', () => {
    const icon = h('span', null, h('svg', { className: 'text-success' }));

    const { container } = render(h(MetricCard, { title: 'Lotes', value: 3, icon }));

    assert.ok(accentBar(container).classList.contains('bg-success'));
  });

  it('el tono explícito gana al que se deduce del icono', () => {
    const { container } = render(
      h(MetricCard, { title: 'Lotes', value: 3, tone: 'warning', icon: tintedIcon('bg-success/10') }),
    );

    const bar = accentBar(container);
    assert.ok(bar.classList.contains('bg-warning'));
    assert.equal(bar.classList.contains('bg-success'), false);
  });

  it('el chip del icono toma el tinte del tono resuelto', () => {
    render(h(MetricCard, { title: 'Lotes', value: 3, icon: tintedIcon('bg-success/10') }));

    const chip = screen.getByTestId('icon').parentElement as HTMLElement;
    assert.ok(chip.classList.contains('bg-success/10'));
    assert.equal(chip.getAttribute('aria-hidden'), 'true');
  });

  it('con iconPosition="left-large" el icono sale del chip de la cabecera', () => {
    render(
      h(MetricCard, { title: 'Lotes', value: 3, iconPosition: 'left-large', icon: tintedIcon('bg-info/10') }),
    );

    const wrapper = screen.getByTestId('icon').parentElement as HTMLElement;
    assert.equal(wrapper.classList.contains('size-6'), false);
  });
});
