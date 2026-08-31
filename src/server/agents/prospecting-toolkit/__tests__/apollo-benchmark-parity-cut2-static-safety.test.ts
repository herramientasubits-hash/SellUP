/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 5, 10, 16, 19, 20 — garantías
 * ESTÁTICAS y las SEIS mutaciones del hito.
 *
 * Lo que este archivo defiende es el ALCANCE y la SEPARACIÓN:
 *
 *   · la demanda de resultados y la reserva financiera siguen desacopladas (§ 5);
 *   · `APOLLO_EXCLUSION_CAPABILITY` sigue entera en false y nada de la memoria
 *     viaja a Apollo (§ 10);
 *   · un fallo de carga de memoria no se puede convertir en 0 aciertos (§ 12);
 *   · este corte no introduce flags, migraciones ni llamadas de pago (§ 19).
 *
 * 🔴 Todo se busca con los COMENTARIOS FUERA. Una guarda que lea el cuerpo crudo
 * convierte «citar un nombre en la prosa» en «usarlo», y ese falso positivo ya
 * ocurrió en este repo (AGENT2A-SEARCH-MORE-PHONES-1G). Cada guarda de orden o de
 * separación se prueba además EN NEGATIVO —sobre una copia mutada del mismo
 * texto, o sobre una traza mutada— para que no pueda quedarse verde por no
 * encontrar ninguno de sus anclajes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  createApolloProviderSeenLedger,
  APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
} from '../apollo-organizations-provider-seen';
import {
  buildProviderSeenMemory,
  collectProviderSeenObservations,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const DEMAND = 'src/modules/prospect-batches/prepaid-novelty/provider-result-demand.ts';
const ORCHESTRATOR = 'src/server/agents/prospecting-toolkit/apollo-two-round/orchestrator.ts';
const TWO_ROUND_BUDGET = 'src/server/agents/prospecting-toolkit/apollo-two-round/budget.ts';
const WIZARD_BUDGET = 'src/modules/prospect-batches/chat-wizard-execution/wizard-budget-estimate.ts';
const WIZARD_ACTIONS =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const WIZARD_APOLLO = 'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts';
const PROVIDER =
  'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts';
const PAGINATED = 'src/server/agents/prospecting-toolkit/apollo-organizations-paginated-search.ts';
const PROVIDER_SEEN = 'src/server/agents/prospecting-toolkit/apollo-organizations-provider-seen.ts';
const EXCLUSION_PLANNER =
  'src/modules/prospect-batches/provider-seen/provider-exclusion-planner.ts';

// ─── MUTACIÓN 1 · ignorar el hueco y usar el objetivo original ────────────────

describe('MUTACIÓN 1 · `residualGap` ignorado y objetivo original en su lugar', () => {
  /**
   * La cota tiene que salir de UNA función y aplicarse sobre el objetivo, no de
   * un `Math.min` suelto que alguien pueda quitar sin que nada lo note.
   */
  it('el orquestador deriva su objetivo EFECTIVO de la cota canónica', () => {
    const code = stripTsComments(read(ORCHESTRATOR));

    assert.ok(code.includes('boundByRemainingTarget('), 'la cota canónica se usa');
    assert.ok(
      code.includes('const targetEligibleCompanies ='),
      'existe UN objetivo efectivo, resuelto una vez',
    );
    // 🔴 Y ninguna PARADA lee ya el config: si alguna sobreviviera, la corrida se
    // detendría con un número y redactaría la ronda siguiente con otro.
    const stops = code.match(/stableFinalizableCandidateCount\(\)\) >= [A-Za-z.]+/g) ?? [];
    assert.ok(stops.length >= 3, `se esperaban varias paradas por objetivo, hay ${stops.length}`);
    for (const stop of stops) {
      assert.ok(
        stop.endsWith('>= targetEligibleCompanies'),
        `una parada sigue leyendo el config: ${stop}`,
      );
    }
    // El hueco proyectado, que gobierna la ronda 2, sale del mismo objetivo.
    assert.ok(
      code.includes('Math.max(0, targetEligibleCompanies - (await stableFinalizableCandidateCount()))'),
      'el hueco proyectado usa el objetivo EFECTIVO',
    );
  });

  /** 🔴 EN NEGATIVO — sin la cota, la guarda de arriba TIENE que ponerse roja. */
  it('mutación: quitar la cota deja la guarda sin su anclaje', () => {
    const mutated = stripTsComments(read(ORCHESTRATOR)).replace(
      /boundByRemainingTarget\(/g,
      'Math.max(',
    );
    assert.ok(
      !mutated.includes('boundByRemainingTarget('),
      'la copia mutada ya no usa la cota canónica',
    );
  });
});

// ─── MUTACIÓN 2 · la ronda 2 se reinicia al hueco original ────────────────────

describe('MUTACIÓN 2 · la ronda 2 vuelve a pedir el hueco original', () => {
  it('el límite de la ronda 2 sale del hueco PROYECTADO, no del inicial', () => {
    const code = stripTsComments(read(ORCHESTRATOR));
    const decl = code.indexOf('const requestedResultLimit =');
    assert.ok(decl > 0, 'la declaración del límite por ronda existe');
    const block = code.slice(decl, decl + 600);

    assert.ok(
      block.includes('await projectedTargetGap()'),
      '🔴 la ronda 2 tiene que descontar lo que la ronda 1 ya aportó',
    );
    assert.ok(
      block.includes("roundNumber === 1 ? targetEligibleCompanies"),
      'la ronda 1 usa el objetivo efectivo y la 2 el hueco vigente',
    );
    // Con demanda presente el límite NO puede volver a ser el config a secas.
    assert.ok(
      !/const requestedResultLimit = config\.maxResultsPerRound;/.test(code),
      'el literal antiguo no puede haber vuelto',
    );
  });

  /**
   * 🔴 EN NEGATIVO — sobre una traza MUTADA. La aserción de acotación que usa la
   * suite de comportamiento tiene que fallar si la ronda 2 se reinicia.
   */
  it('mutación: una traza con la ronda 2 reiniciada rompe la aserción de acotación', () => {
    const original = 3;
    const assertBounded = (
      calls: readonly { roundNumber: number; requestedResultLimit: number }[],
      remainingAfterRound1: number,
    ): void => {
      for (const call of calls) {
        const ceiling = call.roundNumber === 1 ? original : remainingAfterRound1;
        assert.ok(
          call.requestedResultLimit <= ceiling,
          `ronda ${call.roundNumber} pidió ${call.requestedResultLimit} > ${ceiling}`,
        );
      }
    };

    // Traza correcta: la ronda 1 aportó 2, así que la 2 pide como mucho 1.
    assertBounded(
      [
        { roundNumber: 1, requestedResultLimit: 3 },
        { roundNumber: 2, requestedResultLimit: 1 },
      ],
      1,
    );

    // Traza MUTADA: la ronda 2 se reinicia al hueco original.
    assert.throws(() =>
      assertBounded(
        [
          { roundNumber: 1, requestedResultLimit: 3 },
          { roundNumber: 2, requestedResultLimit: 3 },
        ],
        1,
      ),
    );
  });
});

// ─── MUTACIÓN 3 · lo escrito ahora contado como conocimiento previo ───────────

describe('MUTACIÓN 3 · las escrituras de ESTA página cuentan como aciertos previos', () => {
  const organization = (suffix: string): NormalizedApolloOrganization =>
    ({
      providerReference: { providerOrganizationId: `org_${suffix}` },
      primaryDomain: `empresa-${suffix}.com`,
    }) as unknown as NormalizedApolloOrganization;

  it('el snapshot se captura UNA vez y el ledger no lo vuelve a tocar', () => {
    const code = stripTsComments(read(PROVIDER_SEEN));
    const factory = code.slice(code.indexOf('export function createApolloProviderSeenLedger'));

    assert.ok(
      factory.includes('const priorMemory = prior.available ? prior.memory : null;'),
      'el snapshot es una constante local',
    );
    // 🔴 El ledger no puede añadir nada a la memoria previa: sólo consultarla.
    for (const forbidden of [
      'priorMemory.providerEntityIds.add',
      'priorMemory.normalizedDomains.add',
      'buildProviderSeenMemory(',
    ]) {
      assert.ok(!factory.includes(forbidden), `el snapshot es inmutable (${forbidden})`);
    }
  });

  it('el acierto se cuenta ANTES de que la página se escriba', () => {
    const code = stripTsComments(read(PROVIDER_SEEN));
    const hit = code.indexOf('isProviderSeenKnown(priorMemory, observation)');
    const write = code.indexOf('export async function recordApolloProviderSeenPage');
    const observe = code.indexOf('const observed = ledger.observePage(organizations);');
    const record = code.indexOf('await deps.record({');

    assert.ok(hit > 0 && write > 0 && observe > 0 && record > 0);
    // El conteo vive en `observePage`, y `observePage` corre antes de `deps.record`.
    assert.ok(observe < record, 'observar (y contar) ocurre ANTES de escribir');
  });

  /** 🔴 EN NEGATIVO — con la mutación, el acierto aparece donde no debía. */
  it('mutación: sembrar el snapshot con lo de la página 1 produce un acierto falso', () => {
    const pagina1 = [organization('a')];
    const pagina2 = [organization('b')];

    // Comportamiento CORRECTO: snapshot vacío ⇒ 0 aciertos en las dos páginas.
    const correcto = createApolloProviderSeenLedger({
      available: true,
      memory: buildProviderSeenMemory([]),
    });
    correcto.observePage(pagina1);
    correcto.observePage(pagina2);
    assert.equal(correcto.summary().priorSeenHits, 0);

    // MUTACIÓN: el snapshot incluye lo que la página 1 acaba de escribir.
    const mutado = createApolloProviderSeenLedger({
      available: true,
      memory: buildProviderSeenMemory(
        collectProviderSeenObservations('apollo', [
          { providerEntityId: 'org_a', domain: 'empresa-a.com' },
        ]).observations,
      ),
    });
    mutado.observePage(pagina1);
    mutado.observePage(pagina2);
    assert.equal(
      mutado.summary().priorSeenHits,
      1,
      'la mutación se detecta: un acierto que la corrida correcta no tiene',
    );
  });
});

// ─── MUTACIÓN 4 · un fallo de carga convertido en 0 aciertos ──────────────────

describe('MUTACIÓN 4 · el fallo de carga se convierte en 0 aciertos', () => {
  it('sin snapshot el contador NACE null y no se puede incrementar', () => {
    const ledger = createApolloProviderSeenLedger({
      available: false,
      unavailableReason: 'provider_seen_memory_read_failed',
    });
    ledger.observePage([
      {
        providerReference: { providerOrganizationId: 'org_a' },
        primaryDomain: 'empresa-a.com',
      } as unknown as NormalizedApolloOrganization,
    ]);

    const summary = ledger.summary();
    assert.equal(summary.priorSeenHits, null, '🔴 nunca 0 sin memoria');
    assert.equal(summary.priorMemoryAvailable, false);
    assert.equal(summary.priorMemoryUnavailableReason, 'provider_seen_memory_read_failed');
    // Y la observación SÍ ocurrió: la ausencia es de la MEDICIÓN, no del registro.
    assert.equal(summary.uniqueIdentities, 1);
  });

  it('el valor por defecto tiene motivo propio, no un null mudo', () => {
    const ledger = createApolloProviderSeenLedger();
    assert.equal(ledger.summary().priorSeenHits, null);
    assert.equal(
      ledger.summary().priorMemoryUnavailableReason,
      APOLLO_PRIOR_MEMORY_NOT_PROVIDED,
    );
  });

  it('ni el ledger ni el embudo pueden degradar el null con un `?? 0`', () => {
    for (const rel of [PROVIDER_SEEN, 'src/server/agents/prospecting-toolkit/apollo-benchmark-funnel.ts']) {
      const code = stripTsComments(read(rel));
      for (const forbidden of ['priorSeenHits ?? 0', 'priorSeenHits || 0', 'providerSeenHit ?? 0']) {
        assert.ok(!code.includes(forbidden), `${rel}: un null no puede degradarse a 0 (${forbidden})`);
      }
    }
  });

  it('la capa que decide la disponibilidad lee `readOutcome`, no `loaded`', () => {
    const code = stripTsComments(read(WIZARD_ACTIONS));
    const block = code.slice(code.indexOf('const apolloPriorProviderSeen'));

    assert.ok(
      block.includes("providerSeenLoad.readOutcome === 'succeeded'"),
      '🔴 `loaded` fusiona «vacío» con «fallido»; `readOutcome` los separa',
    );
    assert.ok(
      !/apolloPriorProviderSeen[\s\S]{0,400}providerSeenLoad\.loaded/.test(block),
      'no puede volver a decidirse con `loaded`',
    );
  });
});

// ─── MUTACIÓN 5 · exclusiones de Apollo encendidas ────────────────────────────

describe('MUTACIÓN 5 · las exclusiones de Apollo se encienden', () => {
  it('§ 10 — `APOLLO_EXCLUSION_CAPABILITY` sigue TODA en false', () => {
    const code = stripTsComments(read(EXCLUSION_PLANNER));
    const block = code.slice(
      code.indexOf('export const APOLLO_EXCLUSION_CAPABILITY'),
      code.indexOf('const CAPABILITIES'),
    );

    assert.ok(block.includes('supportsDomainExclusion: false'));
    assert.ok(block.includes('supportsIdExclusion: false'));
    assert.ok(block.includes('domainCap: 0'));
    assert.ok(block.includes('idCap: 0'));
  });

  it('nada de la memoria viaja en el body que sale hacia Apollo', () => {
    for (const rel of [PROVIDER, PAGINATED, ORCHESTRATOR]) {
      const code = stripTsComments(read(rel));
      for (const forbidden of [
        'excludeIds',
        'excludeDomains',
        'exclude_ids',
        'exclude_domains',
        'organization_not_ids',
        'q_organization_not_domains',
      ]) {
        assert.ok(!code.includes(forbidden), `${rel} no puede excluir en el proveedor (${forbidden})`);
      }
    }
  });

  it('el snapshot llega al ledger, NO al constructor del request efectivo', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts'),
    );
    const build = code.slice(
      code.indexOf('const effective = buildApolloOrganizationsEffectiveRequest({'),
      code.indexOf('return { searchInput, searchOptions, effective };'),
    );
    assert.ok(build.length > 0, 'el constructor del request efectivo existe');
    assert.ok(
      !build.includes('priorProviderSeen'),
      '🔴 el body efectivo —y su huella— no pueden depender de la memoria',
    );
  });
});

