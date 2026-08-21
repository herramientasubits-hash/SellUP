/**
 * ADDENDUM PROVIDER-SEEN §§ 5, 6 y §§ 11.20, 11.21, 11.22 — el plan explicable, y
 * el contrato de Lusha que este PR NO puede suponer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PREPAID_EXCLUSION_DOMAIN_CAP } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import {
  APOLLO_EXCLUSION_CAPABILITY,
  LUSHA_EXCLUSION_CAPABILITY,
  planProviderExclusions,
  resolveProviderExclusionCapability,
  toProviderExclusionPlanMetadata,
} from '../provider-exclusion-planner';

test('§ 5 — los ids NO viajan mientras el contrato humano de Lusha no llegue', () => {
  const plan = planProviderExclusions('lusha', {
    providerSeenIds: ['v1.aaa', 'v1.bbb'],
    sameRunProviderIds: ['v1.ccc'],
  });

  // Se RECOGEN y se CUENTAN — la memoria no se pierde…
  assert.equal(plan.ids.available, 3);
  // …pero no se envía ninguno, y el motivo queda dicho.
  assert.deepEqual([...plan.ids.sent], []);
  assert.equal(plan.ids.omittedDueToCapability, 3);
  assert.equal(plan.ids.unsupportedReason, 'lusha_exclude_ids_contract_unconfirmed');
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.supportsIdExclusion, false);
});

test('§ 6 — Apollo no recibe NINGUNA exclusión: su contrato no la prueba', () => {
  const plan = planProviderExclusions('apollo', {
    providerSeenDomains: ['a.example'],
    sellupKnownDomains: ['b.example'],
    providerSeenIds: ['org-1'],
  });

  assert.deepEqual([...plan.domains.sent], []);
  assert.deepEqual([...plan.ids.sent], []);
  assert.equal(plan.domains.available, 2, 'se sabe lo que se sabe, aunque no viaje');
  assert.equal(plan.domains.omittedDueToCapability, 2);
  assert.equal(plan.domains.unsupportedReason, 'apollo_exclusion_contract_unverified');
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.supportsDomainExclusion, false);
});

test('§ 11.22 — el plan de DOMINIOS no depende de que haya ids: semántica combinada NO supuesta', () => {
  const withoutIds = planProviderExclusions('lusha', {
    providerSeenDomains: ['zeta.example', 'alfa.example'],
    sellupKnownDomains: ['beta.example'],
  });
  const withIds = planProviderExclusions('lusha', {
    providerSeenDomains: ['zeta.example', 'alfa.example'],
    sellupKnownDomains: ['beta.example'],
    providerSeenIds: ['v1.aaa', 'v1.bbb', 'v1.ccc'],
    sameRunProviderIds: ['v1.ddd'],
  });

  // Byte a byte la misma lista. Si el día de mañana alguien introdujera un tope
  // conjunto o una lista mezclada, esto fallaría antes de llegar a producción.
  assert.deepEqual([...withoutIds.domains.sent], [...withIds.domains.sent]);
  assert.equal(withoutIds.domains.available, withIds.domains.available);
  assert.equal(withoutIds.domains.omittedDueToCap, withIds.domains.omittedDueToCap);
});

test('§ 11.21 — no hay un máximo de exclusiones inventado: el tope de dominios es el DECLARADO del repo', () => {
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.domainCap, PREPAID_EXCLUSION_DOMAIN_CAP);
  // El tope de ids no es un número mágico: es 0 PORQUE la capacidad está apagada.
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.idCap, 0);
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.idCap, 0);
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.domainCap, 0);
});

test('§ 11.20 — el plan no afirma nada sobre relleno de página («backfill») ni sobre orden', () => {
  const plan = planProviderExclusions('lusha', { sellupKnownDomains: ['a.example'] });
  const metadata = toProviderExclusionPlanMetadata(plan);
  const surface = JSON.stringify(metadata).toLowerCase();

  for (const forbidden of ['backfill', 'refill', 'page_fill', 'guarantee', 'ordering']) {
    assert.equal(surface.includes(forbidden), false, forbidden);
  }
  // Y el plan sólo declara cuántos se envían, jamás cuántas filas volverán.
  assert.deepEqual(Object.keys(plan).sort(), ['domains', 'ids', 'provider']);
});

test('§ 6 — el plan es EXPLICABLE: dice de qué procedencia salió cada exclusión', () => {
  const plan = planProviderExclusions('lusha', {
    providerSeenDomains: ['vista.example'],
    sellupKnownDomains: ['cuenta.example', 'cuenta.example'],
    hubspotLocalDomains: ['crm.example'],
    freeSourceAcceptedDomains: ['gratis.example'],
    sameRunDomains: ['corrida.example'],
  });

  assert.deepEqual(plan.domains.bySource, {
    provider_seen: 1,
    sellup_known: 2,
    hubspot_local: 1,
    free_source_accepted: 1,
    same_run: 1,
  });
  // 6 aportaciones, 5 dominios únicos: el desglose cuenta APORTACIONES y el total
  // cuenta identidades. Mezclarlos haría que la suma pareciera cuadrar y no.
  assert.equal(plan.domains.available, 5);
  assert.deepEqual(
    [...plan.domains.sent],
    ['corrida.example', 'crm.example', 'cuenta.example', 'gratis.example', 'vista.example'],
  );
});

test('§ 6 — el recorte por tope se CUENTA aparte del recorte por capacidad', () => {
  const many = Array.from({ length: PREPAID_EXCLUSION_DOMAIN_CAP + 7 }, (_, i) =>
    `empresa${String(i).padStart(4, '0')}.example`,
  );
  const plan = planProviderExclusions('lusha', { providerSeenDomains: many });

  assert.equal(plan.domains.available, PREPAID_EXCLUSION_DOMAIN_CAP + 7);
  assert.equal(plan.domains.sent.length, PREPAID_EXCLUSION_DOMAIN_CAP);
  assert.equal(plan.domains.omittedDueToCap, 7);
  assert.equal(plan.domains.omittedDueToCapability, 0);
});

test('§ 5 — la capacidad se resuelve por proveedor, sin valor por defecto compartido', () => {
  assert.equal(resolveProviderExclusionCapability('lusha'), LUSHA_EXCLUSION_CAPABILITY);
  assert.equal(resolveProviderExclusionCapability('apollo'), APOLLO_EXCLUSION_CAPABILITY);
  assert.notEqual(
    LUSHA_EXCLUSION_CAPABILITY.supportsDomainExclusion,
    APOLLO_EXCLUSION_CAPABILITY.supportsDomainExclusion,
  );
});
