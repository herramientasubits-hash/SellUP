import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleSameCompanyAccount,
  runContactBankStage,
  sameCompanyDomainSpellings,
  type ContactBankAccount,
  type ContactBankEntriesQuery,
  type ContactBankStageDeps,
} from '../contact-bank-stage.server';
import type { ContactBankCandidateRow, ContactBankEntry } from '../contact-bank-core';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function account(over: Partial<ContactBankAccount> = {}): ContactBankAccount {
  return {
    id: 'acc-new',
    ownerId: 'seller-1',
    archivedAt: null,
    taxIdentifier: '900123456',
    countryCode: 'CO',
    domain: 'acme.co',
    hubspotCompanyId: null,
    ...over,
  };
}

function entry(over: Partial<ContactBankEntry> = {}): ContactBankEntry {
  return {
    origin: 'contact',
    originId: 'contact-1',
    originAccountId: 'acc-old',
    source: 'manual',
    sourceContactId: null,
    apolloPersonId: null,
    hubspotContactId: null,
    firstName: 'Ana',
    lastName: 'López',
    fullName: 'Ana López',
    title: 'Directora de Talento Humano',
    seniority: null,
    department: null,
    country: null,
    linkedinUrl: null,
    email: 'ana@acme.co',
    confidence: null,
    foundAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function harness(over: Partial<ContactBankStageDeps> = {}) {
  const calls = { inserted: [] as ContactBankCandidateRow[], entriesQuery: null as ContactBankEntriesQuery | null, dncAccounts: [] as string[] };
  const deps: ContactBankStageDeps = {
    loadRunRef: async () => ({ accountId: 'acc-new', companyDomain: 'https://www.acme.co', hubspotCompanyId: null }),
    loadAccount: async () => account(),
    findSameCompanyAccounts: async () => [account({ id: 'acc-old', archivedAt: '2026-09-01T00:00:00.000Z', ownerId: 'seller-2' })],
    loadEntries: async (query) => {
      calls.entriesQuery = query;
      return [entry()];
    },
    loadKnown: async () => [],
    loadDoNotContact: async (ids) => {
      calls.dncAccounts = ids;
      return [];
    },
    loadSuppressedKeys: async () => new Set(),
    insertRows: async (_attemptId, rows) => {
      calls.inserted.push(...rows);
      return {};
    },
    countRunRowsWithEmail: async () => calls.inserted.filter((r) => r.email).length,
    now: () => NOW,
    ...over,
  };
  return { deps, calls };
}

describe('Banco de contactos — qué fichas son «la misma compañía»', () => {
  const current = account();
  it('una ficha archivada cuenta aunque fuera de otro vendedor (la compañía volvió a entrar)', () => {
    assert.equal(isEligibleSameCompanyAccount(account({ id: 'x', archivedAt: '2026-01-01', ownerId: 'seller-2' }), current), true);
  });
  it('una ficha activa del mismo responsable cuenta (duplicado)', () => {
    assert.equal(isEligibleSameCompanyAccount(account({ id: 'x' }), current), true);
  });
  it('NUNCA la ficha activa de otro vendedor: una empresa, un vendedor', () => {
    assert.equal(isEligibleSameCompanyAccount(account({ id: 'x', ownerId: 'seller-2' }), current), false);
  });
  it('la propia ficha no cuenta', () => {
    assert.equal(isEligibleSameCompanyAccount(current, current), false);
  });
  it('las grafías del dominio salen de la ficha y de la corrida, sin repetir', () => {
    assert.deepEqual(
      sameCompanyDomainSpellings(account({ domain: 'acme.co' }), { accountId: 'a', companyDomain: 'https://www.ACME.co/', hubspotCompanyId: null }).sort(),
      ['acme.co', 'https://www.acme.co/', 'www.acme.co'].sort(),
    );
  });
});

describe('Banco de contactos — etapa', () => {
  it('trae los contactos de la ficha archivada y deja los bloqueos de TODAS las fichas', async () => {
    const { deps, calls } = harness();
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status, 'done');
    assert.equal(result.inserted, 1);
    assert.equal(calls.inserted[0].full_name, 'Ana López');
    assert.deepEqual(calls.entriesQuery?.siblingAccountIds, ['acc-old']);
    assert.equal(calls.entriesQuery?.ownerId, 'seller-1');
    assert.deepEqual(calls.dncAccounts, ['acc-new', 'acc-old']);
    // 1 con correo: no basta, Apollo debe correr.
    assert.equal(result.status === 'done' && result.satisfied, false);
  });

  it('descarta la ficha activa de otro vendedor antes de leer nada de ella', async () => {
    const { deps, calls } = harness({
      findSameCompanyAccounts: async () => [account({ id: 'acc-rival', ownerId: 'seller-2' })],
    });
    await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.deepEqual(calls.entriesQuery?.siblingAccountIds, []);
  });

  it('basta con 3 relevantes con correo en la corrida, contando lo que dejó HubSpot', async () => {
    const { deps } = harness({ countRunRowsWithEmail: async () => 3 });
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status === 'done' && result.satisfied, true);
  });

  it('si el banco no aportó nada, no se atribuye el mérito aunque la corrida ya tenga 3', async () => {
    const { deps } = harness({ loadEntries: async () => [], countRunRowsWithEmail: async () => 5 });
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status, 'done');
    assert.equal(result.satisfied, false);
    assert.equal(result.inserted, 0);
  });

  it('privacidad falla CERRADO: si no se pueden leer las supresiones, no inserta nada', async () => {
    const { deps, calls } = harness({
      loadSuppressedKeys: async () => {
        throw new Error('timeout');
      },
    });
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status, 'error');
    assert.equal(calls.inserted.length, 0);
  });

  it('la búsqueda falla ABIERTO: un error de lectura o de escritura devuelve «no satisfecho»', async () => {
    for (const over of [
      { findSameCompanyAccounts: async () => { throw new Error('db'); } },
      { insertRows: async () => ({ error: 'insert failed' }) },
    ] as Partial<ContactBankStageDeps>[]) {
      const { deps } = harness(over);
      const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
      assert.equal(result.status, 'error');
      assert.equal(result.satisfied, false);
    }
  });

  it('sin ficha de SellUp no hace nada', async () => {
    const { deps, calls } = harness({ loadRunRef: async () => ({ accountId: null, companyDomain: 'acme.co', hubspotCompanyId: '1' }) });
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status, 'no_account');
    assert.equal(calls.entriesQuery, null);
  });

  it('sin fichas hermanas ni dominio no consulta contactos', async () => {
    const { deps, calls } = harness({
      loadAccount: async () => account({ domain: null }),
      loadRunRef: async () => ({ accountId: 'acc-new', companyDomain: null, hubspotCompanyId: null }),
      findSameCompanyAccounts: async () => [],
    });
    const result = await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(result.status, 'no_same_company_accounts');
    assert.equal(calls.entriesQuery, null);
  });

  it('lee sólo lo encontrado en los últimos 180 días', async () => {
    const { deps, calls } = harness();
    await runContactBankStage({ attemptId: 'attempt-1' }, deps);
    assert.equal(calls.entriesQuery?.since, '2026-04-23T12:00:00.000Z');
  });
});
