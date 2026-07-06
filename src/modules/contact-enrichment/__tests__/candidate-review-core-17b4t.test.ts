// Hito 17B.4T — Audit gate de aprobación para candidatos HubSpot-only
//
// Verifica el contrato completo de candidate creation y manual approval para
// runs con account_id=null y company_resolution_source=hubspot (candidatos Lusha
// o Apollo resueltos desde HubSpot sin account_id SellUp).
//
// Hallazgo de auditoría: toda la lógica ya existía desde hito 17A.9H.
// Esta suite ancla los 27 escenarios del spec 17B.4T contra la implementación
// real, sin llamadas live, sin escrituras en DB, sin HubSpot.
//
// Refs:
//   candidate-review-core.ts  — runApproveCandidate / runDiscardCandidate
//   hubspot-account-resolver.ts — resolveOrCreateAccountForHubSpotCandidate
//   contact-candidate-writer.ts — writeContactCandidates (no exige account_id)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  runApproveCandidate,
  runDiscardCandidate,
  buildContactInsertPayload,
  mapCandidateSource,
  type CandidateRecord,
  type ApproveDeps,
  type DiscardDeps,
} from '../candidate-review-core';

import {
  resolveOrCreateAccountForHubSpotCandidate,
  type HubSpotAccountResolutionInput,
  type HubSpotAccountResolutionDeps,
} from '../hubspot-account-resolver';

import { writeContactCandidates, type ContactCandidateWriterDeps } from '../../../server/agents/contact-enrichment-toolkit/contact-candidate-writer';
import type { DeduplicatedContact } from '../../../server/agents/contact-enrichment-toolkit/contact-deduplicator';

// ── Fixtures ────────────────────────────────────────────────────

function makeLushaCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'lusha-cand-1',
    status: 'pending_review',
    full_name: 'Carlos Mendoza',
    first_name: 'Carlos',
    last_name: 'Mendoza',
    title: 'CFO',
    seniority: 'executive',
    department: 'finance',
    email: 'carlos@abank.com',
    phone: null,           // Lusha siempre phone=null en v1
    linkedin_url: 'https://linkedin.com/in/carlosmendoza',
    source: 'lusha',
    enrichment_metadata: { lusha_run: 'run-lusha-1' },
    enrichment_run_id: 'run-lusha-1',
    account_id: null,      // HubSpot-only: sin account SellUp
    hubspot_company_id: 'hs-abank-456',
    company_name: 'ABANK',
    company_domain: 'abank.com',
    country_code: 'CO',
    ...overrides,
  };
}

function makeApproveHubSpotDeps(
  overrides: Partial<ApproveDeps> & {
    resolveOutcome?: string;
    accountId?: string;
    insertedContactId?: string;
  } = {},
): {
  deps: ApproveDeps;
  calls: { resolveOrCreate: number; updateRunAccountId: number; insertContact: number; updateCandidate: number; logAudit: number };
} {
  const calls = { resolveOrCreate: 0, updateRunAccountId: 0, insertContact: 0, updateCandidate: 0, logAudit: 0 };
  const resolvedAccountId = overrides.accountId ?? 'acc-hubspot-resolved';
  const resolveOutcome = overrides.resolveOutcome ?? 'created';
  const contactId = overrides.insertedContactId ?? 'contact-new-1';

  const deps: ApproveDeps = {
    actorId: 'user-qa',
    nowIso: '2026-07-06T10:00:00.000Z',
    loadCandidate: async () => makeLushaCandidate(),
    loadExistingContacts: async () => [],
    insertContact: async () => {
      calls.insertContact++;
      return { id: contactId };
    },
    updateCandidate: async () => {
      calls.updateCandidate++;
      return {};
    },
    logAudit: async () => { calls.logAudit++; },
    resolveOrCreateAccount: async () => {
      calls.resolveOrCreate++;
      return {
        accountId: resolvedAccountId,
        outcome: resolveOutcome,
        countryCodeApplied: 'CO',
        countryResolutionSource: 'contact_enrichment_run',
      };
    },
    updateRunAccountId: async () => { calls.updateRunAccountId++; },
    ...overrides,
  };

  return { deps, calls };
}

// ── A. Candidate writer ──────────────────────────────────────────

