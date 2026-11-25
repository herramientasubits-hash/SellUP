import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPLOYMENT_SWEEP_AI_MIN_REMAINING_MS,
  apolloPersonMatchesCandidate,
  needsEmploymentSweep,
  runEmploymentSweep,
  type EmploymentSweepApolloPatch,
  type EmploymentSweepCandidate,
  type EmploymentSweepDeps,
} from '../hubspot-employment-sweep-core';
import type { IdentityLookup, IdentityLookupQuery } from '../candidate-identity-completion-core';
import type { CurrentEmploymentStatus } from '../current-employment-check';

const NOW = '2026-11-25T21:00:00.000Z';

function candidate(overrides: Partial<EmploymentSweepCandidate> = {}): EmploymentSweepCandidate {
  return {
    id: 'cand-1',
    email: 'bernardo@colinealcorp.test',
    linkedinUrl: null,
    firstName: 'Bernardo',
    lastName: 'Urgiles',
    title: 'Coordinador de RRHH',
    apolloPersonId: null,
    companyName: 'Colineal Corp',
    companyDomain: 'colinealcorp.com',
    enrichmentMetadata: { hubspot_first: true },
    ...overrides,
  };
}

function found(orgName: string, title: string, lastName = 'Urgiles'): IdentityLookup {
  return {
    kind: 'found',
    person: {
      id: 'apollo-1',
      firstName: 'Bernardo',
      lastName,
      linkedinUrl: null,
      email: null,
      currentEmployment: {
        has_history: true,
        roles: [{ organization_id: 'org-x', organization_name: orgName, title, start_date: '2025-07-01' }],
        organization: { id: 'org-x', name: orgName, domain: null },
      },
    },
    usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: 1, status: 'success', results_returned: 1 }],
  };
}

interface Harness {
  deps: EmploymentSweepDeps;
  apolloQueries: IdentityLookupQuery[];
  aiCalls: string[];
  persisted: Map<string, EmploymentSweepApolloPatch>;
  usageLogs: number;
}

function harness(
  candidates: EmploymentSweepCandidate[],
  options: {
    apollo?: (q: IdentityLookupQuery) => IdentityLookup;
    ai?: (id: string) => CurrentEmploymentStatus | null;
    apolloAvailable?: boolean;
    remainingMs?: number;
  } = {},
): Harness {
  const h: Harness = { deps: undefined as unknown as EmploymentSweepDeps, apolloQueries: [], aiCalls: [], persisted: new Map(), usageLogs: 0 };
  h.deps = {
    loadCandidates: async () => candidates,
    apolloAvailable: async () => options.apolloAvailable ?? true,
    lookupApollo: async (q) => {
      h.apolloQueries.push(q);
      return options.apollo ? options.apollo(q) : { kind: 'not_found', usage: [] };
    },
    logApolloUsage: async () => {
      h.usageLogs += 1;
    },
    persistApollo: async (id, patch) => {
      h.persisted.set(id, patch);
    },
    verifyWithAi: async (id) => {
      h.aiCalls.push(id);
      return options.ai ? options.ai(id) : 'unknown';
    },
    nowIso: () => NOW,
    nowMs: () => 0,
    deadlineMs: options.remainingMs ?? 200_000,
  };
  return h;
}

