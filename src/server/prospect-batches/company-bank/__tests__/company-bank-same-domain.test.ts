// Dueña 14-11 — la misma empresa no entra dos veces al banco por tener otra clave
// (Coca-Cola Embonor: una vez por su web, otra por su RUT).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bankItemIdentity,
  createCompanyBankStore,
  isSameCompanyByDomain,
  splitSameDomainDuplicates,
} from '../company-bank-store';
import type { CompanyBankDepositItem } from '../company-bank-types';

const item = (o: { domain: string; fiscal?: string | null; claimDomain?: boolean }): CompanyBankDepositItem => ({
  countryCode: 'CL',
  macroIndustryKey: 'consumer_goods',
  tier: 'ready',
  sourceProvider: 'lusha',
  claims: o.fiscal ? [{ type: 'fiscal', key: o.fiscal }] : [{ type: 'domain', key: o.domain }],
  payload: { kind: 'pipeline_candidate_v1', candidate: { name: 'X', domain: o.domain, countryCode: 'CL' } },
  missingFields: [],
});

describe('identidad de una fila del banco', () => {
  it('lee la web de la clave o del candidato, sin www', () => {
    assert.deepEqual(bankItemIdentity(item({ domain: 'www.embonor.cl', fiscal: 'CL:93281000k' })), {
      domain: 'embonor.cl',
      fiscal: 'CL:93281000k',
    });
    assert.deepEqual(bankItemIdentity(item({ domain: 'embonor.cl' })), { domain: 'embonor.cl', fiscal: null });
  });

  it('misma web = misma empresa, salvo dos RUT distintos (filiales)', () => {
    assert.equal(isSameCompanyByDomain('CL:1', null), true);
    assert.equal(isSameCompanyByDomain(null, null), true);
    assert.equal(isSameCompanyByDomain('CL:1', 'CL:1'), true);
    assert.equal(isSameCompanyByDomain('CL:1', 'CL:2'), false);
  });
});

describe('separar repetidas antes de enviar', () => {
  it('🔴 Embonor: ya en el banco por su web, no vuelve a entrar por su RUT', () => {
    const r = splitSameDomainDuplicates([item({ domain: 'embonor.cl', fiscal: 'CL:93281000k' })], new Map([['embonor.cl', [null]]]));
    assert.equal(r.send.length, 0);
    assert.equal(r.duplicates, 1);
  });

  it('una filial con RUT distinto y la misma web del grupo sí entra', () => {
    const r = splitSameDomainDuplicates([item({ domain: 'grupo.cl', fiscal: 'CL:2' })], new Map([['grupo.cl', ['CL:1']]]));
    assert.equal(r.send.length, 1);
  });

  it('dentro del mismo depósito, la segunda de la misma empresa no se envía', () => {
    const r = splitSameDomainDuplicates([item({ domain: 'a.cl' }), item({ domain: 'a.cl', fiscal: 'CL:9' })], new Map());
    assert.equal(r.send.length, 1);
    assert.equal(r.duplicates, 1);
  });
});

describe('depósito con el cruce por web', () => {
  function fakeClient(rows: unknown[] | null) {
    const sent: unknown[] = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'in']) builder[m] = () => builder;
    builder.or = async () => (rows === null ? { data: null, error: { message: 'boom' } } : { data: rows, error: null });
    const client = {
      from: () => builder,
      rpc: async (_fn: string, args: { p_items: unknown[] }) => {
        sent.push(...args.p_items);
        return { data: { status: 'ok', deposited: args.p_items.length, skipped_claimed: 0, skipped_in_bank: 0, skipped_invalid: 0 }, error: null };
      },
    };
    return { client, sent };
  }

  it('cuenta la repetida como «ya en el banco» y no la envía', async () => {
    const f = fakeClient([{ claim_fiscal: null, claim_domain: 'embonor.cl', cd: 'embonor.cl', ed: null }]);
    const r = await createCompanyBankStore(f.client as never).deposit([
      item({ domain: 'embonor.cl', fiscal: 'CL:93281000k' }),
      item({ domain: 'soprole.cl', fiscal: 'CL:761018124' }),
    ]);
    assert.equal(f.sent.length, 1);
    assert.deepEqual(r, { status: 'ok', deposited: 1, skippedClaimed: 0, skippedInBank: 1, skippedInvalid: 0 });
  });

  it('si la lectura falla, deposita como antes', async () => {
    const f = fakeClient(null);
    const r = await createCompanyBankStore(f.client as never).deposit([item({ domain: 'embonor.cl', fiscal: 'CL:1' })]);
    assert.equal(f.sent.length, 1);
    assert.equal(r.status === 'ok' && r.deposited, 1);
  });
});
