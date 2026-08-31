/**
 * ADDENDUM PROVIDER-SEEN §§ 5, 6 y §§ 11.20, 11.21, 11.22 — el plan explicable, y
 * el contrato de Lusha que este PR NO puede suponer.
 *
 * 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 1, 3, 10 (L1-B) — y desde este
 * corte, el contrato de Lusha ya está resuelto: el soporte HUMANO confirmó que
 * `POST /v3/companies/prospecting` NO tiene exclusión del lado del servidor, ni por
 * dominio ni por id de empresa. Las dos dimensiones de Lusha están apagadas.
 *
 * Lo que estas pruebas defienden es que apagarlas NO destruye la evidencia local:
 * `available` y `availableValues` siguen íntegros, y `unsupportedReason` acompaña
 * siempre al vacío, para que «nada enviado» no se lea como «nada conocido».
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

test('§ 5 · CUT-L1 — los ids NO viajan: Lusha V3 no tiene exclusión server-side', () => {
  const plan = planProviderExclusions('lusha', {
    providerSeenIds: ['v1.aaa', 'v1.bbb'],
    sameRunProviderIds: ['v1.ccc'],
  });

  // Se RECOGEN y se CUENTAN — la memoria no se pierde…
  assert.equal(plan.ids.available, 3);
  assert.deepEqual([...plan.ids.availableValues], ['v1.aaa', 'v1.bbb', 'v1.ccc']);
  // …pero no se envía ninguno, y el motivo queda dicho.
  assert.deepEqual([...plan.ids.sent], []);
  assert.equal(plan.ids.omittedDueToCapability, 3);
  assert.equal(
    plan.ids.unsupportedReason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
  );
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.supportsIdExclusion, false);
});

/**
 * 🔴 L1-B — la telemetría de la dimensión de DOMINIOS con la capacidad apagada.
 *
 * Es el caso central del corte: hay dominios conocidos, no se envía ninguno, y la
 * foto tiene que distinguir «no se envió» de «no había». Antes de CUT-L1 esta
 * dimensión estaba encendida para Lusha sobre un contrato que nunca se verificó.
 */
test('🔴 L1-B · Lusha: dominios conocidos > 0, enviados 0, y el motivo dicho', () => {
  const plan = planProviderExclusions('lusha', {
    providerSeenDomains: ['vista.example'],
    sellupKnownDomains: ['cuenta.example'],
    hubspotLocalDomains: ['crm.example'],
    freeSourceAcceptedDomains: ['gratis.example'],
  });

  assert.equal(plan.domains.available, 4, 'available > 0: se sabe lo que se sabe');
  assert.deepEqual(
    [...plan.domains.availableValues],
    ['crm.example', 'cuenta.example', 'gratis.example', 'vista.example'],
    '🔴 y los VALORES sobreviven: son la siembra de la supresión CLIENTE',
  );
  assert.deepEqual([...plan.domains.sent], [], 'sent = 0');
  assert.equal(plan.domains.omittedDueToCapability, 4, 'omitidos por CAPACIDAD, los 4');
  assert.equal(plan.domains.omittedDueToCap, 0, 'ninguno cayó por el tope propio');
  assert.equal(
    plan.domains.unsupportedReason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
  );

  // Y la vista serializable publica las dos cifras, no sólo el cero.
  const metadata = toProviderExclusionPlanMetadata(plan);
  assert.equal(metadata.provider_exclusion_domains_available, 4);
  assert.equal(metadata.provider_exclusion_domains_sent, 0);
  assert.equal(metadata.provider_exclusion_domains_omitted_capability, 4);
  assert.equal(
    metadata.provider_exclusion_domains_unsupported_reason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
  );
});

/**
 * 🔴 L1-B — el tope propio NO puede recortar la evidencia local.
 *
 * `PREPAID_EXCLUSION_DOMAIN_CAP` acotaba una petición. Sin petición, aplicarlo a
 * `availableValues` tiraría conocimiento en silencio, que es exactamente el
 * defecto que este corte evita.
 */
test('🔴 L1-B · `availableValues` NO se recorta por el tope de envío', () => {
  const many = Array.from({ length: PREPAID_EXCLUSION_DOMAIN_CAP + 7 }, (_, i) =>
    `empresa${String(i).padStart(4, '0')}.example`,
  );
  const plan = planProviderExclusions('lusha', { providerSeenDomains: many });

  assert.equal(plan.domains.available, PREPAID_EXCLUSION_DOMAIN_CAP + 7);
  assert.equal(
    plan.domains.availableValues.length,
    PREPAID_EXCLUSION_DOMAIN_CAP + 7,
    '🔴 la evidencia local está COMPLETA',
  );
  assert.deepEqual([...plan.domains.sent], [], 'y nada viaja');
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
  // 🔴 CUT-L1 § 6 — id de proveedor y dominio siguen siendo evidencia
  // INDEPENDIENTE, y por eso las dos dimensiones se comparan por separado.
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
  assert.deepEqual(
    [...withoutIds.domains.availableValues],
    [...withIds.domains.availableValues],
  );
  assert.equal(withoutIds.domains.available, withIds.domains.available);
  assert.equal(withoutIds.domains.omittedDueToCap, withIds.domains.omittedDueToCap);
});

