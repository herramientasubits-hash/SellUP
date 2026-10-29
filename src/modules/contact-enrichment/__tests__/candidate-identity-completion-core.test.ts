// AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — núcleo de «Revelar LinkedIn», «Revelar correo»
// y de la identificación previa a «Revelar teléfono» para candidatos que ya existen en HubSpot.
//
// Dobles en memoria: sin Supabase, sin Apollo, sin Lusha, sin HubSpot, sin créditos.
// Nombres, correos e ids ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_COMPLETION_METADATA_KEY,
  evaluateCandidateIdentityCompletion,
  isProviderNameConsistent,
  normalizeCandidateEmail,
  phoneIdentityHelperCopy,
  runCandidateIdentityCompletion,
  type IdentityCompletionCandidate,
  type IdentityCompletionDeps,
  type IdentityCompletionPatch,
  type IdentityLookup,
  type IdentityLookupPerson,
  type IdentityLookupQuery,
  type IdentityProviderUsage,
} from '../candidate-identity-completion-core';
import { evaluatePhoneRevealIdentityEligibility } from '../phone-reveal-identity-eligibility';

const APOLLO_ID = '0123456789abcdef01234567';
const LINKEDIN = 'https://www.linkedin.com/in/ana-ficticia';
const APOLLO_USAGE: IdentityProviderUsage = {
  provider_key: 'apollo',
  operation_key: 'person_match',
  credits_used: 1,
  status: 'success',
  results_returned: 1,
};
const LUSHA_USAGE: IdentityProviderUsage = {
  provider_key: 'lusha',
  operation_key: 'lusha_contact_search',
  credits_used: null,
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

function found(person: Partial<IdentityLookupPerson> = {}, usage: IdentityProviderUsage[] = [APOLLO_USAGE]): IdentityLookup {
  return {
    kind: 'found',
    person: {
      id: APOLLO_ID,
      firstName: 'Ana',
      lastName: 'Ficticia',
      linkedinUrl: 'http://es.linkedin.com/in/ana-ficticia/?trk=x',
      email: null,
      ...person,
    },
    usage,
  };
}

const notFound = (usage: IdentityProviderUsage[] = [APOLLO_USAGE]): IdentityLookup => ({ kind: 'not_found', usage });

interface Harness {
  deps: IdentityCompletionDeps;
  persisted: Array<{ id: string; patch: IdentityCompletionPatch }>;
  usage: Array<{ entry: IdentityProviderUsage; channel: string }>;
  apolloQueries: IdentityLookupQuery[];
  lushaQueries: IdentityLookupQuery[];
}

function harness(opts: {
  candidate?: IdentityCompletionCandidate | null;
  /** Respuesta de Apollo por canal (o una sola para todos). */
  apollo?: IdentityLookup | Partial<Record<'email' | 'linkedin', IdentityLookup>>;
  lusha?: IdentityLookup;
  roleKey?: string | null;
  persistThrows?: boolean;
} = {}): Harness {
  const h: Harness = { deps: null as never, persisted: [], usage: [], apolloQueries: [], lushaQueries: [] };
  h.deps = {
    actor: { internalUserId: 'user-1', roleKey: opts.roleKey === undefined ? 'admin' : opts.roleKey },
    nowIso: '2026-10-29T12:00:00.000Z',
    loadCandidate: async () => (opts.candidate === undefined ? hubspotCandidate() : opts.candidate),
    lookupApollo: async (query) => {
      h.apolloQueries.push(query);
      const a = opts.apollo;
      if (!a) return found();
      if ('kind' in a) return a as IdentityLookup;
      return (a as Partial<Record<'email' | 'linkedin', IdentityLookup>>)[query.channel] ?? notFound();
    },
    lookupLusha: async (query) => {
      h.lushaQueries.push(query);
      return opts.lusha ?? notFound([]);
    },
    persist: async (id, patch) => {
      if (opts.persistThrows) throw new Error('db down');
      h.persisted.push({ id, patch });
    },
    logUsage: async (entry, context) => {
      h.usage.push({ entry, channel: context.channel });
    },
  };
  return h;
}

const block = (h: Harness) =>
  h.persisted[0].patch.enrichment_metadata[IDENTITY_COMPLETION_METADATA_KEY] as Record<string, unknown>;

describe('elegibilidad (compartida con la UI)', () => {
  it('HubSpot sólo con correo: ofrece LinkedIn (no correo) y busca identidad por correo', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source: 'hubspot', sourceContactId: '123' });
    assert.equal(e.canRevealLinkedin, true);
    assert.equal(e.canRevealEmail, false);
    assert.equal(e.phoneRevealNeedsIdentity, true);
    assert.deepEqual(e.identityChannels, ['email']);
  });

  it('HubSpot sólo con LinkedIn: ofrece correo (no LinkedIn) y busca identidad por LinkedIn', () => {
    const e = evaluateCandidateIdentityCompletion({ linkedinUrl: LINKEDIN, source: 'hubspot', sourceContactId: '123' });
    assert.equal(e.canRevealEmail, true);
    assert.equal(e.canRevealLinkedin, false);
    assert.equal(e.phoneRevealNeedsIdentity, true);
    assert.deepEqual(e.identityChannels, ['linkedin']);
  });

  it('HubSpot con los dos: ningún botón de canal; el teléfono usa correo y luego LinkedIn', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', linkedinUrl: LINKEDIN, source: 'hubspot' });
    assert.equal(e.canRevealEmail || e.canRevealLinkedin, false);
    assert.equal(e.phoneRevealNeedsIdentity, true);
    assert.deepEqual(e.identityChannels, ['email', 'linkedin']);
  });

  it('sin correo ni LinkedIn utilizables no hay con qué buscar', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'no-es-correo', linkedinUrl: 'https://linkedin.com/company/x', source: 'hubspot' });
    assert.equal(e.canRevealEmail || e.canRevealLinkedin || e.phoneRevealNeedsIdentity, false);
  });

  it('candidatos de Apollo/Lusha no cambian: nunca se les ofrece', () => {
    for (const source of ['apollo', 'lusha', 'manual']) {
      const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source, sourceContactId: null });
      assert.equal(e.canRevealLinkedin || e.canRevealEmail || e.phoneRevealNeedsIdentity, false, source);
    }
  });

  it('con apollo_person_id ya no necesita identidad', () => {
    const e = evaluateCandidateIdentityCompletion({ email: 'a@b.test', source: 'hubspot', apolloPersonId: APOLLO_ID });
    assert.equal(e.phoneRevealNeedsIdentity, false);
  });

  it('un intento sin fruto retira los botones; un fallo de proveedor no', () => {
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

  it('el copy del teléfono dice con qué se identifica y cuánto cuesta', () => {
    assert.match(phoneIdentityHelperCopy(['email']), /por su correo \(1 crédito/);
    assert.match(phoneIdentityHelperCopy(['linkedin']), /por su LinkedIn \(1 crédito/);
    assert.match(phoneIdentityHelperCopy(['email', 'linkedin']), /correo y, si no aparece, por su LinkedIn \(hasta 2 créditos/);
  });

  it('correos: minúsculas y fuera los marcadores bloqueados', () => {
    assert.equal(normalizeCandidateEmail(' Ana@Empresa.TEST '), 'ana@empresa.test');
    assert.equal(normalizeCandidateEmail('email_not_unlocked@domain.com'), null);
    assert.equal(normalizeCandidateEmail('sin-arroba'), null);
  });
});

describe('coincidencia de nombre', () => {
  it('acepta nombre o apellido compartido, sin tildes ni mayúsculas', () => {
    assert.equal(isProviderNameConsistent({ fullName: 'José Pérez' }, { firstName: 'JOSE', lastName: 'Gómez' }), true);
    assert.equal(isProviderNameConsistent({ firstName: 'Ana', lastName: 'Ruiz' }, { firstName: null, lastName: null, fullName: 'Ana María' }), true);
  });
  it('rechaza a otra persona', () => {
    assert.equal(isProviderNameConsistent({ fullName: 'Ana Ficticia' }, { firstName: 'Pedro', lastName: 'Gómez' }), false);
  });
  it('sin nombre en un lado no contradice al dato exacto', () => {
    assert.equal(isProviderNameConsistent({ fullName: null }, { firstName: 'Pedro', lastName: null }), true);
  });
});

describe('«Revelar LinkedIn» (por correo)', () => {
  it('Apollo encuentra: guarda LinkedIn canónico + identidad, 1 crédito, sin teléfonos', async () => {
    const h = harness();
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.linkedinProvider, 'apollo');
    assert.equal(r.providerIdentityAvailable, true);
    const { patch } = h.persisted[0];
    assert.equal(patch.linkedin_url, LINKEDIN);
    assert.equal(patch.apollo_person_id, APOLLO_ID);
    assert.equal(patch.email, undefined);
    assert.equal(patch.enrichment_metadata.hubspot_first, true, 'conserva la metadata previa');
    assert.equal(block(h).outcome, 'completed');
    assert.equal(h.lushaQueries.length, 0, 'con LinkedIn de Apollo no se gasta Lusha');
    assert.equal(h.apolloQueries.length, 1);
    assert.equal(h.apolloQueries[0].channel, 'email');
    assert.equal(h.apolloQueries[0].email, 'ana.ficticia@empresa.test');
    assert.equal(h.apolloQueries[0].wantsEmail, false);
  });

  it('Apollo sin LinkedIn → Lusha por correo lo trae', async () => {
    const h = harness({
      apollo: found({ linkedinUrl: null }),
      lusha: found({ id: null, firstName: null, lastName: null, fullName: 'Ana Ficticia', linkedinUrl: 'linkedin.com/in/ana-f' }, [LUSHA_USAGE]),
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.linkedinProvider, 'lusha');
    assert.equal(h.persisted[0].patch.linkedin_url, 'https://www.linkedin.com/in/ana-f');
    assert.equal(h.persisted[0].patch.apollo_person_id, APOLLO_ID, 'la identidad de Apollo se guarda igual');
    assert.equal(h.lushaQueries[0].channel, 'email');
  });

  it('nadie lo encuentra: not_found anotado y nada más escrito', async () => {
    const h = harness({ apollo: notFound() });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(h.persisted[0].patch.linkedin_url, undefined);
    assert.equal(h.persisted[0].patch.apollo_person_id, undefined);
    assert.equal(block(h).outcome, 'not_found');
  });

  it('otra persona con ese correo: identity_mismatch y NO se guarda su identidad', async () => {
    const h = harness({ apollo: found({ firstName: 'Pedro', lastName: 'Gómez' }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'identity_mismatch');
    assert.equal(h.persisted[0].patch.apollo_person_id, undefined);
    assert.equal(h.persisted[0].patch.linkedin_url, undefined);
  });

  it('sin correo no se puede pedir el LinkedIn', async () => {
    const h = harness({ candidate: hubspotCandidate({ email: null, linkedinUrl: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'missing_identifier');
    assert.equal(h.apolloQueries.length, 0);
  });

  it('Apollo sin clave: provider_unavailable, sin escribir nada (se puede reintentar)', async () => {
    const h = harness({ apollo: { kind: 'unavailable', usage: [] }, lusha: { kind: 'unavailable', usage: [] } });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'linkedin' }, h.deps);
    assert.equal(r.status, 'provider_unavailable');
    assert.equal(h.persisted.length, 0);
  });
});

describe('«Revelar correo» (por LinkedIn)', () => {
  const linkedinOnly = () => hubspotCandidate({ email: null, linkedinUrl: 'https://co.linkedin.com/in/ana-ficticia/' });

  it('Apollo por LinkedIn trae el correo: se guarda (minúsculas) con la identidad', async () => {
    const h = harness({ candidate: linkedinOnly(), apollo: found({ email: 'Ana@Empresa.test' }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.emailProvider, 'apollo');
    assert.equal(h.persisted[0].patch.email, 'ana@empresa.test');
    assert.equal(h.persisted[0].patch.apollo_person_id, APOLLO_ID);
    assert.equal(h.persisted[0].patch.linkedin_url, undefined, 'nunca sobrescribe el LinkedIn');
    assert.equal(h.apolloQueries[0].channel, 'linkedin');
    assert.equal(h.apolloQueries[0].linkedinUrl, LINKEDIN);
    assert.equal(h.apolloQueries[0].wantsEmail, true);
  });

  it('Apollo con correo bloqueado → Lusha por LinkedIn lo trae', async () => {
    const h = harness({
      candidate: linkedinOnly(),
      apollo: found({ email: 'email_not_unlocked@domain.com' }),
      lusha: found({ id: null, email: 'ana@empresa.test' }, [LUSHA_USAGE]),
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.emailProvider, 'lusha');
    assert.equal(h.lushaQueries[0].channel, 'linkedin');
  });

  it('ya tiene correo: nothing_to_complete sin proveedores', async () => {
    const h = harness({ candidate: hubspotCandidate({ linkedinUrl: LINKEDIN }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'email' }, h.deps);
    assert.equal(r.status, 'nothing_to_complete');
    assert.equal(h.apolloQueries.length + h.lushaQueries.length, 0);
  });
});

describe('gates (0 proveedores)', () => {
  const cases: Array<[string, Parameters<typeof harness>[0], string]> = [
    ['rol sin permiso', { roleKey: 'seller' }, 'unauthorized_role'],
    ['actor sin rol', { roleKey: null }, 'unauthorized_role'],
    ['candidato inexistente', { candidate: null }, 'candidate_not_found'],
    ['ya aprobado', { candidate: hubspotCandidate({ status: 'approved' }) }, 'not_pending_review'],
    ['origen Apollo', { candidate: hubspotCandidate({ source: 'apollo' }) }, 'not_hubspot_candidate'],
    ['sin correo ni LinkedIn', { candidate: hubspotCandidate({ email: '  ', linkedinUrl: null }) }, 'missing_identifier'],
  ];
  for (const [name, opts, status] of cases) {
    it(name, async () => {
      const h = harness(opts);
      const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
      assert.equal(r.status, status);
      assert.equal(h.apolloQueries.length + h.lushaQueries.length, 0);
      assert.equal(h.persisted.length, 0);
    });
  }
});

describe('identificación previa a «Revelar teléfono»', () => {
  it('guarda la identidad y la privacidad pasa a ser evaluable con la MISMA función del servidor', async () => {
    const h = harness({ apollo: found({ linkedinUrl: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(r.providerIdentityAvailable, true);
    assert.equal(h.lushaQueries.length, 0, 'en el camino del teléfono no se gasta Lusha');
    const saved = h.persisted[0].patch.apollo_person_id;
    assert.equal(
      evaluatePhoneRevealIdentityEligibility({ apolloPersonId: saved, source: 'hubspot', sourceContactId: '987654321' }),
      'eligible',
    );
  });

  it('con correo y LinkedIn: si el correo no la encuentra, prueba el LinkedIn (uno después del otro)', async () => {
    const h = harness({
      candidate: hubspotCandidate({ linkedinUrl: LINKEDIN }),
      apollo: { email: notFound(), linkedin: found() },
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.deepEqual(h.apolloQueries.map((q) => q.channel), ['email', 'linkedin']);
    assert.deepEqual(h.usage.map((u) => u.channel), ['email', 'linkedin'], 'cada crédito con su canal');
    assert.deepEqual(block(h).channels, ['email', 'linkedin']);
  });

  it('con correo y LinkedIn: si el correo ya la encuentra, NO gasta el segundo crédito', async () => {
    const h = harness({ candidate: hubspotCandidate({ linkedinUrl: LINKEDIN }) });
    await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.deepEqual(h.apolloQueries.map((q) => q.channel), ['email']);
  });

  it('con correo y LinkedIn: un «otra persona» por correo no impide encontrarla por LinkedIn', async () => {
    const h = harness({
      candidate: hubspotCandidate({ linkedinUrl: LINKEDIN }),
      apollo: { email: found({ firstName: 'Pedro', lastName: 'Gómez' }), linkedin: found() },
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.equal(h.persisted[0].patch.apollo_person_id, APOLLO_ID);
  });

  it('sólo LinkedIn: se identifica por LinkedIn y trae de paso el correo', async () => {
    const h = harness({
      candidate: hubspotCandidate({ email: null, linkedinUrl: LINKEDIN }),
      apollo: found({ email: 'ana@empresa.test' }),
    });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'completed');
    assert.deepEqual(h.apolloQueries.map((q) => q.channel), ['linkedin']);
    assert.equal(h.persisted[0].patch.email, 'ana@empresa.test');
  });

  it('Apollo devuelve un id inválido: la identidad NO aparece', async () => {
    const h = harness({ apollo: found({ id: 'v1.lusha-like', linkedinUrl: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(r.providerIdentityAvailable, false);
    assert.equal(h.persisted[0].patch.apollo_person_id, undefined);
  });

  it('un LinkedIn traído de paso no convierte en éxito una identidad ausente', async () => {
    const h = harness({ apollo: found({ id: null }) });
    const r = await runCandidateIdentityCompletion({ candidateId: 'cand-1', purpose: 'phone' }, h.deps);
    assert.equal(r.status, 'not_found');
    assert.equal(h.persisted[0].patch.linkedin_url, LINKEDIN);
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
