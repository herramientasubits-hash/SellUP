// Agente 2A — EL PLANIFICADOR de «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Suite PURA: sin PostgreSQL, sin red, sin proveedores, sin env y sin reloj. Lo que se
// afirma aquí son las reglas que deciden si una operación PAGADA puede ocurrir, así que
// cada caso está escrito desde la consecuencia económica o de privacidad, no desde la
// forma del objeto.
//
// La regla que más vigilancia recibe es la primera del módulo: un proveedor que YA
// contestó no se vuelve a llamar. No es una optimización — es que su respuesta completa ya
// está guardada, así que repetirlo cobraría por el mismo payload.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planSearchMorePhones,
  resolveSearchMoreNativeProviders,
  SEARCH_MORE_PROVIDERS,
  type SearchMorePlannerInput,
} from '../search-more-phones-planner';
import { PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS } from '../phone-reveal-waterfall-core';

/** Un id de Apollo REAL en forma: 24 hex. Otra forma se normaliza a NULL. */
const APOLLO_ID = 'a1b2c3d4e5f60718293a4b5c';
/** Un id nativo de Lusha REAL en forma: prefijo `v1.`. */
const LUSHA_ID = 'v1.lusha-native-token';

/**
 * La forma CANÓNICA del candidato que llega a este flujo, y que es exactamente la que la
 * inspección READ-ONLY de Producción encontró: revelado por APOLLO, con UN teléfono
 * guardado, y con las DOS identidades nativas en la misma fila — así que Lusha es el
 * proveedor que falta.
 */
function eligibleInput(
  overrides: Partial<SearchMorePlannerInput> = {},
): SearchMorePlannerInput {
  return {
    featureEnabled: true,
    actorRoleKey: 'admin',
    candidateId: 'candidate-1',
    candidateStatus: 'pending_review',
    storedUnsuppressedPhoneCount: 1,
    apolloPersonId: APOLLO_ID,
    source: 'lusha',
    sourceContactId: LUSHA_ID,
    providersWithStoredProvenance: ['apollo'],
    providersAlreadySearchedForMore: [],
    hasActivePhoneRun: false,
    privacyState: 'clear',
    ...overrides,
  };
}

