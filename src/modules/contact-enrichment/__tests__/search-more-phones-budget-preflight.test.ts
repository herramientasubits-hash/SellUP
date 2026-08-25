// Agente 2A — «Buscar más números»: EL PREFLIGHT MIRA EL POZO
// (AGENT2A-SEARCH-MORE-PHONES-1K-BUDGET-PREFLIGHT-PARITY)
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ ENCONTRÓ PRODUCCIÓN, Y QUÉ FIJA ESTA SUITE
// ═══════════════════════════════════════════════════════════════════
//
// Un candidato con teléfono, identidad nativa de Lusha y todo lo demás en regla mostraba el
// CTA pagado con su línea de costo. El operador pulsó UNA vez y la respuesta fue «No pudimos
// iniciar la búsqueda. No se consumió ningún crédito.»: 0 corridas, 0 reservas, 0 llamadas y
// 0 créditos —el servidor hizo lo correcto— porque no hay NINGUNA regla de crédito activa
// para Lusha.
//
// La causa no era el runtime: era que la LECTURA de preflight resolvía el candidato, la
// colección, la procedencia, las corridas y la privacidad, y NO el presupuesto, mientras el
// runtime sí lo resolvía antes de reservar. Dos conjuntos de hechos distintos decidiendo la
// misma compra.
//
// Esta suite ejecuta la lectura REAL —`readSearchMorePreflight`, con el planificador REAL y
// el core de crédito REAL— y sólo simula la frontera de I/O. Lo que se afirma:
//
//   * el pozo de LUSHA se resuelve, y sólo el de Lusha;
//   * la disponibilidad incluye la EXPOSICIÓN YA RESERVADA, exactamente como la cuenta el
//     gate del runtime, porque es el MISMO resolver;
//   * los tres rechazos (sin regla / sin saldo / ilegible) llegan al plan por separado;
//   * y mirar todo eso no llama a ningún proveedor, no reserva y no escribe.
//
// El límite de lo que puede demostrar: `checkBudget` está simulado, así que esta suite no
// prueba cómo PostgreSQL agrega las reglas. Lo que prueba es que el preflight consume ese
// resultado con la misma semántica que la reserva, que es donde estaba la divergencia.

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const CANDIDATE_ID = 'cand-1k-budget';
const LUSHA_CONTACT_ID = 'v1.lusha-native-token-1k';
const ACTOR_ID = 'user-1k';

// ═══════════════════════════════════════════════════════════════
// El mundo
// ═══════════════════════════════════════════════════════════════

interface BudgetScript {
  /** `null` ⇒ no hay regla aplicable (el caso REAL de Producción). */
  limitCredits: number | null;
  consumedCredits: number;
  /** Exposición ya reservada en el MISMO pozo. Es la mitad que una resta ingenua pierde. */
  reservedCredits: number;
  /** `'none'` ⇒ ninguna regla ganó el match. */
  scopeApplied: 'user' | 'group' | 'role' | 'global' | 'none';
  /** `true` ⇒ la resolución LANZA: no se pudo mirar el pozo. */
  throws: boolean;
}

interface World {
  candidateRow: Record<string, unknown> | null;
  phoneRows: { id: string; dedupe_key: string }[];
  sourceRows: { provider: string }[];
  runRows: { status: string; run_mode: string }[];
  privacy: string;
  budget: BudgetScript;
  /** Proveedores por los que se preguntó al presupuesto, en orden. */
  budgetProviderQueries: string[];
  /** Actor con el que se resolvió el presupuesto. */
  budgetUserIds: string[];
  /** Cualquier operación que NO sea `select` sobre el cliente admin. */
  forbiddenOperations: string[];
}

let world: World;

