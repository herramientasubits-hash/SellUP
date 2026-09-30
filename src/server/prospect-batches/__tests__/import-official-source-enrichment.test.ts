/**
 * Tests — AGENT1-IMPORT-PARITY-8: la importación consulta primero los
 * catálogos oficiales gratuitos, con la costura compartida de Apollo/Lusha.
 *
 * Catálogo falso inyectado: cero base de datos, cero red, cero IA.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichImportRowsWithOfficialSources,
  type ImportOfficialSourceRow,
} from '../import-official-source-enrichment';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';

function row(overrides: Partial<ImportOfficialSourceRow> & { rowNumber: number }): ImportOfficialSourceRow {
  return { name: 'Empresa SAS', website: null, domain: null, countryCode: 'CO', taxIdentifier: null, ...overrides };
}

function fakeResolver(
  countryCode: string,
  confidence: number,
  calls: string[] = [],
  opts: { throws?: boolean } = {},
): OfficialSourceResolver {
  return {
    countryCode,
    sourceKey: `fake_${countryCode.toLowerCase()}`,
    canResolve: () => true,
    resolve: (input) => {
      calls.push(input.candidate.canonicalName ?? '');
      if (opts.throws) throw new Error('catálogo caído');
      return {
        status: 'matched',
        countryCode,
        sourceKey: `fake_${countryCode.toLowerCase()}`,
        confidence,
        matchMethod: 'exact_name',
        taxIdentifier: '900123456-8',
        taxIdentifierType: 'NIT',
        legalName: 'EMPRESA S.A.S.',
        legalStatus: 'ACTIVA',
        warnings: [],
        issues: [],
      };
    },
  };
}

describe('enrichImportRowsWithOfficialSources', () => {
  it('fila sin NIT de un país con catálogo → identidad fuerte con NIT, razón social y estado', async () => {
    const out = await enrichImportRowsWithOfficialSources([row({ rowNumber: 1 })], [fakeResolver('CO', 0.95)]);
    const r = out.get(1);
    assert.ok(r);
    assert.equal(r.strongIdentityAvailable, true);
    assert.equal(r.typedColumns.tax_identifier, '900123456-8');
    assert.equal(r.typedColumns.legal_name, 'EMPRESA S.A.S.');
    assert.equal(r.metadata.taxIdentifierPresent, true);
  });

  it('coincidencia de baja confianza → NO llena columnas, queda como señal', async () => {
    const out = await enrichImportRowsWithOfficialSources([row({ rowNumber: 1 })], [fakeResolver('CO', 0.5)]);
    const r = out.get(1);
    assert.ok(r);
    assert.equal(r.strongIdentityAvailable, false);
    assert.equal(r.typedColumns.tax_identifier, null);
  });

  it('fila que YA trae NIT no se busca (no se gasta consulta)', async () => {
    const calls: string[] = [];
    const out = await enrichImportRowsWithOfficialSources(
      [row({ rowNumber: 1, taxIdentifier: '800111222-3' })],
      [fakeResolver('CO', 0.95, calls)],
    );
    assert.equal(out.size, 0);
    assert.equal(calls.length, 0);
  });

  it('país sin catálogo conectado (p. ej. México) no se busca', async () => {
    const calls: string[] = [];
    const out = await enrichImportRowsWithOfficialSources(
      [row({ rowNumber: 1, countryCode: 'MX' })],
      [fakeResolver('CO', 0.95, calls)],
    );
    assert.equal(out.size, 0);
    assert.equal(calls.length, 0);
  });

  it('República Dominicana usa su propio catálogo', async () => {
    const calls: string[] = [];
    const out = await enrichImportRowsWithOfficialSources(
      [row({ rowNumber: 1, countryCode: 'DO', name: 'Banco Popular Dominicano' })],
      [fakeResolver('CO', 0.95), fakeResolver('DO', 0.95, calls)],
    );
    assert.equal(out.get(1)?.strongIdentityAvailable, true);
    assert.equal(calls.length, 1);
  });

  it('catálogo caído → la importación sigue (sin identidad, sin lanzar)', async () => {
    const out = await enrichImportRowsWithOfficialSources(
      [row({ rowNumber: 1 })],
      [fakeResolver('CO', 0.95, [], { throws: true })],
    );
    assert.equal(out.get(1)?.strongIdentityAvailable ?? false, false);
  });

  it('sin catálogos disponibles → mapa vacío', async () => {
    const out = await enrichImportRowsWithOfficialSources([row({ rowNumber: 1 })], []);
    assert.equal(out.size, 0);
  });

  it('respeta la concurrencia: procesa todas las filas en tandas', async () => {
    const calls: string[] = [];
    const rows = Array.from({ length: 20 }, (_, i) => row({ rowNumber: i + 1, name: `Empresa ${i + 1} SAS` }));
    const out = await enrichImportRowsWithOfficialSources(rows, [fakeResolver('CO', 0.95, calls)], 3);
    assert.equal(out.size, 20);
    assert.equal(calls.length, 20);
  });
});
