/**
 * SOURCES-CL-SII-FREE-DISCOVERY-1 — filas de `cl_sii_directory` y catálogo de
 * actividades del SII. Puro: cero E/S. Nombres sintéticos; RUT con dígito
 * verificador real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { calculateChileCheckDigit } from '@/modules/prospect-batches/tax-identifier-rules';
import {
  CL_SII_ACTIVITY_DESCRIPTIONS,
  clSiiActivityTextMatchesCode,
  describeClSiiActivity,
} from '../cl-sii-activity-catalog';
import {
  admitClSiiDirectoryCompany,
  buildClSiiDirectoryRow,
  CL_SII_DIRECTORY_MIN_WORKERS,
  CL_SII_DIRECTORY_SOURCE_KEY,
  type ClSiiRegistryReadRow,
} from '../cl-sii-directory-rows';
import { CL_SII_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/cl-sii-macro-table';
import { workforceFromRawData } from '@/server/prospect-batches/snapshot-name-query';

const TECH_CODE = '620200';
const TECH_TEXT = 'ACTIVIDADES DE CONSULTORIA DE INFORMATICA Y DE GESTION DE INSTALACIONES INFORMATICAS';

function rut(n: number): string {
  const body = String(76_000_000 + n);
  return `${body}-${calculateChileCheckDigit(body)}`;
}

function registryRow(overrides: Partial<ClSiiRegistryReadRow> = {}, raw: Record<string, unknown> = {}): ClSiiRegistryReadRow {
  return {
    tax_id: rut(1),
    legal_name: 'EMPRESA SINTETICA SPA',
    normalized_legal_name: 'EMPRESA SINTETICA',
    raw_data: {
      subtype: '213',
      workers: 450,
      activity: TECH_TEXT,
      metrics_year: 2024,
      activity_code: TECH_CODE,
      sales_bracket: '13',
      ...raw,
    },
    ...overrides,
  };
}

describe('catálogo de actividades del SII', () => {
  it('trae los 659 códigos de 6 dígitos leídos de cl_sii_registry', () => {
    assert.equal(CL_SII_ACTIVITY_DESCRIPTIONS.size, 659);
    for (const [code, description] of CL_SII_ACTIVITY_DESCRIPTIONS) {
      assert.match(code, /^\d{6}$/, code);
      assert.ok(description.length > 0, code);
      assert.equal(description, description.trim().toUpperCase(), code);
    }
  });

  it('describe códigos conocidos, incluido el cobre propio de Chile', () => {
    assert.equal(describeClSiiActivity('040000'), 'EXTRACCION Y PROCESAMIENTO DE COBRE');
    assert.equal(describeClSiiActivity('641910'), 'ACTIVIDADES BANCARIAS');
    assert.equal(describeClSiiActivity(' 620200 '), TECH_TEXT);
    assert.equal(describeClSiiActivity('999999'), null);
    assert.equal(describeClSiiActivity(null), null);
  });

  it('código y texto coinciden sólo si dicen lo mismo (sin importar espacios ni mayúsculas)', () => {
    assert.equal(clSiiActivityTextMatchesCode(TECH_CODE, TECH_TEXT), true);
    assert.equal(clSiiActivityTextMatchesCode(TECH_CODE, `  ${TECH_TEXT.toLowerCase()}  `), true);
    // Caso real del 05-10: código de telecomunicaciones con texto de paisajismo.
    assert.equal(
      clSiiActivityTextMatchesCode('611090', 'ACTIVIDADES DE PAISAJISMO, SERVICIOS DE JARDINERIA Y SERVICIOS CONEXOS'),
      false,
    );
    assert.equal(clSiiActivityTextMatchesCode(TECH_CODE, null), false);
    assert.equal(clSiiActivityTextMatchesCode('999999', TECH_TEXT), false);
  });
});

describe('admitClSiiDirectoryCompany', () => {
  it('admite una empresa con RUT válido, 100+ trabajadores y actividad coherente', () => {
    const result = admitClSiiDirectoryCompany(registryRow());
    assert.ok(result.ok);
    assert.deepEqual(result.company, {
      rut: rut(1),
      legalName: 'EMPRESA SINTETICA SPA',
      normalizedLegalName: 'EMPRESA SINTETICA',
      activityCode: TECH_CODE,
      activity: TECH_TEXT,
      workers: 450,
      metricsYear: 2024,
      salesBracket: '13',
      subtype: '213',
    });
  });

  it('el umbral es 100 trabajadores (decisión de la dueña, 05-10-2026)', () => {
    assert.equal(CL_SII_DIRECTORY_MIN_WORKERS, 100);
    assert.ok(admitClSiiDirectoryCompany(registryRow({}, { workers: 100 })).ok);
    assert.deepEqual(admitClSiiDirectoryCompany(registryRow({}, { workers: 99 })), {
      ok: false,
      reason: 'below_min_workers',
    });
    assert.deepEqual(admitClSiiDirectoryCompany(registryRow({}, { workers: undefined })), {
      ok: false,
      reason: 'below_min_workers',
    });
  });

  it('rechaza por cada motivo, con su nombre', () => {
    const badDv = `${rut(1).slice(0, -1)}${rut(1).endsWith('0') ? '1' : '0'}`;
    const cases: Array<[ClSiiRegistryReadRow, string]> = [
      [registryRow({ tax_id: badDv }), 'invalid_rut'],
      [registryRow({ tax_id: null }), 'invalid_rut'],
      [registryRow({ legal_name: '   ' }), 'no_name'],
      [registryRow({}, { activity_code: undefined }), 'no_activity_code'],
      [registryRow({}, { activity_code: '62020' }), 'no_activity_code'],
      [registryRow({}, { activity: 'ACTIVIDADES DE HOTELES' }), 'activity_text_mismatch'],
      [registryRow({}, { activity: undefined }), 'activity_text_mismatch'],
      [registryRow({ raw_data: null }), 'below_min_workers'],
    ];
    for (const [input, reason] of cases) {
      assert.deepEqual(admitClSiiDirectoryCompany(input), { ok: false, reason }, reason);
    }
  });

  it('acepta RUT con puntos y K minúscula; sin núcleo guardado lo calcula', () => {
    const body = '77261280';
    const result = admitClSiiDirectoryCompany(
      registryRow({ tax_id: '77.261.280-k', normalized_legal_name: null, legal_name: 'FALABELLA RETAIL S.A.' }),
    );
    assert.ok(result.ok);
    assert.equal(result.company.rut, `${body}-K`);
    assert.equal(result.company.normalizedLegalName, 'FALABELLA RETAIL');
  });
});

describe('buildClSiiDirectoryRow', () => {
  it('guarda RUT, actividad, macro de la tabla, trabajadores y percentil; nada de personas', () => {
    const admitted = admitClSiiDirectoryCompany(registryRow());
    assert.ok(admitted.ok);
    const row = buildClSiiDirectoryRow({
      company: admitted.company,
      priorityScore: 87.654,
      importedAt: '2026-10-05T12:00:00.000Z',
    });

    assert.equal(row.source_key, CL_SII_DIRECTORY_SOURCE_KEY);
    assert.equal(row.country_code, 'CL');
    assert.equal(row.source_year, 2024);
    assert.equal(row.tax_id, rut(1));
    assert.equal(row.normalized_tax_id, rut(1));
    assert.equal(row.sector, TECH_CODE);
    assert.equal(row.priority_score, 87.65);
    assert.equal(row.record_identity_key, `tax:${rut(1)}`);
    assert.equal(row.raw_data.macro_industry_key, 'technology');
    assert.equal(row.raw_data.macro_table_version, CL_SII_MACRO_TABLE_VERSION);
    assert.equal(row.raw_data.tax_identifier_type, 'RUT');
    assert.equal(row.raw_data.activity, TECH_TEXT);
    assert.equal(row.raw_data.human_review_required, true);
    assert.deepEqual(
      Object.keys(row.raw_data).filter((key) => /phone|email|address|representative|contact/i.test(key)),
      [],
    );
    // El mismo formato que cl_sii_registry: el tamaño se lee igual.
    assert.deepEqual(workforceFromRawData(row.raw_data, 'cl_sii_directory'), {
      workers: 450,
      year: 2024,
      source: 'cl_sii_directory',
      salesBracket: '13',
    });
  });

  it('una actividad sin industria se guarda con macro null; un holding revisado, con la suya', () => {
    const hotel = admitClSiiDirectoryCompany(
      registryRow({}, { activity_code: '551001', activity: 'ACTIVIDADES DE HOTELES' }),
    );
    assert.ok(hotel.ok);
    assert.equal(buildClSiiDirectoryRow({ company: hotel.company, priorityScore: 1, importedAt: '2026-10-05T00:00:00Z' }).raw_data.macro_industry_key, null);

    const holding = admitClSiiDirectoryCompany(
      registryRow(
        { tax_id: '77261280-K' },
        { activity_code: '643000', activity: 'FONDOS Y SOCIEDADES DE INVERSION Y ENTIDADES FINANCIERAS SIMILARES' },
      ),
    );
    assert.ok(holding.ok);
    assert.equal(
      buildClSiiDirectoryRow({ company: holding.company, priorityScore: 1, importedAt: '2026-10-05T00:00:00Z' }).raw_data.macro_industry_key,
      'retail',
    );
  });

  it('el percentil queda entre 0 y 100; sin año de métricas usa el de la importación', () => {
    const admitted = admitClSiiDirectoryCompany(registryRow({}, { metrics_year: undefined }));
    assert.ok(admitted.ok);
    const high = buildClSiiDirectoryRow({ company: admitted.company, priorityScore: 140, importedAt: '2026-10-05T00:00:00Z' });
    const low = buildClSiiDirectoryRow({ company: admitted.company, priorityScore: -3, importedAt: '2026-10-05T00:00:00Z' });
    assert.equal(high.priority_score, 100);
    assert.equal(low.priority_score, 0);
    assert.equal(high.source_year, 2026);
  });
});

describe('cargador (guardas estáticas)', () => {
  const code = readFileSync(join(process.cwd(), 'scripts/source-catalog/run-cl-sii-directory-etl.ts'), 'utf8');

  it('es dry-run por defecto y sólo escribe cl_sii_directory tras la valla de importaciones grandes', () => {
    assert.match(code, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(code, /if \(!apply\) \{[\s\S]*?return;/);
    assert.match(code, /assertLargeImportAllowed\(\{\s*sourceKey: CL_SII_DIRECTORY_SOURCE_KEY/);
    assert.equal((code.match(/\.upsert\(/g) ?? []).length, 1);
    assert.doesNotMatch(code, /\.(insert|update|delete|rpc)\(/);
  });

  it('sólo lee cl_sii_registry y no llama a ningún proveedor', () => {
    assert.match(code, /\.eq\('source_key', CL_SII_REGISTRY_SOURCE_KEY\)/);
    assert.doesNotMatch(code, /\bfetch\s*\(|apollo|lusha|tavily|hubspot/i);
  });
});
