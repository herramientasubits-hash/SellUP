/**
 * Tests — AGENT1-AUDIT-WS5 (importación): contrato del cuerpo, correcciones
 * manuales de industria, reparto de la validación con plazo, CSV con comillas
 * y codificación, y pistas del encabezado para el identificador fiscal.
 *
 * Puro: cero red, cero Supabase.
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_BATCH_MAX_ROWS,
  validateImportBatchInput,
} from '../import-batch-schema';
import { applyManualClassificationOverrides } from '../import-classification-overrides';
import { classifyImportRows } from '../import-classification-service';
import type { ImportRow } from '../import-candidates-parser';
import {
  decodeImportTextFile,
  parseCsvCandidates,
  parsePastedCandidates,
  splitDelimitedLogicalLines,
} from '../import-candidates-parser';
import {
  memoizeAsync,
  orderByIds,
  runBoundedWithDeadline,
} from '../import-validation-scheduler';

const DEFAULTS = { country: 'Colombia', countryCode: 'CO' };

function body(candidates: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    import_type: 'csv',
    candidates,
    recognized_columns: ['company_name'],
    unrecognized_columns: [],
    total_rows: candidates.length,
    valid_rows: candidates.length,
    invalid_rows: 0,
    warning_rows: 0,
    ...extra,
  };
}

// ── Hallazgo 3: contrato del cuerpo ───────────────────────────────────────────

describe('validateImportBatchInput — el mismo contrato en cliente y servidor', () => {
  it('acepta un cuerpo normal y normaliza el país a mayúsculas', () => {
    const result = validateImportBatchInput(body([{ company_name: '  Acme SAS ', country_code: 'co' }]));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.candidates[0].company_name, 'Acme SAS');
      assert.equal(result.data.candidates[0].country_code, 'CO');
    }
  });

  it('rechaza más de 500 filas', () => {
    const rows = Array.from({ length: IMPORT_BATCH_MAX_ROWS + 1 }, (_, i) => ({ company_name: `Empresa ${i}` }));
    const result = validateImportBatchInput(body(rows));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /500/);
  });

  it('rechaza una fila sin nombre y dice cuál', () => {
    const result = validateImportBatchInput(body([{ company_name: 'Uno' }, { company_name: '   ' }]));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /^Fila 2 · company_name/);
  });

  it('rechaza un país fuera de la lista soportada', () => {
    const result = validateImportBatchInput(body([{ company_name: 'Uno', country_code: 'XX' }]));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /País no soportado/);
  });

  it('rechaza textos más largos que el máximo', () => {
    const result = validateImportBatchInput(body([{ company_name: 'x'.repeat(301) }]));
    assert.equal(result.ok, false);
  });

  it('acepta números de celdas XLSX (NIT, tamaño) como texto', () => {
    const result = validateImportBatchInput(body([{ company_name: 'Uno', tax_identifier: 900123456, company_size: 500 }]));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.candidates[0].tax_identifier, '900123456');
  });

  it('un cuerpo que no es objeto es inválido, sin lanzar', () => {
    assert.equal(validateImportBatchInput(null).ok, false);
    assert.equal(validateImportBatchInput('hola').ok, false);
  });
});

// ── Hallazgo 1: correcciones manuales ─────────────────────────────────────────

const CATALOG = {
  version: 'v2.0.0',
  industries: [
    { id: 'ind-tec', name: 'Tecnología', slug: 'tecnologia', active: true },
    { id: 'ind-sal', name: 'Salud', slug: 'salud', active: true },
  ],
  subindustries: [{ id: 'sub-soft', industryId: 'ind-tec', name: 'Software', slug: 'software', applicableCountries: null, active: true }],
  aliases: [],
};

function row(index: number, industry: string | null): ImportRow {
  return {
    index,
    raw: { company_name: `Empresa ${index}`, country_code: 'CO', industry: industry ?? undefined },
    status: 'valid',
    errors: [],
    warnings: [],
    resolved_country_code: 'CO',
    country_from_default: false,
    industry_from_default: false,
    industryOriginalValue: industry,
    subindustryOriginalValue: null,
  };
}

describe('applyManualClassificationOverrides — la corrección de la revisión llega al lote', () => {
  const classified = classifyImportRows({
    rows: [row(0, 'Industria inventada XYZ'), row(1, 'Tecnología')],
    catalog: CATALOG,
    catalogVersionId: 'ver-1',
  });

  it('sin corrección, la industria cruda bloquea (el defecto que se veía como 422)', () => {
    assert.equal(classified.valid, false);
    assert.equal(classified.rows[0].validationStatus, 'requires_review');
  });

  it('con el id del catálogo elegido, la fila queda persistible y el lote deja de bloquearse', () => {
    const outcome = applyManualClassificationOverrides(
      classified,
      CATALOG,
      new Map([[1, { industryId: 'ind-sal', subindustryId: null }]]),
    );
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.result.valid, true);
    assert.equal(outcome.result.blockingIssues.length, 0);
    const [first] = outcome.result.rows;
    assert.equal(first.canPersistAutomatically, true);
    assert.equal(first.classification.industryId, 'ind-sal');
    assert.equal(first.classification.industryName, 'Salud');
    assert.equal(first.classification.industryMatchSource, 'manual');
    assert.equal(outcome.result.summary.reviewRows, 0);
    // La entrada no se muta.
    assert.equal(classified.rows[0].classification.industryId, null);
  });

  it('un id que no existe en el catálogo es un error explícito, no se ignora', () => {
    const outcome = applyManualClassificationOverrides(
      classified,
      CATALOG,
      new Map([[1, { industryId: 'ind-falsa', subindustryId: null }]]),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.errors[0].code, 'industry_not_found');
  });

  it('una subindustria de otra industria se rechaza', () => {
    const outcome = applyManualClassificationOverrides(
      classified,
      CATALOG,
      new Map([[1, { industryId: 'ind-sal', subindustryId: 'sub-soft' }]]),
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.errors[0].code, 'subindustry_wrong_industry');
  });
});

// ── Hallazgo 2: concurrencia acotada y plazo ─────────────────────────────────

describe('runBoundedWithDeadline — validación repartida sin pasarse del plazo', () => {
  it('nunca corre más de N a la vez y conserva el resultado por índice', async () => {
    let active = 0;
    let maxActive = 0;
    const outcome = await runBoundedWithDeadline(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return n * 10;
      },
      { concurrency: 3 },
    );
    assert.equal(maxActive, 3);
    assert.equal(outcome.results.size, 10);
    assert.equal(outcome.results.get(4), 50);
    assert.deepEqual(outcome.skippedIndexes, []);
  });

  it('pasado el plazo no empieza filas nuevas: las devuelve para revalidar', async () => {
    let clock = 0;
    const outcome = await runBoundedWithDeadline(
      ['a', 'b', 'c', 'd', 'e'],
      async (item) => {
        clock += 10; // cada fila «tarda» 10 ms de reloj simulado
        return item;
      },
      { concurrency: 1, deadlineAtMs: 25, now: () => clock },
    );
    assert.deepEqual([...outcome.results.keys()], [0, 1, 2]);
    assert.deepEqual(outcome.skippedIndexes, [3, 4]);
  });

  it('orderByIds respeta el orden del archivo y deja al final lo desconocido', () => {
    const rows = [{ id: 'c' }, { id: 'x' }, { id: 'a' }, { id: 'b' }];
    assert.deepEqual(orderByIds(rows, ['a', 'b', 'c']).map((r) => r.id), ['a', 'b', 'c', 'x']);
    assert.deepEqual(orderByIds(rows, null).map((r) => r.id), ['c', 'x', 'a', 'b']);
  });

  it('memoizeAsync consulta una sola vez por petición y no memoriza un fallo', async () => {
    let calls = 0;
    const ok = memoizeAsync(async () => {
      calls++;
      return true;
    });
    await Promise.all([ok(), ok(), ok()]);
    assert.equal(calls, 1);

    let failures = 0;
    const flaky = memoizeAsync(async () => {
      failures++;
      if (failures === 1) throw new Error('caída');
      return 'ok';
    });
    await assert.rejects(flaky());
    assert.equal(await flaky(), 'ok');
  });
});

// ── Hallazgo 4: CSV RFC 4180 y codificación ───────────────────────────────────

describe('CSV — comillas y saltos de línea dentro de un campo', () => {
  it('una descripción de varias líneas entre comillas no parte la fila', () => {
    const csv = 'Empresa,País,Descripción\n"Acme SAS","Chile","Línea uno\nLínea dos, con coma"\nBeta SAS,Chile,Otra';
    const result = parseCsvCandidates(csv, DEFAULTS);
    assert.deepEqual(result.rows.map((r) => r.raw.company_name), ['Acme SAS', 'Beta SAS']);
    assert.equal(result.rows[0].raw.description, 'Línea uno\nLínea dos, con coma');
  });

  it('las comillas dobles escapadas se conservan', () => {
    const csv = 'Empresa,País\n"Almacenes ""La 14"" SA",Colombia\nBeta,Colombia';
    const result = parseCsvCandidates(csv, DEFAULTS);
    assert.equal(result.rows[0].raw.company_name, 'Almacenes "La 14" SA');
  });

  it('una comilla suelta a mitad del nombre es texto: no se traga las filas siguientes', () => {
    const csv = 'Empresa,País\nAlmacenes "La 14 SA,Colombia\nBeta,Colombia\nGamma,Colombia';
    const result = parseCsvCandidates(csv, DEFAULTS);
    assert.deepEqual(result.rows.map((r) => r.raw.company_name), ['Almacenes "La 14 SA', 'Beta', 'Gamma']);
  });

  it('una comilla de apertura sin cerrar vuelve a las líneas físicas', () => {
    const lines = splitDelimitedLogicalLines('a,b\n"abierta,c\nd,e', ',');
    assert.deepEqual(lines, ['a,b', '"abierta,c', 'd,e']);
  });

  it('CRLF de Windows se trata como un salto', () => {
    assert.deepEqual(splitDelimitedLogicalLines('a,"x\r\ny"\r\nb,c', ','), ['a,"x\r\ny"', 'b,c']);
  });
});

describe('decodeImportTextFile — UTF-8 o Windows-1252', () => {
  it('UTF-8 válido se lee como UTF-8 (y sin BOM)', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Compañía,Perú')]);
    assert.equal(decodeImportTextFile(bytes), 'Compañía,Perú');
  });

  it('un CSV de Excel en Windows-1252 conserva tildes y eñes', () => {
    // «Compañía,Perú» en Windows-1252: ñ=0xF1, í=0xED, ú=0xFA.
    const bytes = new Uint8Array([0x43, 0x6f, 0x6d, 0x70, 0x61, 0xf1, 0xed, 0x61, 0x2c, 0x50, 0x65, 0x72, 0xfa]);
    assert.equal(decodeImportTextFile(bytes), 'Compañía,Perú');
  });

  it('UTF-16LE con BOM (Excel «texto Unicode»)', () => {
    const text = 'Empresa\tPaís';
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16[0] = 0xff;
    utf16[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      utf16[2 + i * 2] = text.charCodeAt(i) & 0xff;
      utf16[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    assert.equal(decodeImportTextFile(utf16.buffer), text);
  });
});

// ── Hallazgo H: el encabezado como pista del identificador fiscal ────────────

describe('formato libre — teléfono vs. NIT', () => {
  it('«Cliente|Teléfono|NIT|País»: el teléfono no es NIT y el NIT real se conserva', () => {
    const text = [
      'Cliente\tTeléfono\tNIT\tPaís',
      'Acme SAS\t3001234567\t900123456-8\tColombia',
      'Beta SAS\t3109876543\t800197268-4\tColombia',
    ].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'columns_by_content');
    const guesses = Object.fromEntries(result.column_guesses.map((g) => [g.column, g.field]));
    assert.equal(guesses['Teléfono'], null);
    assert.equal(guesses['NIT'], 'tax_identifier');
    assert.equal(result.rows[0].raw.tax_identifier, '900123456-8');
  });

  it('un número adivinado por su forma que no es NIT válido para el país no se guarda como NIT', () => {
    // Sin encabezado: la columna de 10 dígitos parece identificador fiscal.
    const text = ['Acme SAS\t3001234567', 'Beta SAS\t3109876543', 'Gamma SAS\t3157654321'].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.rows.length, 3);
    for (const r of result.rows) {
      assert.equal(r.raw.tax_identifier, undefined);
      assert.match(r.raw.notes ?? '', /Número descartado como identificador fiscal \(no válido para CO\)/);
    }
  });
});