describe('runEmploymentSweep (Colineal 25-11: «Apollo y luego IA»)', () => {
  it('Apollo dice que trabaja en otra empresa ⇒ queda marcado y no se gasta IA', async () => {
    const h = harness([candidate()], { apollo: () => found('GO CORP', 'Head of Human Resources') });
    const summary = await runEmploymentSweep(h.deps);
    assert.equal(summary.left, 1);
    assert.equal(summary.apolloChecks, 1);
    assert.equal(h.aiCalls.length, 0);
    assert.equal(h.usageLogs, 1);
    const patch = h.persisted.get('cand-1');
    const check = patch?.enrichment_metadata.current_employment as { status: string; current_company: string };
    assert.equal(check.status, 'other_company');
    assert.equal(check.current_company, 'GO CORP');
    // El cargo de HubSpot NO se cambia por el de otra empresa; sí se guarda el id de Apollo.
    assert.equal(patch?.title, undefined);
    assert.equal(patch?.apollo_person_id, 'apollo-1');
    // Nunca pide correos (ni teléfonos).
    assert.equal(h.apolloQueries[0].wantsEmail, false);
    assert.equal(h.apolloQueries[0].channel, 'email');
  });

  it('sigue en la empresa aunque Apollo la escriba pegada ⇒ confirmado', async () => {
    const h = harness([candidate({ title: 'Head of Human Resources' })], {
      apollo: () => found('ColinealCorp', 'Head of Human Resources'),
    });
    const summary = await runEmploymentSweep(h.deps);
    assert.equal(summary.confirmed, 1);
    assert.equal(summary.left, 0);
  });

  it('Apollo no lo conoce ⇒ verifica con IA', async () => {
    const h = harness([candidate()], { ai: () => 'other_company' });
    const summary = await runEmploymentSweep(h.deps);
    assert.deepEqual(h.aiCalls, ['cand-1']);
    assert.equal(summary.left, 1);
    assert.equal(summary.aiChecks, 1);
    assert.equal(h.persisted.size, 0);
  });

  it('Apollo devuelve a OTRA persona (otro apellido) ⇒ no se usa y pasa a la IA', async () => {
    const h = harness([candidate()], { apollo: () => found('GO CORP', 'Gerente', 'Pérez'), ai: () => 'confirmed' });
    const summary = await runEmploymentSweep(h.deps);
    assert.equal(h.persisted.size, 0);
    assert.equal(summary.confirmed, 1);
  });

  it('sin correo ni LinkedIn no se llama a Apollo; sin cuota de Apollo, tampoco', async () => {
    const noIds = harness([candidate({ email: null })]);
    await runEmploymentSweep(noIds.deps);
    assert.equal(noIds.apolloQueries.length, 0);
    assert.equal(noIds.aiCalls.length, 1);

    const noQuota = harness([candidate()], { apolloAvailable: false });
    await runEmploymentSweep(noQuota.deps);
    assert.equal(noQuota.apolloQueries.length, 0);
    assert.equal(noQuota.aiCalls.length, 1);
  });

  it('ya comprobado no se vuelve a gastar; un «no sé» de Apollo va directo a la IA', async () => {
    const confirmed = candidate({ id: 'a', enrichmentMetadata: { current_employment: { status: 'confirmed', source: 'apollo' } } });
    const unknown = candidate({ id: 'b', enrichmentMetadata: { current_employment: { status: 'unknown', source: 'apollo' } } });
    assert.equal(needsEmploymentSweep(confirmed), false);
    assert.equal(needsEmploymentSweep(unknown), true);
    const h = harness([confirmed, unknown], { ai: () => 'confirmed' });
    const summary = await runEmploymentSweep(h.deps);
    assert.equal(summary.considered, 1);
    assert.equal(h.apolloQueries.length, 0);
    assert.deepEqual(h.aiCalls, ['b']);
  });

  it('sin tiempo para la IA, queda sin comprobar (como antes)', async () => {
    const h = harness([candidate()], { remainingMs: EMPLOYMENT_SWEEP_AI_MIN_REMAINING_MS - 1 });
    const summary = await runEmploymentSweep(h.deps);
    assert.equal(h.apolloQueries.length, 1);
    assert.equal(h.aiCalls.length, 0);
    assert.equal(summary.unknown, 1);
  });

  it('respeta el tope por búsqueda y un fallo no corta a los demás', async () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ id: `c${i}` }));
    const h = harness(many, {
      apollo: (q) => {
        if (q.email && h.apolloQueries.length === 1) throw new Error('boom');
        return found('GO CORP', 'Gerente');
      },
    });
    const summary = await runEmploymentSweep({ ...h.deps, maxContacts: 5 });
    assert.equal(summary.considered, 5);
    assert.equal(summary.left, 4);
  });
});

describe('apolloPersonMatchesCandidate', () => {
  it('compara el apellido sin tildes y tolera apellidos compuestos', () => {
    assert.equal(apolloPersonMatchesCandidate({ firstName: 'A', lastName: 'Gómez Coello' }, { lastName: 'Gomez' }), true);
    assert.equal(apolloPersonMatchesCandidate({ firstName: 'A', lastName: 'Urgiles' }, { lastName: 'Pérez' }), false);
    assert.equal(apolloPersonMatchesCandidate({ firstName: 'A', lastName: null }, { lastName: 'Pérez' }), true);
  });
});
