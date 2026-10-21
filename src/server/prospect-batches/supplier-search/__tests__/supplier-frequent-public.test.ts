/**
 * Tests — «Proveedores frecuentes del Estado» (AGENT1-SUPPLIER-FREQUENT-PUBLIC-1,
 * auditoría 21-10, bloque «Próximo»).
 *
 * Sin empresa de referencia: empresas que le venden a 3 o más entidades públicas del país
 * en la industria pedida (compras públicas cargadas). Mismo camino que el paso de una
 * entidad (filtros, 12 como mucho, web, rescate) y Claude nunca corre. Sin red, sin Prod.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createInitialProspectWizardState,
  prospectWizardReducer,
  type ProspectWizardAction,
  type ProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard';
import { wizardExecutionRequestSchema } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-schema';
import { buildFrequentPublicSupplierBatchName } from '@/modules/prospect-batches/chat-wizard-execution/supplier-batch-name';
import {
  executeSupplierSearchRun,
  type SupplierSearchRunDeps,
  type SupplierSearchRunInput,
} from '@/modules/prospect-batches/chat-wizard-execution/wizard-supplier-search';
import type { CatalogResolutionOutput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-catalog-resolver';
import {
  describeFrequentBuyers,
  FREQUENT_PUBLIC_REFERENCE_LABEL,
  runFrequentPublicSupplierStep,
  type FrequentPublicStepDeps,
  type PublicBuyerStepOutcome,
  type PublicBuyerSupplier,
} from '../public-buyer-suppliers';
import { FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES } from '../countries/codes';
import { PUBLIC_BUYER_COUNTRIES } from '../countries';
import { buildLoadedLinksLookups, FREQUENT_SUPPLIER_MAX_ROWS } from '../countries/loaded-lookups.server';
import { UNSPSC_CLASSIFIER } from '../unspsc-classifier';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import type { LoadedCountrySource } from '../countries/types';

function supplier(taxId: string, name: string, buyerCount: number, topBuyerNames: string[]): PublicBuyerSupplier {
  return {
    taxId,
    name,
    totalAmount: 2_500_000_000,
    contractCount: 14,
    lastSignedAt: '2026-09-01',
    macroIndustryKey: 'technology',
    macroShare: 1,
    rubro: 'Servicios informáticos',
    evidenceUrl: 'https://example.gob/p1',
    buyerCount,
    topBuyerNames,
  };
}

function stepDeps(suppliers: PublicBuyerSupplier[] | 'unavailable') {
  const written: string[] = [];
  const deps: FrequentPublicStepDeps = {
    sourceKey: 'mx_comprasmx_contracts',
    taxIdentifierType: 'RFC',
    listFrequentSuppliers: async () =>
      suppliers === 'unavailable'
        ? { ok: false, reason: 'source_unavailable' }
        : { ok: true, suppliers, read: suppliers.length, outsideIndustry: 0, tableVersion: 't1', sinceYear: '2025' },
    listPublicOnlyTaxIds: async () => new Set<string>(),
    findDomainsByTaxId: async (taxIds) => new Map(taxIds.map((t) => [t, `${t.toLowerCase()}.mx`])),
    writeWithWebsite: async (companies) => {
      written.push(...companies.map((c) => c.legalName ?? ''));
      return { written: companies.length, failed: false };
    },
    recordWithoutWebsite: async (companies) => companies.length,
  };
  return { deps, written };
}

const STEP_INPUT = {
  batchId: 'b1',
  countryCode: 'MX',
  countryName: 'México',
  macroIndustryKey: 'technology',
  nowIso: '2026-10-21T00:00:00.000Z',
};

describe('1. el paso: empresas que le venden a varias entidades', () => {
  it('ofrece, escribe y deja «Proveedor de …» con sus entidades y la prueba', async () => {
    const { deps, written } = stepDeps([
      supplier('TEL960101AB1', 'TELEFONIA NACIONAL SA', 7, ['IMSS', 'ISSSTE', 'SICT']),
      supplier('SOF010101CD2', 'SOFTWARE DEL NORTE SA', 3, ['IMSS', 'SAT', 'CFE']),
    ]);
    const outcome = await runFrequentPublicSupplierStep(STEP_INPUT, deps);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.scope, 'frequent_public');
    assert.equal(outcome.buyer.name, FREQUENT_PUBLIC_REFERENCE_LABEL);
    assert.equal(outcome.offered, 2);
    assert.deepEqual(written, ['TELEFONIA NACIONAL SA', 'SOFTWARE DEL NORTE SA']);
    assert.equal(outcome.relationships[0].referenceName, 'IMSS, ISSSTE, SICT y 4 más');
    assert.equal(outcome.relationships[1].referenceName, 'IMSS, SAT y CFE');
    assert.match(outcome.relationships[0].evidence, /^Le vende a 7 entidades públicas de México, entre ellas IMSS, ISSSTE, SICT: 14 contratos/);
  });

  it('sin nadie en la industria ⇒ no corre, con su motivo; la fuente caída pasa su motivo', async () => {
    assert.deepEqual(await runFrequentPublicSupplierStep(STEP_INPUT, stepDeps([]).deps), {
      executed: false,
      reason: 'no_frequent_suppliers',
    });
    assert.deepEqual(await runFrequentPublicSupplierStep(STEP_INPUT, stepDeps('unavailable').deps), {
      executed: false,
      reason: 'source_unavailable',
    });
  });

  it('los competidores de UBITS tampoco entran por aquí', async () => {
    const { deps } = stepDeps([supplier('UDE0101EF3', 'UDEMY IRELAND LIMITED', 9, ['SEP'])]);
    const outcome = await runFrequentPublicSupplierStep(STEP_INPUT, deps);
    assert.equal(outcome.executed && outcome.offered, 0);
    assert.equal(outcome.executed && outcome.ubitsCompetitorsExcluded, 1);
  });

  it('a quién le vende: sin nombres, el conteo con el país', () => {
    assert.equal(describeFrequentBuyers({ ...supplier('X', 'X', 5, []) }, 'Perú'), '5 entidades públicas de Perú');
    assert.equal(describeFrequentBuyers({ ...supplier('X', 'X', 1, ['MINSA']) }, 'Perú'), 'MINSA');
  });
});

describe('2. la lectura de un país cargado', () => {
  const COUNTRY: LoadedCountrySource = {
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

  /** Cliente con la función 154 y nada más (las fichas no se consultan sin claves de fuente). */
  function rpcClient(rows: Array<Record<string, unknown>>, calls: Array<{ fn: string; args: unknown }>): SupabaseClient {
    return {
      rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: rows, error: null }),
      from: () => {
        throw new Error('no debería leer tablas');
      },
    } as unknown as SupabaseClient;
  }

  const row = (taxId: string, buyers: number, family: string) => ({
    supplier_tax_id: taxId,
    supplier_name: `EMPRESA ${taxId} SAC`,
    buyer_count: buyers,
    total_amount: '900000',
    order_count: '6',
    amount_by_family: { [family]: 900000 },
    top_buyer_names: ['ESSALUD', 'MINSA'],
    top_order_url: 'https://example.gob.pe/o1',
    last_order_on: '2026-09-01',
    window_start: '2025-10-01',
  });

  it('pide a la función 154 y deja sólo la industria pedida, con sus entidades', async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const lookups = buildLoadedLinksLookups(
      COUNTRY,
      rpcClient([row('20100000001', 9, '4321'), row('20100000002', 6, '4211'), row('20100000003', 3, '4321')], calls),
    );
    const listed = await lookups.listFrequentSuppliers!({ macroIndustryKey: 'technology', minBuyers: 3 });
    assert.deepEqual(calls, [
      {
        fn: 'list_frequent_public_procurement_suppliers',
        args: { p_country_code: 'PE', p_min_buyers: 3, p_limit: FREQUENT_SUPPLIER_MAX_ROWS },
      },
    ]);
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.suppliers.map((s) => [s.taxId, s.buyerCount]), [
      ['20100000001', 9],
      ['20100000003', 3],
    ]);
    assert.deepEqual(listed.suppliers[0].topBuyerNames, ['ESSALUD', 'MINSA']);
    assert.equal(listed.outsideIndustry, 1);
    assert.equal(listed.sinceYear, '2025');
  });

  it('la función con error ⇒ fuente no disponible (no «nadie»)', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) } as unknown as SupabaseClient;
    const listed = await buildLoadedLinksLookups(COUNTRY, client).listFrequentSuppliers!({ macroIndustryKey: 'technology', minBuyers: 3 });
    assert.deepEqual(listed, { ok: false, reason: 'source_unavailable' });
  });

  it('los países de «frecuentes» son exactamente los cargados del registro', () => {
    const loaded = PUBLIC_BUYER_COUNTRIES.filter((c) => c.kind === 'loaded').map((c) => c.countryCode).sort();
    assert.deepEqual([...FREQUENT_PUBLIC_SUPPLIER_COUNTRY_CODES].sort(), loaded);
  });
});