function freshWorld(): World {
  return {
    // La forma canónica del candidato de Producción: revelado por APOLLO, con UN teléfono
    // guardado, e identidad nativa de LUSHA en la misma fila.
    candidateRow: {
      id: CANDIDATE_ID,
      status: 'pending_review',
      source: 'lusha',
      source_contact_id: LUSHA_CONTACT_ID,
    },
    phoneRows: [{ id: 'phone-1', dedupe_key: '+573001112233' }],
    sourceRows: [{ provider: 'apollo' }],
    runRows: [],
    privacy: 'clear',
    budget: {
      limitCredits: 100,
      consumedCredits: 0,
      reservedCredits: 0,
      scopeApplied: 'global',
      throws: false,
    },
    budgetProviderQueries: [],
    budgetUserIds: [],
    forbiddenOperations: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// Mocks — SÓLO la frontera de I/O
// ═══════════════════════════════════════════════════════════════

/**
 * Cadena PostgREST simulada, por TABLA. Sólo expone lo que la lectura usa; cualquier verbo de
 * ESCRITURA se registra como operación prohibida en vez de fallar silenciosamente, para que
 * un `.insert()` que apareciera algún día se vea como lo que es.
 */
function fakeAdminClient() {
  return {
    from: (table: string) => ({
      select: () => chainFor(table),
      insert: () => {
        world.forbiddenOperations.push(`insert:${table}`);
        return chainFor(table);
      },
      update: () => {
        world.forbiddenOperations.push(`update:${table}`);
        return chainFor(table);
      },
      delete: () => {
        world.forbiddenOperations.push(`delete:${table}`);
        return chainFor(table);
      },
      upsert: () => {
        world.forbiddenOperations.push(`upsert:${table}`);
        return chainFor(table);
      },
    }),
    rpc: (fn: string) => {
      world.forbiddenOperations.push(`rpc:${fn}`);
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function rowsFor(table: string): unknown[] {
  switch (table) {
    case 'contact_enrichment_candidates':
      return world.candidateRow ? [world.candidateRow] : [];
    case 'contact_enrichment_candidate_phones':
      return world.phoneRows;
    case 'contact_enrichment_candidate_phone_sources':
      return world.sourceRows;
    case 'phone_reveal_waterfall_runs':
      return world.runRows;
    default:
      return [];
  }
}

function chainFor(table: string): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  const passthrough = () => self;
  self.select = passthrough;
  self.eq = passthrough;
  self.in = passthrough;
  self.is = passthrough;
  self.maybeSingle = async () => ({ data: rowsFor(table)[0] ?? null, error: null });
  self.then = (resolve: (v: unknown) => unknown): unknown =>
    resolve({ data: rowsFor(table), error: null });
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: { createSupabaseAdminClient: () => fakeAdminClient() },
});

mock.module('@/modules/contact-enrichment/phone-reveal-privacy-gate', {
  namedExports: { checkPhoneRevealPrivacyGate: async () => world.privacy },
});

/**
 * El presupuesto se simula EN SU FRONTERA REAL —`checkBudget`— y no un nivel más arriba. Es
 * deliberado: así el `readPhoneRevealCreditPools` que corre aquí es el MISMO código que corre
 * en la reserva del runtime, incluida la traducción de `reservedCredits` al pozo. Simular los
 * pozos ya traducidos habría dejado sin probar justo la pieza cuya ausencia causó el defecto.
 */
mock.module('@/modules/budgets/budget-resolution', {
  namedExports: {
    checkBudget: async (providerKey: string, userId: string) => {
      world.budgetProviderQueries.push(providerKey);
      world.budgetUserIds.push(userId);
      if (world.budget.throws) throw new Error('budget resolution exploded');
      const { limitCredits, consumedCredits, reservedCredits, scopeApplied } = world.budget;
      return {
        allowed: true,
        reason: null,
        providerKey,
        userId,
        periodStart: '2026-08-01T00:00:00.000Z',
        periodEnd: '2026-08-31T23:59:59.999Z',
        scopeApplied,
        matchedRule:
          limitCredits === null
            ? null
            : { limitCredits, limitUsd: null, periodType: 'monthly', scopeId: null },
        consumedCredits,
        consumedUsd: 0,
        reservedCredits,
        consumptionBreakdown: [],
        projectedCredits: consumedCredits,
        projectedUsd: 0,
        remainingCredits: limitCredits === null ? null : limitCredits - consumedCredits,
        remainingUsd: null,
        usdCostTruth: 'reported',
      };
    },
  },
});

/**
 * Guarda de gasto: NINGÚN `fetch` puede salir de un preflight. Un proveedor llamado desde una
 * pantalla que sólo mira sería el defecto más caro que este subsistema puede tener.
 */
const httpCalls: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  httpCalls.push(String(input));
  throw new Error('BUG: el preflight NO puede hacer ninguna llamada de red');
}) as typeof fetch;

type ReadModule = typeof import('../search-more-phones-read');
let readModule: ReadModule;

before(async () => {
  readModule = await import('../search-more-phones-read');
});

beforeEach(() => {
  world = freshWorld();
  httpCalls.length = 0;
});

async function preflight(actorInternalUserId: string | null = ACTOR_ID) {
  return readModule.readSearchMorePreflight({
    candidateId: CANDIDATE_ID,
    featureEnabled: true,
    actorRoleKey: 'admin',
    actorInternalUserId,
  });
}

/** Nada de esto puede haber ocurrido por MIRAR. */
function assertNothingSpent(context: string) {
  assert.deepEqual(httpCalls, [], `0 llamadas de red ${context}`);
  assert.deepEqual(world.forbiddenOperations, [], `0 escrituras ${context}`);
}

// ═══════════════════════════════════════════════════════════════
// Los casos
// ═══════════════════════════════════════════════════════════════

describe('AGENT2A-SEARCH-MORE-PHONES-1K · el preflight resuelve el pozo de Lusha', () => {
  it('CASO A — sin regla de crédito ⇒ UNBOUNDED: el CTA SÍ se ofrece, y no es fantasma', async () => {
    // Ninguna regla gana el match. Este caso ha cambiado de veredicto dos veces y lo que
    // importa es POR QUÉ. 1K lo cerró porque el CTA era FANTASMA: se ofrecía y el clic
    // moría en el rechazo del presupuesto. Con
    // AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1 el clic ya NO muere —sin regla no
    // hay tope interno que aplicar, así que la reserva no bloquea— y por lo tanto
    // ofrecerlo deja de ser una promesa vacía. El invariante de 1K se mantiene: el
    // preflight y la reserva deciden lo MISMO. Lo que cambió es lo que ambos deciden.
    world.budget = {
      limitCredits: null,
      consumedCredits: 0,
      reservedCredits: 0,
      scopeApplied: 'none',
      throws: false,
    };

    const { facts, summary } = await preflight();

    assert.equal(facts.budgetDecision, 'authorized');
    assert.equal(summary.plan.eligible, true);
    assert.deepEqual([...summary.plan.providersToTry], ['lusha']);
    // El techo que se le enseña a la persona NO cambia por no haber regla: sale de la
    // modalidad, no del presupuesto.
    assert.equal(summary.plan.maxCreditRequirement, 5);
    // Y mirar sigue sin costar: 0 red, 0 escrituras.
    assertNothingSpent('al descubrir que no hay tope interno');
  });

  it('CASO A2 — el presupuesto ILEGIBLE sigue cerrando el CTA', async () => {
    // La asimetría que este hito preserva: «no hay regla» autoriza, «no se pudo leer la
    // regla» no. Si esto se degradara a UNBOUNDED, un fallo de lectura acabaría
    // autorizando gasto sin techo.
    world.budget = { ...world.budget, throws: true };

    const { facts, summary } = await preflight();

    assert.equal(facts.budgetDecision, 'balance_unavailable');
    assert.equal(summary.plan.eligible, false);
    assertNothingSpent('cuando el presupuesto no se puede leer');
  });

  it('CASO B — hay regla pero sólo quedan 4 créditos ⇒ insuficiente, y se dice así', async () => {
    world.budget = { ...world.budget, limitCredits: 10, consumedCredits: 6 };

    const { facts, summary } = await preflight();

    assert.equal(facts.budgetDecision, 'insufficient_credits');
    assert.equal(summary.plan.eligible, false);
    assert.equal(
      summary.plan.reason,
      'insufficient_credits',
      'falta SALDO, no configuración: mandar al operador a la gestión equivocada cuesta un día',
    );
    assertNothingSpent('con el saldo por debajo del techo');
  });

  it('CASO C — con EXACTAMENTE 5 disponibles el plan es elegible: el límite no se descuenta dos veces', async () => {
    world.budget = { ...world.budget, limitCredits: 10, consumedCredits: 5 };

    const { facts, summary } = await preflight();

    assert.equal(facts.budgetDecision, 'authorized');
    assert.equal(summary.plan.eligible, true, '5 disponibles cubren un techo de 5');
    assert.equal(summary.plan.maxCreditRequirement, 5);
    assert.deepEqual([...summary.plan.providersToTry], ['lusha']);
    assertNothingSpent('al autorizar el CTA');
  });

  it('CASO D — con saldo de sobra, elegible igual', async () => {
    world.budget = { ...world.budget, limitCredits: 100, consumedCredits: 0 };

    const { summary } = await preflight();

    assert.equal(summary.plan.eligible, true);
    assertNothingSpent('con el pozo lleno');
  });

  it('CASO E — la resolución del presupuesto LANZA ⇒ fail-closed, y sin culpar al saldo', async () => {
    world.budget = { ...world.budget, throws: true };

    const { facts, summary } = await preflight();

    assert.equal(facts.budgetDecision, 'balance_unavailable');
    assert.equal(summary.plan.eligible, false, 'no haber podido mirar NUNCA es un permiso');
    assert.equal(
      summary.plan.reason,
      'credit_balance_unavailable',
      'decir «no hay créditos» aquí afirmaría un hecho que nadie comprobó',
    );
    assertNothingSpent('cuando el presupuesto no se pudo leer');
  });

  it('CASO F — la exposición RESERVADA reduce la disponibilidad igual que en la reserva', async () => {
    // 10 de límite, 3 consumidos y 3 comprometidos por una autorización EN VUELO dejan 4. Una
    // aproximación `límite - consumo` habría visto 7 y ofrecido el CTA, y la reserva atómica
    // —que sí resta lo reservado -- lo habría rechazado: exactamente la divergencia de 1K,
    // pero por el otro extremo.
    world.budget = {
      ...world.budget,
      limitCredits: 10,
      consumedCredits: 3,
      reservedCredits: 3,
    };

    const withReservation = await preflight();
    assert.equal(withReservation.facts.budgetDecision, 'insufficient_credits');
    assert.equal(withReservation.summary.plan.eligible, false);

    // La MISMA regla y el MISMO consumo, sin la reserva viva: 7 disponibles ⇒ elegible. Lo
    // que movió el veredicto fue exclusivamente lo comprometido.
    world = { ...freshWorld(), budget: { ...world.budget, reservedCredits: 0 } };
    const withoutReservation = await preflight();
    assert.equal(withoutReservation.facts.budgetDecision, 'authorized');
    assert.equal(withoutReservation.summary.plan.eligible, true);
  });

  it('sólo se pregunta por el pozo de LUSHA, y con el actor que reservará', async () => {
    await preflight();

    assert.deepEqual(
      world.budgetProviderQueries,
      ['lusha'],
      'preguntar por el de Apollo dejaría a un proveedor que no corre bloqueando esta compra',
    );
    assert.deepEqual(world.budgetUserIds, [ACTOR_ID]);
  });

  it('sin actor no hay pozo que mirar ⇒ fail-closed, y NO se inventa que falte la regla', async () => {
    const { facts, summary } = await preflight(null);

    assert.equal(facts.budgetDecision, 'balance_unavailable');
    assert.equal(summary.plan.eligible, false);
    assert.deepEqual(
      world.budgetProviderQueries,
      [],
      'sin actor la regla no es resoluble: preguntar devolvería el pozo de nadie',
    );
  });

  it('el veredicto crudo del presupuesto NO cruza al navegador: el resumen sólo lleva el plan', async () => {
    world.budget = { ...world.budget, limitCredits: 10, consumedCredits: 9 };

    const { summary } = await preflight();

    // El motivo mecánico ya viaja dentro del plan, que es lo que la UI traduce. Publicar
    // además el límite, el consumo o el scope no le daría nada al cliente y sí expondría la
    // forma interna del presupuesto.
    const summaryKeys = Object.keys(summary);
    for (const forbidden of ['budgetDecision', 'limitCredits', 'consumedCredits', 'scopeType']) {
      assert.equal(summaryKeys.includes(forbidden), false, `${forbidden} no cruza al navegador`);
    }
    assert.equal(summary.plan.reason, 'insufficient_credits');
  });

  it('un bloqueo del CANDIDATO gana al del presupuesto: el motivo describe lo más importante', async () => {
    // Sin teléfono guardado el camino correcto es «Revelar teléfono», y eso no cambia porque
    // además falte presupuesto.
    world.phoneRows = [];
    world.sourceRows = [];
    world.budget = { ...world.budget, limitCredits: null, scopeApplied: 'none' };

    const { summary } = await preflight();

    assert.equal(summary.plan.reason, 'no_stored_phone');
    assert.equal(summary.plan.phase, 'no_phone_yet');
  });

  it('la privacidad y el presupuesto se resuelven los DOS, y la privacidad manda', async () => {
    world.privacy = 'blocked_suppressed';
    world.budget = { ...world.budget, limitCredits: null, scopeApplied: 'none' };

    const { facts, summary } = await preflight();

    assert.equal(facts.privacyState, 'blocked_suppressed');
    assert.equal(
      facts.budgetDecision,
      'authorized',
      'el presupuesto se resuelve igual: los hechos no dependen de qué gate gane',
    );
    assert.equal(
      summary.plan.reason,
      'blocked_suppressed',
      'una restricción de privacidad registrada no puede quedar tapada por una de tesorería',
    );
  });

  it('CASO J — mirar el presupuesto no llama a NINGÚN proveedor ni escribe nada', async () => {
    for (const budget of [
      { limitCredits: null, scopeApplied: 'none' as const },
      { limitCredits: 10, scopeApplied: 'global' as const },
    ]) {
      world = freshWorld();
      world.budget = { ...world.budget, ...budget };
      await preflight();
      assertNothingSpent('en ninguno de los desenlaces del presupuesto');
    }
  });
});
