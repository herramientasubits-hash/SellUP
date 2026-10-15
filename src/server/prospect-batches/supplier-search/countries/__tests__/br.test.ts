/**
 * Tests — Brasil en «Proveedores de una empresa» por compras públicas (en vivo): lectura de
 * Compras.gov.br y del PNCP con filas REALES recortadas (Ministério da Saúde, 15-10-2026),
 * CNPJ (empresa, filial → matriz, sin personas físicas), nombre del comprador, tabla
 * BORRADOR CATMAT/CATSER, consultas con dobles y el paso de punta a punta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runPublicBuyerSupplierStep, type PublicBuyerStepDeps } from '../../public-buyer-suppliers';
import {
  aggregateBrSuppliers,
  brItemsToLookup,
  brMatrizCnpj,
  brPncpContractUrl,
  brSupplierCnpj,
  brWindow,
  normalizeBrBuyerName,
  parseBrComprasItems,
  parseBrPncpContracts,
  pickBrCandidates,
  spreadPages,
} from '../br';
import { brIsPublicNatureza, buildBrLookups, type BrFetchJson } from '../br.server';
import {
  BR_CATMAT_CLASSIFIER,
  brCatalogFamily,
  resolveBrCatalogMacro,
  resolveBrCatalogRubro,
} from '../br-catmat-macro-table';
import { MACRO_INDUSTRY_KEYS } from '@/modules/macro-industry-catalog/macro-industries';
import { BR_CATMAT_GROUP_MACRO, BR_CATSER_DIVISION_MACRO } from '../br-catmat-macro-table';

const MS = '00394544000185';

/** Ítems reales de `2_consultarContratosItem` (Ministério da Saúde), recortados. */
const COMPRAS_ITEMS = {
  resultado: [
    { niFornecedor: '04198254000117', nomeRazaoSocialFornecedor: 'MCR SISTEMAS E CONSULTORIA LTDA', numeroControlePncpContrato: '00394544000185-2-011879/2025', valorTotalItem: 510786.0, tipoItem: 'Serviço', codigoItem: 27502, dataVigenciaInicial: '2025-10-16T00:00:00', contratoExcluido: false, contratoItemExcluido: false },
    { niFornecedor: '61485900001132', nomeRazaoSocialFornecedor: 'SG TECNOLOGIA CLINICA LTDA', numeroControlePncpContrato: '00394544000185-2-012177/2025', valorTotalItem: 16886.15, tipoItem: 'Material', codigoItem: 303151, dataVigenciaInicial: '2025-10-16T00:00:00', contratoExcluido: false, contratoItemExcluido: false },
    { niFornecedor: '61485900000160', nomeRazaoSocialFornecedor: 'SG TECNOLOGIA CLINICA LTDA', numeroControlePncpContrato: '00394544000185-2-012178/2025', valorTotalItem: 60000, tipoItem: 'Material', codigoItem: 303151, dataVigenciaInicial: '2026-02-01T00:00:00', contratoExcluido: false, contratoItemExcluido: false },
    { niFornecedor: '28643008000195', nomeRazaoSocialFornecedor: 'SANTO REMEDIO -COMERCIO DE PRODUTOS MEDICO-HOSPITALAR LTDA', numeroControlePncpContrato: '00394544000185-2-013092/2025', valorTotalItem: 3750.7, tipoItem: 'Material', codigoItem: 270597, dataVigenciaInicial: '2025-10-15T00:00:00', contratoExcluido: false, contratoItemExcluido: false },
    { niFornecedor: '28643008000195', nomeRazaoSocialFornecedor: 'SANTO REMEDIO', numeroControlePncpContrato: '00394544000185-2-013093/2025', valorTotalItem: 999999, tipoItem: 'Material', codigoItem: 270597, contratoExcluido: true },
  ],
  totalRegistros: 5,
  totalPaginas: 1,
};

/** Contratos reales del PNCP; la persona física es sintética (sin datos personales). */
const PNCP_CONTRACTS = {
  data: [
    { tipoPessoa: 'PJ', niFornecedor: '05439635000456', nomeRazaoSocialFornecedor: 'ANTIBIOTICOS DO BRASIL LTDA.', orgaoEntidade: { cnpj: MS }, anoContrato: 2025, sequencialContrato: 11176, numeroControlePNCP: '00394544000185-2-011176/2025', valorGlobal: 2500.0, dataAssinatura: '2025-10-10' },
    { tipoPessoa: 'PF', niFornecedor: '00000000000', nomeRazaoSocialFornecedor: 'PESSOA FISICA EXEMPLO', orgaoEntidade: { cnpj: MS }, anoContrato: 2025, sequencialContrato: 11307, valorGlobal: 108000.0, dataAssinatura: '2025-10-14' },
  ],
  totalPaginas: 1,
};