describe('3. la corrida: sólo compras públicas, Claude nunca corre', () => {
  const INPUT: SupplierSearchRunInput = {
    userId: 'u1',
    clientRequestId: '523e4567-e89b-12d3-a456-426614174004',
    countryCode: 'MX',
    countryName: 'México',
    catalogVersion: '2.0.0',
    additionalCriteria: null,
    referenceCompanyName: FREQUENT_PUBLIC_REFERENCE_LABEL,
    scope: 'frequent_public',
    catalogResolution: {
      country: { code: 'MX', name: 'México' },
      catalog: { version: '2.0.0' },
      industry: { id: '223e4567-e89b-12d3-a456-426614174001', slug: 'technology', name: 'Tecnología' },
      subindustries: [],
    } as unknown as CatalogResolutionOutput,
    searchDepth: 'standard',
  };

  function runDeps(step: PublicBuyerStepOutcome) {
    const claude: number[] = [];
    const reserved: unknown[] = [];
    const deps: SupplierSearchRunDeps = {
      resolveSupplierSearchEnabled: () => true,
      runClaudeSupplierSearch: async (input) => (claude.push(input.round ?? 0), { executed: false, reason: 'no' }),
      runPublicBuyerSuppliers: async () => {
        throw new Error('no debería buscar una entidad');
      },
      runFrequentPublicSuppliers: async () => step,
      countCompetitorBatchOutcome: async () => ({ reviewable: 4, hubspotDuplicates: 0, sellupDuplicates: 0 }),
      listAcceptedPublicCandidateIds: async () => ['a', 'b', 'c', 'd'],
      tagPublicBuyerSuppliers: async () => 4,
      checkPersistenceReadiness: async () => ({ status: 'available' as const }),
      reserveSlot: async (input) => (reserved.push(input), { status: 'reserved', batchId: 'b1' }),
      sealFreeOnlyBatchStatus: async () => undefined,
      actionStartedAtMs: 0,
      nowMs: () => 10_000,
    };
    return { deps, claude, reserved };
  }

  const executedStep: PublicBuyerStepOutcome = {
    executed: true,
    scope: 'frequent_public',
    buyer: { taxId: 'frequent_public', name: FREQUENT_PUBLIC_REFERENCE_LABEL, matchedBy: 'exact' },
    sourceKey: 'mx_comprasmx_contracts',
    tableVersion: 't1',
    read: 120,
    outsideIndustry: 80,
    publicEntitiesExcluded: 0,
    offered: 4,
    written: 4,
    writeFailed: false,
    recordedWithoutWebsite: 0,
    relationships: [],
  };

  it('4 escritas y aceptadas, sin Claude; el lote se reserva con el alcance', async () => {
    const f = runDeps(executedStep);
    const result = await executeSupplierSearchRun(INPUT, f.deps);
    assert.deepEqual(f.claude, []);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.acceptedForTarget?.acceptedForTargetTotal, 4);
    const payload = (f.reserved[0] as { initialBatchPayload: { supplierSearch: unknown } }).initialBatchPayload.supplierSearch;
    assert.deepEqual(payload, { referenceCompanyName: FREQUENT_PUBLIC_REFERENCE_LABEL, scope: 'frequent_public' });
  });

  it('sin empresas frecuentes ⇒ mensaje claro, sin Claude', async () => {
    const f = runDeps({ executed: false, reason: 'no_frequent_suppliers' });
    const result = await executeSupplierSearchRun(INPUT, f.deps);
    assert.deepEqual(f.claude, []);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.message : '', /3 o más entidades públicas/);
  });

  it('un país sin compras cargadas ⇒ ni lo intenta', async () => {
    const f = runDeps(executedStep);
    const result = await executeSupplierSearchRun({ ...INPUT, countryCode: 'CO', countryName: 'Colombia' }, f.deps);
    assert.deepEqual(f.claude, []);
    assert.match(!result.ok ? result.message : '', /todavía no está disponible/);
  });

  it('nombre del lote', () => {
    assert.equal(buildFrequentPublicSupplierBatchName('México', 'Tecnología'), 'Proveedores frecuentes del Estado · México · Tecnología');
  });
});