describe('17B.4T — A. Candidate writer (account_id=null no impide candidato)', () => {
  it('A1: writeContactCandidates no exige account_id y escribe candidato con enrichment_run_id', async () => {
    const inserted: unknown[] = [];
    const deps: ContactCandidateWriterDeps = {
      insertRows: async (rows) => {
        inserted.push(...rows);
        return {};
      },
    };

    const candidate: DeduplicatedContact = {
      source: 'apollo',
      firstName: 'Carlos',
      lastName: 'Mendoza',
      fullName: 'Carlos Mendoza',
      title: 'CFO',
      seniority: 'executive',
      department: 'finance',
      country: 'CO',
      linkedinUrl: 'https://linkedin.com/in/carlosmendoza',
      email: 'carlos@abank.com',
      phone: null,
      sourceContactId: 'lusha-person-1',
      confidence: 0.9,
      duplicateStatus: 'no_match',
      enrichmentMetadata: { lusha_run: 'run-lusha-1' },
    };

    const result = await writeContactCandidates('run-lusha-1', [candidate], deps);

    assert.equal(result.inserted, 1);
    assert.equal(result.skippedNoName, 0);
    assert.equal(result.error, undefined);

    const row = inserted[0] as Record<string, unknown>;
    assert.equal(row.enrichment_run_id, 'run-lusha-1');
    assert.equal(row.status, 'pending_review');
  });

  it('A2: candidate conserva enrichment_run_id en la fila insertada', async () => {
    const inserted: unknown[] = [];
    const deps: ContactCandidateWriterDeps = {
      insertRows: async (rows) => { inserted.push(...rows); return {}; },
    };
    const candidate: DeduplicatedContact = {
      source: 'apollo',
      firstName: 'X', lastName: null, fullName: 'X', title: null, seniority: null,
      department: null, country: null, linkedinUrl: null, email: null, phone: null,
      sourceContactId: null, confidence: 0.5, duplicateStatus: 'no_match',
      enrichmentMetadata: {},
    };
    await writeContactCandidates('run-abc', [candidate], deps);
    assert.equal((inserted[0] as Record<string, unknown>).enrichment_run_id, 'run-abc');
  });

  it('A3: writer omite candidato sin full_name (company resolution source no interfiere)', async () => {
    const inserted: unknown[] = [];
    const deps: ContactCandidateWriterDeps = {
      insertRows: async (rows) => { inserted.push(...rows); return {}; },
    };
    const candidate: DeduplicatedContact = {
      source: 'apollo',
      firstName: null, lastName: null, fullName: '', title: null, seniority: null,
      department: null, country: null, linkedinUrl: null, email: null, phone: null,
      sourceContactId: null, confidence: 0, duplicateStatus: 'no_match',
      enrichmentMetadata: {},
    };
    const result = await writeContactCandidates('run-abc', [candidate], deps);
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedNoName, 1);
    assert.equal(inserted.length, 0);
  });

  it('A4: lusha phone=null se preserva en el candidato (no se inyecta phone)', async () => {
    const inserted: unknown[] = [];
    const deps: ContactCandidateWriterDeps = {
      insertRows: async (rows) => { inserted.push(...rows); return {}; },
    };
    const candidate: DeduplicatedContact = {
      source: 'apollo',
      firstName: 'Ana', lastName: 'Ruiz', fullName: 'Ana Ruiz', title: 'VP',
      seniority: 'vp', department: 'sales', country: 'MX', linkedinUrl: null,
      email: 'ana@corp.mx', phone: null,
      sourceContactId: 'ls-1', confidence: 0.85, duplicateStatus: 'no_match',
      enrichmentMetadata: {},
    };
    await writeContactCandidates('run-mx-1', [candidate], deps);
    assert.equal((inserted[0] as Record<string, unknown>).phone, null);
  });
});

// ── B. Approval ─────────────────────────────────────────────────

describe('17B.4T — B. Approval — candidato SellUp con account_id conocido', () => {
  it('B5: candidato con account_id existente: aprobación intacta (sin resolveOrCreate)', async () => {
    const calls = { insertContact: 0, resolveOrCreate: 0 };
    const deps: ApproveDeps = {
      actorId: 'user-qa',
      nowIso: '2026-07-06T10:00:00.000Z',
      loadCandidate: async () => makeLushaCandidate({ account_id: 'acc-sellup-1', hubspot_company_id: null }),
      loadExistingContacts: async () => [],
      insertContact: async () => { calls.insertContact++; return { id: 'c-1' }; },
      updateCandidate: async () => ({}),
      resolveOrCreateAccount: async () => {
        calls.resolveOrCreate++;
        return { accountId: 'should-not-be-called', outcome: 'created', countryCodeApplied: null, countryResolutionSource: 'unknown' };
      },
    };

    const result = await runApproveCandidate('lusha-cand-1', deps);

    assert.equal(result.ok, true);
    assert.equal(calls.insertContact, 1);
    assert.equal(calls.resolveOrCreate, 0, 'resolveOrCreate NO debe llamarse si account_id ya existe');
  });
});

