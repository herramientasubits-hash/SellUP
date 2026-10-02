/**
 * Importar candidatos — contrato RUNTIME de las piezas en que se partió el
 * drawer: la validación del archivo (mismas reglas al elegirlo o arrastrarlo),
 * el paso de entrada con `UploadZone` / `FilePreview`, el resumen de
 * clasificación y lo que se envía al crear el lote.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test has no DOM environment) ────────────────────────
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
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;
for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

mock.module('sonner', {
  namedExports: { toast: { success: () => {}, error: () => {} } },
});

let helpers: typeof import('../import-candidates-helpers');
let ImportCandidatesInputStep: (typeof import('../import-candidates-input-step'))['ImportCandidatesInputStep'];
let ImportClassificationSummary: (typeof import('../import-classification-summary'))['ImportClassificationSummary'];
let ImportClassificationFooter: (typeof import('../import-candidates-footer'))['ImportClassificationFooter'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  helpers = await import('../import-candidates-helpers');
  ({ ImportCandidatesInputStep } = await import('../import-candidates-input-step'));
  ({ ImportClassificationSummary } = await import('../import-classification-summary'));
  ({ ImportClassificationFooter } = await import('../import-candidates-footer'));
});

afterEach(() => {
  cleanup();
});

function file(name: string, size = 10): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateImportFile — las tres reglas de siempre', () => {
  it('acepta .csv y .xlsx (sin distinguir mayúsculas)', () => {
    assert.deepEqual(helpers.validateImportFile(file('empresas.csv')), { ext: 'csv' });
    assert.deepEqual(helpers.validateImportFile(file('Empresas.XLSX')), { ext: 'xlsx' });
  });

  it('rechaza .xlsm con su aviso de seguridad', () => {
    assert.deepEqual(helpers.validateImportFile(file('macro.xlsm')), {
      error: 'Por seguridad, sube el archivo como .xlsx o CSV. Los archivos .xlsm no son soportados.',
    });
  });

  it('rechaza cualquier otro formato', () => {
    assert.deepEqual(helpers.validateImportFile(file('lista.pdf')), {
      error: 'Formato no soportado. Usa CSV o XLSX.',
    });
  });

  it('rechaza más de 2 MB y acepta justo 2 MB', () => {
    assert.deepEqual(helpers.validateImportFile(file('a.csv', 2 * 1024 * 1024)), { ext: 'csv' });
    assert.deepEqual(helpers.validateImportFile(file('a.csv', 2 * 1024 * 1024 + 1)), {
      error: 'El archivo supera 2 MB. Usa un archivo más pequeño o pega el contenido.',
    });
  });
});

describe('lo que se envía al crear el lote', () => {
  const row = {
    index: 0,
    status: 'valid',
    resolved_country_code: 'CO',
    raw: { company_name: 'Acme', country: 'Colombia', industry: 'Tecnología', subindustry: 'SaaS', website: 'acme.co' },
  } as unknown as Parameters<typeof helpers.buildImportCandidates>[0][number];

  it('la subindustria solo viaja cuando el catálogo las publica', () => {
    assert.equal(helpers.buildImportCandidates([row], true)[0].subindustry, 'SaaS');
    const without = JSON.parse(JSON.stringify(helpers.buildImportCandidates([row], false)[0]));
    assert.equal('subindustry' in without, false);
    assert.equal(without.company_name, 'Acme');
    assert.equal(without.country_code, 'CO');
  });

  it('el cuerpo lleva los conteos de la vista previa y los valores por defecto', () => {
    const preview = {
      recognized_columns: ['Empresa'],
      unrecognized_columns: ['X'],
      total: 3,
      valid: 1,
      errors: 1,
      warnings_only: 1,
      rows: [],
    } as unknown as Parameters<typeof helpers.buildCreateImportBatchBody>[0]['preview'];
    const body = helpers.buildCreateImportBatchBody({
      importType: 'csv',
      candidates: [],
      preview,
      defaults: { country: 'Colombia', country_code: 'CO', industry: undefined, subindustry: undefined },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(body)), {
      import_type: 'csv',
      candidates: [],
      recognized_columns: ['Empresa'],
      unrecognized_columns: ['X'],
      total_rows: 3,
      valid_rows: 1,
      invalid_rows: 1,
      warning_rows: 1,
      defaults: { country: 'Colombia', country_code: 'CO' },
    });
  });

  it('el paso del indicador se deriva del estado', () => {
    assert.equal(helpers.getStepperIndex('input', false), 0);
    assert.equal(helpers.getStepperIndex('classification', true), 1);
    assert.equal(helpers.getStepperIndex('classification', false), 2);
    assert.equal(helpers.getStepperIndex('preview', false), 3);
    assert.equal(helpers.getStepperIndex('success', false), 4);
  });
});

function inputStep(overrides: Record<string, unknown> = {}) {
  const calls = { selected: [] as File[], removed: 0, retry: 0 };
  const props = {
    countryCode: '',
    onCountryChange: () => {},
    industryId: '',
    onIndustryChange: () => {},
    industryOptions: [{ value: 'i1', label: 'Tecnología' }],
    subindustriesEnabled: false,
    subindustryId: '',
    onSubindustryChange: () => {},
    subindustryOptions: [],
    subindustryCountryWarning: false,
    catalogReady: true,
    catalogEmpty: false,
    catalogLoading: false,
    catalogError: null,
    onRetryCatalog: () => {
      calls.retry += 1;
    },
    fileMethod: 'file',
    onFileMethodChange: () => {},
    pasteText: '',
    onPasteTextChange: () => {},
    selectedFile: null,
    fileError: null,
    onFileSelected: (f: File) => {
      calls.selected.push(f);
    },
    onFileRemoved: () => {
      calls.removed += 1;
    },
    showGuide: false,
    onShowGuideChange: () => {},
    ...overrides,
  } as unknown as Parameters<typeof ImportCandidatesInputStep>[0];
  const view = render(h(ImportCandidatesInputStep, props));
  return { calls, ...view };
}

describe('paso de entrada — subir archivo', () => {
  it('ofrece la zona para arrastrar o elegir, con los límites a la vista', () => {
    inputStep();
    assert.ok(screen.getByText('Arrastra el archivo aquí o haz clic para elegirlo'));
    assert.ok(screen.getByText('Archivos .csv o .xlsx · máx. 2 MB · 500 filas'));
  });

  it('elegir un archivo lo entrega tal cual al drawer (que es quien valida)', () => {
    const { container, calls } = inputStep();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const picked = file('empresas.csv');
    fireEvent.change(input, { target: { files: [picked] } });
    assert.equal(calls.selected.length, 1);
    assert.equal(calls.selected[0], picked);
  });

  it('soltar un archivo hace lo mismo que elegirlo', () => {
    const { calls } = inputStep();
    const zone = screen.getByText('Arrastra el archivo aquí o haz clic para elegirlo').closest('[role="button"]') as HTMLElement;
    const dropped = file('lista.xlsm');
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });
    assert.equal(calls.selected[0], dropped, 'también lo que el drawer va a rechazar llega a su validación');
  });

  it('el error de validación se lee en la propia zona', () => {
    inputStep({ fileError: 'Formato no soportado. Usa CSV o XLSX.' });
    const message = screen.getByText('Formato no soportado. Usa CSV o XLSX.');
    assert.equal(message.getAttribute('role'), 'alert');
  });

  it('con archivo elegido muestra su ficha y deja quitarlo', () => {
    const { calls, container } = inputStep({ selectedFile: file('empresas.csv', 2048) });
    assert.ok(screen.getByText('empresas.csv'));
    assert.equal(container.querySelector('input[type="file"]'), null, 'la zona se retira');
    fireEvent.click(screen.getByRole('button', { name: /empresas\.csv/ }));
    assert.equal(calls.removed, 1);
  });

  it('con el método «pegar», el campo de texto queda enlazado a su etiqueta', () => {
    inputStep({ fileMethod: 'paste' });
    const textarea = screen.getByLabelText('Pega el contenido copiado desde Google Sheets o Excel');
    assert.equal(textarea.tagName, 'TEXTAREA');
  });
});

describe('paso de entrada — catálogo de industrias', () => {
  it('mientras carga lo anuncia una sola vez', () => {
    inputStep({ catalogReady: false, catalogLoading: true });
    assert.equal(screen.getAllByRole('status').length, 1);
    assert.ok(screen.getByText('Cargando catálogo…'));
  });

  it('si falla, avisa y deja reintentar', () => {
    const { calls } = inputStep({ catalogReady: false, catalogError: 'boom' });
    assert.ok(screen.getByText('No pudimos cargar el catálogo.'));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    assert.equal(calls.retry, 1);
  });
});

describe('resumen de clasificación', () => {
  const base = { total: 10, valid: 6, normalized: 2, warning: 2, requiresReview: 0, invalid: 0 };

  it('todo listo: aviso en positivo con el porcentaje y la versión del catálogo', () => {
    render(h(ImportClassificationSummary, { stats: base, catalogVersion: '7' }));
    const alert = screen.getByRole('alert');
    assert.match(alert.textContent ?? '', /8 de 10 filas listas para importar \(80%\)/);
    assert.match(alert.textContent ?? '', /Catálogo: v7/);
    const bar = screen.getByRole('img');
    assert.match(bar.getAttribute('aria-label') ?? '', /Reparto de las filas/);
  });

  it('con filas por corregir: aviso de advertencia que cuenta revisión + no válidas', () => {
    render(
      h(ImportClassificationSummary, {
        stats: { total: 10, valid: 5, normalized: 1, warning: 1, requiresReview: 2, invalid: 1 },
        catalogVersion: '7',
      }),
    );
    assert.match(screen.getByRole('alert').textContent ?? '', /3 de 10 filas requieren corrección antes de importar/);
    assert.ok(screen.getByText('No válidas'), 'las no válidas aparecen cuando las hay');
  });

  it('sin filas no válidas, ese tramo no ocupa sitio', () => {
    render(h(ImportClassificationSummary, { stats: base, catalogVersion: '7' }));
    assert.equal(screen.queryByText('No válidas'), null);
  });
});

describe('pie del paso de clasificación — qué bloquea importar', () => {
  function footer(overrides: Record<string, unknown>) {
    let confirmed = 0;
    render(
      h(ImportClassificationFooter, {
        onBack: () => {},
        onConfirm: () => {
          confirmed += 1;
        },
        selectedCount: 3,
        totalCount: 5,
        blockingCount: 0,
        canImport: true,
        confirming: false,
        ...overrides,
      } as Parameters<typeof ImportClassificationFooter>[0]),
    );
    return () => confirmed;
  }

  it('con filas elegidas y sin bloqueos, importa', () => {
    const confirmed = footer({});
    const button = screen.getByRole('button', { name: 'Importar 3 candidatos' }) as HTMLButtonElement;
    assert.equal(button.disabled, false);
    fireEvent.click(button);
    assert.equal(confirmed(), 1);
  });

  it('con filas que requieren corrección, el botón queda apagado y dice por qué', () => {
    footer({ blockingCount: 2, canImport: false });
    assert.equal((screen.getByRole('button', { name: 'Importar 3 candidatos' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByText('Corrige o deselecciona 2 filas para continuar.'));
  });

  it('sin filas elegidas, pide elegir al menos una', () => {
    footer({ selectedCount: 0, canImport: false });
    assert.equal((screen.getByRole('button', { name: 'Importar 0 candidatos' }) as HTMLButtonElement).disabled, true);
    assert.ok(screen.getByText('Selecciona al menos una fila para importar.'));
  });
});