describe('4. la petición', () => {
  const base = {
    countryCode: 'CL',
    industryId: '223e4567-e89b-12d3-a456-426614174001',
    subindustryIds: [],
    additionalCriteriaRaw: null,
    catalogVersion: '2.0.0',
    clientRequestId: '623e4567-e89b-12d3-a456-426614174005',
    searchMode: 'suppliers',
    supplierScope: 'frequent_public',
  };

  it('sin referencia y en un país cargado: válida', () => {
    assert.equal(wizardExecutionRequestSchema.safeParse(base).success, true);
  });

  it('con referencia, en un país en vivo o fuera de «Proveedores»: inválida', () => {
    assert.equal(wizardExecutionRequestSchema.safeParse({ ...base, referenceCompanyName: 'IMSS' }).success, false);
    assert.equal(wizardExecutionRequestSchema.safeParse({ ...base, countryCode: 'CO' }).success, false);
    assert.equal(wizardExecutionRequestSchema.safeParse({ ...base, searchMode: 'exploratory' }).success, false);
  });
});

describe('5. el asistente', () => {
  const initial = (): ProspectWizardState =>
    createInitialProspectWizardState({ catalogVersion: '2.0.0', defaultRequestedCount: 10, supplierSearchEnabled: true });
  const run = (state: ProspectWizardState, actions: ProspectWizardAction[]) => actions.reduce(prospectWizardReducer, state);
  const toReference: ProspectWizardAction[] = [{ type: 'START' }, { type: 'SELECT_SEARCH_MODE', mode: 'suppliers' }];

  it('«sin empresa» ⇒ pregunta de país; Colombia no se acepta, Chile sí', () => {
    const state = run(initial(), [...toReference, { type: 'SET_SUPPLIER_FREQUENT_PUBLIC' }]);
    assert.equal(state.supplierScope, 'frequent_public');
    assert.equal(state.referenceCompanyName, null);
    assert.equal(state.currentStep, 'country');
    const co = run(state, [{ type: 'SELECT_COUNTRY', countryCode: 'CO' }]);
    assert.equal(co.currentStep, 'country');
    assert.ok(co.blockingIssues.some((i) => i.code === 'COUNTRY_REQUIRED'));
    const cl = run(state, [{ type: 'SELECT_COUNTRY', countryCode: 'CL' }]);
    assert.equal(cl.countryCode, 'CL');
    assert.equal(cl.currentStep, 'industry');
  });

  it('escribir una empresa después quita el «sin empresa»', () => {
    const state = run(initial(), [
      ...toReference,
      { type: 'SET_SUPPLIER_FREQUENT_PUBLIC' },
      { type: 'GO_BACK' },
      { type: 'SET_REFERENCE_COMPANY', value: 'Ecopetrol' },
    ]);
    assert.equal(state.supplierScope, null);
    assert.equal(state.referenceCompanyName, 'Ecopetrol');
  });

  it('desde el resumen con Colombia ⇒ vuelve a preguntar el país', () => {
    const summary = run(initial(), [
      ...toReference,
      { type: 'SET_REFERENCE_COMPANY', value: 'Ecopetrol' },
      { type: 'SELECT_COUNTRY', countryCode: 'CO' },
      { type: 'SELECT_INDUSTRY', industryId: '00000000-0000-4000-8000-000000000001' },
      { type: 'SKIP_ADDITIONAL_CRITERIA' },
    ]);
    const picked = run(summary, [
      { type: 'EDIT_STEP', step: 'reference_company', returnToSummary: true },
      { type: 'SET_SUPPLIER_FREQUENT_PUBLIC' },
    ]);
    assert.equal(picked.countryCode, null);
    assert.equal(picked.currentStep, 'country');
  });
});

describe('6. migración 154: la segunda función también es de sólo lectura', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/154_public_procurement_read_functions.sql'), 'utf8').replace(
    /--.*$/gm,
    '',
  );
  it('existe, SECURITY INVOKER y EXECUTE sólo para service_role', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_frequent_public_procurement_suppliers/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_frequent_public_procurement_suppliers[^;]+FROM anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_frequent_public_procurement_suppliers[^;]+TO service_role/);
    assert.equal((sql.match(/SECURITY INVOKER/g) ?? []).length, 2);
  });
});
