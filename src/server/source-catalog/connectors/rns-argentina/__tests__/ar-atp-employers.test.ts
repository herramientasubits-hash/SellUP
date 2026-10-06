/**
 * SOURCES-AR-E2E-1 — empleadores ATP 2020 (Argentina): lectura de filas del CSV
 * y armado de la fila de `ar_atp_employers`. Puro, sin E/S. CUIT con dígito
 * verificador válido; nombres sintéticos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AR_ATP_EMPLOYERS_SOURCE_KEY,
  AR_ATP_MIN_WORKERS,
  buildArAtpEmployerRow,
  pickAtpEmployer,
  type ArAtpEmployer,
} from '../ar-atp-employers';
import { AR_RNS_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/ar-rns-macro-table';
import { SOURCE_FAMILY_BY_SOURCE_KEY } from '@/server/source-catalog/record-identity/source-family-registry';

// 30-63945373-8: CUIT de persona jurídica con dígito verificador válido.
const CUIT = '30639453738';

function atpRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    cuit: CUIT,
    razon_social: 'EMPRESA SINTETICA SA',
    cantidad_perceptores: '250',
    sector: 'Salud',
    provincia: 'CORDOBA',
    ronda_atp: '1',
    salario_devengado_mes: 'abril',
    ...overrides,
  };
}

const employer: ArAtpEmployer = { cuit: CUIT, workers: 250, province: 'CORDOBA', atpSector: 'Salud' };

describe('pickAtpEmployer', () => {
  it('se queda con el MÁXIMO de trabajadores entre meses y rondas', () => {
    const first = pickAtpEmployer(null, atpRow({ cantidad_perceptores: '120' }));
    const more = pickAtpEmployer(first, atpRow({ cantidad_perceptores: '300', provincia: 'MENDOZA' }));
    const less = pickAtpEmployer(more, atpRow({ cantidad_perceptores: '90' }));
    assert.equal(first?.workers, 120);
    assert.deepEqual(more, { cuit: CUIT, workers: 300, province: 'MENDOZA', atpSector: 'Salud' });
    assert.equal(less, more, 'una fila menor no cambia nada');
  });

  it('ignora personas humanas, CUIT inválidas y cantidades no numéricas', () => {
    assert.equal(pickAtpEmployer(null, atpRow({ cuit: '20333449588' })), null);
    assert.equal(pickAtpEmployer(null, atpRow({ cuit: '30639453739' })), null);
    assert.equal(pickAtpEmployer(null, atpRow({ cantidad_perceptores: 'x' })), null);
    assert.equal(pickAtpEmployer(null, atpRow({ cantidad_perceptores: '0' })), null);
  });

  it('nunca mezcla dos CUIT', () => {
    const previous = pickAtpEmployer(null, atpRow());
    assert.equal(pickAtpEmployer(previous, atpRow({ cuit: '30500041681', cantidad_perceptores: '999' })), previous);
  });
});

describe('buildArAtpEmployerRow', () => {
  const registry = { cuit: CUIT, legalName: 'Clínica Sintética S.A.', activityCode: '861010' };

  it('arma la fila con macro de la tabla vigente, piso de trabajadores y región ATP', () => {
    const row = buildArAtpEmployerRow({ employer, registry, priorityScore: 87.456, importedAt: 'T' });
    assert.ok(row);
    assert.equal(row.source_key, AR_ATP_EMPLOYERS_SOURCE_KEY);
    assert.equal(row.normalized_tax_id, CUIT);
    assert.equal(row.legal_name, 'Clínica Sintética S.A.');
    assert.equal(row.normalized_legal_name, 'CLINICA SINTETICA S.A.');
    assert.equal(row.region, 'CORDOBA');
    assert.equal(row.priority_score, 87.46);
    assert.equal(row.signals['atp_workers_floor'], 250);
    assert.equal(row.raw_data['macro_industry_key'], 'health_pharma');
    assert.equal(row.raw_data['macro_table_version'], AR_RNS_MACRO_TABLE_VERSION);
    assert.equal(row.raw_data['actividad_codigo'], '861010');
    assert.ok(row.record_identity_key);
  });

  it('no carga: menos del mínimo, sin actividad, actividad sin macro o CUIT cruzada', () => {
    const base = { registry, priorityScore: 50, importedAt: 'T' };
    assert.equal(buildArAtpEmployerRow({ ...base, employer: { ...employer, workers: AR_ATP_MIN_WORKERS - 1 } }), null);
    assert.equal(buildArAtpEmployerRow({ ...base, employer, registry: { ...registry, activityCode: null } }), null);
    // 561011 = restaurantes: división 56 sin macro aprobada.
    assert.equal(buildArAtpEmployerRow({ ...base, employer, registry: { ...registry, activityCode: '561011' } }), null);
    assert.equal(buildArAtpEmployerRow({ ...base, employer, registry: { ...registry, cuit: '30500041681' } }), null);
  });

  it('el mínimo es configurable', () => {
    const small = { ...employer, workers: 60 };
    assert.ok(buildArAtpEmployerRow({ employer: small, registry, priorityScore: 1, importedAt: 'T', minWorkers: 50 }));
  });

  it('ARCA guarda el código como número: se rellena a 6 dígitos', () => {
    const row = buildArAtpEmployerRow({
      employer,
      registry: { ...registry, activityCode: '11111' },
      priorityScore: 1,
      importedAt: 'T',
    });
    assert.equal(row?.raw_data['actividad_codigo'], '011111');
    assert.equal(row?.raw_data['macro_industry_key'], 'agroindustry');
  });
});

describe('guardas', () => {
  it('la fuente es de grano fiscal (un CUIT, una fila)', () => {
    assert.equal(SOURCE_FAMILY_BY_SOURCE_KEY[AR_ATP_EMPLOYERS_SOURCE_KEY], 'TAX_GRAIN');
  });

  it('el módulo es puro: sin env, red ni base de datos', () => {
    const code = readFileSync(join(process.cwd(), 'src/server/source-catalog/connectors/rns-argentina/ar-atp-employers.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /process\.env|fetch\(|createClient|supabase-js/);
  });
});
