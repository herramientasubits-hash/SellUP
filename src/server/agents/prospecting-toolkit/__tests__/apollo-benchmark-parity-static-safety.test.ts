/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 — garantías ESTÁTICAS.
 *
 * Lo que este archivo defiende es el ORDEN y el ALCANCE: dónde nace la memoria
 * respecto de los filtros locales, de qué cifra sale la contabilidad, y todo lo
 * que este corte tenía prohibido tocar.
 *
 * 🔴 Todo se busca con los COMENTARIOS FUERA. Una guarda que lea el cuerpo crudo
 * convierte «citar un nombre en la prosa» en «usarlo», y ese falso positivo ya
 * ocurrió en este repo (AGENT2A-SEARCH-MORE-PHONES-1G). Cada guarda de orden se
 * prueba además EN NEGATIVO sobre una copia mutada del mismo texto, para que no
 * pueda quedarse verde por no encontrar ninguno de sus dos anclajes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

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

const PAGINATED = 'src/server/agents/prospecting-toolkit/apollo-organizations-paginated-search.ts';
const PROVIDER =
  'src/server/agents/prospecting-toolkit/web-search-providers/apollo-organizations-search-provider.ts';
const USAGE_LOGGING =
  'src/server/agents/prospecting-toolkit/apollo-organizations-usage-logging.ts';
const EXCLUSION_PLANNER =
  'src/modules/prospect-batches/provider-seen/provider-exclusion-planner.ts';
const LUSHA_EXECUTOR = 'src/server/prospect-batches/lusha-pending-review.ts';

// ─── P0-2 · el orden, sobre el ejecutor real ──────────────────────────────────

/** Los tres anclajes del orden, en el texto ya despojado de comentarios. */
function orderingAnchors(code: string) {
  return {
    okGuard: code.indexOf('if (response.ok && !response.malformedBody)'),
    record: code.indexOf('recordApolloProviderSeenPage('),
    truncation: code.indexOf('if (collected.length >= budget.maxCandidates) break;'),
    crossPageDedupe: code.indexOf('if (seenOrganizationIds.has(id)) continue;'),
  };
}

describe('P0-2 · RESPUESTA VÁLIDA → recordar → filtrar', () => {
  it('los tres anclajes existen y están en ese orden', () => {
    const anchors = orderingAnchors(stripTsComments(read(PAGINATED)));

    assert.ok(anchors.okGuard > 0, 'la guarda de respuesta válida existe');
    assert.ok(anchors.record > 0, 'la memoria se registra en la búsqueda paginada');
    assert.ok(anchors.crossPageDedupe > 0, 'el dedupe entre páginas existe');
    assert.ok(anchors.truncation > 0, 'el tope de candidatos existe');

    assert.ok(anchors.okGuard < anchors.record, 'recordar ocurre DESPUÉS de comprobar `ok`');
    assert.ok(
      anchors.record < anchors.crossPageDedupe,
      'recordar ocurre ANTES del dedupe entre páginas',
    );
    assert.ok(
      anchors.record < anchors.truncation,
      'recordar ocurre ANTES del tope `maxCandidates`',
    );
  });

  /**
   * 🔴 EN NEGATIVO — mutación 1 del hito: mover el registro DESPUÉS del tope.
   * Si esta prueba no se pusiera roja, la de arriba estaría comprobando nada.
   */
  it('mutación: registrar después del tope de candidatos rompe la guarda', () => {
    const code = stripTsComments(read(PAGINATED));
    const call = 'await recordApolloProviderSeenPage(';
    const start = code.indexOf(call);
    assert.ok(start > 0);
    const end = code.indexOf('});', start) + 3;
    const block = code.slice(start, end);

    const mutated = code.slice(0, start) + code.slice(end) + `\n${block}\n`;
    const anchors = orderingAnchors(mutated);
    assert.ok(
      !(anchors.record < anchors.truncation),
      'con el registro movido al final, la guarda del tope TIENE que fallar',
    );
    // 🔴 Mutación 2 del hito: la misma copia mutada deja el registro DESPUÉS del
    // dedupe entre páginas, y esa guarda también tiene que ponerse roja.
    assert.ok(
      !(anchors.record < anchors.crossPageDedupe),
      'con el registro movido al final, la guarda del dedupe TIENE que fallar',
    );
    // Y el texto original sí las cumple: la mutación es lo único que las rompe.
    const original = orderingAnchors(code);
    assert.ok(original.record < original.crossPageDedupe);
    assert.ok(original.record < original.truncation);
  });

  it('la validez NO se deriva del tamaño de la lista en el punto de registro', () => {
    const code = stripTsComments(read(PAGINATED));
    const start = code.indexOf('recordApolloProviderSeenPage(');
    const block = code.slice(start, start + 400);

    for (const forbidden of [
      'organizations.length >',
      'organizations.length > 0',
      'length > 0 ?',
    ]) {
      assert.ok(!block.includes(forbidden), `la validez no puede salir de un tamaño (${forbidden})`);
    }
  });

  /** 🔴 Mutación 6 del hito: volver fail-CLOSED la escritura de memoria. */
  it('la escritura de memoria es fail-SOFT: nunca propaga', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-organizations-provider-seen.ts'),
    );
    const fn = code.slice(code.indexOf('export async function recordApolloProviderSeenPage'));

    assert.ok(fn.includes('try {'), 'la escritura va dentro de un try');
    assert.ok(fn.includes('ledger.noteWriteFailure('), 'el fallo se CUENTA, no se traga');
    assert.ok(!fn.includes('throw '), 'la memoria no puede lanzar hacia la búsqueda');
  });
});

