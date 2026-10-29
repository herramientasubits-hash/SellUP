// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — buscar contacto por CORREO: SellUp → HubSpot →
// Apollo → Lusha, de lo gratis a lo pagado. Dobles en memoria. Datos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_SEARCH_COPY,
  normalizeEmailInput,
  searchContactByEmail,
  type EmailSearchDeps,
  type HubSpotEmailContact,
} from '../email-contact-search-core';
import type { LinkedinProviderProfile, LinkedinProviderUsage } from '../linkedin-contact-search-core';

const EMAIL = 'ana@empresa-ficticia.test';

function providerProfile(overrides: Partial<LinkedinProviderProfile> = {}): LinkedinProviderProfile {
  return {
    provider: 'apollo',
    sourceContactId: 'apollo-person-1',
    firstName: 'Ana',
    lastName: 'Ficticia',
    fullName: 'Ana Ficticia',
    title: 'Directora de Talento',
    seniority: 'director',
    country: 'Colombia',
    email: EMAIL,
    providerCompanyName: 'Empresa Ficticia SAS',
    providerCompanyDomain: 'empresa-ficticia.test',
    providerCompanyWebsiteUrl: 'https://empresa-ficticia.test',
    phoneAvailable: null,
    linkedinUrl: 'https://es.linkedin.com/in/ana-ficticia/',
    ...overrides,
  };
}

const HUBSPOT_CONTACT: HubSpotEmailContact = {
  id: 'hs-1',
  firstName: 'Ana',
  lastName: 'Ficticia',
  jobTitle: 'Directora de Talento',
  phone: null,
  mobilePhone: '+57 300 000 0000',
  linkedinUrl: null,
  ownerId: null,
  associatedCompanyId: '65498491',
};

const APOLLO_USAGE: LinkedinProviderUsage = {
  provider_key: 'apollo',
  operation_key: 'person_match',
  credits_used: 1,
  status: 'success',
  results_returned: 1,
};

function makeDeps(overrides: Partial<EmailSearchDeps> = {}) {
  const calls: string[] = [];
  const logged: LinkedinProviderUsage[] = [];
  const deps: EmailSearchDeps = {
    isEnabled: () => true,
    findSellUpContactByEmail: async (email) => {
      calls.push(`sellup-email:${email}`);
      return null;
    },
    findPendingCandidateByEmail: async (email) => {
      calls.push(`pending-email:${email}`);
      return null;
    },
    findHubSpotContactByEmail: async (email) => {
      calls.push(`hubspot-email:${email}`);
      return null;
    },
    isHubSpotContactOfferable: async () => true,
    lookupApollo: async (email) => {
      calls.push(`apollo:${email}`);
      return { kind: 'found', profile: providerProfile(), usage: [APOLLO_USAGE] };
    },
    lookupLusha: async (email) => {
      calls.push(`lusha:${email}`);
      return { kind: 'found', profile: providerProfile({ provider: 'lusha', sourceContactId: 'lusha-1' }), usage: [] };
    },
    findSellUpContactByLinkedin: async (slug) => {
      calls.push(`sellup-linkedin:${slug}`);
      return null;
    },
    findPendingCandidateByLinkedin: async (slug) => {
      calls.push(`pending-linkedin:${slug}`);
      return null;
    },
    logUsage: async (entry) => {
      logged.push(entry);
    },
    nowIso: () => '2026-10-29T12:00:00.000Z',
    ...overrides,
  };
  return { deps, calls, logged };
}

const paidCalls = (calls: string[]) => calls.filter((c) => c.startsWith('apollo:') || c.startsWith('lusha:'));

describe('normalizeEmailInput', () => {
  it('acepta correos, en minúsculas y sin mailto ni <>', () => {
    assert.equal(normalizeEmailInput('  Ana@Empresa-Ficticia.TEST '), EMAIL);
    assert.equal(normalizeEmailInput('mailto:ana@empresa-ficticia.test'), EMAIL);
    assert.equal(normalizeEmailInput('<ana@empresa-ficticia.test>'), EMAIL);
  });

  it('rechaza lo que no es un correo', () => {
    for (const raw of ['', 'ana', 'ana@', '@empresa.test', 'ana@empresa', 'ana @empresa.test', 'linkedin.com/in/ana', 42, null]) {
      assert.equal(normalizeEmailInput(raw), null, String(raw));
    }
  });
});

