/**
 * Tests — Entity Verifier (Hito 16AB.23.1)
 *
 * Usa Node.js built-in test runner (node:test + node:assert).
 * Sin dependencias externas de test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEntity, analyzeNameSuspicion, classifyByUrl, isRedditUrl } from '../entity-verifier';

// ─── Fixtures: identidades que DEBEN ser rechazadas ──────────────────────────

describe('classifyEntity — debe rechazar', () => {
  it('rechaza "Artículo Especial [...] Colombia Fintech" como no-empresa', () => {
    const result = classifyEntity(
      'Artículo Especial Libro Empresas Fintech en Colombia sus Retos y Logros, de Colombia Fintech',
      'https://colombiafintech.co/publicaciones/articulo',
      null,
    );
    assert.notEqual(result.entity_type, 'company');
  });

  it('rechaza "Protege tu Negocio..." y envía a resolución de identidad', () => {
    const result = classifyEntity(
      'Protege tu Negocio con la Mejor Empresa de Ciberseguridad en Colombia',
      'https://clusterds.co/protege-tu-negocio-con-la-mejor-empresa-de-ciberseguridad-en-colombia',
      null,
    );
    assert.notEqual(result.entity_type, 'company');
    assert.equal(result.send_to_identity_resolution, true);
  });

  it('rechaza pregunta de Reddit como forum_post', () => {
    const result = classifyEntity(
      '¿Qué software de nómina recomiendan en Colombia para una PyME?',
      'https://www.reddit.com/r/ColombiaDevs/comments/1s3l18k/',
      null,
    );
    assert.equal(result.entity_type, 'forum_post');
    assert.equal(result.send_to_identity_resolution, false);
  });

  it('rechaza "Icon Isotype" como no-empresa', () => {
    const result = classifyEntity(
      'Icon Isotype',
      'https://www.indragroup.com/es/america-latina/colombia',
      null,
    );
    assert.notEqual(result.entity_type, 'company');
  });

  it('rechaza "Paytech 💳 en América Latina" como no-empresa', () => {
    const result = classifyEntity(
      'Paytech 💳 en América Latina',
      'https://www.latamfintech.co/segments/paytech',
      null,
    );
    assert.notEqual(result.entity_type, 'company');
  });

  it('rechaza artículo de puntored y envía a resolución', () => {
    const result = classifyEntity(
      'Fintech y pagos masivos:inclusión financiera para tu empresa',
      'https://puntored.co/fintech-inclusion-financiera-pagos-masivos',
      null,
    );
    assert.notEqual(result.entity_type, 'company');
    assert.equal(result.send_to_identity_resolution, true);
  });

  it('rechaza Colombiafintech como asociación (por descripción)', () => {
    const result = classifyEntity(
      'Colombiafintech',
      'https://colombiafintech.co',
      'Somos la asociación de empresas de tecnología e innovación financiera.',
    );
    assert.equal(result.entity_type, 'association');
  });
});

// ─── Fixtures: identidades que DEBEN pasar a verificación ────────────────────

describe('classifyEntity — debe permitir verificación', () => {
  it('"AXD" no es rechazado directamente — pasa a verificación o resolución', () => {
    const result = classifyEntity(
      'AXD',
      'https://axd.com.co/soluciones-de-ciberseguridad-en-colombia',
      null,
    );
    // Either company (passed) or article with resolution enabled
    if (result.entity_type !== 'company') {
      assert.equal(result.send_to_identity_resolution, true);
    }
  });

  it('"Softland" no es rechazado directamente', () => {
    const result = classifyEntity(
      'Softland',
      'https://softland.com/co/software-gestion-recursos-humanos',
      null,
    );
    if (result.entity_type !== 'company') {
      assert.equal(result.send_to_identity_resolution, true);
    }
  });
});

// ─── analyzeNameSuspicion ─────────────────────────────────────────────────────

describe('analyzeNameSuspicion', () => {
  it('marca nombres con signo de interrogación como sospechosos (forum_post)', () => {
    const r = analyzeNameSuspicion('¿Qué software de nómina recomiendan en Colombia?');
    assert.equal(r.suspicious, true);
    assert.equal(r.likely_type, 'forum_post');
  });

  it('marca nombres con emoji como sospechosos', () => {
    const r = analyzeNameSuspicion('Paytech 💳 en América Latina');
    assert.equal(r.suspicious, true);
  });

  it('marca "Icon Isotype" como sospechoso (unknown)', () => {
    const r = analyzeNameSuspicion('Icon Isotype');
    assert.equal(r.suspicious, true);
    assert.equal(r.likely_type, 'unknown');
  });

  it('marca nombres muy largos como artículo', () => {
    const r = analyzeNameSuspicion('Artículo Especial Libro Empresas Fintech en Colombia sus Retos y Logros de Colombia Fintech y pagos masivos');
    assert.equal(r.suspicious, true);
    assert.equal(r.likely_type, 'article');
  });

  it('no marca "AXD" como sospechoso', () => {
    const r = analyzeNameSuspicion('AXD');
    assert.equal(r.suspicious, false);
  });

  it('no marca "Softland" como sospechoso', () => {
    const r = analyzeNameSuspicion('Softland');
    assert.equal(r.suspicious, false);
  });

  it('no marca "Payments Way" como sospechoso', () => {
    const r = analyzeNameSuspicion('Payments Way');
    assert.equal(r.suspicious, false);
  });
});

// ─── classifyByUrl ────────────────────────────────────────────────────────────

describe('classifyByUrl', () => {
  it('clasifica Reddit como forum_post', () => {
    assert.equal(classifyByUrl('https://www.reddit.com/r/ColombiaDevs/comments/abc'), 'forum_post');
  });

  it('clasifica colombiafintech.co como association', () => {
    assert.equal(classifyByUrl('https://colombiafintech.co'), 'association');
  });

  it('clasifica latamfintech.co/segments como directory', () => {
    assert.equal(classifyByUrl('https://www.latamfintech.co/segments/paytech'), 'directory');
  });

  it('clasifica URLs con /blog/ como article', () => {
    assert.equal(classifyByUrl('https://somecompany.co/blog/fintech-colombia'), 'article');
  });

  it('retorna null para dominio de empresa sin señales', () => {
    assert.equal(classifyByUrl('https://axd.com.co/'), null);
    assert.equal(classifyByUrl('https://softland.com/'), null);
  });
});

// ─── isRedditUrl ──────────────────────────────────────────────────────────────

describe('isRedditUrl', () => {
  it('detecta Reddit correctamente', () => {
    assert.equal(isRedditUrl('https://www.reddit.com/r/ColombiaDevs/comments/abc'), true);
    assert.equal(isRedditUrl('https://reddit.com/r/test'), true);
  });

  it('no detecta sitios normales como Reddit', () => {
    assert.equal(isRedditUrl('https://axd.com.co'), false);
    assert.equal(isRedditUrl('https://softland.com'), false);
    assert.equal(isRedditUrl(null), false);
  });
});
