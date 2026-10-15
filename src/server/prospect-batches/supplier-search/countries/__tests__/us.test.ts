/**
 * Tests — Estados Unidos en «Proveedores de una empresa» por compras públicas (en vivo):
 * USAspending con filas REALES recortadas (Department of Veterans Affairs, 15-10-2026),
 * nombre de la agencia, UEI, tabla NAICS aprobada, consultas con dobles, el paso de punta
 * a punta y la etiqueta «Proveedor de X» con UEI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { runPublicBuyerSupplierStep, tagPublicBuyerSuppliers, taxIdKey, type PublicBuyerStepDeps } from '../../public-buyer-suppliers';
import {
  buildUsAwardsBody,
  buildUsRecipientsBody,
  decodeUsAgency,
  encodeUsAgency,
  normalizeUsAgencyName,
  parseUsAgencies,
  parseUsAwards,
  parseUsRecipients,
  usTimePeriod,
  usUei,
} from '../us';
import { buildUsLookups, type UsPostJson } from '../us.server';
import {
  resolveUsNaicsMacro,
  resolveUsNaicsRubro,
  US_NAICS_CLASSIFIER,
  US_NAICS_MACRO,
  usNaicsPrefixesForMacro,
} from '../us-naics-macro-table';

const VA = 'toptier|Department of Veterans Affairs';

/** Respuestas reales de USAspending (VA, FY2026), recortadas. */
const AGENCIES = {
  results: {
    toptier_agency: [{ abbreviation: 'VA', code: '036', name: 'Department of Veterans Affairs', subtier_agencies: [] }],
    subtier_agency: [{ abbreviation: 'VA', code: '3600', name: 'Department of Veterans Affairs' }],
    office: [{ code: '36C502', name: 'VETERANS HEALTH ADMINISTRATION' }],
  },
};
const RECIPIENTS = {
  results: [
    { amount: 2063798279.88, name: 'ORACLE HEALTH GOVERNMENT SERVICES, INC.', uei: 'DT2KS3HH5FP5' },
    { amount: 608187040.82, name: 'V3GATE, LLC', uei: 'J4KHM5JY79E3' },
    { amount: 5_000_000, name: 'MULTIPLE RECIPIENTS', uei: null },
    { amount: 50_000, name: 'SMALL VENDOR LLC', uei: 'ABCDEFGHJK12' },
    { amount: 18238514.55, name: 'OREGON HEALTH & SCIENCE UNIVERSITY', uei: 'NPSNT86JKN51' },
  ],
};
const GOVERNMENTS = { results: [{ amount: 18238514.55, name: 'OREGON HEALTH & SCIENCE UNIVERSITY', uei: 'NPSNT86JKN51' }] };
const AWARDS = {
  results: [
    { 'Recipient UEI': 'DT2KS3HH5FP5', 'Award Amount': 2120623737.86, NAICS: { code: '541512' }, generated_internal_id: 'CONT_AWD_36C10B22N0051EHRM_3600_36C10B18D5000_3600', 'Start Date': '2022-09-28' },
    { 'Recipient UEI': 'DT2KS3HH5FP5', 'Award Amount': 1511268663.21, NAICS: { code: '541512' }, generated_internal_id: 'CONT_AWD_36C10B18N0003_3600_36C10B18D5000_3600', 'Start Date': '2018-05-17' },
    { 'Recipient UEI': 'J4KHM5JY79E3', 'Award Amount': 576889048.72, NAICS: { code: '541519' }, generated_internal_id: 'CONT_AWD_36C10B23F0172_3600_NNG15SD27B_8000', 'Start Date': '2023-06-26' },
    { 'Recipient UEI': 'J4KHM5JY79E3', 'Award Amount': 220097682.77, NAICS: { code: '541519' }, generated_internal_id: 'CONT_AWD_36C10B26F0195_3600_NNG15SD27B_8000', 'Start Date': '2026-07-01' },
    { 'Recipient UEI': 'NPSNT86JKN51', 'Award Amount': 18238514.55, NAICS: { code: '541512' }, generated_internal_id: 'CONT_AWD_X', 'Start Date': '2026-01-01' },
    { 'Recipient UEI': 'OTHERUEI0001', 'Award Amount': 1, NAICS: { code: '541512' }, generated_internal_id: 'CONT_AWD_Y', 'Start Date': '2026-01-01' },
  ],
};