// ─── P0-4 · de qué cifra sale la contabilidad ─────────────────────────────────

describe('P0-4 · el agregado NO puede volver a salir de la lista recogida', () => {
  /** 🔴 Mutación 3 del hito: volver a `rawOrgs.length` / `collected.length`. */
  it('los créditos y `results_returned` se derivan del volumen pagado', () => {
    const code = stripTsComments(read(PROVIDER));

    assert.ok(
      code.includes('resolveApolloPaidResultsVolume(paginated.pageOutcomes)'),
      'la autoridad es el ledger por página',
    );
    assert.ok(
      code.includes("creditsForApolloOperation('organizations_search', paidVolume.resultsVolume)"),
      'los créditos salen del volumen pagado',
    );
    assert.ok(
      !code.includes("creditsForApolloOperation('organizations_search', rawOrgs.length)"),
      'la base NO puede volver a ser la lista ya truncada y deduplicada',
    );
    assert.ok(
      code.includes('results_returned: paidVolume.resultsVolume'),
      'la fila declara el volumen pagado',
    );
    assert.ok(
      !code.includes('results_returned: rawOrgs.length'),
      'la fila NO puede volver a declarar lo recogido',
    );
  });

  it('el modelo de facturación de Apollo NO se decide en código', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-organizations-paid-volume.ts'),
    );

    // P0-1 sigue sin confirmación externa: la etiqueta lo dice y nadie afirma
    // que el proveedor haya reportado la factura.
    assert.ok(code.includes('providerReported: false'));
    assert.ok(code.includes("'results_volume_model_provider_unconfirmed'"));
    for (const forbidden of ['providerReported: true', 'billed_by_provider', 'invoiced_credits']) {
      assert.ok(!code.includes(forbidden), `no se puede afirmar la factura (${forbidden})`);
    }
  });
});

// ─── P1-1 · el costo desconocido ──────────────────────────────────────────────

describe('P1-1 · null explícito no puede volver a colapsar en 0', () => {
  /** 🔴 Mutación 4 del hito. */
  it('la fila Apollo preserva el costo desconocido', () => {
    const code = stripTsComments(read(USAGE_LOGGING));
    const builder = code.slice(code.indexOf('export function buildProviderUsageLogRow'));

    assert.ok(
      builder.includes('preserveUnknownEstimatedCost: true'),
      'la opción canónica está encendida en la ruta Apollo',
    );
    for (const forbidden of ['estimated_cost_usd ?? 0', 'estimatedCostUsd ?? 0']) {
      assert.ok(!builder.includes(forbidden), `no puede fabricarse un 0 (${forbidden})`);
    }
  });
});

// ─── P1-3 · el embudo no inventa ──────────────────────────────────────────────

