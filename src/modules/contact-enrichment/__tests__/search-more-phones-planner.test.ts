// Agente 2A — EL PLANIFICADOR de «Buscar más números»
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// Suite PURA: sin PostgreSQL, sin red, sin proveedores, sin env y sin reloj. Lo que se
// afirma aquí son las reglas que deciden si una operación PAGADA puede ocurrir, así que
// cada caso está escrito desde la consecuencia económica o de privacidad, no desde la
// forma del objeto.
//
// La regla que más vigilancia recibe es la primera del módulo: Lusha, el ÚNICO proveedor
// de v1, no se llama dos veces. No es una optimización — es que su respuesta completa ya
// está guardada desde 4O-D, así que repetirla cobraría por el mismo payload.
//
// Y la que más consecuencia tiene si se relaja: v1 es LUSHA-ONLY. Ninguna entrada —una
// identidad de Apollo, una colección sin procedencia, un `source` desconocido— puede hacer
// que el plan proponga a Apollo, porque no existe operación de Apollo que produzca números
// que Apollo no haya dado ya.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planSearchMorePhones,
  resolveSearchMoreNativeProviders,
  SEARCH_MORE_BUDGET_MODE,
  SEARCH_MORE_MAX_CREDITS,
  SEARCH_MORE_PROVIDER,
  SEARCH_MORE_PROVIDERS,
  type SearchMorePlannerInput,
} from '../search-more-phones-planner';
import {
  evaluatePhoneRevealCreditBudget,
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
  resolvePhoneRevealCreditBudgetProviders,
  resolvePhoneRevealCreditBudgetRequiredCredits,
} from '../phone-reveal-credit-budget-core';

/** Un id de Apollo REAL en forma: 24 hex. En v1 NUNCA habilita nada. */
const APOLLO_ID = 'a1b2c3d4e5f60718293a4b5c';
/** Un id nativo de Lusha REAL en forma: prefijo `v1.`. */
const LUSHA_ID = 'v1.lusha-native-token';
/** Un id de contacto oficial REAL en forma: uuid v4. */
const OFFICIAL_CONTACT_ID = 'd6f35a76-bce1-46d4-a7e8-8af1591aef87';