describe('1. agencia, UEI y ventana (EE. UU.)', () => {
  it('nombre de la agencia sin «U.S.» ni «Department of (the)»', () => {
    assert.equal(normalizeUsAgencyName('Department of Veterans Affairs'), 'VETERANS AFFAIRS');
    assert.equal(normalizeUsAgencyName('U.S. Department of the Army'), 'ARMY');
    assert.equal(normalizeUsAgencyName('US Army'), 'ARMY');
    assert.equal(normalizeUsAgencyName('General Services Administration'), 'GENERAL SERVICES ADMINISTRATION');
    assert.equal(normalizeUsAgencyName('State Farm'), 'STATE FARM');
  });

  it('agencias de la búsqueda: toptier es la cabeza', () => {
    assert.deepEqual(parseUsAgencies(AGENCIES), [
      { tier: 'toptier', name: 'Department of Veterans Affairs', abbreviation: 'VA' },
      { tier: 'subtier', name: 'Department of Veterans Affairs', abbreviation: 'VA' },
    ]);
    assert.deepEqual(decodeUsAgency(encodeUsAgency({ tier: 'subtier', name: 'Department of the Army' })), { tier: 'subtier', name: 'Department of the Army' });
    assert.equal(decodeUsAgency('otro|x'), null);
  });

  it('UEI de 12 caracteres; ventana de 12 meses', () => {
    assert.equal(usUei('dt2ks3hh5fp5'), 'DT2KS3HH5FP5');
    assert.equal(usUei('080898173'), null, 'DUNS legado, no UEI');
    assert.deepEqual(usTimePeriod('2026-10-15T12:00:00Z'), { start_date: '2025-10-15', end_date: '2026-10-15' });
  });

  it('la etiqueta «Proveedor de X» cruza por UEI (sus letras cuentan)', async () => {
    assert.equal(taxIdKey('DT2KS3HH5FP5'), 'DT2KS3HH5FP5');
    assert.equal(taxIdKey('04.198.254/0001-17'), '04198254000117', 'CNPJ sigue por dígitos');
    assert.equal(taxIdKey('96505260-7'), '965052607', 'RUT chileno sin cambios');
    const updated: string[] = [];
    const tagged = await tagPublicBuyerSuppliers(
      { batchId: 'b1', referenceCompanyName: 'Department of Veterans Affairs', relationships: [{ taxId: 'DT2KS3HH5FP5', name: 'ORACLE', evidenceUrl: null, evidence: 'x' }] },
      {
        loadCandidates: async () => [{ id: 'c1', taxIdentifier: 'DT2KS3HH5FP5', metadata: {} }, { id: 'c2', taxIdentifier: 'J4KHM5JY79E3', metadata: {} }],
        updateMetadata: async (id) => (updated.push(id), true),
      },
    );
    assert.equal(tagged, 1);
    assert.deepEqual(updated, ['c1']);
  });
});

describe('2. consultas y lectura de USAspending', () => {
  const period = { start_date: '2025-10-15', end_date: '2026-10-15' };

  it('consulta 1: agencia, contratos A–D, NAICS de la industria; opcional sólo gobiernos', () => {
    const body = buildUsRecipientsBody({ agency: { tier: 'toptier', name: 'Department of Veterans Affairs' }, period, naicsPrefixes: ['51', '5415'], onlyGovernment: true });
    assert.deepEqual(body.filters, {
      agencies: [{ type: 'awarding', tier: 'toptier', name: 'Department of Veterans Affairs' }],
      time_period: [period],
      award_type_codes: ['A', 'B', 'C', 'D'],
      naics_codes: { require: ['51', '5415'] },
      recipient_type_names: ['government'],
    });
  });

  it('consulta 2: contratos de esos UEI, de más monto', () => {
    const body = buildUsAwardsBody({ agency: { tier: 'toptier', name: 'X' }, period, ueis: ['DT2KS3HH5FP5'] });
    assert.deepEqual((body.filters as Record<string, unknown>).recipient_search_text, ['DT2KS3HH5FP5']);
    assert.equal(body.sort, 'Award Amount');
  });

  it('proveedores con UEI, nombre de empresa y piso', () => {
    assert.deepEqual(
      parseUsRecipients(RECIPIENTS, 100_000).map((r) => r.uei),
      ['DT2KS3HH5FP5', 'J4KHM5JY79E3', 'NPSNT86JKN51'],
    );
  });

  it('contratos por UEI: NAICS, cuenta, fecha y el más grande como prueba', () => {
    const facts = parseUsAwards(AWARDS, new Set(['DT2KS3HH5FP5', 'J4KHM5JY79E3']));
    assert.equal(facts.size, 2, 'sólo los UEI pedidos');
    const oracle = facts.get('DT2KS3HH5FP5');
    assert.deepEqual(oracle?.amountByNaics, { '541512': 2120623737.86 + 1511268663.21 });
    assert.equal(oracle?.contractCount, 2);
    assert.equal(oracle?.lastStartDate, '2022-09-28');
    assert.equal(oracle?.topAward?.url, 'https://www.usaspending.gov/award/CONT_AWD_36C10B22N0051EHRM_3600_36C10B18D5000_3600');
  });
});

