// AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — núcleo de «Revelar LinkedIn» y de la
// identificación previa a «Revelar teléfono» para candidatos que ya existen en HubSpot.
//
// Dobles en memoria: sin Supabase, sin Apollo, sin Lusha, sin HubSpot, sin créditos.
// Nombres, correos e ids ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_COMPLETION_METADATA_KEY,
  evaluateCandidateIdentityCompletion,
  isProviderNameConsistent,
  runCandidateIdentityCompletion,
  type ApolloIdentityLookup,
  type IdentityCompletionCandidate,
  type IdentityCompletionDeps,
  type IdentityCompletionPatch,
  type IdentityProviderUsage,
  type LushaLinkedinLookup,
} from '../candidate-identity-completion-core';
import { evaluatePhoneRevealIdentityEligibility } from '../phone-reveal-identity-eligibility';

const APOLLO_ID = '0123456789abcdef01234567';
const APOLLO_USAGE: IdentityProviderUsage = {
  provider_key: 'apollo',
  operation_key: 'person_match',
  credits_used: 1,
  status: 'success',
  results_returned: 1,
};

function hubspotCandidate(overrides: Partial<IdentityCompletionCandidate> = {}): IdentityCompletionCandidate {
  return {
    id: 'cand-1',
    status: 'pending_review',
    source: 'hubspot',
    sourceContactId: '987654321',
    apolloPersonId: null,
    email: 'Ana.Ficticia@Empresa.test',
    linkedinUrl: null,
    firstName: 'Ana',
    lastName: 'Ficticia',
    fullName: 'Ana Ficticia',
    companyName: 'Empresa Ficticia SAS',
    companyDomain: 'empresa.test',
    enrichmentMetadata: { hubspot_first: true },
    ...overrides,
  };
}

function apolloFound(overrides: Partial<{ id: string | null; firstName: string | null; lastName: string | null; linkedinUrl: string | null }> = {}): ApolloIdentityLookup {
  return {
    kind: 'found',
    person: {
      id: APOLLO_ID,
      firstName: 'Ana',
      lastName: 'Ficticia',
      linkedinUrl: 'http://es.linkedin.com/in/ana-ficticia/?trk=x',
      ...overrides,
    },
    usage: [APOLLO_USAGE],
  };
}

interface Harness {
  deps: IdentityCompletionDeps;
  persisted: Array<{ id: string; patch: IdentityCompletionPatch }>;
  usage: IdentityProviderUsage[];
  apolloQueries: unknown[];
  lushaCalls: number;
}

function harness(opts: {
  candidate?: IdentityCompletionCandidate | null;
  apollo?: ApolloIdentityLookup;
  lusha?: LushaLinkedinLookup;
  roleKey?: string | null;
  persistThrows?: boolean;
} = {}): Harness {
  const h: Harness = { deps: null as never, persisted: [], usage: [], apolloQueries: [], lushaCalls: 0 };
  h.deps = {
    actor: { internalUserId: 'user-1', roleKey: opts.roleKey === undefined ? 'admin' : opts.roleKey },
    nowIso: '2026-10-29T12:00:00.000Z',
    loadCandidate: async () => (opts.candidate === undefined ? hubspotCandidate() : opts.candidate),
    lookupApollo: async (query) => {
      h.apolloQueries.push(query);
      return opts.apollo ?? apolloFound();
    },
    lookupLushaLinkedin: async () => {
      h.lushaCalls += 1;
      return opts.lusha ?? { kind: 'not_found', usage: [] };
    },
    persist: async (id, patch) => {
      if (opts.persistThrows) throw new Error('db down');
      h.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      h.usage.push(entry);
    },
  };
  return h;
}