/**
 * La forma CANÓNICA del candidato que llega a este flujo, y que es exactamente la que la
 * inspección READ-ONLY de Producción encontró: revelado por APOLLO, con UN teléfono
 * guardado, y con identidad nativa de LUSHA en la misma fila — así que Lusha es el
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
    // Sin destino registrado por default: la mayoría de estos casos describe un candidato
    // NO aprobado, para el que `officialContactId` no importa. Los casos de la sección
    // AGENT2A-SEARCH-MORE-APPROVED-CONTACT-1 lo sobreescriben explícitamente.
    officialContactId: null,
    storedUnsuppressedPhoneCount: 1,
    source: 'lusha',
    sourceContactId: LUSHA_ID,
    providersWithStoredProvenance: ['apollo'],
    providersAlreadySearchedForMore: [],
    hasActivePhoneRun: false,
    privacyState: 'clear',
    // El pozo de Lusha respalda el techo. Es un HECHO más del preflight desde 1K, y su
    // default es «hay saldo» para que los casos de este archivo sigan hablando de lo que
    // hablaban; los casos de presupuesto lo sobreescriben explícitamente.
    budgetDecision: 'authorized',
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

  it('el techo es el de LA pata que se va a reservar, nunca los 13 del waterfall', () => {
    const plan = planSearchMorePhones(eligibleInput());
    assert.equal(plan.maxCreditRequirement, PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS);
    assert.equal(plan.budgetMode, 'search_more_lusha');
    assert.notEqual(plan.maxCreditRequirement, 13);
  });

  it('una colección SIN procedencia de nadie sigue autorizando SÓLO a Lusha', () => {
    // Sólo caché en la colección: nadie escribió procedencia nativa. Aun así el plan no
    // puede proponer a Apollo — no existe una pata de Apollo que ejecutar.
    const plan = planSearchMorePhones(
      eligibleInput({ providersWithStoredProvenance: ['apollo_cache'] }),
    );

    assert.deepEqual(plan.providersToTry, ['lusha']);
    assert.equal(
      plan.maxCreditRequirement,
      PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
      'un solo pozo, el de Lusha: el de Apollo no se lee ni se ocupa',
    );
  });

  it('LUSHA ya contestó ⇒ NO elegible: Apollo NO es un plan alternativo', () => {
    // La trampa que v1 cierra. Con la procedencia de Lusha ya en la colección, el diseño
    // de dos proveedores habría propuesto una pata de Apollo con techo 8. No hay tal pata:
    // la respuesta de Apollo ya está guardada ENTERA desde 4O-C.
    const plan = planSearchMorePhones(
      eligibleInput({ providersWithStoredProvenance: ['lusha'] }),
    );

    assert.equal(plan.eligible, false);
    assert.deepEqual(plan.providersToTry, []);
    assert.equal(plan.reason, 'no_additional_provider');
    assert.equal(plan.maxCreditRequirement, 0, 'NI UN crédito, y menos los 8 de Apollo');
    assert.equal(plan.budgetMode, null);
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

  it('Lusha agotada NO se reabre porque la colección esté vacía de procedencia', () => {
    // Colección sin ninguna procedencia nativa Y Lusha ya consultada por adicionales. No
    // queda nada: el agotamiento de la ÚNICA fuente es el agotamiento de todas.
    const plan = planSearchMorePhones(
      eligibleInput({
        providersWithStoredProvenance: [],
        providersAlreadySearchedForMore: ['lusha'],
      }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.phase, 'providers_exhausted');
    assert.equal(plan.reason, 'providers_exhausted');
    assert.deepEqual(plan.providersToTry, []);
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('§18: el agotamiento NO depende del desenlace de la corrida anterior', () => {
    // `revealed`, `no_phone_found`, `no_new_distinct_phone` y `error` producen todos la
    // MISMA entrada aquí —Lusha en `providersAlreadySearchedForMore`— porque el planificador
    // lee que la corrida fue TERMINAL, no cómo terminó. Un error del proveedor no compra un
    // reintento pagado automático.
    const plan = planSearchMorePhones(
      eligibleInput({ providersAlreadySearchedForMore: ['LUSHA'] }),
    );
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'providers_exhausted');
  });

  // ───────────────────────────────────────────────────────────────
  // §18.11 / §18.12 — identidad: sin id nativo no hay pata, y NUNCA hay búsqueda
  // ───────────────────────────────────────────────────────────────

  it('un candidato de origen APOLLO no tiene fuente adicional (jamás se busca por nombre)', () => {
    // Su `source_contact_id` pertenece al espacio de ids de Apollo, y reenviarlo a Lusha es
    // la causa raíz del HTTP 422 del RCA. No hay identidad de Lusha ⇒ no hay operación.
    const plan = planSearchMorePhones(
      eligibleInput({
        source: 'apollo',
        sourceContactId: APOLLO_ID,
        providersWithStoredProvenance: ['apollo'],
      }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(
      plan.reason,
      'missing_person_identity',
      'no es «no queda fuente»: es que este candidato nunca tuvo identidad de Lusha',
    );
    assert.deepEqual(
      plan.providersToTry,
      [],
      'no existe ninguna vía que fabrique una identidad de Lusha',
    );
  });

  it('sin identidad nativa ⇒ `missing_person_identity`, no un bloqueo genérico', () => {
    const plan = planSearchMorePhones(eligibleInput({ source: null, sourceContactId: null }));

    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'missing_person_identity');
    assert.deepEqual(plan.providersToTry, []);
  });

  it('un `source_contact_id` en blanco NO cuenta como identidad', () => {
    for (const blank of ['', '   ', null]) {
      const providers = resolveSearchMoreNativeProviders({
        source: 'lusha',
        sourceContactId: blank,
      });
      assert.deepEqual(providers, [], `«${blank}» no puede resolver una identidad`);
    }
  });

  it('SÓLO `source = lusha` resuelve identidad: ninguna otra fuente cuenta', () => {
    for (const source of ['apollo', 'tavily', 'manual', 'hubspot', null, '']) {
      const providers = resolveSearchMoreNativeProviders({
        source,
        sourceContactId: LUSHA_ID,
      });
      assert.deepEqual(
        providers,
        [],
        `source «${source}» no puede habilitar una consulta a Lusha`,
      );
    }
    assert.deepEqual(
      resolveSearchMoreNativeProviders({ source: ' Lusha ', sourceContactId: LUSHA_ID }),
      ['lusha'],
      'el recorte y las mayúsculas sí se normalizan',
    );
  });

  it('el conjunto de proveedores es CERRADO y contiene SÓLO Lusha', () => {
    assert.deepEqual(
      [...SEARCH_MORE_PROVIDERS],
      ['lusha'],
      'Apollo en este conjunto autorizaría un gasto que ninguna rama puede cobrar',
    );
    assert.equal(SEARCH_MORE_PROVIDER, 'lusha');
  });

  it('NINGUNA entrada consigue que el plan proponga a Apollo', () => {
    // Barrido adversarial sobre los ejes que el diseño de dos proveedores usaba para
    // elegir a Apollo: la fuente, la procedencia almacenada y el historial de búsquedas.
    for (const source of ['lusha', 'apollo', 'tavily', null]) {
      for (const provenance of [[], ['apollo'], ['lusha'], ['apollo_cache'], ['apollo', 'lusha']]) {
        for (const searched of [[], ['lusha'], ['apollo']]) {
          const plan = planSearchMorePhones(
            eligibleInput({
              source,
              providersWithStoredProvenance: provenance,
              providersAlreadySearchedForMore: searched,
            }),
          );
          assert.ok(
            !plan.providersToTry.includes('apollo' as never),
            `source=${source} provenance=${provenance} searched=${searched} propuso Apollo`,
          );
          if (plan.eligible) {
            assert.deepEqual(plan.providersToTry, ['lusha']);
            assert.equal(plan.budgetMode, 'search_more_lusha');
            assert.equal(
              plan.maxCreditRequirement,
              PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
            );
          }
        }
      }
    }
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
        providersWithStoredProvenance: ['lusha'],
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

  it('rejected/discarded/archived siguen bloqueados SIN excepción, aunque haya contacto oficial', () => {
    // Éstos NO tienen un contacto vivo al que proyectar nada: `officialContactId` no los
    // reabre, a diferencia de `approved`.
    for (const status of ['rejected', 'discarded', 'archived']) {
      const plan = planSearchMorePhones(
        eligibleInput({ candidateStatus: status, officialContactId: OFFICIAL_CONTACT_ID }),
      );
      assert.equal(plan.eligible, false, `${status} no debía permitir gasto`);
      assert.equal(plan.reason, 'candidate_not_editable');
    }
  });

  it('un candidato sin estado registrado NO se bloquea por eso', () => {
    const plan = planSearchMorePhones(eligibleInput({ candidateStatus: null }));
    assert.equal(plan.eligible, true, 'la ausencia de estado no es un estado terminal');
  });

  // ───────────────────────────────────────────────────────────────
  // AGENT2A-SEARCH-MORE-APPROVED-CONTACT-1 — «approved» ya no es congelado
  // ───────────────────────────────────────────────────────────────
  //
  // El mismo defecto que #361 cerró para el waterfall principal: todo contacto oficial ES,
  // por definición, un candidato `approved`, así que bloquearlo sin excepción hacía
  // ESTRUCTURALMENTE imposible «Buscar más números» sobre el botón que el panel de rescate
  // del contacto oficial ya ofrece (PR #361). La corrección es la MISMA que allí: `approved`
  // deja de estar congelado cuando trae un `officialContactId` registrado.

  it('APROBADO + contacto oficial registrado ⇒ ELIGIBLE (el botón del rescate ya funciona)', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ candidateStatus: 'approved', officialContactId: OFFICIAL_CONTACT_ID }),
    );

    assert.equal(plan.eligible, true);
    assert.equal(plan.reason, null);
    assert.deepEqual(plan.providersToTry, ['lusha']);
  });

  it('APROBADO SIN contacto oficial ⇒ sigue bloqueado, fail-closed', () => {
    // Sin destino registrado no hay dónde proyectar el teléfono que se compraría: pagar por
    // él sería comprar un dato que no puede llegar a ninguna ficha.
    const plan = planSearchMorePhones(
      eligibleInput({ candidateStatus: 'approved', officialContactId: null }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'candidate_not_editable');
    assert.deepEqual(plan.providersToTry, []);
    assert.equal(plan.maxCreditRequirement, 0);
  });

  it('la excepción de «approved» NO relaja rejected/discarded/archived', () => {
    // Barrido explícito: un `officialContactId` real presente en los tres estados
    // permanentemente bloqueados no debe colar por parecido con `approved`.
    for (const status of ['rejected', 'discarded', 'archived']) {
      const plan = planSearchMorePhones(
        eligibleInput({ candidateStatus: status, officialContactId: OFFICIAL_CONTACT_ID }),
      );
      assert.equal(plan.eligible, false, `${status} + contacto oficial no debía autorizar`);
      assert.equal(plan.reason, 'candidate_not_editable');
    }
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

// ═══════════════════════════════════════════════════════════════
// 1K — EL PRESUPUESTO ES UN GATE MÁS, Y FALLA CERRADO
// ═══════════════════════════════════════════════════════════════
//
// Hasta 1J este planificador no sabía nada del dinero: un candidato impecable devolvía un
// plan ELEGIBLE aunque no existiera ninguna regla de crédito para Lusha, y el rechazo llegaba
// después del clic. Los casos de abajo fijan que el veredicto del pozo entra como un hecho
// más, que los tres rechazos se distinguen, y que el orden respecto de la privacidad es el
// que le dice al operador la verdad más importante primero.

describe('AGENT2A-SEARCH-MORE-PHONES-1K · el presupuesto en el planificador', () => {
  it('CASO A — sin regla de crédito para Lusha ⇒ NO elegible, y lo dice como configuración', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ budgetDecision: 'budget_not_configured' }),
    );

    assert.equal(
      plan.eligible,
      false,
      'un plan elegible aquí es exactamente el CTA fantasma que Producción encontró',
    );
    assert.equal(plan.reason, 'budget_not_configured');
    assert.equal(plan.phase, 'budget_blocked');
    assert.deepEqual(plan.providersToTry, [], 'no se nombra una fuente que no se va a llamar');
    assert.equal(plan.maxCreditRequirement, 0);
    assert.equal(plan.budgetMode, null);
    assert.equal(
      plan.alreadyExhausted,
      false,
      'el candidato NO está agotado: lo que falta es presupuesto, y eso se arregla',
    );
  });

  it('CASO B — el saldo no cubre el techo ⇒ NO elegible, y NO se confunde con falta de regla', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ budgetDecision: 'insufficient_credits' }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'insufficient_credits');
    assert.equal(plan.phase, 'budget_blocked');
  });

  it('CASO E — un presupuesto ILEGIBLE bloquea igual, sin afirmar cuál de los otros dos es', () => {
    const plan = planSearchMorePhones(
      eligibleInput({ budgetDecision: 'balance_unavailable' }),
    );

    assert.equal(plan.eligible, false, 'no haber podido mirar NUNCA es un permiso');
    assert.equal(
      plan.reason,
      'credit_balance_unavailable',
      'decir «no hay créditos» o «no hay regla» aquí sería declarar un hecho no comprobado',
    );
  });

  it('CASOS C y D — con el pozo autorizado el plan es elegible y reserva la pata de Lusha', () => {
    const plan = planSearchMorePhones(eligibleInput({ budgetDecision: 'authorized' }));

    assert.equal(plan.eligible, true);
    assert.deepEqual(plan.providersToTry, ['lusha']);
    assert.equal(plan.maxCreditRequirement, SEARCH_MORE_MAX_CREDITS);
    assert.equal(plan.budgetMode, SEARCH_MORE_BUDGET_MODE);
  });

  it('el techo del plan y lo que la MODALIDAD exige son el mismo número: 5', () => {
    // Es la unión que hace honesta la paridad. Si el plan pidiera 5 y la modalidad exigiera
    // otra cosa, el preflight evaluaría un requisito y la reserva ocuparía otro, y el CTA
    // volvería a prometer lo que el runtime rechaza — por el camino contrario al de 1K.
    assert.equal(
      resolvePhoneRevealCreditBudgetRequiredCredits(SEARCH_MORE_BUDGET_MODE),
      SEARCH_MORE_MAX_CREDITS,
    );
    assert.deepEqual(
      [...resolvePhoneRevealCreditBudgetProviders(SEARCH_MORE_BUDGET_MODE)],
      ['lusha'],
      'esta modalidad no puede leer ni ocupar el pozo de ningún otro proveedor',
    );
  });

  it('CASO F — la exposición RESERVADA cuenta: 5 disponibles con 5 ya reservados NO alcanza', () => {
    // El veredicto se produce con el core CANÓNICO —el mismo que usa la reserva del runtime—
    // sobre un pozo con reserva viva. Es la mitad que una aproximación `límite - consumo`
    // perdería: 10 de límite, 0 consumido y 5 comprometidos por otra autorización en vuelo
    // dejan 5, pero comprometer los mismos 5 dos veces es el sobregiro que la migración 104
    // impide. Con 6 reservados ya ni siquiera empata.
    const verdictWithReservation = evaluatePhoneRevealCreditBudget({
      mode: SEARCH_MORE_BUDGET_MODE,
      budget: {
        model: 'per_provider',
        pools: [
          {
            providerKey: 'lusha',
            state: {
              kind: 'configured',
              limitCredits: 10,
              consumedCredits: 0,
              reservedCredits: 6,
              scopeType: 'global',
              scopeId: null,
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
          },
        ],
      },
    });
    assert.equal(verdictWithReservation.decision, 'insufficient_credits');

    const plan = planSearchMorePhones(
      eligibleInput({ budgetDecision: verdictWithReservation.decision }),
    );
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, 'insufficient_credits');
  });

  it('la MISMA exposición sin reserva SÍ alcanza: lo que bloquea es lo comprometido', () => {
    const verdict = evaluatePhoneRevealCreditBudget({
      mode: SEARCH_MORE_BUDGET_MODE,
      budget: {
        model: 'per_provider',
        pools: [
          {
            providerKey: 'lusha',
            state: {
              kind: 'configured',
              limitCredits: 10,
              consumedCredits: 0,
              reservedCredits: 0,
              scopeType: 'global',
              scopeId: null,
              periodStart: '2026-08-01T00:00:00.000Z',
              periodEnd: '2026-08-31T23:59:59.999Z',
            },
          },
        ],
      },
    });
    assert.equal(verdict.decision, 'authorized');
    assert.equal(planSearchMorePhones(eligibleInput({ budgetDecision: verdict.decision })).eligible, true);
  });

  it('la PRIVACIDAD se evalúa antes: un candidato suprimido lo dice, aunque además falte saldo', () => {
    const plan = planSearchMorePhones(
      eligibleInput({
        privacyState: 'blocked_suppressed',
        budgetDecision: 'budget_not_configured',
      }),
    );

    assert.equal(plan.eligible, false);
    assert.equal(
      plan.reason,
      'blocked_suppressed',
      'un hecho sobre la persona no puede quedar tapado por uno de tesorería',
    );
  });

  it('un bloqueo ANTERIOR gana al presupuesto: sin teléfono se sigue ofreciendo el reveal', () => {
    // El orden importa hacia los dos lados. `no_stored_phone` tiene que seguir mandando al
    // operador al botón correcto («Revelar teléfono»), no a una queja de presupuesto.
    const plan = planSearchMorePhones(
      eligibleInput({
        storedUnsuppressedPhoneCount: 0,
        budgetDecision: 'budget_not_configured',
      }),
    );

    assert.equal(plan.reason, 'no_stored_phone');
    assert.equal(plan.phase, 'no_phone_yet');
  });
});