describe('3. tabla NAICS (aprobada 15-10)', () => {
  it('sector, grupo y clase: gana el prefijo más largo', () => {
    assert.equal(resolveUsNaicsMacro('541512'), 'technology');
    assert.equal(resolveUsNaicsMacro('541611'), 'services_company');
    assert.equal(resolveUsNaicsMacro('423430'), 'technology');
    assert.equal(resolveUsNaicsMacro('423450'), 'health_pharma');
    assert.equal(resolveUsNaicsMacro('423510'), 'retail');
    assert.equal(resolveUsNaicsMacro('325412'), 'health_pharma');
    assert.equal(resolveUsNaicsMacro('334511'), 'industry_manufacturing_chemicals_automotive');
    assert.equal(resolveUsNaicsMacro('561510'), null, 'agencias de viaje');
    assert.equal(resolveUsNaicsMacro('611310'), null, 'educación');
    assert.equal(resolveUsNaicsRubro('541512'), 'Servicios informáticos (software, desarrollo, soporte)');
  });

  it('prefijos para filtrar: sólo 2, 4 o 6 dígitos (lo que acepta USAspending), sin redundantes', () => {
    for (const macro of MACRO_INDUSTRY_KEYS) {
      for (const code of usNaicsPrefixesForMacro(macro)) assert.ok([2, 4, 6].includes(code.length), `${macro}: ${code}`);
    }
    assert.deepEqual(usNaicsPrefixesForMacro('technology'), ['3341', '3342', '3343', '3344', '3346', '423430', '51', '5415']);
    assert.deepEqual(usNaicsPrefixesForMacro('government'), []);
  });

  it('regla del 50 % y sólo claves de macro industria del catálogo', () => {
    assert.deepEqual(US_NAICS_CLASSIFIER.classify({ '541512': 70, '561720': 30 }), { macroIndustryKey: 'technology', share: 0.7 });
    assert.equal(US_NAICS_CLASSIFIER.classify({ '541512': 40, '561720': 35, '236220': 25 }), null);
    for (const macro of Object.values(US_NAICS_MACRO)) assert.ok((MACRO_INDUSTRY_KEYS as readonly string[]).includes(macro), macro);
  });
});

/** Doble del cliente de Supabase: misma respuesta para cualquier consulta. */
function fakeClient(rows: unknown[]): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return { from: () => builder } as unknown as SupabaseClient;
}

