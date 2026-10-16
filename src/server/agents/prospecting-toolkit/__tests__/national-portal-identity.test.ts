/**
 * AUDIT-HARDENING-1 — identidad de los ministerios que viven como ruta del portal
 * nacional (`gob.pe/minsa`, `gob.mx/sep`…).
 *
 * WS7 los dejó pasar el filtro de ruido con su ruta como sitio, pero el dominio
 * guardado sigue siendo el del portal. Con `gob.pe` como identidad, todos los
 * ministerios compartían clave (se saltaban como «ya vistos» desde la segunda
 * corrida) y el reclamo `domain:gob.pe` del primero bloqueaba a los demás.
 *
 * Puro: sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildProspectCandidateIdentityKey } from '../prospect-candidate-identity-key';
import { normalizeIdentityDomain } from '../normalization';

describe('identidad de ministerios del portal nacional (AUDIT-HARDENING-1)', () => {
  it('dos ministerios del mismo portal tienen claves distintas', () => {
    const minsa = buildProspectCandidateIdentityKey({ name: 'Ministerio de Salud', domain: 'gob.pe', website: 'https://www.gob.pe/minsa' });
    const minedu = buildProspectCandidateIdentityKey({ name: 'Ministerio de Educación', domain: 'gob.pe', website: 'https://www.gob.pe/minedu' });
    assert.equal(minsa, 'domain:gob.pe/minsa');
    assert.equal(minedu, 'domain:gob.pe/minedu');
  });

  it('la ruta /institucion/<entidad> de gob.pe da la misma clave que la portada de la entidad', () => {
    const key = buildProspectCandidateIdentityKey({ domain: 'gob.pe', website: 'https://www.gob.pe/institucion/minsa/noticias/123' });
    assert.equal(key, 'domain:gob.pe/minsa');
  });

  it('la portada del portal sin entidad no da clave de dominio: cae al nombre', () => {
    const key = buildProspectCandidateIdentityKey({ name: 'Plataforma del Estado Peruano', domain: 'gob.pe', website: 'https://www.gob.pe/' });
    assert.ok(key === null || key.startsWith('name:'), `clave inesperada: ${key}`);
  });

  it('un dominio normal no cambia', () => {
    assert.equal(buildProspectCandidateIdentityKey({ domain: 'siigo.com', website: 'https://www.siigo.com/co' }), 'domain:siigo.com');
  });

  it('el portal nacional no es dominio de identidad (no se reclama ni casa por él)', () => {
    for (const host of ['gob.pe', 'www.gob.mx', 'argentina.gob.ar', 'gub.uy', 'gob.ec', 'https://www.gob.pe/minsa']) {
      assert.equal(normalizeIdentityDomain(host), null, host);
    }
    assert.equal(normalizeIdentityDomain('minsa.gob.pe'), 'minsa.gob.pe');
    assert.equal(normalizeIdentityDomain('siigo.com'), 'siigo.com');
  });
});