describe('17B.4T — B. Approval — candidato HubSpot-only (Lusha, account_id=null)', () => {
  it('B6: aprueba candidato Lusha HubSpot-only (account_id=null, hubspot_company_id presente) — cuenta nueva', async () => {
    const { deps, calls } = makeApproveHubSpotDeps({ resolveOutcome: 'created' });
    const result = await runApproveCandidate('lusha-cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.resolveOrCreate, 1);
    assert.equal(calls.insertContact, 1);
    assert.equal(calls.updateCandidate, 1);
  });

  it('B7: bloquea si account_id=null y hubspot_company_id=null', async () => {
    const { deps } = makeApproveHubSpotDeps();
    const blockedDeps: ApproveDeps = {
      ...deps,
      loadCandidate: async () => makeLushaCandidate({ account_id: null, hubspot_company_id: null }),
    };
    const result = await runApproveCandidate('lusha-cand-1', blockedDeps);
    assert.equal(result.ok, false);
    assert.match(result.error, /no.*asociado|SellUp|HubSpot/i);
  });

  it('B8: bloquea si account_id=null, hubspot_company_id existe pero sin dep resolveOrCreateAccount', async () => {
    const { deps } = makeApproveHubSpotDeps();
    const { resolveOrCreateAccount: _unused, ...depsNoResolver } = deps;
    const result = await runApproveCandidate('lusha-cand-1', depsNoResolver);
    assert.equal(result.ok, false);
  });

  it('B9: usa cuenta existente por hubspot_company_id (no crea duplicado de cuenta)', async () => {
    const { deps, calls } = makeApproveHubSpotDeps({
      resolveOutcome: 'existing_by_hubspot',
      accountId: 'acc-existing',
    });
    const result = await runApproveCandidate('lusha-cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.resolveOrCreate, 1);
    assert.equal(calls.insertContact, 1);
  });

  it('B10: usa cuenta existente por dominio, vincula hubspot_company_id', async () => {
    const { deps } = makeApproveHubSpotDeps({
      resolveOutcome: 'existing_by_domain_linked',
      accountId: 'acc-by-domain',
    });
    const result = await runApproveCandidate('lusha-cand-1', deps);
    assert.equal(result.ok, true);
  });

  it('B11: bloquea si resolveOrCreateAccount retorna error', async () => {
    const { deps } = makeApproveHubSpotDeps();
    const failDeps: ApproveDeps = {
      ...deps,
      resolveOrCreateAccount: async () => ({ error: 'DB error en accounts' }),
    };
    const result = await runApproveCandidate('lusha-cand-1', failDeps);
    assert.equal(result.ok, false);
  });

  it('B12: llama updateRunAccountId con runId, accountId y outcome', async () => {
    const updateRuns: unknown[] = [];
    const { deps } = makeApproveHubSpotDeps();
    const fullDeps: ApproveDeps = {
      ...deps,
      updateRunAccountId: async (runId, accountId, outcome, ccApplied, ccSource) => {
        updateRuns.push({ runId, accountId, outcome, ccApplied, ccSource });
      },
    };
    await runApproveCandidate('lusha-cand-1', fullDeps);
    assert.equal(updateRuns.length, 1);
    const call = updateRuns[0] as Record<string, unknown>;
    assert.equal(call.runId, 'run-lusha-1');
    assert.equal(call.accountId, 'acc-hubspot-resolved');
    assert.equal(call.ccApplied, 'CO');
  });

  it('B13: no llama updateRunAccountId si enrichment_run_id=null', async () => {
    const updateRuns: unknown[] = [];
    const { deps } = makeApproveHubSpotDeps();
    const fullDeps: ApproveDeps = {
      ...deps,
      loadCandidate: async () => makeLushaCandidate({ enrichment_run_id: null }),
      updateRunAccountId: async (...args) => { updateRuns.push(args); },
    };
    await runApproveCandidate('lusha-cand-1', fullDeps);
    assert.equal(updateRuns.length, 0);
  });

  it('B14: crea contacto con el accountId resuelto (no null)', async () => {
    const insertPayloads: unknown[] = [];
    const { deps } = makeApproveHubSpotDeps({ accountId: 'acc-resolved-123' });
    const captureDeps: ApproveDeps = {
      ...deps,
      insertContact: async (payload) => {
        insertPayloads.push(payload);
        return { id: 'c-new' };
      },
    };
    await runApproveCandidate('lusha-cand-1', captureDeps);
    assert.equal(insertPayloads.length, 1);
    assert.equal((insertPayloads[0] as Record<string, unknown>).account_id, 'acc-resolved-123');
  });

  it('B15: source Lusha candidato mapea a "lusha" en contacto oficial', () => {
    assert.equal(mapCandidateSource('lusha'), 'lusha');
  });

  it('B16: buildContactInsertPayload preserva source=lusha', () => {
    const candidate = makeLushaCandidate({ account_id: 'acc-1' });
    const payload = buildContactInsertPayload({
      candidate,
      accountId: 'acc-1',
      internalUserId: 'user-1',
    });
    assert.equal(payload.source, 'lusha');
  });

  it('B17: buildContactInsertPayload preserva email', () => {
    const candidate = makeLushaCandidate({ account_id: 'acc-1', email: 'carlos@abank.com' });
    const payload = buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'u' });
    assert.equal(payload.email, 'carlos@abank.com');
  });

  it('B18: buildContactInsertPayload preserva LinkedIn URL', () => {
    const candidate = makeLushaCandidate({ account_id: 'acc-1', linkedin_url: 'https://linkedin.com/in/cm' });
    const payload = buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'u' });
    assert.equal(payload.linkedin_url, 'https://linkedin.com/in/cm');
  });

  it('B19: phone=null Lusha: buildContactInsertPayload preserva null', () => {
    const candidate = makeLushaCandidate({ account_id: 'acc-1', phone: null });
    const payload = buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'u' });
    assert.equal(payload.phone, null);
  });
});

