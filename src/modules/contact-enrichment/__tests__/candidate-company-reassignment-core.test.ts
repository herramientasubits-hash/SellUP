// AGENT2A-CANDIDATE-COMPANY-REASSIGN-1 — «Reasignar empresa» en la ficha del candidato.
// Sin red, sin DB: todas las dependencias se inyectan.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyCandidateCompanyReassignment,
  parseCompanyReassignmentSelection,
  pickReassignmentCompany,
  readCandidateCompanyReassignment,
  runReassignCandidateCompany,
  type ReassignCandidateCompanyDeps,
  type ReassignableCandidate,
} from '../candidate-company-reassignment-core';
import { runApproveCandidate, type ApproveDeps, type CandidateRecord } from '../candidate-review-core';
import type { CompanyCandidate } from '../types';

const NOW = '2026-10-06T12:00:00.000Z';

function pizzaCandidate(overrides: Partial<ReassignableCandidate> = {}): ReassignableCandidate {
  return {
    id: 'cand-1',
    status: 'pending_review',
    email: 'juvenal.lavin@pizzapizza.cl',
    enrichment_metadata: {
      company_consistency: {
        status: 'unknown',
        email_domain: 'pizzapizza.cl',
        expected_domain: null,
        organization_name: 'Pizza Pizza',
        organization_domain: 'pizzapizza.cl',
        signals: [],
        review_required: false,
        explanation: '',
      },
    },
    run: {
      account_id: null,
      hubspot_company_id: null,
      company_name: 'Pizza Pizza',
      company_domain: null,
      country_code: 'CL',
    },
    ...overrides,
  };
}

function makeDeps(
  candidate: ReassignableCandidate | null,
  company: CompanyCandidate | null,
  overrides: Partial<ReassignCandidateCompanyDeps> = {},
) {
  const writes: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  const accountCalls: unknown[] = [];
  const deps: ReassignCandidateCompanyDeps = {
    actorId: 'user-1',
    nowIso: NOW,
    loadCandidate: async () => candidate,
    resolveCompany: async () => company,
    resolveOrCreateAccount: async (args) => {
      accountCalls.push(args);
      return { accountId: 'acc-from-hs', outcome: 'created' };
    },
    writeCandidateMetadata: async (id, metadata) => {
      writes.push({ id, metadata });
      return { updated: true };
    },
    ...overrides,
  };
  return { deps, writes, accountCalls };
}

const SELLUP_PIZZA: CompanyCandidate = {
  source: 'sellup',
  sellupAccountId: 'acc-pizza',
  hubspotCompanyId: '123456789',
  name: 'Pizza Pizza Chile',
  domain: 'pizzapizza.cl',
  countryCode: 'CL',
  matchConfidence: 1,
};

const HUBSPOT_PIZZA: CompanyCandidate = {
  source: 'hubspot',
  hubspotCompanyId: '987654321',
  name: 'Pizza Pizza',
  domain: 'pizzapizza.cl',
  countryCode: 'CL',
  matchConfidence: 1,
};

describe('parseCompanyReassignmentSelection', () => {
  it('acepta SellUp por id de cuenta y HubSpot por id numérico', () => {
    assert.deepEqual(parseCompanyReassignmentSelection({ source: 'sellup', sellupAccountId: ' a ' }), {
      source: 'sellup',
      sellupAccountId: 'a',
    });
    assert.deepEqual(
      parseCompanyReassignmentSelection({ source: 'hubspot', hubspotCompanyId: '123' }),
      { source: 'hubspot', hubspotCompanyId: '123' },
    );
  });
  it('rechaza «manual», ids vacíos y HubSpot no numérico', () => {
    assert.equal(parseCompanyReassignmentSelection({ source: 'manual', name: 'x' }), null);
    assert.equal(parseCompanyReassignmentSelection({ source: 'sellup', sellupAccountId: ' ' }), null);
    assert.equal(parseCompanyReassignmentSelection({ source: 'hubspot', hubspotCompanyId: 'abc' }), null);
    assert.equal(parseCompanyReassignmentSelection(null), null);
  });
});

describe('pickReassignmentCompany', () => {
  it('para HubSpot prefiere la cuenta SellUp ya vinculada a ese id', () => {
    const linked = { ...SELLUP_PIZZA, hubspotCompanyId: '987654321' };
    const picked = pickReassignmentCompany({ source: 'hubspot', hubspotCompanyId: '987654321' }, [
      HUBSPOT_PIZZA,
      linked,
    ]);
    assert.equal(picked, linked);
  });
  it('no devuelve una empresa distinta a la seleccionada', () => {
    assert.equal(
      pickReassignmentCompany({ source: 'sellup', sellupAccountId: 'otra' }, [SELLUP_PIZZA]),
      null,
    );
  });
});