describe('AGENT2A-SEARCH-MORE-PHONES-1 · planificador', () => {
  // ───────────────────────────────────────────────────────────────
  // §18.2 — el caso feliz, y qué exactamente autoriza
  // ───────────────────────────────────────────────────────────────

  it('1 teléfono + proveedor nativo alterno ⇒ ELEGIBLE, y sólo ese proveedor', () => {
    const plan = planSearchMorePhones(eligibleInput());

    assert.equal(plan.eligible, true);
    assert.equal(plan.phase, 'has_phone_provider_available');
    assert.equal(plan.reason, null);
    assert.deepEqual(
      plan.providersToTry,
      ['lusha'],
      'Apollo ya contestó: NO puede volver a aparecer en el plan',
    );
    assert.equal(plan.alreadyExhausted, false);
  });

  it('el techo es UNA pata por proveedor consultable, nunca los 13 del waterfall', () => {
    const one = planSearchMorePhones(eligibleInput());
    assert.equal(one.maxCreditRequirement, PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS);

    // Un candidato cuya colección no tiene procedencia de NINGUNO de los dos: los dos son
    // consultables, así que el techo es el doble. Sigue sin ser 13: Apollo no corre como
    // primera pata de un reveal aquí, corre como fuente adicional.
    const two = planSearchMorePhones(
      eligibleInput({ providersWithStoredProvenance: ['apollo_cache'] }),
    );
    assert.deepEqual(two.providersToTry, ['lusha', 'apollo']);
    assert.equal(two.maxCreditRequirement, 2 * PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS);
    assert.notEqual(two.maxCreditRequirement, 13);
  });

  // ───────────────────────────────────────────────────────────────
  // §18.1 — sin teléfono NO es este camino
  // ───────────────────────────────────────────────────────────────

  it('sin teléfono almacenado ⇒ NO elegible, y la fase dice que toca el reveal normal', () => {
    const plan = planSearchMorePhones(eligibleInput({ storedUnsuppressedPhoneCount: 0 }));

    assert.equal(plan.eligible, false);
    assert.equal(
      plan.phase,
      'no_phone_yet',
      'la UI necesita saber que debe ofrecer «Revelar teléfono», no este botón deshabilitado',
    );
    assert.equal(plan.reason, 'no_stored_phone');
    assert.deepEqual(plan.providersToTry, []);
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('un conteo no entero o negativo se trata como CERO (fail-closed)', () => {
    for (const count of [-1, 0.5, Number.NaN]) {
      const plan = planSearchMorePhones(
        eligibleInput({ storedUnsuppressedPhoneCount: count }),
      );
      assert.equal(plan.phase, 'no_phone_yet', `conteo ${count} debía leerse como 0`);
    }
  });

  // ───────────────────────────────────────────────────────────────
  // §18.3 / §18.13 — LA REGLA: un proveedor que ya contestó no se repite
  // ───────────────────────────────────────────────────────────────

  it('un proveedor con procedencia ALMACENADA nunca vuelve al plan', () => {
    // Los dos proveedores ya escribieron en la colección. No queda nada que preguntar sin
    // pagar por una respuesta ya guardada.
    const plan = planSearchMorePhones(
      eligibleInput({ providersWithStoredProvenance: ['apollo', 'lusha'] }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.phase, 'has_phone_no_provider_available');
    assert.equal(plan.reason, 'no_additional_provider');
    assert.deepEqual(plan.providersToTry, []);
    assert.equal(plan.maxCreditRequirement, 0, 'no se autoriza NI UN crédito');
    assert.equal(plan.alreadyExhausted, true);
  });

  it('la comparación de proveedor NO es sensible a mayúsculas ni a espacios', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ providersWithStoredProvenance: ['  APOLLO ', 'Lusha'] }),
    );
    assert.equal(
      plan.eligible,
      false,
      'un `LUSHA` con espacios seguiría siendo Lusha: repetirlo sería un cobro doble',
    );
    assert.equal(plan.reason, 'no_additional_provider');
  });

  // ───────────────────────────────────────────────────────────────
  // §18.25 — agotamiento: no se gasta dos veces contra lo mismo
  // ───────────────────────────────────────────────────────────────

  it('un proveedor ya consultado por ADICIONALES queda agotado, con su propia razón', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ providersAlreadySearchedForMore: ['lusha'] }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.phase, 'providers_exhausted');
    assert.equal(
      plan.reason,
      'providers_exhausted',
      'se distingue de `no_additional_provider`: el copy honesto es distinto',
    );
    assert.equal(plan.alreadyExhausted, true);
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('una identidad nativa NUEVA reabre la elegibilidad aunque otra esté agotada', () => {
    // Lusha ya se consultó por adicionales, pero la colección no tiene procedencia de
    // Apollo. Apollo sigue siendo una fuente legítima no preguntada.
    const plan = planSearchMorePhones(
      eligibleInput({
        providersWithStoredProvenance: [],
        providersAlreadySearchedForMore: ['lusha'],
      }),
    );

    assert.equal(plan.eligible, true);
    assert.deepEqual(plan.providersToTry, ['apollo']);
  });

  // ───────────────────────────────────────────────────────────────
  // §18.11 / §18.12 — identidad: sin id nativo no hay pata, y NUNCA hay búsqueda
  // ───────────────────────────────────────────────────────────────

  it('sin identidad de Lusha, Lusha NO entra al plan (jamás se busca por nombre o email)', () => {
    // Candidato de origen Apollo: su `source_contact_id` pertenece al espacio de ids de
    // Apollo y reenviarlo a Lusha es la causa raíz del HTTP 422 del RCA.
    const plan = planSearchMorePhones(
      eligibleInput({
        source: 'apollo',
        sourceContactId: APOLLO_ID,
        providersWithStoredProvenance: ['apollo'],
      }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'no_additional_provider');
    assert.deepEqual(
      plan.providersToTry,
      [],
      'no existe ninguna vía que fabrique una identidad de Lusha',
    );
  });

  it('sin NINGUNA identidad nativa ⇒ `missing_person_identity`, no un bloqueo genérico', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ apolloPersonId: null, source: null, sourceContactId: null }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'missing_person_identity');
    assert.deepEqual(plan.providersToTry, []);
  });

  it('un `source_contact_id` en blanco NO cuenta como identidad', () => {
    for (const blank of ['', '   ', null]) {
      const providers = resolveSearchMoreNativeProviders({
        apolloPersonId: null,
        source: 'lusha',
        sourceContactId: blank,
      });
      assert.deepEqual(providers, [], `«${blank}» no puede resolver una identidad`);
    }
  });

  it('un id de Apollo mal formado NO resuelve identidad de Apollo', () => {
    const providers = resolveSearchMoreNativeProviders({
      apolloPersonId: 'apollo-person-1',
      source: null,
      sourceContactId: null,
    });
    assert.deepEqual(
      providers,
      [],
      'la forma la valida `resolvePhoneRevealProviderIdentity`, no este módulo',
    );
  });

  it('las DOS identidades de la MISMA fila se leen, y eso NO es la Fase 2', () => {
    const providers = resolveSearchMoreNativeProviders({
      apolloPersonId: APOLLO_ID,
      source: 'lusha',
      sourceContactId: LUSHA_ID,
    });
    assert.deepEqual(providers.slice().sort(), ['apollo', 'lusha']);
  });

  it('el conjunto de proveedores es CERRADO', () => {
    assert.deepEqual([...SEARCH_MORE_PROVIDERS], ['apollo', 'lusha']);
  });

  // ───────────────────────────────────────────────────────────────
  // §18.9 / §18.10 — privacidad, fail-closed en las tres ramas
  // ───────────────────────────────────────────────────────────────

  it('supresión confirmada ⇒ NO elegible y 0 créditos autorizados', () => {
    const plan = planSearchMorePhones(eligibleInput({ privacyState: 'blocked_suppressed' }));
    assert.equal(plan.eligible, false);
    assert.equal(plan.phase, 'privacy_blocked');
    assert.equal(plan.reason, 'blocked_suppressed');
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('`do_not_contact` ⇒ NO elegible, con su propia razón', () => {
    const plan = planSearchMorePhones(eligibleInput({ privacyState: 'do_not_contact' }));
    assert.equal(plan.reason, 'do_not_contact');
  });

  it('privacidad NO EVALUABLE bloquea igual, pero NO se registra como supresión', () => {
    const plan = planSearchMorePhones(eligibleInput({ privacyState: 'check_unavailable' }));

    assert.equal(plan.eligible, false, 'fail-closed: el efecto es el mismo');
    assert.equal(
      plan.reason,
      'suppression_check_unavailable',
      'la afirmación NO es la misma: SellUp no declara un veredicto que no obtuvo',
    );
    assert.notEqual(plan.reason, 'blocked_suppressed');
  });

  it('`unknown` (el cliente aún no lo sabe) no bloquea el botón pero tampoco autoriza', () => {
    const plan = planSearchMorePhones(eligibleInput({ privacyState: 'unknown' }));
    assert.equal(
      plan.eligible,
      true,
      'el botón puede mostrarse; la autoridad sigue siendo el servidor, que revalida',
    );
  });

  // ───────────────────────────────────────────────────────────────
  // §18.6 — una sola operación viva por candidato
  // ───────────────────────────────────────────────────────────────

  it('con una corrida de teléfono activa ⇒ deshabilitado, no una segunda autorización', () => {
    const plan = planSearchMorePhones(eligibleInput({ hasActivePhoneRun: true }));

    assert.equal(plan.eligible, false);
    assert.equal(plan.phase, 'search_more_already_running');
    assert.equal(plan.reason, 'active_run_exists');
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('la corrida activa se evalúa ANTES que la privacidad y que los proveedores', () => {
    // Con TODO lo demás también bloqueado, la razón devuelta debe seguir siendo la corrida
    // activa: es la comprobación más barata que impide una segunda compra, y el orden
    // barato→caro es parte del contrato.
    const plan = planSearchMorePhones(
      eligibleInput({
        hasActivePhoneRun: true,
        privacyState: 'blocked_suppressed',
        providersWithStoredProvenance: ['apollo', 'lusha'],
      }),
    );
    assert.equal(plan.reason, 'active_run_exists');
  });

  // ───────────────────────────────────────────────────────────────
  // Puertas baratas: flag, rol y estado del candidato
  // ───────────────────────────────────────────────────────────────

  it('flag apagado ⇒ NO elegible, y se evalúa antes que cualquier otra cosa', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ featureEnabled: false, actorRoleKey: null, candidateId: null }),
    );
    assert.equal(plan.reason, 'feature_disabled');
  });

  it('sólo `admin` autoriza esta compra', () => {
    for (const role of ['viewer', 'editor', 'sales', '', null]) {
      const plan = planSearchMorePhones(eligibleInput({ actorRoleKey: role }));
      assert.equal(plan.eligible, false, `el rol ${role} no debía autorizar`);
      assert.equal(plan.reason, 'role_not_allowed');
    }
    assert.equal(planSearchMorePhones(eligibleInput({ actorRoleKey: 'admin' })).eligible, true);
  });

  it('un candidato en estado terminal ya no se edita', () => {
    for (const status of ['approved', 'rejected', 'discarded', 'archived']) {
      const plan = planSearchMorePhones(eligibleInput({ candidateStatus: status }));
      assert.equal(plan.eligible, false, `${status} no debía permitir gasto`);
      assert.equal(plan.reason, 'candidate_not_editable');
    }
  });

  it('un candidato sin estado registrado NO se bloquea por eso', () => {
    const plan = planSearchMorePhones(eligibleInput({ candidateStatus: null }));
    assert.equal(plan.eligible, true, 'la ausencia de estado no es un estado terminal');
  });

  it('es PURO: la misma entrada da la misma salida y no muta el argumento', () => {
    const input = eligibleInput();
    const snapshot = JSON.stringify(input);
    const a = planSearchMorePhones(input);
    const b = planSearchMorePhones(input);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(input), snapshot, 'el planificador no muta su entrada');
  });
});
