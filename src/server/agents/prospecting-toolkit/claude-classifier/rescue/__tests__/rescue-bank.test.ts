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