describe('1. número fiscal y nombre (Brasil)', () => {
  it('CNPJ válido de empresa; CPF, extranjero y DV inválido fuera', () => {
    assert.equal(brSupplierCnpj('04.198.254/0001-17'), '04198254000117');
    assert.equal(brSupplierCnpj('66193206949'), null, 'CPF de persona física');
    assert.equal(brSupplierCnpj('04198254000118'), null, 'dígito verificador inválido');
    assert.equal(brSupplierCnpj(null), null);
  });

  it('filial → CNPJ completo de su matriz (raíz + 0001 + DV)', () => {
    assert.equal(brMatrizCnpj('61485900001132'), '61485900000160');
    assert.equal(brSupplierCnpj(brMatrizCnpj('05439635000456')), '05439635000103');
  });

  it('nombre del comprador como la Receita; «Prefeitura de X» = «MUNICIPIO DE X»', () => {
    assert.equal(normalizeBrBuyerName('Ministério da Saúde'), 'MINISTERIO DA SAUDE');
    assert.equal(normalizeBrBuyerName('Prefeitura Municipal de Campinas'), 'MUNICIPIO DE CAMPINAS');
    assert.equal(normalizeBrBuyerName('Prefeitura do Rio de Janeiro'), 'MUNICIPIO DO RIO DE JANEIRO');
  });

  it('natureza jurídica 1xxx = entidad pública; 2xxx (estatales, mixtas) sí son proveedoras', () => {
    assert.equal(brIsPublicNatureza('1147'), true);
    assert.equal(brIsPublicNatureza('2038'), false);
    assert.equal(brIsPublicNatureza(null), false);
  });
});

describe('2. lectura de las fuentes', () => {
  it('Compras.gov.br: ítems de empresas en su matriz, con el ítem del catálogo y el contrato del PNCP', () => {
    const lines = parseBrComprasItems(COMPRAS_ITEMS);
    assert.equal(lines.length, 4, 'el contrato excluido no entra');
    assert.deepEqual(lines[0], {
      supplierTaxId: '04198254000117',
      supplierName: 'MCR SISTEMAS E CONSULTORIA LTDA',
      contractKey: '00394544000185-2-011879/2025',
      amount: 510786,
      date: '2025-10-16',
      evidenceUrl: 'https://pncp.gov.br/app/contratos/00394544000185/2025/11879',
      catalogItem: { tipo: 'Serviço', code: 27502 },
    });
    assert.equal(lines[1].supplierTaxId, '61485900000160', 'filial juntada en su matriz');
  });

  it('PNCP: sólo personas jurídicas; enlace al contrato', () => {
    const lines = parseBrPncpContracts(PNCP_CONTRACTS);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].supplierTaxId, '05439635000103');
    assert.equal(lines[0].evidenceUrl, 'https://pncp.gov.br/app/contratos/00394544000185/2025/11176');
    assert.equal(lines[0].catalogItem, undefined);
  });

  it('agregado por proveedor con piso; la entidad misma nunca sale', () => {
    const lines = parseBrComprasItems(COMPRAS_ITEMS);
    const rows = aggregateBrSuppliers([...lines, { ...lines[0], supplierTaxId: '00394544000266' }], { buyerCnpj: MS, minAmount: 55_000, limit: 10 });
    assert.deepEqual(rows.map((r) => [r.taxId, Math.round(r.totalAmount), r.contractCount]), [
      ['04198254000117', 510786, 1],
      ['61485900000160', 76886, 2],
    ]);
    assert.equal(rows[1].lastSignedAt, '2026-02-01');
  });

  it('enlace del PNCP sólo con el formato oficial', () => {
    assert.equal(brPncpContractUrl('bad'), null);
  });

  it('páginas repartidas en el año y ventana de 12 meses', () => {
    assert.deepEqual(spreadPages(3, 24), [1, 2, 3]);
    assert.deepEqual(spreadPages(66, 4), [1, 23, 44, 66]);
    assert.deepEqual(brWindow('2026-10-15T12:00:00Z'), { start: '2025-10-15', end: '2026-10-15' });
    assert.deepEqual(brWindow('2028-02-29T00:00:00Z'), { start: '2027-02-28', end: '2028-02-29' });
  });

  it('preselección: los de más monto siempre + los de la industria por su CNAE', () => {
    const rows = ['A', 'B', 'C', 'D'].map((taxId, i) => ({ taxId, name: taxId, totalAmount: 100 - i, contractCount: 1, lastSignedAt: null, evidenceUrl: null, amountByItem: new Map() }));
    const picked = pickBrCandidates(rows, { macroOfTaxId: (t) => (t === 'D' ? 'technology' : 'health_pharma'), macroIndustryKey: 'technology', top: 1, limit: 3 });
    assert.deepEqual(picked.map((r) => r.taxId), ['A', 'D']);
  });

  it('ítems a buscar en el catálogo: los de más monto de cada proveedor, con tope', () => {
    const supplier = { taxId: 'A', name: 'A', totalAmount: 100, contractCount: 1, lastSignedAt: null, evidenceUrl: null, amountByItem: new Map([['Material:1', 80], ['Material:2', 15], ['Material:3', 5]]) };
    assert.deepEqual(brItemsToLookup([supplier], { perSupplier: 3, coverage: 0.7, cap: 10 }), ['Material:1']);
    assert.deepEqual(brItemsToLookup([supplier], { perSupplier: 3, coverage: 0.99, cap: 2 }), ['Material:1', 'Material:2']);
  });
});

