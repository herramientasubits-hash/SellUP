/**
 * Piezas compartidas de los paneles del detalle de una fuente — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - el desenlace de una ejecución se anuncia como aviso (error o éxito);
 *   - un error nunca convive con un informe viejo;
 *   - las advertencias y las muestras solo aparecen cuando existen;
 *   - las muestras llegan plegadas y se abren con un botón de verdad.
 *
 * Solo presentación: aquí no se importa ninguna acción de servidor ni se llama
 * a ningún proveedor.
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FlaskConical } from '@/icons';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let parts: typeof import('../[sourceKey]/source-panel-parts');

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  parts = await import('../[sourceKey]/source-panel-parts');
});

afterEach(() => cleanup());

describe('SourcePanel', () => {
  it('pinta título, descripción y cuerpo', () => {
    render(
      h(parts.SourcePanel, {
        icon: FlaskConical,
        title: 'Dry-run de fuente',
        description: 'Prueba controlada.',
        children: h('p', null, 'Cuerpo'),
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Dry-run de fuente' }));
    assert.ok(screen.getByText('Prueba controlada.'));
    assert.ok(screen.getByText('Cuerpo'));
  });
});

describe('PanelRunResult', () => {
  it('con error muestra solo el aviso de error, nunca el informe', () => {
    render(h(parts.PanelRunResult, { error: 'Falló la prueba.', children: h('p', null, 'Informe') }));

    assert.match(screen.getByRole('alert').textContent ?? '', /Falló la prueba\./);
    assert.equal(screen.queryByText('Informe'), null);
  });

  it('con informe muestra el aviso de éxito y el informe', () => {
    render(h(parts.PanelRunResult, { successTitle: 'Dry-run completado', children: h('p', null, 'Informe') }));

    assert.match(screen.getByRole('alert').textContent ?? '', /Dry-run completado/);
    assert.ok(screen.getByText('Informe'));
  });

  it('sin error ni informe no pinta nada', () => {
    const { container } = render(h(parts.PanelRunResult, { error: null }));
    assert.equal(container.textContent, '');
  });
});

describe('PanelWarnings', () => {
  it('no pinta nada cuando no hay advertencias', () => {
    const { container } = render(h(parts.PanelWarnings, { warnings: [] }));
    assert.equal(container.textContent, '');
  });

  it('lista cada advertencia dentro de un aviso con su cuenta', () => {
    render(h(parts.PanelWarnings, { warnings: ['Sin RFC en 3 registros', 'Límite alcanzado'] }));

    const alert = screen.getByRole('alert');
    assert.match(alert.textContent ?? '', /2 advertencias/);
    assert.equal(alert.querySelectorAll('li').length, 2);
  });

  it('usa el singular con una sola advertencia', () => {
    render(h(parts.PanelWarnings, { warnings: ['Solo una'] }));
    assert.match(screen.getByRole('alert').textContent ?? '', /1 advertencia(?!s)/);
  });
});

describe('PanelSamples', () => {
  it('llega plegado y se abre y se cierra con su botón', () => {
    render(h(parts.PanelSamples, { children: h('p', null, 'Empresa de muestra') }));

    const trigger = screen.getByRole('button', { name: 'Ver muestras' });
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryByText('Empresa de muestra'), null);

    fireEvent.click(trigger);

    assert.ok(screen.getByText('Empresa de muestra'));
    const openTrigger = screen.getByRole('button', { name: 'Ocultar muestras' });
    assert.equal(openTrigger.getAttribute('aria-expanded'), 'true');
  });

  it('acepta un texto propio para el disparador', () => {
    render(h(parts.PanelSamples, { showLabel: 'Ver muestras (7)', children: h('p', null, 'x') }));
    assert.ok(screen.getByRole('button', { name: 'Ver muestras (7)' }));
  });
});

describe('PanelSampleList', () => {
  it('no pinta nada con cero elementos', () => {
    const { container } = render(h(parts.PanelSampleList, { title: 'Aceptados', count: 0, children: null }));
    assert.equal(container.textContent, '');
  });

  it('muestra el título con la cuenta y sus filas', () => {
    render(
      h(parts.PanelSampleList, {
        title: 'Aceptados',
        count: 1,
        children: h(parts.PanelSampleItem, { children: 'ACME SA' }),
      }),
    );

    assert.ok(screen.getByText('Aceptados (1)'));
    assert.equal(screen.getByText('ACME SA').tagName, 'LI');
  });
});

describe('PanelSummary y avisos', () => {
  it('cada cifra es un par dt/dd', () => {
    render(
      h(parts.PanelSummary, {
        children: h(parts.PanelSummaryItem, { label: 'Leídos', value: 25 }),
      }),
    );

    assert.equal(screen.getByText('Leídos').tagName, 'DT');
    assert.equal(screen.getByText('25').tagName, 'DD');
  });

  it('el aviso de solo administradores es un aviso del sistema', () => {
    render(h(parts.AdminOnlyNotice, { children: 'Solo administradores pueden ejecutar dry-runs de fuente.' }));
    assert.match(screen.getByRole('alert').textContent ?? '', /Solo administradores/);
  });

  it('el pie muestra cuándo se ejecutó y sobre qué fuente', () => {
    render(h(parts.PanelRunFooter, { executedAt: '2026-10-01T15:00:00.000Z', trailing: 'mx_denue · MX' }));

    assert.ok(screen.getByText(/^Ejecutado: /));
    assert.ok(screen.getByText('mx_denue · MX'));
  });
});
