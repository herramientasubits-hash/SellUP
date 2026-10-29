// AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — adaptadores Apollo/Lusha con dobles.
// Sin red ni créditos: el cliente de cada proveedor se inyecta.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { lookupApolloIdentity, lookupLushaIdentity } from '../candidate-identity-completion-providers.server';
import type { IdentityLookupQuery } from '../candidate-identity-completion-core';

const BASE: Omit<IdentityLookupQuery, 'channel' | 'wantsEmail'> = {
  email: 'ana@empresa.test',
  linkedinUrl: 'https://www.linkedin.com/in/ana',
  firstName: 'Ana',
  lastName: 'Ficticia',
  organizationName: 'Empresa',
  domain: 'empresa.test',
};

function apolloPerson(email: string | null) {
  return {
    id: '0123456789abcdef01234567',
    first_name: 'Ana',
    last_name: 'Ficticia',
    linkedin_url: 'https://linkedin.com/in/ana',
    title: null,
    email,
    phone_numbers: [],
    organization: null,
  };
}

function capturingMatch(email: string | null = null) {
  const sent: Array<Record<string, unknown>> = [];
  const matchPerson = (async (params: Record<string, unknown>) => {
    sent.push(params);
    return { success: true, data: apolloPerson(email) };
  }) as never;
  return { sent, matchPerson };
}

describe('Apollo people/match', () => {
  it('por correo: sólo el correo como identificador; nunca teléfono ni correo personal', async () => {
    const { sent, matchPerson } = capturingMatch();
    const r = await lookupApolloIdentity({ ...BASE, channel: 'email', wantsEmail: false }, { getApiKey: async () => 'k', matchPerson });
    assert.equal(r.kind, 'found');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, 'ana@empresa.test');
    assert.equal('linkedin_url' in sent[0], false);
    for (const forbidden of ['reveal_phone_number', 'reveal_personal_emails', 'webhook_url']) {
      assert.equal(forbidden in sent[0], false, forbidden);
    }
    assert.equal(r.usage[0].credits_used, 1);
  });

  it('por LinkedIn buscando el correo: sólo el LinkedIn; pide correos, nunca teléfono', async () => {
    const { sent, matchPerson } = capturingMatch('Ana@Empresa.test');
    const r = await lookupApolloIdentity({ ...BASE, channel: 'linkedin', wantsEmail: true }, { getApiKey: async () => 'k', matchPerson });
    assert.equal(sent[0].linkedin_url, 'https://www.linkedin.com/in/ana');
    assert.equal('email' in sent[0], false);
    assert.equal(sent[0].reveal_personal_emails, true);
    assert.equal('reveal_phone_number' in sent[0], false);
    assert.equal(r.kind === 'found' && r.person.email, 'ana@empresa.test');
  });

  it('correo bloqueado de Apollo no se devuelve como correo', async () => {
    const { matchPerson } = capturingMatch('email_not_unlocked@domain.com');
    const r = await lookupApolloIdentity({ ...BASE, channel: 'linkedin', wantsEmail: true }, { getApiKey: async () => 'k', matchPerson });
    assert.equal(r.kind === 'found' && r.person.email, null);
  });

  it('sin clave: unavailable y 0 llamadas', async () => {
    const { sent, matchPerson } = capturingMatch();
    const r = await lookupApolloIdentity({ ...BASE, channel: 'email', wantsEmail: false }, { getApiKey: async () => null, matchPerson });
    assert.equal(r.kind, 'unavailable');
    assert.equal(sent.length, 0);
  });

  it('error del proveedor: créditos desconocidos (null), nunca 0', async () => {
    const r = await lookupApolloIdentity({ ...BASE, channel: 'email', wantsEmail: false }, {
      getApiKey: async () => 'k',
      matchPerson: (async () => ({ success: false, error: { error: 'HTTP_500' } })) as never,
    });
    assert.equal(r.kind, 'error');
    assert.equal(r.usage[0].credits_used, null);
  });
});

describe('Lusha', () => {
  it('por correo: sólo búsqueda (vista sin revelar), trae el LinkedIn', async () => {
    const r = await lookupLushaIdentity({ ...BASE, channel: 'email', wantsEmail: false }, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: (async () => ({
        ok: true,
        status: 'success',
        resultsReturned: 1,
        creditsCharged: null,
        sanitizedResults: [{ id: 'l1', fullName: 'Ana Ficticia', title: null, companyName: null, companyDomain: null, linkedinUrl: 'https://linkedin.com/in/ana', has: null, canReveal: null }],
      })) as never,
    });
    assert.equal(r.kind === 'found' && r.person.linkedinUrl, 'https://linkedin.com/in/ana');
    assert.equal(r.usage[0].credits_used, null);
  });

  it('por correo con el flag de Lusha apagado: 0 llamadas', async () => {
    let calls = 0;
    const r = await lookupLushaIdentity({ ...BASE, channel: 'email', wantsEmail: false }, {
      isEnabled: () => false,
      search: (async () => {
        calls += 1;
        return { ok: true };
      }) as never,
    });
    assert.equal(r.kind, 'unavailable');
    assert.equal(calls, 0);
  });

  it('por LinkedIn: reutiliza el adaptador de la búsqueda por LinkedIn y devuelve el correo', async () => {
    const urls: string[] = [];
    const r = await lookupLushaIdentity({ ...BASE, channel: 'linkedin', wantsEmail: true }, {
      byLinkedin: (async (url: string) => {
        urls.push(url);
        return {
          kind: 'found',
          profile: { firstName: 'Ana', lastName: 'Ficticia', fullName: 'Ana Ficticia', email: 'ana@empresa.test' },
          usage: [{ provider_key: 'lusha', operation_key: 'lusha_contact_enrich', credits_used: 1, status: 'success', results_returned: 1 }],
        };
      }) as never,
    });
    assert.deepEqual(urls, ['https://www.linkedin.com/in/ana']);
    assert.equal(r.kind === 'found' && r.person.email, 'ana@empresa.test');
  });
});