describe('elegibilidad (compartida con la UI)', () => {
  it('HubSpot sólo con correo: ofrece LinkedIn y necesita identidad para el teléfono', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source: 'hubspot', sourceContactId: '123' });
    assert.equal(e.canRevealLinkedin, true);
    assert.equal(e.phoneRevealNeedsIdentity, true);
  });

  it('sin correo no hay con qué buscar', () => {
    const e = evaluateCandidateIdentityCompletion({ email: null, source: 'hubspot' });
    assert.equal(e.canRevealLinkedin, false);
    assert.equal(e.phoneRevealNeedsIdentity, false);
  });

  it('candidatos de Apollo/Lusha no cambian: nunca se les ofrece', () => {
    for (const source of ['apollo', 'lusha', 'manual']) {
      const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source, sourceContactId: null });
      assert.equal(e.canRevealLinkedin, false, source);
      assert.equal(e.phoneRevealNeedsIdentity, false, source);
    }
  });

  it('con apollo_person_id ya no necesita identidad', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source: 'hubspot', apolloPersonId: APOLLO_ID });
    assert.equal(e.phoneRevealNeedsIdentity, false);
  });

  it('un intento sin fruto retira ambos botones; un fallo de proveedor no', () => {
    for (const outcome of ['not_found', 'identity_mismatch']) {
      const e = evaluateCandidateIdentityCompletion({
        email: 'a@b.test',
        source: 'hubspot',
        enrichmentMetadata: { [IDENTITY_COMPLETION_METADATA_KEY]: { outcome } },
      });
      assert.equal(e.canRevealLinkedin || e.phoneRevealNeedsIdentity, false, outcome);
    }
    const retry = evaluateCandidateIdentityCompletion({
      email: 'a@b.test',
      source: 'hubspot',
      enrichmentMetadata: { [IDENTITY_COMPLETION_METADATA_KEY]: { outcome: 'provider_error' } },
    });
    assert.equal(retry.canRevealLinkedin, true);
  });
});

describe('coincidencia de nombre', () => {
  it('acepta nombre o apellido compartido, sin tildes ni mayúsculas', () => {
    assert.equal(isProviderNameConsistent({ fullName: 'José Pérez' }, { firstName: 'JOSE', lastName: 'Gómez' }), true);
    assert.equal(isProviderNameConsistent({ firstName: 'Ana', lastName: 'Ruiz' }, { firstName: 'Ana María', lastName: null }), true);
  });
  it('rechaza a otra persona', () => {
    assert.equal(isProviderNameConsistent({ fullName: 'Ana Ficticia' }, { firstName: 'Pedro', lastName: 'Gómez' }), false);
  });
  it('sin nombre en un lado no contradice al correo', () => {
    assert.equal(isProviderNameConsistent({ fullName: null }, { firstName: 'Pedro', lastName: null }), true);
  });
});