/** Doble de USAspending por ruta (y por si la consulta pide sólo gobiernos). */
function fakePost(overrides: Partial<Record<'agencies' | 'recipients' | 'governments' | 'awards', unknown>> = {}): { postJson: UsPostJson; bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  const routes = { agencies: AGENCIES, recipients: RECIPIENTS, governments: GOVERNMENTS, awards: AWARDS, ...overrides };
  return {
    bodies,
    postJson: async (url, body) => {
      bodies.push(body);
      const filters = (body.filters ?? {}) as Record<string, unknown>;
      const route = url.includes('autocomplete') ? 'agencies' : url.includes('spending_by_award') ? 'awards' : filters.recipient_type_names ? 'governments' : 'recipients';
      const value = routes[route];
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

const DIRECTORY = [{ normalized_legal_name: 'ORACLE HEALTH GOVERNMENT SERVICES', source_year: 2025, website: 'oracle.com', workers: '1200', kind: 'sec' }];

describe('4. consultas en vivo (dobles)', () => {
  it('industria por lo que le vende a la agencia; gobiernos marcados; web y empleados por nombre', async () => {
    const { postJson } = fakePost();
    const lookups = buildUsLookups(fakeClient(DIRECTORY), { postJson });
    const r = await lookups.listSuppliers({ buyerTaxId: VA, macroIndustryKey: 'technology', nowIso: '2026-10-15T12:00:00Z' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.suppliers.map((s) => s.taxId), ['DT2KS3HH5FP5', 'J4KHM5JY79E3', 'NPSNT86JKN51']);
    assert.equal(r.read, 3);
    assert.deepEqual(r.suppliers[0].officialWorkers, { workers: 1200, year: 2025, sourceLabel: 'IRS 990' });
    assert.deepEqual([...(await lookups.listPublicOnlyTaxIds(r.suppliers.map((s) => s.taxId)))], ['NPSNT86JKN51']);
    assert.deepEqual([...(await lookups.findDomainsByTaxId(['DT2KS3HH5FP5', 'J4KHM5JY79E3']))], [['DT2KS3HH5FP5', 'oracle.com']]);
  });

  it('dos filas del directorio con el mismo nombre ⇒ sin web (no se adivina)', async () => {
    const { postJson } = fakePost();
    const lookups = buildUsLookups(fakeClient([...DIRECTORY, { ...DIRECTORY[0], website: 'otra.com' }]), { postJson });
    await lookups.listSuppliers({ buyerTaxId: VA, macroIndustryKey: 'technology', nowIso: '2026-10-15' });
    assert.equal((await lookups.findDomainsByTaxId(['DT2KS3HH5FP5'])).size, 0);
  });

  it('industria sin NAICS o agencia inválida ⇒ no consulta; fuente caída ⇒ source_unavailable', async () => {
    const { postJson, bodies } = fakePost({ recipients: new Error('HTTP 500') });
    const lookups = buildUsLookups(fakeClient([]), { postJson });
    assert.deepEqual(await lookups.listSuppliers({ buyerTaxId: VA, macroIndustryKey: 'government', nowIso: '2026-10-15' }), { ok: false, reason: 'industry_without_unspsc' });
    assert.equal(bodies.length, 0);
    assert.deepEqual(await lookups.listSuppliers({ buyerTaxId: VA, macroIndustryKey: 'technology', nowIso: '2026-10-15' }), { ok: false, reason: 'source_unavailable' });
  });

  it('agencias por nombre (toptier cabeza, nombre normalizado)', async () => {
    const { postJson, bodies } = fakePost();
    const rows = await buildUsLookups(fakeClient([]), { postJson }).findPublicEntities('VETERANS AFFAIRS');
    assert.deepEqual(rows[0], { taxId: VA, normalizedLegalName: 'VETERANS AFFAIRS', shortName: 'VA', isHead: true });
    assert.deepEqual(bodies[0], { search_text: 'VETERANS AFFAIRS', limit: 10 });
  });
});

describe('5. paso de punta a punta (EE. UU.)', () => {
  it('VA × Tecnología: agencia única, gobierno fuera, con web al lote, sin web a Descartadas', async () => {
    const { postJson } = fakePost();
    const lookups = buildUsLookups(fakeClient(DIRECTORY), { postJson });
    const written: string[] = [];
    const recorded: string[] = [];
    const deps: PublicBuyerStepDeps = {
      ...lookups,
      writeWithWebsite: async (companies) => {
        written.push(...companies.map((c) => `${c.taxId}|${c.taxIdentifierType}|${c.domain}`));
        return { written: companies.length, failed: false };
      },
      recordWithoutWebsite: async (companies) => (recorded.push(...companies.map((c) => c.taxId ?? '')), companies.length),
    };
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'U.S. Department of Veterans Affairs', countryCode: 'US', macroIndustryKey: 'technology', nowIso: '2026-10-15T12:00:00Z' },
      deps,
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, VA);
    assert.equal(outcome.publicEntitiesExcluded, 1);
    assert.deepEqual(written, ['DT2KS3HH5FP5|other|oracle.com']);
    assert.deepEqual(recorded, ['J4KHM5JY79E3']);
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://www.usaspending.gov/award/CONT_AWD_36C10B22N0051EHRM_3600_36C10B18D5000_3600');
    assert.match(outcome.relationships[0].evidence, /servicios informáticos/);
  });
});