describe('3. tabla BORRADOR CATMAT/CATSER', () => {
  it('familia por tipo y clase; macro por grupo (material) o división (servicio)', () => {
    assert.equal(brCatalogFamily('Material', 6550), 'M6550');
    assert.equal(brCatalogFamily('Serviço', 1821), 'S1821');
    assert.equal(brCatalogFamily('Outro', 1821), null);
    assert.equal(resolveBrCatalogMacro('M6505'), 'health_pharma');
    assert.equal(resolveBrCatalogMacro('M7010'), 'technology');
    assert.equal(resolveBrCatalogMacro('S1821'), 'technology');
    assert.equal(resolveBrCatalogMacro('S8511'), 'services_company');
    assert.equal(resolveBrCatalogMacro('S6311'), null, 'alimentación y alojamiento sin macro');
    assert.equal(resolveBrCatalogRubro('M6505'), 'Medicamentos');
    assert.equal(resolveBrCatalogRubro('S1821'), 'Licencias de software');
  });

  it('regla del 50 %', () => {
    assert.deepEqual(BR_CATMAT_CLASSIFIER.classify({ S1821: 60, M6505: 40 }), { macroIndustryKey: 'technology', share: 0.6 });
    assert.equal(BR_CATMAT_CLASSIFIER.classify({ S1821: 40, M6505: 35, M7510: 25 }), null);
  });

  it('sólo claves de macro industria del catálogo', () => {
    for (const macro of [...Object.values(BR_CATMAT_GROUP_MACRO), ...Object.values(BR_CATSER_DIVISION_MACRO)]) {
      assert.ok((MACRO_INDUSTRY_KEYS as readonly string[]).includes(macro), macro);
    }
  });
});