describe('«Revelar LinkedIn»', () => {
  it('Apollo encuentra: guarda LinkedIn canónico + identidad, 1 crédito, sin teléfonos', async () => {
    const h = harness();
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.ok, true);
    assert.equal(r.linkedinProvider, 'apollo');
    assert.equal(r.providerIdentityAvailable, true);
    assert.equal(h.persisted.length, 1);
    const { patch } = h.persisted[0];
    assert.equal(patch.linkedin_url, 'https://www.linkedin.com/in/ana-ficticia');
    assert.equal(patch.apollo_person_id, APOLLO_ID);
    assert.equal((patch.enrichment_metadata.hubspot_first as boolean), true, 'conserva la metadata previa');
    const block = patch.enrichment_metadata[IDENTITY_COMPLETION_METADATA_KEY] as Record<string, unknown>;
    assert.equal(block.outcome, 'completed');
    assert.deepEqual(block.providers, ['apollo']);
    assert.equal(h.lushaCalls, 0, 'con LinkedIn de Apollo no se gasta Lusha');
    assert.deepEqual(h.usage, [APOLLO_USAGE]);
    // El correo viaja normalizado; nunca hay campos de teléfono en la consulta.
    assert.deepEqual(h.apolloQueries[0], {
      email: 'ana.ficticia@empresa.test',
      firstName: 'Ana',
      lastName: 'Ficticia',
      organizationName: 'Empresa Ficticia SAS',
      domain: 'empresa.test',
    });
  });

  it('Apollo sin LinkedIn → Lusha por correo lo trae', async () => {
    const h = harness({
      apollo: apolloFound({ linkedinUrl: null }),
      lusha: {
        kind: 'found',
        person: { firstName: 'Ana', lastName: 'Ficticia', fullName: 'Ana Ficticia', linkedinUrl: 'linkedin.com/in/ana-f' },
        usage: [{ provider_key: 'lusha', operation_key: 'lusha_contact_search', credits_used: null, status: 'success', results_returned: 1 }],
      },
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.linkedinProvider, 'lusha');
    assert.equal(h.persisted[0].patch.linkedin_url, 'https://www.linkedin.com/in/ana-f');
    assert.equal(h.persisted[0].patch.apollo_person_id, APOLLO_ID, 'la identidad de Apollo se guarda igual');
    assert.equal(h.usage.length, 2);
  });

  it('nadie lo encuentra: not_found anotado (retira el botón) y nada más escrito', async () => {
    const h = harness({ apollo: { kind: 'not_found', usage: [APOLLO_USAGE] } });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(r.ok, false);
    const { patch } = h.persisted[0];
    assert.equal(patch.linkedin_url, undefined);
    assert.equal(patch.apollo_person_id, undefined);
    assert.equal((patch.enrichment_metadata[IDENTITY_COMPLETION_METADATA_KEY] as Record<string, unknown>).outcome, 'not_found');
  });

  it('otra persona con ese correo: identity_mismatch y NO se guarda su identidad', async () => {
    const h = harness({ apollo: apolloFound({ firstName: 'Pedro', lastName: 'Gómez' }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'identity_mismatch');
    assert.equal(h.persisted[0].patch.apollo_person_id, undefined);
    assert.equal(h.persisted[0].patch.linkedin_url, undefined);
  });

  it('nunca sobrescribe un LinkedIn existente: ya tiene ⇒ 0 proveedores', async () => {
    const h = harness({ candidate: hubspotCandidate({ linkedinUrl: 'https://www.linkedin.com/in/otra' }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'nothing_to_complete');
    assert.equal(h.apolloQueries.length, 0);
    assert.equal(h.persisted.length, 0);
  });

  it('Apollo sin clave: provider_unavailable, sin escribir nada (se puede reintentar)', async () => {
    const h = harness({ apollo: { kind: 'unavailable', usage: [] } });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'provider_unavailable');
    assert.equal(h.persisted.length, 0);
  });
});

describe('gates (0 proveedores)', () => {
  const cases: Array<[string, Parameters<typeof harness>[0], string]> = [
    ['rol sin permiso', { roleKey: 'seller' }, 'unauthorized_role'],
    ['actor sin rol', { roleKey: null }, 'unauthorized_role'],
    ['candidato inexistente', { candidate: null }, 'candidate_not_found'],
    ['ya aprobado', { candidate: hubspotCandidate({ status: 'approved' }) }, 'not_pending_review'],
    ['origen Apollo', { candidate: hubspotCandidate({ source: 'apollo' }) }, 'not_hubspot_candidate'],
    ['sin correo', { candidate: hubspotCandidate({ email: '  ' }) }, 'missing_email'],
  ];
  for (const [name, opts, status] of cases) {
    it(name, async () => {
      const h = harness(opts);
      const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
      assert.equal(r.status, status);
      assert.equal(h.apolloQueries.length + h.lushaCalls, 0);
      assert.equal(h.persisted.length, 0);
    });
  }
});

describe('identificación previa a «Revelar teléfono»', () => {
  it('guarda la identidad y la privacidad pasa a ser evaluable con la MISMA función del servidor', async () => {
    const h = harness({ apollo: apolloFound({ linkedinUrl: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.providerIdentityAvailable, true);
    assert.equal(h.lushaCalls, 0, 'en el camino del teléfono no se gasta Lusha');
    const saved = h.persisted[0].patch.apollo_person_id;
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({ apolloPersonId: saved, source: 'hubspot', sourceContactId: '987654321' }),
      'eligible',
    );
  });

  it('Apollo devuelve un id inválido: la identidad NO aparece', async () => {
    const h = harness({ apollo: apolloFound({ id: 'v1.lusha-like', linkedinUrl: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(r.providerIdentityAvailable, false);
    assert.equal(h.persisted[0].patch.apollo_person_id, undefined);
  });

  it('un LinkedIn traído de paso no convierte en éxito una identidad ausente', async () => {
    const h = harness({ apollo: apolloFound({ id: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(h.persisted[0].patch.linkedin_url, 'https://www.linkedin.com/in/ana-ficticia');
  });

  it('ya identificado: nothing_to_complete sin proveedores', async () => {
    const h = harness({ candidate: hubspotCandidate({ apolloPersonId: APOLLO_ID }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'nothing_to_complete');
    assert.equal(r.providerIdentityAvailable, true);
    assert.equal(h.apolloQueries.length, 0);
  });

  it('fallo al guardar ⇒ persist_failed (no se afirma identidad)', async () => {
    const h = harness({ persistThrows: true });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'persist_failed');
    assert.equal(r.providerIdentityAvailable, false);
  });
});
