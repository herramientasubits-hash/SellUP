/**
 * Tarjetas de cobertura del catálogo de fuentes — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - la base común pinta cabecera, grupos etiqueta/valor, listas y avisos
 *     con las piezas del sistema (`Alert`, `Heading`), no con cajas a mano;
 *   - cada tarjeta sigue mostrando los mismos datos que antes;
 *   - el estado de error se anuncia como aviso (`role="alert"`).
 *
 * Solo presentación: ninguna tarjeta hace I/O.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Landmark } from '@/icons';
import type { SicopSourceCoverageSummary } from '@/server/services/cr-sicop-source-coverage-summary';
import type { HnContratacionesCoverageSummary } from '@/server/services/hn-contrataciones-coverage-summary';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let parts: typeof import('../coverage-card');
let CrSicopCoverageCard: (typeof import('../cr-sicop-coverage-card'))['CrSicopCoverageCard'];
let HnContratacionesAbiertasCard: (typeof import('../hn-contrataciones-abiertas-card'))['HnContratacionesAbiertasCard'];
let BrReceitaCnpjStatusCard: (typeof import('../br-receita-cnpj-status-card'))['BrReceitaCnpjStatusCard'];
let RdCoverageCard: (typeof import('../rd-coverage-card'))['RdCoverageCard'];

const h = React.createElement;

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  parts = await import('../coverage-card');
  ({ CrSicopCoverageCard } = await import('../cr-sicop-coverage-card'));
  ({ HnContratacionesAbiertasCard } = await import('../hn-contrataciones-abiertas-card'));
  ({ BrReceitaCnpjStatusCard } = await import('../br-receita-cnpj-status-card'));
  ({ RdCoverageCard } = await import('../rd-coverage-card'));
});

afterEach(() => cleanup());

describe('base común de las tarjetas de cobertura', () => {
  it('pinta el título como encabezado y el cuerpo de la tarjeta', () => {
    // Arrange / Act
    render(
      h(parts.CoverageCard, {
        icon: Landmark,
        title: 'Cobertura de prueba',
        description: 'Indicador de solo lectura.',
        children: h('p', null, 'Contenido'),
      }),
    );

    // Assert
    assert.ok(screen.getByRole('heading', { level: 2, name: 'Cobertura de prueba' }));
    assert.ok(screen.getByText('Indicador de solo lectura.'));
    assert.ok(screen.getByText('Contenido'));
  });

  it('anuncia el error de carga como aviso', () => {
    render(h(parts.CoverageCardError, { icon: Landmark, title: 'Cobertura', message: 'No se pudo cargar.' }));

    const alert = screen.getByRole('alert');
    assert.match(alert.textContent ?? '', /No se pudo cargar\./);
  });

  it('un grupo pinta su título h3 y cada par etiqueta/valor', () => {
    render(
      h(parts.CoverageFieldGroup, {
        title: 'Carga piloto',
        children: h(parts.CoverageFieldRow, { label: 'Proveedores', value: '160', detail: '160 de 906' }),
      }),
    );

    assert.ok(screen.getByRole('heading', { level: 3, name: 'Carga piloto' }));
    assert.equal(screen.getByText('Proveedores').tagName, 'DT');
    assert.equal(screen.getByText('160').tagName, 'DD');
    assert.ok(screen.getByText('160 de 906'));
  });

  it('el estado operativo es un aviso con título', () => {
    render(h(parts.CoverageStatusNotice, { title: 'Estado operativo', children: 'Piloto local disponible.' }));

    const alert = screen.getByRole('alert');
    assert.match(alert.textContent ?? '', /Estado operativo/);
    assert.match(alert.textContent ?? '', /Piloto local disponible\./);
  });

  it('el motivo del respaldo no pinta nada si no hay motivo', () => {
    const { container } = render(h(parts.CoverageSourceReason, { reason: null }));
    assert.equal(container.textContent, '');
  });

  it('el motivo del respaldo se muestra cuando existe', () => {
    render(h(parts.CoverageSourceReason, { reason: 'lectura dinámica no disponible' }));
    assert.ok(screen.getByText('Motivo: lectura dinámica no disponible'));
  });
});

describe('tarjetas concretas sobre la base común', () => {
  const sicopSummary = {
    loadedRows: 160,
    coverageStatus: 'pilot_sample',
    coverageSource: 'audited_fallback',
    coverageSourceReason: 'missing_env',
    isProcurementSignalOnly: true,
    isFiscalSource: false,
  } as unknown as SicopSourceCoverageSummary;

  it('SICOP muestra sus datos, sus limitaciones y el aviso de estado operativo', () => {
    render(h(CrSicopCoverageCard, { summary: sicopSummary }));

    assert.ok(screen.getByRole('heading', { level: 2, name: 'Cobertura SICOP Costa Rica' }));
    assert.ok(screen.getByText('160 proveedores'));
    assert.ok(screen.getByText('fallback auditado'));
    assert.ok(screen.getByRole('heading', { level: 3, name: 'Limitaciones' }));
    assert.ok(screen.getByText('No valida cédula jurídica.'));
    assert.match(screen.getByRole('alert').textContent ?? '', /Estado operativo/);
    assert.ok(screen.getByText('Motivo: lectura dinámica no disponible'));
  });

  it('SICOP sin resumen muestra el aviso de error y no inventa datos', () => {
    render(h(CrSicopCoverageCard, { error: true }));

    assert.match(screen.getByRole('alert').textContent ?? '', /No se pudo cargar el resumen de cobertura/);
    assert.equal(screen.queryByText('Carga piloto'), null);
  });

  it('DGII RD sin resumen muestra el aviso de error', () => {
    render(h(RdCoverageCard, { error: true }));
    assert.match(screen.getByRole('alert').textContent ?? '', /No se pudo cargar el resumen de cobertura/);
  });

  it('Honduras sin cobertura todavía dice que está cargando, sin aviso de error', () => {
    render(h(HnContratacionesAbiertasCard, { coverage: null }));

    assert.ok(screen.getByText('Cargando cobertura…'));
    assert.equal(screen.queryByRole('alert'), null);
    // Las salvaguardas no dependen de los datos.
    assert.ok(screen.getByText('No reemplaza SAR Honduras ni Registro Mercantil.'));
  });

  it('Honduras con lectura fallida avisa y no muestra cifras del snapshot', () => {
    const coverage = {
      coverageSource: 'audited_fallback',
      loadedRows: 0,
      sourceYear: null,
      pilotScope: true,
      humanReviewRequired: true,
      refreshedAt: null,
    } as unknown as HnContratacionesCoverageSummary;

    render(h(HnContratacionesAbiertasCard, { coverage }));

    assert.match(screen.getByRole('alert').textContent ?? '', /No se pudo leer el resumen de cobertura/);
    assert.equal(screen.queryByText('Proveedores cargados'), null);
  });

  it('Honduras con datos en vivo muestra el número de proveedores que recibe', () => {
    const coverage = {
      coverageSource: 'live_database',
      loadedRows: 66,
      sourceYear: 2025,
      pilotScope: true,
      humanReviewRequired: true,
      refreshedAt: null,
    } as unknown as HnContratacionesCoverageSummary;

    render(h(HnContratacionesAbiertasCard, { coverage }));

    assert.equal(screen.getByText('Proveedores cargados').nextElementSibling?.textContent, '66');
    assert.equal(screen.queryByRole('alert'), null);
  });

  it('Brasil separa lo listo de lo bloqueado y nunca marca como listo lo bloqueado', () => {
    render(h(BrReceitaCnpjStatusCard));

    assert.equal(screen.getAllByText('Listo', { selector: '[data-slot="badge"], span' }).length >= 4, true);
    const blocked = screen.getByRole('heading', { level: 3, name: 'Bloqueado' }).closest('section');
    assert.ok(blocked);
    for (const label of ['Importación', 'Runtime enrichment', 'Integración live Agent 1', 'Sincronización HubSpot']) {
      assert.ok(blocked.textContent?.includes(label), `${label} debe estar entre lo bloqueado`);
    }
    assert.equal(blocked.textContent?.includes('Parser'), false);
  });
});