describe('P1-3 · un campo no medible se publica null, nunca 0', () => {
  /** 🔴 Mutación 5 del hito: fabricar `accepted_for_target` desde lo devuelto. */
  it('la ruta Apollo pasa `acceptedForTarget: null` y no otra cosa', () => {
    const code = stripTsComments(read(PROVIDER));

    assert.ok(code.includes('acceptedForTarget: null'));
    for (const forbidden of [
      'acceptedForTarget: filteredMapped.length',
      'acceptedForTarget: rawOrgs.length',
      'acceptedForTarget: paidVolume.resultsVolume',
      'acceptedForTarget: postGateCount',
      'acceptedForTarget: 0',
    ]) {
      assert.ok(!code.includes(forbidden), `el campo no se puede fabricar (${forbidden})`);
    }
  });

  it('el constructor del embudo no tiene ningún `?? 0`', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-benchmark-funnel.ts'),
    );
    for (const forbidden of ['?? 0', '|| 0']) {
      assert.ok(!code.includes(forbidden), `un null no puede degradarse a 0 (${forbidden})`);
    }
  });
});

// ─── Alcance: lo que este corte tenía PROHIBIDO tocar ─────────────────────────

describe('alcance — lo que este corte NO tocó (y lo que el corte 2 SÍ abrió)', () => {
  it('la capacidad de exclusión de Apollo sigue TODA en false', () => {
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

  /**
   * 🔴 RATCHET INVERTIDO por AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2, no borrado.
   *
   * Esta guarda decía «P0-3 está FUERA de este corte» y enumeraba SIETE nombres
   * prohibidos en el provider. El corte 2 abre P0-3 —demanda residual y carga de
   * memoria previa— así que el enunciado dejó de ser verdad y mantenerlo verde
   * habría sido peor que borrarlo: un ratchet que afirma un alcance caducado.
   *
   * Lo que se conserva es la parte que SIGUE siendo cierta, y por las mismas
   * razones de siempre:
   *
   *   · el provider no resuelve por su cuenta la capa gratuita
   *     (`runPrepaidNoveltyGate`): la recibe ya resuelta desde el wizard, que es
   *     quien puede ordenarla ANTES de reservar;
   *   · el provider no PLANIFICA exclusiones (`buildProviderExclusionPlan`): la
   *     capacidad de Apollo sigue entera en false y nada viaja al proveedor;
   *   · el provider no cuenta aciertos por su cuenta
   *     (`isProviderSeenKnown` / `countProviderSeenHits` / `buildProviderSeenMemory`):
   *     eso ocurre en `apollo-organizations-provider-seen.ts`, con la función
   *     canónica, para que no exista un segundo emparejador de identidad.
   *
   * Y lo que cambia de signo: el provider AHORA transporta el snapshot previo.
   */
  it('el provider TRANSPORTA la memoria previa, pero no la resuelve ni la empareja', () => {
    const code = stripTsComments(read(PROVIDER));

    // Lo nuevo del corte 2, afirmado en positivo.
    assert.ok(
      code.includes('priorProviderSeen'),
      'el corte 2 hace que el snapshot previo llegue a la búsqueda',
    );
    assert.ok(
      code.includes('providerSeenHit: paginated.providerSeen.priorSeenHits'),
      'el embudo publica lo MEDIDO, no un null fijo',
    );
    assert.ok(
      !code.includes('providerSeenHit: null'),
      'ya no puede quedar un `providerSeenHit: null` literal en la ruta Apollo',
    );

    // Lo que sigue prohibido, y por qué.
    for (const forbidden of [
      'runPrepaidNoveltyGate',
      'buildProviderExclusionPlan',
      'isProviderSeenKnown',
      'countProviderSeenHits',
      'buildProviderSeenMemory',
    ]) {
      assert.ok(
        !code.includes(forbidden),
        `el provider transporta, no resuelve ni empareja (${forbidden})`,
      );
    }
  });

  it('la búsqueda paginada no gana ninguna exclusión ni cambia de volumen', () => {
    const code = stripTsComments(read(PAGINATED));
    // 🔴 `residualGap` sale de esta lista en el corte 2 por una razón CONCRETA y no
    // por comodidad: el nombre del lado del proveedor es `remainingTarget`, que ya
    // existía en el repo (`buildRound2Hypothesis`), y la cota se aplica en el
    // orquestador, no aquí. La búsqueda paginada sigue sin conocer el hueco: recibe
    // un `per_page` ya resuelto. Las exclusiones siguen prohibidas, sin matices.
    for (const forbidden of ['exclude', 'excludeIds', 'excludeDomains', 'residualGap']) {
      assert.ok(!code.includes(forbidden), `este corte no toca el gasto (${forbidden})`);
    }
    // El tope de candidatos sigue saliendo del presupuesto, no de un literal nuevo.
    assert.ok(code.includes('budget.maxCandidates'), 'el tope sigue viniendo del presupuesto');
  });

  it('este corte NO introduce flags ni migraciones', () => {
    const touched = [
      PAGINATED,
      PROVIDER,
      USAGE_LOGGING,
      'src/server/agents/prospecting-toolkit/apollo-organizations-provider-seen.ts',
      'src/server/agents/prospecting-toolkit/apollo-organizations-paid-volume.ts',
      'src/server/agents/prospecting-toolkit/apollo-benchmark-funnel.ts',
    ];
    for (const rel of touched) {
      const code = stripTsComments(read(rel));
      for (const forbidden of ['ENABLE_APOLLO_BENCHMARK', 'ENABLE_APOLLO_PROVIDER_SEEN']) {
        assert.ok(!code.includes(forbidden), `${rel} introduce un flag nuevo (${forbidden})`);
      }
    }

    // La única migración de provider-seen sigue siendo la 123 ya aplicada.
    const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
      f.endsWith('.sql'),
    );
    assert.deepEqual(
      migrations.filter((f) => f.toLowerCase().includes('provider_seen')),
      ['123_provider_seen_entities.sql'],
    );
    // La 124 la tomó AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 (identidad
    // provider-native del reveal de TELÉFONO, Agente 2A). Este corte sigue sin aportar
    // ninguna, y eso se comprueba por AUTORÍA además de por número: un número libre no
    // demuestra nada si mañana otro hito lo ocupa.
    // La 125 la toma BR-SOURCE CUT A.1 (reconciliación GENÉRICA de `record_identity_key`
    // sobre `source_company_snapshots`, fuentes NO brasileñas; AUTORADA y NO APLICADA), y la
    // 126 la toma BR-SOURCE-FUNCTIONAL-CUT-A (identidad MENSUAL del snapshot de Receita,
    // RENUMERADA de 125 a 126 para dejar sitio a la anterior; AUTORADA y NO APLICADA). El
    // siguiente número libre es la 127, y la AUTORÍA se barre ahora sobre 124, 125 y 126.
    assert.equal(
      migrations.filter((f) => f.startsWith('127')).length,
      0,
      'este corte no añade migración',
    );
    for (const file of migrations.filter(
      (f) => f.startsWith('124') || f.startsWith('125') || f.startsWith('126'),
    )) {
      assert.equal(
        read(path.join('supabase/migrations', file)).includes('BENCHMARK-PARITY'),
        false,
        `${file} no puede ser autoría de este corte`,
      );
    }
  });
});

// ─── Lusha intacto ────────────────────────────────────────────────────────────

describe('alcance — la ruta Lusha no cambia', () => {
  it('Lusha sigue registrando memoria después de `ok` y antes del dedupe', () => {
    const code = stripTsComments(read(LUSHA_EXECUTOR));

    const okGuard = code.indexOf('if (!search.ok)');
    const record = code.indexOf('planProviderSeenRecording(');
    const dedupe = code.indexOf('dedupeLushaCompaniesByIdentity(search.results');

    assert.ok(okGuard > 0 && record > 0 && dedupe > 0);
    assert.ok(okGuard < record, 'Lusha recuerda DESPUÉS de comprobar `ok`');
    assert.ok(record < dedupe, 'Lusha recuerda ANTES del dedupe — igual que Apollo ahora');
  });

  it('Apollo no puede suprimir identidades de Lusha ni al revés', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-organizations-provider-seen.ts'),
    );
    assert.ok(code.includes("provider: 'apollo'"), 'la observación se sella como Apollo');
    for (const forbidden of ["'lusha'", 'provider_suppressions', 'crossProvider']) {
      assert.ok(!code.includes(forbidden), `no hay identidad cruzada (${forbidden})`);
    }
  });

  it('el módulo Apollo de memoria no alcanza a un proveedor ni a la red', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-organizations-provider-seen.ts'),
    );
    for (const forbidden of ['fetch(', 'axios', 'getApolloApiKey', 'apollo-client']) {
      assert.ok(!code.includes(forbidden), `recordar no puede volver a pagar (${forbidden})`);
    }
  });
});