describe('searchContactByEmail — antes de gastar', () => {
  it('correo inválido: mensaje claro y nada se consulta', async () => {
    const { deps, calls } = makeDeps();
    const result = await searchContactByEmail('no-es-correo', deps);
    assert.deepEqual(result, { status: 'invalid_input', message: EMAIL_SEARCH_COPY.invalid });
    assert.deepEqual(calls, []);
  });

  it('con la bandera apagada no hace nada', async () => {
    const { deps, calls } = makeDeps({ isEnabled: () => false });
    assert.deepEqual(await searchContactByEmail(EMAIL, deps), { status: 'disabled' });
    assert.deepEqual(calls, []);
  });

  it('ya es contacto de SellUp: no se consulta HubSpot ni proveedores', async () => {
    const { deps, calls } = makeDeps({
      findSellUpContactByEmail: async () => ({ fullName: 'Ana Ficticia', companyName: 'Empresa' }),
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status, 'already_known');
    assert.equal(result.status === 'already_known' && result.where, 'sellup_contact');
    assert.equal(result.status === 'already_known' && result.creditsSpent, false);
    assert.deepEqual(calls, []);
  });

  it('ya está en «Por revisar»: se avisa con su id y no se gasta', async () => {
    const { deps, calls } = makeDeps({
      findPendingCandidateByEmail: async () => ({ fullName: 'Ana', companyName: null, candidateId: 'cand-9' }),
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status === 'already_known' && result.where, 'sellup_pending_candidate');
    assert.equal(result.status === 'already_known' && result.match.candidateId, 'cand-9');
    assert.deepEqual(paidCalls(calls), []);
  });
});

describe('searchContactByEmail — HubSpot antes que los proveedores', () => {
  it('existe en HubSpot: el candidato sale de ahí, sin proveedores ni créditos', async () => {
    const { deps, calls, logged } = makeDeps({ findHubSpotContactByEmail: async () => HUBSPOT_CONTACT });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.deepEqual(paidCalls(calls), []);
    assert.deepEqual(logged, []);
    assert.equal(result.data.profile.provider, 'hubspot');
    assert.equal(result.data.profile.sourceContactId, 'hs-1');
    assert.equal(result.data.profile.phone, '+57 300 000 0000');
    assert.deepEqual(result.data.hubspotContact, { id: 'hs-1', associatedCompanyId: '65498491' });
    assert.equal(result.data.creditsSpent, 0);
    assert.equal(result.data.entryMode, 'email_single');
    assert.equal(result.preview.hasPhone, true);
  });

  it('contacto de HubSpot de otro vendedor: no se ofrece ni se gasta', async () => {
    const { deps, calls } = makeDeps({
      findHubSpotContactByEmail: async () => ({ ...HUBSPOT_CONTACT, ownerId: 'owner-otro' }),
      isHubSpotContactOfferable: async () => false,
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status === 'already_known' && result.where, 'hubspot_contact');
    assert.equal(result.status === 'already_known' && result.message, EMAIL_SEARCH_COPY.hubspotOtherSeller);
    assert.deepEqual(paidCalls(calls), []);
  });

  it('si la regla de dueño falla, se trata como no ofrecible (fail closed)', async () => {
    const { deps } = makeDeps({
      findHubSpotContactByEmail: async () => HUBSPOT_CONTACT,
      isHubSpotContactOfferable: async () => {
        throw new Error('boom');
      },
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status === 'already_known' && result.where, 'hubspot_contact');
  });

  it('HubSpot caído no bloquea: se sigue con Apollo y se marca', async () => {
    const { deps, calls } = makeDeps({
      findHubSpotContactByEmail: async () => {
        throw new Error('HTTP 500');
      },
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status, 'found');
    assert.equal(result.status === 'found' && result.hubspotCheck, 'unavailable');
    assert.deepEqual(paidCalls(calls), [`apollo:${EMAIL}`]);
  });
});

describe('searchContactByEmail — proveedores', () => {
  it('Apollo encuentra: no se llama a Lusha; el correo es el escrito y el LinkedIn queda canónico', async () => {
    const { deps, calls, logged } = makeDeps({
      lookupApollo: async () => ({
        kind: 'found',
        profile: providerProfile({ email: 'otro@empresa-ficticia.test' }),
        usage: [APOLLO_USAGE],
      }),
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.equal(paidCalls(calls).some((c) => c.startsWith('lusha:')), false);
    assert.deepEqual(logged, [APOLLO_USAGE]);
    assert.equal(result.data.profile.email, EMAIL);
    assert.equal(result.data.linkedinUrl, 'https://www.linkedin.com/in/ana-ficticia');
    assert.equal(result.data.linkedinSlug, 'ana-ficticia');
    assert.equal(result.data.creditsSpent, 1);
  });

  it('Apollo no la encuentra: va a Lusha', async () => {
    const { deps, calls } = makeDeps({ lookupApollo: async () => ({ kind: 'not_found', usage: [APOLLO_USAGE] }) });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status === 'found' && result.data.profile.provider, 'lusha');
    assert.deepEqual(paidCalls(calls), [`lusha:${EMAIL}`]);
  });

  it('nadie la encuentra: no se crea nada (decisión C)', async () => {
    const { deps } = makeDeps({
      lookupApollo: async () => ({ kind: 'not_found', usage: [APOLLO_USAGE] }),
      lookupLusha: async () => ({ kind: 'not_found', usage: [] }),
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.deepEqual(result, { status: 'not_found', message: EMAIL_SEARCH_COPY.notFound, creditsSpent: true });
  });

  it('error o ningún proveedor disponible: error del proveedor, no «no encontrado»', async () => {
    for (const overrides of [
      { lookupApollo: async () => ({ kind: 'error' as const, message: 'x', usage: [] }), lookupLusha: async () => ({ kind: 'not_found' as const, usage: [] }) },
      { lookupApollo: async () => ({ kind: 'unavailable' as const, usage: [] }), lookupLusha: async () => ({ kind: 'unavailable' as const, usage: [] }) },
    ]) {
      const { deps } = makeDeps(overrides);
      const result = await searchContactByEmail(EMAIL, deps);
      assert.equal(result.status, 'provider_error');
    }
  });

  it('el LinkedIn que trae la fuente ya es contacto de SellUp: se avisa del gasto', async () => {
    const { deps } = makeDeps({
      findSellUpContactByLinkedin: async (slug) => (slug === 'ana-ficticia' ? { fullName: 'Ana', companyName: 'X' } : null),
    });
    const result = await searchContactByEmail(EMAIL, deps);
    assert.equal(result.status === 'already_known' && result.matchedBy, 'linkedin');
    assert.equal(result.status === 'already_known' && result.creditsSpent, true);
  });
});