describe('runReassignCandidateCompany', () => {
  it('asocia una cuenta SellUp elegida y recalcula la consistencia de empresa', async () => {
    const { deps, writes, accountCalls } = makeDeps(pizzaCandidate(), SELLUP_PIZZA);
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      deps,
    );
    assert.equal(res.ok, true);
    assert.equal(accountCalls.length, 0, 'una cuenta SellUp no pasa por el resolvedor HubSpot');
    assert.equal(writes.length, 1);
    const saved = readCandidateCompanyReassignment(writes[0].metadata);
    assert.ok(saved);
    assert.equal(saved.account_id, 'acc-pizza');
    assert.equal(saved.company_domain, 'pizzapizza.cl');
    assert.equal(saved.account_resolution, 'selected_sellup_account');
    assert.equal(saved.original.company_name, 'Pizza Pizza');
    assert.equal(saved.original.account_id, null);
    const consistency = writes[0].metadata.company_consistency as { status: string };
    assert.equal(consistency.status, 'match');
  });

  it('para una empresa sólo de HubSpot resuelve/crea la cuenta SellUp', async () => {
    const { deps, writes, accountCalls } = makeDeps(pizzaCandidate(), HUBSPOT_PIZZA);
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'hubspot', hubspotCompanyId: '987654321' },
      deps,
    );
    assert.equal(res.ok, true);
    assert.deepEqual(accountCalls, [
      {
        hubspot_company_id: '987654321',
        company_name: 'Pizza Pizza',
        company_domain: 'pizzapizza.cl',
        country_code: 'CL',
      },
    ]);
    const saved = readCandidateCompanyReassignment(writes[0].metadata);
    assert.equal(saved?.account_id, 'acc-from-hs');
    assert.equal(saved?.hubspot_company_id, '987654321');
    assert.equal(saved?.account_resolution, 'created');
  });

  it('bloquea candidatos que ya no están pendientes', async () => {
    const { deps, writes } = makeDeps(pizzaCandidate({ status: 'approved' }), SELLUP_PIZZA);
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      deps,
    );
    assert.deepEqual(res.ok ? null : res.code, 'NOT_PENDING');
    assert.equal(writes.length, 0);
  });

  it('falla cerrado si el servidor no confirma la empresa', async () => {
    const { deps, writes } = makeDeps(pizzaCandidate(), null);
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      deps,
    );
    assert.equal(res.ok ? null : res.code, 'COMPANY_NOT_FOUND');
    assert.equal(writes.length, 0);
  });

  it('una carrera perdida (ya no pending_review al escribir) no se reporta como éxito', async () => {
    const { deps } = makeDeps(pizzaCandidate(), SELLUP_PIZZA, {
      writeCandidateMetadata: async () => ({ updated: false }),
    });
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      deps,
    );
    assert.equal(res.ok ? null : res.code, 'NOT_PENDING');
  });

  it('una segunda reasignación conserva el contexto ORIGINAL del run', async () => {
    const first = makeDeps(pizzaCandidate(), HUBSPOT_PIZZA);
    await runReassignCandidateCompany(
      'cand-1',
      { source: 'hubspot', hubspotCompanyId: '987654321' },
      first.deps,
    );
    const afterFirst = pizzaCandidate({ enrichment_metadata: first.writes[0].metadata });
    const second = makeDeps(afterFirst, SELLUP_PIZZA);
    const res = await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      second.deps,
    );
    assert.equal(res.ok, true);
    const saved = readCandidateCompanyReassignment(second.writes[0].metadata);
    assert.equal(saved?.account_id, 'acc-pizza');
    assert.equal(saved?.original.company_name, 'Pizza Pizza');
    assert.equal(saved?.original.account_id, null);
  });
});

describe('applyCandidateCompanyReassignment', () => {
  it('sin reasignación devuelve el contexto del run tal cual', () => {
    const base = { account_id: null, hubspot_company_id: null, company_name: 'X', company_domain: null };
    assert.equal(applyCandidateCompanyReassignment(base, {}), base);
    assert.equal(applyCandidateCompanyReassignment(base, { company_reassignment: { version: 2 } }), base);
  });
});

describe('aprobación tras reasignar (caso juvenal.lavin@pizzapizza.cl)', () => {
  function candidateRecord(metadata: Record<string, unknown>): CandidateRecord {
    const company = applyCandidateCompanyReassignment(
      { account_id: null, hubspot_company_id: null, company_name: 'Pizza Pizza', company_domain: null, country_code: 'CL' },
      metadata,
    );
    return {
      id: 'cand-1',
      status: 'pending_review',
      full_name: 'Juvenal Lavín',
      first_name: 'Juvenal',
      last_name: 'Lavín',
      title: 'Gerente',
      seniority: null,
      department: null,
      email: 'juvenal.lavin@pizzapizza.cl',
      phone: null,
      linkedin_url: null,
      source: 'apollo',
      enrichment_metadata: metadata,
      enrichment_run_id: 'run-1',
      account_id: company.account_id,
      hubspot_company_id: company.hubspot_company_id,
      company_name: company.company_name,
      company_domain: company.company_domain,
      country_code: company.country_code ?? null,
    };
  }

  function approveDeps(record: CandidateRecord) {
    const approvedWith: string[] = [];
    const runUpdates: string[] = [];
    const deps: ApproveDeps = {
      actorId: 'user-1',
      nowIso: NOW,
      loadCandidate: async () => record,
      loadExistingContacts: async () => [],
      approveTransactionally: async ({ accountId }) => {
        approvedWith.push(accountId);
        return { ok: true, contactId: 'contact-1', alreadyApproved: false };
      },
      updateCandidate: async () => ({}),
      updateRunAccountId: async (runId) => {
        runUpdates.push(runId);
      },
    };
    return { deps, approvedWith, runUpdates };
  }

  it('sin empresa: la aprobación sigue bloqueada (comportamiento previo)', async () => {
    const { deps } = approveDeps(candidateRecord({}));
    const res = await runApproveCandidate('cand-1', deps);
    assert.equal(res.ok, false);
  });

  it('con empresa reasignada: aprueba contra esa cuenta y no toca el run', async () => {
    const { deps: rDeps, writes } = makeDeps(pizzaCandidate(), SELLUP_PIZZA);
    await runReassignCandidateCompany(
      'cand-1',
      { source: 'sellup', sellupAccountId: 'acc-pizza' },
      rDeps,
    );
    const { deps, approvedWith, runUpdates } = approveDeps(candidateRecord(writes[0].metadata));
    const res = await runApproveCandidate('cand-1', deps);
    assert.equal(res.ok, true);
    assert.deepEqual(approvedWith, ['acc-pizza']);
    assert.deepEqual(runUpdates, []);
  });
});
