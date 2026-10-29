// AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION — adaptadores Apollo/Lusha con dobles.
// Sin red ni créditos: el cliente de cada proveedor se inyecta.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  lookupApolloIdentityByEmail,
  lookupLushaLinkedinByEmail,
} from '../candidate-identity-completion-providers.server';

const QUERY = { email: 'ana@empresa.test', firstName: 'Ana', lastName: 'Ficticia', organizationName: 'Empresa', domain: 'empresa.test' };

describe('Apollo por correo', () => {
  it('nunca pide teléfono ni correo personal; 1 crédito al responder', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const r = await lookupApolloIdentityByEmail(QUERY, {
      getApiKey: async () => 'k',
      matchPerson: (async (params: Record<string, unknown>) => {
        captured.push(params);
        return {
          success: true,
          data: { id: '0123456789abcdef01234567', first_name: 'Ana', last_name: 'Ficticia', linkedin_url: 'https://linkedin.com/in/ana', title: null, email: null, phone_numbers: [], organization: null },
        };
      }) as never,
    });
    assert.equal(r.kind, 'found');
    assert.equal(captured.length, 1);
    const sent = captured[0];
    assert.equal('reveal_phone_number' in sent, false);
    assert.equal('reveal_personal_emails' in sent, false);
    assert.equal('webhook_url' in sent, false);
    assert.equal(sent.email, 'ana@empresa.test');
    assert.equal(r.usage[0].credits_used, 1);
  });

  it('sin clave: unavailable y 0 llamadas', async () => {
    let calls = 0;
    const r = await lookupApolloIdentityByEmail(QUERY, {
      getApiKey: async () => null,
      matchPerson: (async () => {
        calls += 1;
        return { success: true };
      }) as never,
    });
    assert.equal(r.kind, 'unavailable');
    assert.equal(calls, 0);
  });

  it('error del proveedor: créditos desconocidos (null), nunca 0', async () => {
    const r = await lookupApolloIdentityByEmail(QUERY, {
      getApiKey: async () => 'k',
      matchPerson: (async () => ({ success: false, error: { error: 'HTTP_500' } })) as never,
    });
    assert.equal(r.kind, 'error');
    assert.equal(r.usage[0].credits_used, null);
  });
});

describe('Lusha por correo (sólo búsqueda, nunca enrich)', () => {
  it('trae el LinkedIn de la vista sin revelar', async () => {
    const r = await lookupLushaLinkedinByEmail(QUERY, {
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
    assert.equal(r.kind, 'found');
    assert.equal(r.kind === 'found' && r.person.linkedinUrl, 'https://linkedin.com/in/ana');
    assert.equal(r.usage[0].credits_used, null);
  });

  it('apagado por flag: 0 llamadas', async () => {
    let calls = 0;
    const r = await lookupLushaLinkedinByEmail(QUERY, {
      isEnabled: () => false,
      search: (async () => {
        calls += 1;
        return { ok: true };
      }) as never,
    });
    assert.equal(r.kind, 'unavailable');
    assert.equal(calls, 0);
  });
});
