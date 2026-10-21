/**
 * Tests — AGENT1-SUPPLIER-AUDIT-NOW-1 (auditoría de «Proveedores de una empresa», 21-10):
 *  1. Un error al leer entidades públicas se lanza (antes: lista vacía ⇒ «no es entidad
 *     pública» y la corrida pasaba a Claude como si fuera una empresa privada).
 *  2. Guardar las sin web en Descartadas que falla queda marcado en el paso.
 *  3. Los competidores de UBITS no se ofrecen tampoco por compras públicas.
 *  4. El número fiscal con letras (NIF de España) conserva las letras al cruzar.
 *  5. El progreso del chat tiene la etapa de compras públicas.
 * Doble de Supabase sin red, sin Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isUbitsCompetitorName } from '@/server/agents/prospecting-toolkit/claude-classifier/ubits-competitors';
import {
  RUN_PROGRESS_LABELS,
  RUN_PROGRESS_STAGES,
  withRunProgress,
} from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import {
  runPublicBuyerSupplierStep,
  taxIdKey,
  type PublicBuyerStepDeps,
  type PublicBuyerSupplier,
} from '../public-buyer-suppliers';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import { buildCoLookups } from '../countries/co.server';
import { buildLoadedLinksLookups } from '../countries/loaded-lookups.server';
import type { LoadedCountrySource } from '../countries/types';

/** Cliente que falla en cualquier consulta (caída de la base). */
function failingClient(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'gt', 'like', 'in', 'or', 'order', 'limit', 'range']) builder[op] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: 'connection reset' } });
  return { from: () => builder } as unknown as SupabaseClient;
}

const LOADED: LoadedCountrySource = {
  kind: 'loaded',
  countryCode: 'PE',
  sourceKey: 'pe_test',
  taxIdentifierType: 'RUC',
  currency: 'PEN',
  minPairAmount: 1,
  normalizeBuyerName: normalizePublicEntityName,
  classifier: UNSPSC_CLASSIFIER,
  domainSourceKeys: [],
  workersSourceKeys: [],
};

function supplier(taxId: string, name: string): PublicBuyerSupplier {
  return {
    taxId,
    name,
    totalAmount: 1_000_000,
    contractCount: 2,
    lastSignedAt: '2026-09-01',
    macroIndustryKey: 'technology',
    macroShare: 1,
    rubro: 'Servicios informáticos',
    evidenceUrl: 'https://example.gov/p1',
  };
}

function stepDeps(
  suppliers: PublicBuyerSupplier[],
  overrides: Partial<PublicBuyerStepDeps> = {},
): PublicBuyerStepDeps & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    sourceKey: 'co_secop2_buyer_suppliers',
    findPublicEntities: async () => [
      { taxId: '899999001', normalizedLegalName: 'MINISTERIO DE EDUCACION NACIONAL', shortName: null, isHead: true },
    ],
    listSuppliers: async () => ({ ok: true, suppliers, read: suppliers.length, outsideIndustry: 0, tableVersion: 't1' }),
    listPublicOnlyTaxIds: async () => new Set<string>(),
    findDomainsByTaxId: async () => new Map<string, string>(),
    writeWithWebsite: async (companies) => {
      written.push(...companies.map((c) => c.legalName ?? ''));
      return { written: companies.length, failed: false };
    },
    recordWithoutWebsite: async (companies) => companies.length,
    ...overrides,
  };
}

const INPUT = {
  batchId: 'b1',
  referenceCompanyName: 'Ministerio de Educación Nacional',
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  nowIso: '2026-10-21T00:00:00.000Z',
};

describe('1. un error al buscar la entidad no la convierte en «empresa privada»', () => {
  it('países cargados: la caída se lanza', async () => {
    const lookups = buildLoadedLinksLookups(LOADED, failingClient());
    await assert.rejects(() => lookups.findPublicEntities('MINISTERIO DE SALUD'), /public_entity_lookup_failed:PE/);
  });

  it('Colombia: la caída se lanza', async () => {
    const lookups = buildCoLookups(failingClient());
    await assert.rejects(() => lookups.findPublicEntities('ALCALDIA DE MEDELLIN'), /public_entity_lookup_failed:CO/);
  });
});