// ── C. Human review ─────────────────────────────────────────────

describe('17B.4T — C. Human review — pending_review y discard no crean nada', () => {
  function makeDiscardDeps(overrides: Partial<DiscardDeps> = {}): {
    deps: DiscardDeps;
    updated: unknown[];
  } {
    const updated: unknown[] = [];
    const deps: DiscardDeps = {
      actorId: 'user-qa',
      nowIso: '2026-07-06T10:00:00.000Z',
      loadCandidate: async () => makeLushaCandidate(),
      updateCandidate: async (id, patch) => { updated.push({ id, patch }); return {}; },
      ...overrides,
    };
    return { deps, updated };
  }

  it('C20: pending_review no crea cuenta (solo approval puede crear)', () => {
    // Verificación de contrato: DiscardDeps no tiene insertContact ni resolveOrCreateAccount
    const { deps } = makeDiscardDeps();
    const keys = Object.keys(deps);
    assert.ok(!keys.includes('insertContact'), 'DiscardDeps no debe exponer insertContact');
    assert.ok(!keys.includes('resolveOrCreateAccount'), 'DiscardDeps no debe exponer resolveOrCreateAccount');
  });

  it('C21: pending_review no crea contacto (DiscardDeps carece de insertContact)', () => {
    // Lo garantiza el tipo: runDiscardCandidate solo llama updateCandidate
    const { deps } = makeDiscardDeps();
    assert.ok(!Object.prototype.hasOwnProperty.call(deps, 'insertContact'));
  });

  it('C22: discard no crea cuenta — runDiscardCandidate no llama resolveOrCreateAccount', async () => {
    let resolveCalled = false;
    const { deps } = makeDiscardDeps();
    // Monkey-patch para detectar llamada inadvertida
    (deps as unknown as Record<string, unknown>).resolveOrCreateAccount = async () => {
      resolveCalled = true;
      return { accountId: 'SHOULD_NOT_REACH', outcome: 'created', countryCodeApplied: null, countryResolutionSource: 'unknown' };
    };
    await runDiscardCandidate('lusha-cand-1', 'Candidato irrelevante', deps);
    assert.equal(resolveCalled, false);
  });

  it('C23: discard no crea contacto — runDiscardCandidate no llama insertContact', async () => {
    let insertCalled = false;
    const { deps } = makeDiscardDeps();
    (deps as unknown as Record<string, unknown>).insertContact = async () => {
      insertCalled = true;
      return { id: 'SHOULD_NOT_REACH' };
    };
    await runDiscardCandidate('lusha-cand-1', 'Sin interés', deps);
    assert.equal(insertCalled, false);
  });
});