/** Doble del cliente de Supabase: misma respuesta para cualquier consulta de la tabla. */
function fakeClient(rows: unknown[]) {
  const calls: Array<Array<[string, unknown[]]>> = [];
  const client = {
    from() {
      const ops: Array<[string, unknown[]]> = [];
      calls.push(ops);
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = (...args: unknown[]) => (ops.push([op, args]), builder);
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

/** Doble de las APIs: responde por la ruta pedida y registra las URL. */
function fakeFetch(routes: Record<string, unknown>): { fetchJson: BrFetchJson; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchJson: async (url) => {
      urls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) throw new Error(`sin ruta: ${url}`);
      return routes[key];
    },
  };
}

const RECEITA_ROWS = [
  { normalized_tax_id: '04198254000117', natureza: '2062', cnae: '6201501', source_key: 'br_receita_registry', website: 'mcrsistemas.com.br' },
  { normalized_tax_id: '61485900000160', natureza: '2062', cnae: '4664800', source_key: 'br_receita_directory', website: null },
  { normalized_tax_id: MS, natureza: '1015', cnae: '8411600', source_key: 'br_receita_registry', normalized_legal_name: 'MINISTERIO DA SAUDE' },
];

const CATALOG_ROUTES = {
  '6_consultarItemServico': { resultado: [{ codigoServico: 27502, codigoClasse: 1821 }] },
  '4_consultarItemMaterial': { resultado: [{ codigoItem: 303151, codigoGrupo: 65, codigoClasse: 6515 }] },
};

describe('4. consultas en vivo (dobles)', () => {
  it('órgão federal ⇒ Compras.gov.br con su código; industria por catálogo', async () => {
    const { fetchJson, urls } = fakeFetch({ '2_consultarOrgao': { resultado: [{ codigoOrgao: 36000, esfera: 'F' }] }, '2_consultarContratosItem': COMPRAS_ITEMS, ...CATALOG_ROUTES });
    const { client } = fakeClient(RECEITA_ROWS);
    const r = await buildBrLookups(client, { fetchJson }).listSuppliers({ buyerTaxId: MS, macroIndustryKey: 'technology', nowIso: '2026-10-15T12:00:00Z' });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.suppliers.map((s) => [s.taxId, s.rubro, s.macroShare]), [['04198254000117', 'Licencias de software', 1]]);
    assert.equal(r.read, 2);
    assert.equal(r.sinceYear, '2025');
    assert.ok(urls.some((u) => u.includes('codigoOrgao=36000') && u.includes('dataVigenciaInicialMin=2025-10-15')));
    assert.ok(!urls.some((u) => u.includes('pncp.gov.br')), 'un órgão federal no va al PNCP');
  });

  it('no federal ⇒ PNCP por cnpjOrgao; industria por CNAE de la Receita', async () => {
    const big = { ...PNCP_CONTRACTS, data: [{ ...PNCP_CONTRACTS.data[0], valorGlobal: 90_000 }] };
    const { fetchJson, urls } = fakeFetch({ '2_consultarOrgao': null, 'pncp.gov.br/api/consulta/v1/contratos': big });
    const { client } = fakeClient([{ normalized_tax_id: '05439635000103', natureza: '2062', cnae: '2121101' }]);
    const r = await buildBrLookups(client, { fetchJson }).listSuppliers({ buyerTaxId: '51885242000140', macroIndustryKey: 'health_pharma', nowIso: '2026-10-15' });
    assert.equal(r.ok && r.suppliers.map((s) => s.taxId).join(), '05439635000103');
    assert.equal(r.ok && r.tableVersion, 'br-catmat-catser-macro-v0-draft+br-cnae23-receita-macro-v1');
    assert.ok(urls.some((u) => u.includes('cnpjOrgao=51885242000140') && u.includes('dataInicial=20251015')));
  });

  it('la fuente caída ⇒ source_unavailable', async () => {
    const { fetchJson } = fakeFetch({ '2_consultarOrgao': { resultado: [{ codigoOrgao: 36000, esfera: 'F' }] } });
    const r = await buildBrLookups(fakeClient([]).client, { fetchJson }).listSuppliers({ buyerTaxId: MS, macroIndustryKey: 'technology', nowIso: '2026-10-15' });
    assert.deepEqual(r, { ok: false, reason: 'source_unavailable' });
  });

  it('entidad por nombre sólo entre la administración pública de la Receita', async () => {
    const { client, calls } = fakeClient([{ normalized_tax_id: MS, normalized_legal_name: 'MINISTERIO DA SAUDE' }]);
    const rows = await buildBrLookups(client).findPublicEntities('MINISTERIO DA SAUDE');
    assert.deepEqual(rows, [{ taxId: MS, normalizedLegalName: 'MINISTERIO DA SAUDE', shortName: null, isHead: false }]);
    assert.deepEqual(calls[0].filter(([op]) => op === 'like').map(([, a]) => a), [['normalized_legal_name', 'MINISTERIO DA SAUDE%'], ['raw_data->>natureza_juridica', '1%']]);
  });

  it('web por CNPJ: la fuente de más prioridad gana', async () => {
    const { client } = fakeClient([
      { source_key: 'br_receita_domain_key', normalized_tax_id: 'X', website: 'otra.com.br' },
      { source_key: 'br_receita_directory', normalized_tax_id: 'X', website: 'https://www.buena.com.br/' },
    ]);
    const domains = await buildBrLookups(client).findDomainsByTaxId(['X']);
    assert.deepEqual([...domains], [['X', 'buena.com.br']]);
  });
});

describe('5. paso de punta a punta (Brasil)', () => {
  it('Ministério da Saúde × Tecnología: entidad única, proveedor con web al lote, prueba del PNCP', async () => {
    const { fetchJson } = fakeFetch({ '2_consultarOrgao': { resultado: [{ codigoOrgao: 36000, esfera: 'F' }] }, '2_consultarContratosItem': COMPRAS_ITEMS, ...CATALOG_ROUTES });
    const { client } = fakeClient(RECEITA_ROWS);
    const lookups = buildBrLookups(client, { fetchJson });
    const written: string[] = [];
    const deps: PublicBuyerStepDeps = {
      ...lookups,
      findPublicEntities: async () => [{ taxId: MS, normalizedLegalName: 'MINISTERIO DA SAUDE', shortName: null, isHead: false }],
      writeWithWebsite: async (companies) => {
        written.push(...companies.map((c) => `${c.taxId}|${c.taxIdentifierType}|${c.domain}`));
        return { written: companies.length, failed: false };
      },
      recordWithoutWebsite: async (companies) => companies.length,
    };
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Ministério da Saúde', countryCode: 'BR', macroIndustryKey: 'technology', nowIso: '2026-10-15T12:00:00Z' },
      deps,
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.matchedBy, 'exact');
    assert.deepEqual(written, ['04198254000117|CNPJ|mcrsistemas.com.br']);
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://pncp.gov.br/app/contratos/00394544000185/2025/11879');
    assert.match(outcome.relationships[0].evidence, /licencias de software/);
  });
});
