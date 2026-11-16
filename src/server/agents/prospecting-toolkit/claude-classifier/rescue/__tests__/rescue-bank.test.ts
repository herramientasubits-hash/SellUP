// Dueña 14-11 — lo rescatado que no cabe en la búsqueda va al banco gratuito.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDispositionBankItem } from '../rescue-bank';
import { readBankPipelineCandidate } from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';
import type { CompanyClassificationResult } from '../../types';
import type { RescuableDispositionRow } from '../rescue-dispositions';

const row = (o: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow & { source_primary?: string | null } => ({
  id: 'd1',
  batch_id: 'b1',
  candidate_id: null,
  status: 'discarded',
  name: 'Viña Ejemplo',
  domain: 'www.vinaejemplo.cl',
  country_code: 'CL',
  industry: 'Farming',
  reason_code: 'sub_industry_branch_parent_only',
  evidence: {},
  source_primary: 'lusha',
  ...o,
});
const result = { employeeRange: { min: 250, max: 500 } } as unknown as CompanyClassificationResult;
const admit = (sizeConfirmed: boolean) =>
  ({ kind: 'admit', sectorConfirmed: true, sizeConfirmed, linkedinConfirmed: false }) as const;
const build = (o: Partial<Parameters<typeof buildDispositionBankItem>[0]> = {}) =>
  buildDispositionBankItem({
    row: row(),
    result,
    decision: admit(true),
    macroIndustryKey: 'agroindustria',
    industryName: 'Agroindustria',
    decidedAt: '2026-11-14T00:00:00Z',
    ...o,
  });

describe('rescatada sin lugar → banco', () => {
  it('arma una fila lista del banco que el escritor sabe volver a leer', () => {
    const item = build();
    assert.ok(item);
    assert.equal(item.countryCode, 'CL');
    assert.equal(item.macroIndustryKey, 'agroindustria');
    assert.equal(item.tier, 'ready');
    assert.equal(item.sourceProvider, 'lusha');
    assert.equal(item.sourceBatchId, 'b1');
    assert.ok(item.claims.length > 0);
    const candidate = readBankPipelineCandidate(item.payload);
    assert.equal(candidate?.domain, 'vinaejemplo.cl');
    assert.equal(candidate?.employeeCount, 250);
  });

  it('sin tamaño confirmado queda «por completar»', () => {
    const item = build({ decision: admit(false) });
    assert.equal(item?.tier, 'to_complete');
    assert.deepEqual(item?.missingFields, ['company_size']);
  });

  it('sin dominio, país o macro no se guarda', () => {
    assert.equal(build({ row: row({ domain: null }) }), null);
    assert.equal(build({ row: row({ country_code: null }) }), null);
    assert.equal(build({ macroIndustryKey: null }), null);
  });
});

// ─── Dueña 16-11 — la web es la palabra distintiva del nombre ─────────────────
import { domainIsDistinctiveNameWord } from '../../domain-finder';

describe('web = palabra distintiva del nombre', () => {
  it('«tottus.cl» para «HIPERMERCADOS TOTTUS SA» (y con el país)', () => {
    assert.equal(domainIsDistinctiveNameWord('tottus.cl', ['HIPERMERCADOS TOTTUS SA']), true);
    assert.equal(domainIsDistinctiveNameWord('tottuschile.cl', ['HIPERMERCADOS TOTTUS SA']), true);
  });

  it('una palabra genérica o corta no basta', () => {
    assert.equal(domainIsDistinctiveNameWord('hipermercados.cl', ['HIPERMERCADOS TOTTUS SA']), false);
    assert.equal(domainIsDistinctiveNameWord('servicios.cl', ['SERVICIOS INTEGRALES SA']), false);
    assert.equal(domainIsDistinctiveNameWord('abc.cl', ['ABC S.A.']), false);
    assert.equal(domainIsDistinctiveNameWord('frusan.cl', ['FRUTERA SAN FERNANDO SOCIEDAD ANONIMA']), false);
  });

  it('nunca una plataforma o un dominio compartido', () => {
    assert.equal(domainIsDistinctiveNameWord('tottus.blogspot.com', ['HIPERMERCADOS TOTTUS SA']), false);
  });
});

// ─── Dueña 16-11 — web equivocada y posible duplicado del árbol: la IA busca la web ──
import { asWebsiteSearchRow, isDomainSearchCandidate } from '../domain-search';
import { needsDispositionRescue } from '../rescue-dispositions';

describe('más descartadas a las que la IA les busca la web', () => {
  const base = {
    id: 'd1', batch_id: 'b1', candidate_id: null, status: 'discarded', name: 'Acme SpA',
    country_code: 'CL', industry: 'Retail', evidence: {},
  };

  it('web que no es de la empresa: se ignora la equivocada y se busca la correcta', () => {
    const row = asWebsiteSearchRow({ ...base, domain: 'otra-empresa.cl', reason_code: 'ownership_rejected_final' });
    assert.equal(row.domain, null);
    assert.equal(isDomainSearchCandidate(row), true);
    assert.equal(needsDispositionRescue(row, Date.now(), true), true);
    assert.equal(needsDispositionRescue(row, Date.now(), false), false, 'sin buscador de web, nada');
  });

  it('posible duplicado del árbol sin web: se busca y la revisión de duplicados decide', () => {
    const row = { ...base, domain: null, reason_code: 'corporate_tree_possible_hubspot_duplicate' };
    assert.equal(isDomainSearchCandidate(row), true);
  });

  it('los duplicados confirmados y el periodo de espera no se tocan', () => {
    for (const reason_code of ['hubspot_duplicate_final', 'cooldown_final', null]) {
      const row = asWebsiteSearchRow({ ...base, domain: 'x.cl', reason_code });
      assert.equal(row.domain, 'x.cl');
      assert.equal(needsDispositionRescue(row as never, Date.now(), true), false);
    }
  });
});

import { bankFailedBeforeFix } from '../rescue-dispositions';

describe('las que el banco rechazó antes del arreglo se reintentan una vez', () => {
  it('bank_outcome failed sin la marca ⇒ reintento; con la marca ⇒ no', () => {
    assert.equal(bankFailedBeforeFix({ claude_rescue: { decision: 'reassign', bank_outcome: 'failed' } }), true);
    assert.equal(bankFailedBeforeFix({ claude_rescue: { decision: 'reassign', bank_outcome: 'failed', bank_found_web_v1: true } }), false);
    assert.equal(bankFailedBeforeFix({ claude_rescue: { decision: 'reassign', banked: true } }), false);
    assert.equal(bankFailedBeforeFix(null), false);
  });
});