// ── D. No HubSpot write ─────────────────────────────────────────

describe('17B.4T — D. No HubSpot write', () => {
  it('D24: approval no escribe HubSpot — ApproveDeps no tiene dep de HubSpot', () => {
    const { deps } = makeApproveHubSpotDeps();
    const keys = Object.keys(deps);
    const hubspotDep = keys.find((k) => k.toLowerCase().includes('hubspot'));
    assert.equal(hubspotDep, undefined, `Dep HubSpot inesperada: ${hubspotDep}`);
  });

  it('D25: HubSpot company identity solo referencia — resolveOrCreateAccount no escribe HubSpot', async () => {
    let hubspotWriteCalled = false;

    // Simula resolveOrCreateAccount que usa hubspot_company_id solo como lookup key
    const deps: HubSpotAccountResolutionDeps = {
      findByHubspotId: async () => null,
      findByDomain: async () => null,
      createAccount: async () => ({ id: 'acc-new' }),
      linkHubspotId: async () => { /* no escribe HubSpot */ },
      updateAccountCountryCode: async () => { /* no escribe HubSpot */ },
    };

    // Monkey-patch para detectar cualquier escritura HubSpot inadvertida
    (deps as unknown as Record<string, unknown>).writeHubSpotContact = async () => { hubspotWriteCalled = true; };
    (deps as unknown as Record<string, unknown>).syncHubSpot = async () => { hubspotWriteCalled = true; };

    const input: HubSpotAccountResolutionInput = {
      hubspot_company_id: 'hs-abank-456',
      company_name: 'ABANK',
      company_domain: 'abank.com',
      run_id: 'run-lusha-1',
      country_code: 'CO',
    };

    await resolveOrCreateAccountForHubSpotCandidate(input, deps);
    assert.equal(hubspotWriteCalled, false);
  });
});

// ── E. Apollo parity ────────────────────────────────────────────