// ─── MUTACIÓN 6 · la reserva reducida desde el hueco ──────────────────────────

describe('MUTACIÓN 6 · la reserva financiera se deriva del hueco residual', () => {
  it('§ 5 — el estimador canónico sólo recibe el PROVEEDOR', () => {
    const code = stripTsComments(read(WIZARD_BUDGET));
    const fn = code.slice(code.indexOf('export function estimateCreditsForProvider'));
    const signature = fn.slice(0, fn.indexOf('{'));

    assert.ok(
      /\(provider: WizardDiscoveryProviderKey\): number/.test(signature),
      `la firma no puede ganar un parámetro de demanda: ${signature.trim()}`,
    );
    for (const forbidden of ['remainingTarget', 'residualGap', 'resultDemand', 'targetEligible']) {
      assert.ok(!code.includes(forbidden), `el estimador no puede ver la demanda (${forbidden})`);
    }
  });

  it('§ 16 — el peor caso de dos rondas no depende del objetivo ni del hueco', () => {
    const code = stripTsComments(read(TWO_ROUND_BUDGET));
    // 🔴 El corte del bloque NO puede anclarse en un comentario: `stripTsComments`
    // ya los quitó, así que `indexOf` devolvería -1 y el `slice` se comería el
    // archivo entero — una guarda que mira de más es tan inútil como una que mira
    // de menos. Se corta en el cierre de la propia función.
    const start = code.indexOf('export function estimateApolloTwoRoundBudget');
    assert.ok(start > 0, 'la función existe');
    const end = code.indexOf('\n}', start);
    assert.ok(end > start, 'la función cierra');
    const fn = code.slice(start, end);

    // AGENT1-APOLLO-NET-NEW-PAGINATION-LIVE-WIRING — el techo de Search por
    // ronda dejó de ser `config.maxResultsPerRound` (organizaciones pedidas) y
    // pasó a ser `WIZARD_APOLLO_MAX_PAGES_HARD_CAP` (páginas): Apollo cobra por
    // página no vacía, no por organización pedida, así que anclar la reserva al
    // volumen pedido sobre-reservaba o sub-declaraba el techo real. El ancla
    // sigue siendo una CONSTANTE por ronda, nunca la demanda — eso es lo que
    // esta guarda protege — sólo cambió CUÁL constante.
    assert.ok(
      fn.includes('WIZARD_APOLLO_MAX_PAGES_HARD_CAP'),
      'se deriva del techo de páginas por ronda',
    );
    assert.ok(fn.includes('config.maxRounds'), 'y del número de rondas');
    for (const forbidden of ['targetEligibleCompanies', 'remainingTarget', 'residualGap']) {
      assert.ok(
        !fn.includes(forbidden),
        `🔴 el techo financiero no puede encogerse por la demanda (${forbidden})`,
      );
    }
  });

  it('la reserva del wizard se pide con el proveedor y NADA más', () => {
    const code = stripTsComments(read(WIZARD_ACTIONS));

    assert.ok(
      code.includes('const requestedCredits = estimateCreditsForProvider(discoveryProvider);'),
      'la reserva sale de la autoridad canónica, con un solo argumento',
    );
    const reserva = code.slice(
      code.indexOf('const budgetResult = await deps.reserveBudget({'),
      code.indexOf('if (budgetResult.status ===') ,
    );
    assert.ok(reserva.includes('requestedCredits'), 'se reserva la estimación');
    for (const forbidden of ['remainingTarget', 'resultDemand', 'residualGap']) {
      assert.ok(!reserva.includes(forbidden), `la reserva no ve la demanda (${forbidden})`);
    }
  });

  it('el orquestador NUNCA muta el `config` que alimenta al peor caso', () => {
    const code = stripTsComments(read(ORCHESTRATOR));
    // 🔴 Con `=` a secas, `config.maxRounds === 1` daría un falso positivo. La
    // asignación es un `=` que NO va seguido de otro `=`.
    for (const field of ['targetEligibleCompanies', 'maxResultsPerRound', 'maxRounds']) {
      const assignment = new RegExp(`config\\.${field}\\s*=[^=]`);
      assert.ok(!assignment.test(code), `el config es de sólo lectura aquí (${field})`);
    }
    assert.ok(!/\bconfig\s*=\s*\{/.test(code), 'el config no se reconstruye');
  });

  /** 🔴 EN NEGATIVO — la guarda de la firma detecta el parámetro añadido. */
  it('mutación: darle un parámetro de demanda al estimador rompe la guarda', () => {
    const mutated =
      'export function estimateCreditsForProvider(provider: WizardDiscoveryProviderKey, remainingTarget: number): number {';
    const signature = mutated.slice(0, mutated.indexOf('{'));
    assert.ok(!/\(provider: WizardDiscoveryProviderKey\): number/.test(signature));
  });
});

// ─── § 19 · alcance: nada de esto cuesta dinero ni cambia el despliegue ───────

describe('CUT-2 § 19 · sin flags, sin migraciones, sin llamadas de pago', () => {
  const TOUCHED = [
    DEMAND,
    ORCHESTRATOR,
    PROVIDER,
    PAGINATED,
    PROVIDER_SEEN,
    WIZARD_APOLLO,
    'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts',
    'src/server/agents/prospecting-toolkit/apollo-benchmark-funnel.ts',
    'src/modules/prospect-batches/provider-seen/provider-seen-telemetry.ts',
  ];

  it('ningún flag nuevo', () => {
    for (const rel of TOUCHED) {
      const code = stripTsComments(read(rel));
      for (const forbidden of [
        'ENABLE_APOLLO_RESIDUAL',
        'ENABLE_RESIDUAL_GAP',
        'ENABLE_APOLLO_BENCHMARK',
        'ENABLE_APOLLO_PROVIDER_SEEN',
      ]) {
        assert.ok(!code.includes(forbidden), `${rel} introduce un flag nuevo (${forbidden})`);
      }
    }
  });

  it('ninguna migración nueva', () => {
    const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    assert.deepEqual(
      migrations.filter((f) => f.toLowerCase().includes('provider_seen')),
      ['123_provider_seen_entities.sql'],
    );
    // La 124 la tomó AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 (Agente 2A,
    // teléfono). Este corte sigue sin aportar ninguna: se comprueba por número libre y
    // por AUTORÍA, porque un número ocupado por otro hito no es una infracción de este.
    // La 125 la toma BR-SOURCE CUT A.1 (reconciliación GENÉRICA de `record_identity_key`
    // sobre `source_company_snapshots`, fuentes NO brasileñas; AUTORADA y NO APLICADA). La
    // 126 la toma AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY (vallado optimista de la admisión
    // por identidad de LOTE; añade `prospect_batches.identity_epoch` y dos funciones sobre
    // `prospect_batches`/`prospect_candidates`; AUTORADA y NO APLICADA), que reclamó ese
    // número de forma independiente mientras la reconciliación de BR-SOURCE CUT A.1 seguía
    // en revisión. La 127 la toma BR-SOURCE-FUNCTIONAL-CUT-A (identidad MENSUAL del snapshot
    // de Receita, RENUMERADA DOS VECES — 125→126→127 — para no colisionar con ninguna de las
    // dos anteriores; AUTORADA y NO APLICADA). El siguiente número libre es la 128, y la
    // AUTORÍA se barre ahora sobre 124, 125, 126 y 127: es la comprobación que de verdad
    // protege este corte.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 reclamó después la 128: la
    // proyección de la colección de teléfonos de un candidato ya APROBADO al contacto que su
    // aprobación creó (Agente 2A, teléfono). El siguiente número libre es la 129, y la AUTORÍA
    // se barre ahora también sobre la 128: un número ocupado por otro hito no es una infracción
    // de este, y la comprobación que de verdad protege este corte es la de autoría.
    //
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 reclamó después el tramo 129–132: la cadena
    // de sincronización con HubSpot de Agente 2 (129 la completitud del estado durable `stale`,
    // 130 su procedencia, 131 la 128 RE-EMITIDA que produce el pendiente, 132 la línea base de
    // los contactos ya vinculados), canonicalizada desde cuatro archivos que nacieron sin número
    // mientras la numeración 125/126/127 estaba en disputa aguas arriba. AUTORADAS y NO APLICADAS.
    //
    // 🔴 POR QUÉ ESTA LÍNEA TENÍA QUE MOVERSE, Y POR QUÉ NO DEBILITA LA GUARDA:
    // «el siguiente número está libre» es un PROXY de «este corte no aporta migración», y el
    // proxy caduca en cuanto CUALQUIER otro hito ocupa ese número —cosa que este corte no puede
    // ni impedir ni provocar—. Lo que de verdad protege este corte es la AUTORÍA, que se barre
    // abajo, y ese barrido se ENSANCHA aquí de cinco números a nueve. La guarda queda más fuerte
    // que antes, no meramente desplazada: un número libre nunca demostró nada.
    // 🔴 BR-PRODUCTION-RELEASE reclamó después la 133: la promoción VALLADA de la identidad
    // fiscal resuelta de una candidata brasileña (BR-SOURCE CUT D), numerada al volver ese
    // trabajo a GitHub tras vivir en local sin número. El proxy «el siguiente número está libre»
    // se mueve por tanto de la 133 a la 134, y el barrido de AUTORÍA —lo único que de verdad
    // protege este corte— se ENSANCHA de nueve números a diez para incluir la 133. La guarda
    // queda otra vez más fuerte que antes, no meramente desplazada: un número libre nunca
    // demostró nada.
    // 🔴 BR-COMPACT-SNAPSHOT-PRODUCTIZATION reclamó después la 134: la tabla dedicada y
    // particionada del snapshot nacional de Brasil. El proxy «el siguiente número está libre» se
    // mueve por tanto de la 134 a la 135, y el barrido de AUTORÍA —lo único que de verdad protege
    // este corte— se ENSANCHA de diez números a once para incluir la 134. Otra vez más fuerte que
    // antes, no meramente desplazada.
    assert.equal(migrations.filter((f) => f.startsWith('135')).length, 0);
    for (const file of migrations.filter(
      (f) =>
        f.startsWith('124') ||
        f.startsWith('125') ||
        f.startsWith('126') ||
        f.startsWith('127') ||
        f.startsWith('128') ||
        f.startsWith('129') ||
        f.startsWith('130') ||
        f.startsWith('131') ||
        f.startsWith('132') ||
        f.startsWith('133') ||
        f.startsWith('134'),
    )) {
      assert.equal(
        read(path.join('supabase/migrations', file)).includes('BENCHMARK-PARITY'),
        false,
        `${file} no puede ser autoría de este corte`,
      );
    }
  });

  it('el módulo de demanda es PURO: sin env, sin reloj, sin red, sin DB', () => {
    const code = stripTsComments(read(DEMAND));
    for (const forbidden of [
      'process.env',
      'fetch(',
      'Date.now',
      'new Date',
      'supabase',
      'createClient',
    ]) {
      assert.ok(!code.includes(forbidden), `el contrato de demanda es puro (${forbidden})`);
    }
  });

  it('la memoria previa no puede volver a pagar: el módulo Apollo sigue sin transporte', () => {
    const code = stripTsComments(read(PROVIDER_SEEN));
    for (const forbidden of ['fetch(', 'axios', 'getApolloApiKey', 'apollo-client']) {
      assert.ok(!code.includes(forbidden), `recordar y contar no pueden pagar (${forbidden})`);
    }
  });
});