test('§ 11.21 · CUT-L1 — ningún tope inventado: los cuatro son 0 POR CAPACIDAD', () => {
  // 🔴 CUT-L1 § 1 — con las dos dimensiones de Lusha apagadas, su tope de dominios
  // ya no es `PREPAID_EXCLUSION_DOMAIN_CAP`: es 0, y es un HECHO de capacidad, no
  // un número mágico. La constante sigue existiendo como tope de la DIMENSIÓN.
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.domainCap, 0);
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.idCap, 0);
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.idCap, 0);
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.domainCap, 0);
  assert.equal(PREPAID_EXCLUSION_DOMAIN_CAP, 100, 'la constante declarada no se toca');
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
  // 🔴 CUT-L1 § 3 — la lista explicable vive en `availableValues`: `sent` está
  // vacío por capacidad y afirmarla ahí fijaría un envío inexistente.
  assert.deepEqual(
    [...plan.domains.availableValues],
    ['corrida.example', 'crm.example', 'cuenta.example', 'gratis.example', 'vista.example'],
  );
  assert.deepEqual([...plan.domains.sent], []);
});

/**
 * § 6 — el recorte por tope y el recorte por capacidad se cuentan APARTE.
 *
 * 🔴 CUT-L1 — ya no hay proveedor vivo con la capacidad encendida, así que el
 * recorte por tope se demuestra sobre una capacidad SINTÉTICA inyectada. Es la
 * forma de conservar la cobertura del contador sin afirmar que algún proveedor
 * real acepta exclusiones: `planProviderExclusions` recibe la capacidad como
 * tercer parámetro justo para esto.
 */
test('§ 6 — el recorte por tope se CUENTA aparte del recorte por capacidad', () => {
  const many = Array.from({ length: PREPAID_EXCLUSION_DOMAIN_CAP + 7 }, (_, i) =>
    `empresa${String(i).padStart(4, '0')}.example`,
  );
  const hypothetical = {
    ...LUSHA_EXCLUSION_CAPABILITY,
    supportsDomainExclusion: true,
    domainCap: PREPAID_EXCLUSION_DOMAIN_CAP,
    domainExclusionUnsupportedReason: null,
  };
  const plan = planProviderExclusions('lusha', { providerSeenDomains: many }, hypothetical);

  assert.equal(plan.domains.available, PREPAID_EXCLUSION_DOMAIN_CAP + 7);
  assert.equal(plan.domains.availableValues.length, PREPAID_EXCLUSION_DOMAIN_CAP + 7);
  assert.equal(plan.domains.sent.length, PREPAID_EXCLUSION_DOMAIN_CAP);
  assert.equal(plan.domains.omittedDueToCap, 7);
  assert.equal(plan.domains.omittedDueToCapability, 0);

  // 🔴 Y con la capacidad REAL de Lusha, el mismo material no envía nada.
  const real = planProviderExclusions('lusha', { providerSeenDomains: many });
  assert.equal(real.domains.sent.length, 0);
  assert.equal(real.domains.omittedDueToCapability, PREPAID_EXCLUSION_DOMAIN_CAP + 7);
  assert.equal(real.domains.omittedDueToCap, 0);
});

test('§ 5 — la capacidad se resuelve por proveedor, sin valor por defecto compartido', () => {
  assert.equal(resolveProviderExclusionCapability('lusha'), LUSHA_EXCLUSION_CAPABILITY);
  assert.equal(resolveProviderExclusionCapability('apollo'), APOLLO_EXCLUSION_CAPABILITY);

  // 🔴 CUT-L1 § 1 — las dos rutas coinciden hoy en el VALOR (`false`) y difieren en
  // el MOTIVO, y eso es lo que hay que fijar: Lusha por contrato HUMANO negativo,
  // Apollo porque su Organization Search nunca probó exclusiones. Comparar los
  // valores esperando que difieran fijaría el estado anterior al corte.
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.supportsDomainExclusion, false);
  assert.equal(APOLLO_EXCLUSION_CAPABILITY.supportsDomainExclusion, false);
  assert.notEqual(
    LUSHA_EXCLUSION_CAPABILITY.domainExclusionUnsupportedReason,
    APOLLO_EXCLUSION_CAPABILITY.domainExclusionUnsupportedReason,
  );
  assert.equal(
    LUSHA_EXCLUSION_CAPABILITY.domainExclusionUnsupportedReason,
    'lusha_v3_no_server_side_exclusion_human_confirmed',
  );
  assert.equal(
    APOLLO_EXCLUSION_CAPABILITY.domainExclusionUnsupportedReason,
    'apollo_exclusion_contract_unverified',
  );
});
