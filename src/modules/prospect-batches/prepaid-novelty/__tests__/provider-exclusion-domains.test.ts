/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 11, 22(H), 22(I).
 * AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION § 3 — y la separación entre lo que se
 * CONOCE (`availableValues`) y lo que podría ENVIARSE (`sent`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeExclusionDomain,
  planProviderExclusionDomains,
  PREPAID_EXCLUSION_DOMAIN_CAP,
} from '../provider-exclusion-domains';

test('§ 22(H) — normaliza, deduplica y ordena de forma determinista', () => {
  const plan = planProviderExclusionDomains([
    'https://WWW.Acme.com/contacto?x=1',
    'acme.com',
    'http://acme.com:8443',
    'zeta.co',
    'beta.com.co',
  ]);

  assert.deepEqual([...plan.sent], ['acme.com', 'beta.com.co', 'zeta.co']);
  assert.equal(plan.available, 3);
  assert.equal(plan.omittedDueToCap, 0);
});

test('§ 22(I) — un valor que no puede ser dominio NO se fabrica: se descarta', () => {
  assert.equal(normalizeExclusionDomain(null), null);
  assert.equal(normalizeExclusionDomain(''), null);
  assert.equal(normalizeExclusionDomain('   '), null);
  assert.equal(normalizeExclusionDomain('Clínica Andes S.A.S.'), null);
  assert.equal(normalizeExclusionDomain('localhost'), null);
  assert.equal(normalizeExclusionDomain('900123456'), null);

  const plan = planProviderExclusionDomains([null, undefined, 'Sin Web S.A.', 'real.com']);
  assert.deepEqual([...plan.sent], ['real.com']);
});

test('§ 11 — el recorte por tope se CUENTA, nunca es silencioso', () => {
  const domains = Array.from({ length: PREPAID_EXCLUSION_DOMAIN_CAP + 25 }, (_, i) =>
    `empresa${String(i).padStart(4, '0')}.com`,
  );
  const plan = planProviderExclusionDomains(domains);

  assert.equal(plan.available, PREPAID_EXCLUSION_DOMAIN_CAP + 25);
  assert.equal(plan.sent.length, PREPAID_EXCLUSION_DOMAIN_CAP);
  assert.equal(plan.omittedDueToCap, 25);
  // available = sent + omitted, siempre. Sin esta identidad el conteo mentiría.
  assert.equal(plan.sent.length + plan.omittedDueToCap, plan.available);
});

test('§ 11 — la selección bajo tope es DETERMINISTA: dos ordenaciones distintas producen la misma lista', () => {
  const source = ['delta.com', 'alfa.com', 'charlie.com', 'bravo.com'];
  const a = planProviderExclusionDomains(source, 2);
  const b = planProviderExclusionDomains([...source].reverse(), 2);
  assert.deepEqual([...a.sent], [...b.sent]);
  assert.deepEqual([...a.sent], ['alfa.com', 'bravo.com']);
});

test('tope 0 ⇒ no viaja ninguno, y los conocidos se siguen contando', () => {
  const plan = planProviderExclusionDomains(['a.com', 'b.com'], 0);
  assert.deepEqual([...plan.sent], []);
  assert.equal(plan.available, 2);
  assert.equal(plan.omittedDueToCap, 2);
});

/**
 * 🔴 CUT-L1 § 3 — `availableValues` responde «¿qué sabe SellUp?» y `sent` «¿qué
 * puede enviarse?». La segunda se acota; la primera JAMÁS.
 *
 * Dicho como defecto: si el tope recortara también lo conocido, apagar la
 * capacidad de un proveedor —que es exactamente lo que CUT-L1 hace con Lusha—
 * dejaría la supresión CLIENTE sin evidencia, en silencio.
 */
test('🔴 CUT-L1 § 3 — `availableValues` NO se recorta por el tope de envío', () => {
  const domains = Array.from({ length: PREPAID_EXCLUSION_DOMAIN_CAP + 25 }, (_, i) =>
    `empresa${String(i).padStart(4, '0')}.com`,
  );
  const plan = planProviderExclusionDomains(domains);

  assert.equal(plan.availableValues.length, PREPAID_EXCLUSION_DOMAIN_CAP + 25);
  assert.equal(plan.availableValues.length, plan.available);
  assert.equal(plan.sent.length, PREPAID_EXCLUSION_DOMAIN_CAP);
  // `sent` es un PREFIJO de lo conocido: la misma lista, recortada, no otra.
  assert.deepEqual([...plan.sent], plan.availableValues.slice(0, PREPAID_EXCLUSION_DOMAIN_CAP));
});

test('🔴 CUT-L1 § 3 — con tope 0 lo conocido sigue ENTERO y normalizado', () => {
  const plan = planProviderExclusionDomains(
    ['https://WWW.Acme.com/x', 'acme.com', null, 'zeta.co', 'Sin Web S.A.'],
    0,
  );

  assert.deepEqual([...plan.sent], [], 'nada viaja');
  assert.deepEqual(
    [...plan.availableValues],
    ['acme.com', 'zeta.co'],
    '🔴 y aun así se sabe exactamente qué se conoce',
  );
  assert.equal(plan.available, 2);
});
