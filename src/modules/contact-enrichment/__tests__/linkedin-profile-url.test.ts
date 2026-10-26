// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — normalización y rechazo de URLs de LinkedIn.
// URLs ficticias: ninguna corresponde a una persona real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  linkedinProfileKey,
  linkedinSlugIlikePatterns,
  normalizeLinkedinProfileUrl,
} from '../linkedin-profile-url';

describe('normalizeLinkedinProfileUrl', () => {
  it('quita protocolo, subdominio de idioma, parámetros y barra final', () => {
    for (const raw of [
      'https://es.linkedin.com/in/persona-ficticia-123/',
      'http://cl.linkedin.com/in/persona-ficticia-123?trk=public_profile',
      'linkedin.com/in/Persona-Ficticia-123',
      'www.linkedin.com/in/persona-ficticia-123#experience',
      '  https://m.linkedin.com/in/persona-ficticia-123/es/  ',
      'https://www.linkedin.com/in/persona-ficticia-123/details/experience/',
    ]) {
      assert.deepEqual(normalizeLinkedinProfileUrl(raw), {
        ok: true,
        slug: 'persona-ficticia-123',
        canonicalUrl: 'https://www.linkedin.com/in/persona-ficticia-123',
      }, raw);
    }
  });

  it('decodifica tildes para comparar y las vuelve a codificar en la URL canónica', () => {
    const a = normalizeLinkedinProfileUrl('https://www.linkedin.com/in/jos%C3%A9-ficticio');
    const b = normalizeLinkedinProfileUrl('https://co.linkedin.com/in/José-Ficticio/');
    assert.equal(a.ok && a.slug, 'josé-ficticio');
    assert.deepEqual(a, b);
    assert.equal(a.ok && a.canonicalUrl, 'https://www.linkedin.com/in/jos%C3%A9-ficticio');
  });

  it('rechaza páginas de empresa con su propio motivo', () => {
    assert.deepEqual(normalizeLinkedinProfileUrl('https://www.linkedin.com/company/empresa-ficticia/'), {
      ok: false,
      reason: 'company_page',
    });
    assert.equal(normalizeLinkedinProfileUrl('linkedin.com/school/universidad-ficticia').ok, false);
    assert.deepEqual(normalizeLinkedinProfileUrl('linkedin.com/showcase/marca-ficticia'), { ok: false, reason: 'company_page' });
  });

  it('rechaza lo que no es LinkedIn, vacío, sin slug u otros formatos', () => {
    assert.deepEqual(normalizeLinkedinProfileUrl(''), { ok: false, reason: 'empty' });
    assert.deepEqual(normalizeLinkedinProfileUrl('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://example.com/in/persona'), { ok: false, reason: 'not_linkedin' });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://notlinkedin.com/in/persona'), { ok: false, reason: 'not_linkedin' });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://www.linkedin.com/in/'), { ok: false, reason: 'not_profile' });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://www.linkedin.com/feed/'), { ok: false, reason: 'not_profile' });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://www.linkedin.com/pub/persona/1/2/3'), {
      ok: false,
      reason: 'unsupported_profile_format',
    });
    assert.deepEqual(normalizeLinkedinProfileUrl('https://www.linkedin.com/in/ACoAAABCDEFGHIJKLMNOP'), {
      ok: false,
      reason: 'unsupported_profile_format',
    });
    assert.equal(normalizeLinkedinProfileUrl(undefined).ok, false);
  });

  it('la misma clave sirve para comparar los dos lados', () => {
    assert.equal(
      linkedinProfileKey('https://es.linkedin.com/in/Persona-Ficticia/'),
      linkedinProfileKey('linkedin.com/in/persona-ficticia?trk=x'),
    );
    assert.equal(linkedinProfileKey('https://www.linkedin.com/company/x'), null);
  });

  it('los patrones ilike escapan comodines y cubren la forma codificada', () => {
    assert.deepEqual(linkedinSlugIlikePatterns('persona_100%'), ['%/in/persona\\_100\\%%', '%/in/persona\\_100\\%25%']);
    assert.deepEqual(linkedinSlugIlikePatterns('josé'), ['%/in/josé%', '%/in/jos\\%C3\\%A9%']);
    assert.deepEqual(linkedinSlugIlikePatterns('ana-ficticia'), ['%/in/ana-ficticia%']);
  });
});