describe('2. guardar las sin web que falla queda marcado', () => {
  it('recordWithoutWebsiteFailed = true y 0 guardadas', async () => {
    const deps = stepDeps([supplier('900111222', 'SOFTWARE ANDINO SAS')], {
      recordWithoutWebsite: async () => {
        throw new Error('insert failed');
      },
    });
    const outcome = await runPublicBuyerSupplierStep(INPUT, deps);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.recordedWithoutWebsite, 0);
    assert.equal(outcome.recordWithoutWebsiteFailed, true);
  });

  it('sin fallo, el campo no aparece', async () => {
    const outcome = await runPublicBuyerSupplierStep(INPUT, stepDeps([supplier('900111222', 'SOFTWARE ANDINO SAS')]));
    assert.equal(outcome.executed && 'recordWithoutWebsiteFailed' in outcome, false);
  });
});

describe('3. competidores de UBITS fuera también en compras públicas', () => {
  it('por nombre (sin web) y por sitio (con web)', async () => {
    const deps = stepDeps(
      [
        supplier('900000001', 'COURSERA INC'),
        supplier('900000002', 'Formación Digital SAS'),
        supplier('900000003', 'SOFTWARE ANDINO SAS'),
      ],
      {
        findDomainsByTaxId: async () =>
          new Map([
            ['900000002', 'crehana.com'],
            ['900000003', 'softwareandino.co'],
          ]),
      },
    );
    const outcome = await runPublicBuyerSupplierStep(INPUT, deps);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.ubitsCompetitorsExcluded, 2);
    assert.equal(outcome.offered, 1);
    assert.deepEqual(deps.written, ['SOFTWARE ANDINO SAS']);
    assert.deepEqual(outcome.relationships.map((r) => r.taxId), ['900000003']);
  });

  it('el nombre exige una palabra completa: universidades y «academias» siguen siendo clientes', () => {
    assert.equal(isUbitsCompetitorName('UDEMY IRELAND LIMITED'), true);
    assert.equal(isUbitsCompetitorName('Platzi S.A.S.'), true);
    assert.equal(isUbitsCompetitorName('EDXCEL CONSULTORES'), false);
    assert.equal(isUbitsCompetitorName('Academia de Idiomas Andina'), false);
    assert.equal(isUbitsCompetitorName('Universidad Nacional'), false);
    assert.equal(isUbitsCompetitorName(null), false);
  });
});

describe('4. número fiscal con letras', () => {
  it('NIF de España: las letras distinguen empresas', () => {
    assert.equal(taxIdKey('B12345678'), 'B12345678');
    assert.notEqual(taxIdKey('A12345678'), taxIdKey('B12345678'));
    assert.equal(taxIdKey('b-12.345.678'), 'B12345678');
  });

  it('RUT con K, NIT, CNPJ y UEI siguen igual', () => {
    assert.equal(taxIdKey('76.286.049-k'), '76286049K');
    assert.equal(taxIdKey('900092385-1'), '900092385');
    assert.equal(taxIdKey('04.198.254/0001-17'), '04198254000117');
    assert.equal(taxIdKey('DT2KS3HH5FP5'), 'DT2KS3HH5FP5');
  });
});

describe('5. etapa de compras públicas en el progreso del chat', () => {
  it('existe, tiene texto y se anota al llamar a runPublicBuyerSuppliers', async () => {
    assert.ok(RUN_PROGRESS_STAGES.includes('supplier_public'));
    assert.match(RUN_PROGRESS_LABELS.supplier_public, /compras públicas/);
    const seen: string[] = [];
    const wrapped = withRunProgress({ runPublicBuyerSuppliers: async () => 'ok' }, (stage) => seen.push(stage));
    await wrapped.runPublicBuyerSuppliers();
    assert.deepEqual(seen, ['supplier_public', 'reviewing']);
  });
});