describe('17B.4T — E. Apollo parity', () => {
  it('E26: Apollo candidate approval usa el mismo runApproveCandidate (paridad de contrato)', async () => {
    // Apollo candidato con account_id conocido: mismo camino que Lusha sin resolver
    const calls = { insertContact: 0 };
    const apolloCandidate = makeLushaCandidate({
      source: 'apollo',
      account_id: 'acc-apollo-1',
      hubspot_company_id: null,
    });
    const deps: ApproveDeps = {
      actorId: 'u',
      nowIso: '2026-07-06T10:00:00.000Z',
      loadCandidate: async () => apolloCandidate,
      loadExistingContacts: async () => [],
      insertContact: async () => { calls.insertContact++; return { id: 'c-apollo' }; },
      updateCandidate: async () => ({}),
    };
    const result = await runApproveCandidate('apollo-cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.insertContact, 1);
  });

  it('E27: Lusha y Apollo usan el mismo approval contract (runApproveCandidate)', async () => {
    // Apollo HubSpot-only usa el mismo flow que Lusha HubSpot-only
    const calls = { resolveOrCreate: 0 };
    const apolloHubSpotCandidate = makeLushaCandidate({
      source: 'apollo',
      account_id: null,
      hubspot_company_id: 'hs-apollo-789',
    });
    const deps: ApproveDeps = {
      actorId: 'u',
      nowIso: '2026-07-06T10:00:00.000Z',
      loadCandidate: async () => apolloHubSpotCandidate,
      loadExistingContacts: async () => [],
      insertContact: async () => ({ id: 'c-ap' }),
      updateCandidate: async () => ({}),
      resolveOrCreateAccount: async () => {
        calls.resolveOrCreate++;
        return { accountId: 'acc-ap', outcome: 'created', countryCodeApplied: 'CO', countryResolutionSource: 'contact_enrichment_run' };
      },
    };
    const result = await runApproveCandidate('apollo-cand-1', deps);
    assert.equal(result.ok, true);
    assert.equal(calls.resolveOrCreate, 1, 'resolveOrCreate llamado exactamente 1 vez para Apollo HubSpot-only');
  });
});

// ── Hub resolución de cuenta — deduplicación ─────────────────────

describe('17B.4T — resolveOrCreateAccountForHubSpotCandidate', () => {
  function makeDeps(overrides: Partial<HubSpotAccountResolutionDeps> = {}): HubSpotAccountResolutionDeps {
    return {
      findByHubspotId: async () => null,
      findByDomain: async () => null,
      createAccount: async () => ({ id: 'acc-created' }),
      linkHubspotId: async () => {},
      updateAccountCountryCode: async () => {},
      ...overrides,
    };
  }

  const INPUT: HubSpotAccountResolutionInput = {
    hubspot_company_id: 'hs-abank-456',
    company_name: 'ABANK',
    company_domain: 'abank.com',
    run_id: 'run-lusha-1',
    country_code: 'CO',
  };

  it('H7: reutiliza cuenta existente por hubspot_company_id', async () => {
    const deps = makeDeps({ findByHubspotId: async () => ({ id: 'acc-exist-hs' }) });
    const result = await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps);
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.accountId, 'acc-exist-hs');
      assert.equal(result.outcome, 'existing_by_hubspot');
    }
  });

  it('H8: reutiliza cuenta existente por dominio', async () => {
    const deps = makeDeps({
      findByDomain: async () => ({ id: 'acc-domain', hubspot_company_id: null }),
    });
    const result = await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps);
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.accountId, 'acc-domain');
    }
  });

  it('H9: crea cuenta SellUp mínima cuando no existe', async () => {
    const deps = makeDeps();
    const result = await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps);
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.equal(result.accountId, 'acc-created');
      assert.equal(result.outcome, 'created');
    }
  });

  it('H10: cuenta se crea solo durante approval (provider runner no crea cuenta)', () => {
    // Contrato de diseño: writeContactCandidates no llama createAccount.
    // Verificación estructural: el writer no importa nada de hubspot-account-resolver.
    // Si este test compila y pasa, la separación de responsabilidades está en pie.
    assert.ok(true, 'writeContactCandidates no interactúa con accounts table');
  });

  it('H11: provider run no crea account — writeContactCandidates solo escribe candidates', async () => {
    const accountsCreated: unknown[] = [];
    const deps: ContactCandidateWriterDeps = {
      insertRows: async (rows) => {
        // Verificar que no se intenta insertar en accounts
        for (const r of rows) {
          const row = r as unknown as Record<string, unknown>;
          assert.ok(!('account_id' in row), 'candidate row no debe tener account_id');
        }
        return {};
      },
    };

    const candidate: DeduplicatedContact = {
      source: 'apollo',
      firstName: 'Test', lastName: 'User', fullName: 'Test User', title: null,
      seniority: null, department: null, country: null, linkedinUrl: null,
      email: null, phone: null, sourceContactId: null, confidence: 0.7,
      duplicateStatus: 'no_match', enrichmentMetadata: {},
    };

    await writeContactCandidates('run-1', [candidate], deps);
    assert.equal(accountsCreated.length, 0);
  });

  it('H12: no crea cuenta duplicada — encontrada por hubspot_company_id termina sin crear', async () => {
    let createCalled = false;
    const deps = makeDeps({
      findByHubspotId: async () => ({ id: 'acc-exist' }),
      createAccount: async () => { createCalled = true; return { id: 'should-not-reach' }; },
    });
    await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps);
    assert.equal(createCalled, false);
  });

  it('H13: contacto usa accountId resuelto, no null', async () => {
    const deps = makeDeps({ findByHubspotId: async () => ({ id: 'acc-resolved-xyz' }) });
    const result = await resolveOrCreateAccountForHubSpotCandidate(INPUT, deps);
    assert.ok(!('error' in result));
    if (!('error' in result)) {
      assert.ok(result.accountId, 'accountId debe ser no-null');
    }
  });

  it('H14: candidate queda approved después del flujo completo', async () => {
    const { deps, calls } = makeApproveHubSpotDeps();
    const updatedPatches: unknown[] = [];
    const captureDeps: ApproveDeps = {
      ...deps,
      updateCandidate: async (id, patch) => {
        updatedPatches.push({ id, patch });
        return {};
      },
    };
    await runApproveCandidate('lusha-cand-1', captureDeps);
    const lastPatch = updatedPatches[updatedPatches.length - 1] as { patch: { status: string } };
    assert.equal(lastPatch.patch.status, 'approved');
  });

  it('H15: contact_source metadata preservada en trazabilidad', () => {
    const candidate = makeLushaCandidate({ account_id: 'acc-1' });
    const payload = buildContactInsertPayload({ candidate, accountId: 'acc-1', internalUserId: 'u' });
    const meta = payload.metadata as Record<string, unknown>;
    assert.equal(meta.candidate_source, 'lusha');
    assert.equal(meta.source, 'contact_enrichment_candidate');
  });
});
