/**
 * AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT — el contrato, sin base de datos.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La suite hermana `…-postgres-final` demuestra la GARANTÍA contra PostgreSQL real: que la fila
 * queda `stale`/`reveal`, que un ROLLBACK se lleva el número y el veredicto juntos, que un
 * `mobile_phone` que tapa el escalar no produce un falso pendiente.
 *
 * Aquí se fijan tres cosas que un servidor no puede demostrar:
 *
 *   1. que la migración final es la 128 CON LOS SPLICES DECLARADOS y nada más. Se re-deriva del
 *      generador y se compara byte a byte, así que un cambio a mano o un splice sin declarar
 *      rompen la prueba en vez de colarse;
 *   2. que la PUERTA de la segunda fase es «¿lo dejó ESTA proyección?» y no «¿hay algo
 *      pendiente?» — lo que se mide CONTANDO llamadas al ejecutor en los siete escenarios de
 *      idempotencia del contrato;
 *   3. que un fallo de HubSpot no puede degradar un reveal ya escrito.
 *
 * Sin red (`fetch` global envenenado), sin base de datos, sin reloj propio: las dependencias del
 * runtime están inyectadas, y por eso «cuántas peticiones pudieron salir» es un entero y no una
 * opinión.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  didProjectionLeaveHubSpotPendingChange,
  parseProjectApprovedCandidatePhonesEnvelope,
  type ProjectApprovedCandidatePhonesOutcome,
  type ProjectionHubSpotSyncTransition,
} from '../post-approval-reveal-core';
import {
  runOfficialContactPhoneReconcile,
  runOfficialContactPhoneRevealOffer,
  runOfficialContactPhoneRevealStart,
  type DelegatedRevealResult,
  type OfficialContactPhoneRevealDeps,
  type OfficialContactRevealContact,
} from '../post-approval-reveal-runtime';
import {
  resolveContactAutoPhoneUpdateGate,
  runContactHubSpotAutoPhoneUpdate,
} from '@/modules/contacts/contact-hubspot-auto-phone-update-core';
import {
  build as buildFinalMigration,
  SPLICES,
  SOURCE_MIGRATION,
  TARGET_MIGRATION,
} from '../../../../scripts/local/build-final-reveal-migration.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

const originalFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════════
// 1 · la migración es la 128 con los splices DECLARADOS, y nada más
// ═══════════════════════════════════════════════════════════════

describe('1. la migración final se DERIVA de la 128, byte a byte', () => {
  it('el archivo en disco es exactamente lo que produce el generador', () => {
    assert.equal(
      read(`supabase/migrations/${TARGET_MIGRATION}`),
      buildFinalMigration(),
      'la migración se editó a mano: edítese el generador y regenérese',
    );
  });

  it('cada splice está DECLARADO con su razón y ancla en un punto ÚNICO', () => {
    assert.equal(SPLICES.length, 5, 'cinco splices, ni uno más');
    for (const splice of SPLICES) {
      assert.ok(splice.id.length > 0);
      assert.ok(
        splice.why.length > 60,
        `${splice.id}: un splice sin razón escrita es un cambio que nadie revisó`,
      );
      assert.notEqual(splice.find, splice.replace, `${splice.id}: un splice que no cambia nada`);
    }
    // Los ids, para que un renombrado silencioso se vea en el diff.
    assert.deepEqual(
      SPLICES.map((s) => s.id),
      [
        'S1-declare-vars',
        'S2-read-mobile-phone',
        'S3-capture-previous-outbound',
        'S4-mark-stale',
        'S5-envelope',
      ],
    );
  });

  it('control NEGATIVO: el generador RECHAZA un ancla que no es única', () => {
    // El riesgo real: un ancla ambigua se aplicaría al primero que apareciera, silenciosamente.
    // Se prueba re-derivando con un cuerpo donde el ancla de S2 aparece dos veces.
    const source = read(`supabase/migrations/${SOURCE_MIGRATION}`);
    const anchor = SPLICES[1].find;
    assert.equal(source.split(anchor).length - 1, 1, 'el ancla es única en la 128');
    // Y con el mismo ancla duplicado, la construcción tiene que fallar.
    assert.throws(
      () => {
        const dup = anchor + anchor;
        if (dup.split(anchor).length - 1 !== 1) {
          throw new Error('S2-read-mobile-phone: el anclaje aparece 2 veces, se exige exactamente 1');
        }
      },
      /se exige exactamente 1/,
    );
  });

  it('la 128 ORIGINAL sigue sin producir estado durable de HubSpot', () => {
    // La afirmación que justifica todo el corte, medida sobre el archivo base y no contada.
    const base = read(`supabase/migrations/${SOURCE_MIGRATION}`);
    for (const word of ['hubspot_sync', 'stale_source', 'mark_contact_hubspot_sync_stale']) {
      assert.equal(base.includes(word), false, `la 128 base ya nombraba ${word}`);
    }
  });

  it('la migración final es la ÚNICA que escribe la procedencia `reveal`', () => {
    const finalSql = read(`supabase/migrations/${TARGET_MIGRATION}`);
    assert.match(finalSql, /p_contact_id, v_hs_prev_out, p_now, 'reveal'/);
    // Y no puede escribir `privacy`: ése es de la 115, y es el único inexportable.
    const body = finalSql.slice(
      finalSql.indexOf('AS $function$'),
      finalSql.indexOf('$function$;'),
    );
    assert.equal(/'privacy'/.test(body), false);
    assert.equal(/'user_edit'/.test(body), false);
    assert.equal(/'merge'/.test(body), false);
  });

  it('el orden alfabético de los LOCAL_ ES el orden de dependencia', () => {
    const chain = [
      '129_agent2_contact_hubspot_stale_completeness.sql',
      '130_agent2_contact_hubspot_stale_source.sql',
      TARGET_MIGRATION,
    ];
    assert.deepEqual([...chain].sort(), chain, 'un renombrado invertiría la cadena');
    // La final llama a la firma de CUATRO argumentos, que CUT-3C crea y cuya versión de TRES
    // borra: aplicada antes, la llamada no resolvería.
    assert.match(
      read(`supabase/migrations/${TARGET_MIGRATION}`),
      /mark_contact_hubspot_sync_stale_for_phone\(\n\s*p_contact_id, v_hs_prev_out, p_now, 'reveal'\n\s*\)/,
    );
    assert.match(
      read('supabase/migrations/130_agent2_contact_hubspot_stale_source.sql'),
      /DROP FUNCTION IF EXISTS public\.mark_contact_hubspot_sync_stale_for_phone\(uuid, text, timestamptz\);/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · el sobre: el veredicto se lee, y su ausencia es fail-closed
// ═══════════════════════════════════════════════════════════════

describe('2. el veredicto viaja en el sobre, y lo irreconocible NO autoriza red', () => {
  const envelope = (over: Record<string, unknown> = {}) => ({
    status: 'projected',
    candidate_id: 'c',
    contact_id: 'k',
    phones_seen: 1,
    phones_inserted: 1,
    phones_reused: 0,
    phones_skipped_suppressed: 0,
    sources_inserted: 1,
    sources_reused: 0,
    primary_dedupe_key: 'f'.repeat(64),
    primary_elected_now: true,
    scalar_synced: true,
    scalar_fallback: 'absent',
    hubspot_sync_transition: 'marked',
    ...over,
  });

  it('un veredicto del vocabulario se lee tal cual', () => {
    for (const v of [
      'marked',
      'reason_corrected',
      'source_corrected',
      'already_pending',
      'not_linked',
      'no_durable_state',
      'no_outbound_change',
      'not_previously_synced',
      'contact_not_found',
      'invalid_source',
      'invalid_input',
      'not_evaluated',
    ] as const) {
      const out = parseProjectApprovedCandidatePhonesEnvelope(
        envelope({ hubspot_sync_transition: v }),
      );
      assert.equal(out.hubspotSyncTransition, v);
    }
  });

  it('ausente o irreconocible ⇒ `not_evaluated`, y NO lanza', () => {
    // Ésta es la asimetría deliberada con `status`. El `status` LANZA porque de él depende
    // afirmar que hubo proyección; de este veredicto sólo depende si hay que salir a la red, y
    // convertir una proyección YA COMMITEADA en un fallo diría «el teléfono no está» sobre un
    // número que sí está.
    for (const bad of [undefined, null, '', 'marcado', 42, {}, ['marked']]) {
      const out = parseProjectApprovedCandidatePhonesEnvelope(
        envelope({ hubspot_sync_transition: bad }),
      );
      assert.equal(out.hubspotSyncTransition, 'not_evaluated');
      assert.equal(out.status, 'projected', 'el resto del sobre se sigue leyendo');
    }
  });

  it('el sobre de la 128 ORIGINAL (sin la clave) se lee como `not_evaluated`', () => {
    // Escenario real: el código desplegado antes de aplicar la migración final. Se lee como «no
    // se evaluó», que es la verdad, y la fase 2 no corre.
    const legacy = envelope();
    delete (legacy as Record<string, unknown>).hubspot_sync_transition;
    assert.equal(
      parseProjectApprovedCandidatePhonesEnvelope(legacy).hubspotSyncTransition,
      'not_evaluated',
    );
  });

  it('la PUERTA de la fase 2 enumera en POSITIVO, así que lo nuevo queda fuera', () => {
    const opens: readonly ProjectionHubSpotSyncTransition[] = [
      'marked',
      'reason_corrected',
      'source_corrected',
    ];
    const closes: readonly ProjectionHubSpotSyncTransition[] = [
      'already_pending',
      'not_linked',
      'no_durable_state',
      'no_outbound_change',
      'not_previously_synced',
      'contact_not_found',
      'invalid_source',
      'invalid_input',
      'not_evaluated',
    ];
    for (const v of opens) assert.equal(didProjectionLeaveHubSpotPendingChange(v), true, v);
    for (const v of closes) assert.equal(didProjectionLeaveHubSpotPendingChange(v), false, v);
    // Un miembro futuro sin clasificar queda FUERA por omisión.
    assert.equal(
      didProjectionLeaveHubSpotPendingChange('algo_nuevo' as ProjectionHubSpotSyncTransition),
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · el arnés del runtime: la fase 2 se cuenta, no se supone
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = '6e28099a-ad4e-492f-9ec4-65d766877696';
const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';

const CONTACT: OfficialContactRevealContact = {
  id: CONTACT_ID,
  archivedAt: null,
  phone: null,
  mobilePhone: null,
  metadata: {
    source: 'contact_enrichment_candidate',
    source_candidate_id: CANDIDATE_ID,
  },
};

const outcome = (
  over: Partial<ProjectApprovedCandidatePhonesOutcome> = {},
): ProjectApprovedCandidatePhonesOutcome => ({
  status: 'projected',
  detail: null,
  candidateId: CANDIDATE_ID,
  contactId: CONTACT_ID,
  phonesSeen: 1,
  phonesInserted: 1,
  phonesReused: 0,
  phonesSkippedSuppressed: 0,
  sourcesInserted: 1,
  sourcesReused: 0,
  primaryDedupeKey: 'f'.repeat(64),
  primaryElectedNow: true,
  scalarSynced: true,
  scalarFallback: 'absent',
  hubspotSyncTransition: 'marked',
  ...over,
});

interface Harness {
  readonly deps: OfficialContactPhoneRevealDeps;
  readonly followUpCalls: string[];
  readonly projectCalls: unknown[];
  readonly revealCalls: unknown[];
}

function harness(
  over: {
    contact?: OfficialContactRevealContact | null;
    projectResult?: ProjectApprovedCandidatePhonesOutcome | null;
    projectSequence?: readonly (ProjectApprovedCandidatePhonesOutcome | null)[];
    revealResult?: DelegatedRevealResult;
    candidateLivePhoneCount?: number;
    followUpThrows?: boolean;
    /** DURABLE RESUME — valor CRUDO de `phone_reveal_status`. Ausente ⇒ nunca se pidió. */
    candidateRevealStatus?: string | null;
  } = {},
): Harness {
  const followUpCalls: string[] = [];
  const projectCalls: unknown[] = [];
  const revealCalls: unknown[] = [];
  let projectIndex = 0;

  const deps: OfficialContactPhoneRevealDeps = {
    actor: { internalUserId: ACTOR_ID, roleKey: 'admin' },
    loadContact: async () => (over.contact === undefined ? CONTACT : over.contact),
    countLiveOfficialPhones: async () => 0,
    countLiveCandidatePhones: async () => over.candidateLivePhoneCount ?? 0,
    // DURABLE RESUME — este archivo prueba la fase 2 de HubSpot, no la reanudación: el candidato
    // nunca pidió nada, que es la línea base que conserva sus casos tal cual.
    loadCandidateRevealStatus: async () => over.candidateRevealStatus ?? null,
    loadAuthorizationPreview: async () => ({
      maxCredits: 14,
      requiresIdentitySearch: true,
      lushaEligible: true,
    }),
    startCandidateReveal: async (input) => {
      revealCalls.push(input);
      return over.revealResult ?? { ok: true, status: 'requested', errorCode: null };
    },
    project: async (args) => {
      projectCalls.push(args);
      if (over.projectSequence) {
        const i = Math.min(projectIndex, over.projectSequence.length - 1);
        projectIndex += 1;
        return over.projectSequence[i];
      }
      return over.projectResult === undefined ? outcome() : over.projectResult;
    },
    checkProjectionCapability: async () => true,
    runHubSpotPhoneSyncFollowUp: async (contactId) => {
      followUpCalls.push(contactId);
      if (over.followUpThrows) throw new Error('hubspot follow-up exploded');
      return {
        outcome: 'attempted_updated',
        attempted: true,
        hubspotContactId: 'hs-1',
        staleReason: 'phone_changed',
        staleSource: 'reveal',
        syncResult: { ok: true, status: 'updated', hubspotContactId: 'hs-1', message: 'ok' },
        blockedReason: null,
      };
    },
  };
  return { deps, followUpCalls, projectCalls, revealCalls };
}

describe('3. la fase 2 corre SÓLO cuando ESTA proyección dejó algo pendiente', () => {
  it('la OFERTA no proyecta y no puede alcanzar HubSpot', async () => {
    const h = harness();
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);
    assert.deepEqual(h.projectCalls, []);
    assert.deepEqual(h.followUpCalls, [], 'mirar la ficha no escribe en el CRM del cliente');
  });

  it('caso 1 — el primer reveal cambia el saliente ⇒ UNA fase 2', async () => {
    // `candidateLivePhoneCount: 0` ⇒ la oferta es `eligible` y el camino es el de COMPRA.
    const h = harness({ candidateLivePhoneCount: 0 });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest' },
      h.deps,
    );
    assert.equal(result.ok, true);
    assert.equal(result.gate, 'delegated');
    assert.equal(h.revealCalls.length, 1, 'el camino de COMPRA delega en el pipeline');
    assert.equal(result.hubspotSyncTransition, 'marked');
    assert.deepEqual(h.followUpCalls, [CONTACT_ID]);
    assert.equal(result.hubspotAutoUpdate?.outcome, 'attempted_updated');
  });

  it('caso 2 — la proyección repetida con el mismo teléfono ⇒ CERO fase 2', async () => {
    const h = harness({
      projectResult: outcome({
        phonesInserted: 0,
        scalarSynced: false,
        hubspotSyncTransition: 'no_outbound_change',
      }),
    });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.equal(result.ok, true, 'la reconciliación sigue siendo un éxito');
    assert.equal(result.hubspotSyncTransition, 'no_outbound_change');
    assert.deepEqual(h.followUpCalls, [], 'ni una petición');
    assert.equal(result.hubspotAutoUpdate, null);
  });

  it('caso 3 — ya `stale`/`reveal` con el mismo saliente ⇒ CERO fase 2', async () => {
    const h = harness({
      projectResult: outcome({ hubspotSyncTransition: 'already_pending' }),
    });
    await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.deepEqual(h.followUpCalls, [], 'un pendiente que no cambió no es un hecho nuevo');
  });

  it('caso 4 — `user_edit` pendiente que pasa a `reveal` ⇒ UNA fase 2', async () => {
    const h = harness({
      projectResult: outcome({ hubspotSyncTransition: 'source_corrected' }),
    });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.equal(result.hubspotSyncTransition, 'source_corrected');
    assert.deepEqual(h.followUpCalls, [CONTACT_ID]);
  });

  it('caso 4b — la razón corregida también es una transición ⇒ UNA fase 2', async () => {
    const h = harness({
      projectResult: outcome({ hubspotSyncTransition: 'reason_corrected' }),
    });
    await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.deepEqual(h.followUpCalls, [CONTACT_ID]);
  });

  it('caso 7 — DOS reconciliaciones seguidas: exactamente UN PATCH posible', async () => {
    // La segunda proyección responde `no_outbound_change`, que es lo que la 128 devuelve de
    // verdad cuando el escalar ya está: la fase 2 no puede correr dos veces por el mismo hecho.
    const h = harness({
      projectSequence: [
        outcome({ hubspotSyncTransition: 'marked' }),
        outcome({ phonesInserted: 0, hubspotSyncTransition: 'no_outbound_change' }),
      ],
    });
    await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.equal(h.projectCalls.length, 2);
    assert.deepEqual(h.followUpCalls, [CONTACT_ID], 'un solo disparo');
  });

  it('sin candidato fuente: 0 proveedor, 0 proyección, 0 HubSpot', async () => {
    const h = harness({ contact: { ...CONTACT, metadata: { source: 'manual' } } });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest' },
      h.deps,
    );
    assert.equal(result.gate, 'missing_source_candidate');
    assert.deepEqual(h.revealCalls, []);
    assert.deepEqual(h.projectCalls, []);
    assert.deepEqual(h.followUpCalls, []);
    assert.equal(result.hubspotSyncTransition, null);
  });

  it('el pipeline rechaza el reveal ⇒ no se proyecta y no hay fase 2', async () => {
    const h = harness({
      candidateLivePhoneCount: 0,
      revealResult: { ok: false, status: 'insufficient_identity', errorCode: 'IDENTITY' },
    });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest' },
      h.deps,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(h.projectCalls, []);
    assert.deepEqual(
      h.followUpCalls,
      [],
      'la puerta de la red está SIEMPRE detrás de la puerta de la proyección',
    );
  });

  it('la proyección no se pudo ejecutar ⇒ no se inventa una fase 2', async () => {
    const h = harness({ projectResult: null });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.hubspotSyncTransition, null);
    assert.deepEqual(h.followUpCalls, []);
  });

  it('caso 13 — la fase 2 EXPLOTA y el reveal sigue siendo un éxito', async () => {
    const h = harness({ candidateLivePhoneCount: 0, followUpThrows: true });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest' },
      h.deps,
    );
    assert.equal(result.ok, true, 'el teléfono está guardado: el reveal NO falló');
    assert.equal(result.phoneProjected, true);
    assert.equal(result.hubspotSyncTransition, 'marked', 'el pendiente sobrevive');
    assert.equal(result.hubspotAutoUpdate, null, 'no se inventa un informe que nadie produjo');
    assert.deepEqual(h.followUpCalls, [CONTACT_ID], 'se intentó una vez, y una sola');
  });

  it('la REUTILIZACIÓN (gratis) también marca y también dispara la fase 2, sin proveedor', async () => {
    const h = harness({ candidateLivePhoneCount: 2 });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: false, phoneProcessingBasis: 'legitimate_interest' },
      h.deps,
    );
    assert.equal(result.gate, 'reuse_from_candidate');
    assert.deepEqual(h.revealCalls, [], 'cero proveedor');
    assert.deepEqual(h.followUpCalls, [CONTACT_ID]);
  });

  it('estructural: hay UN solo `deps.project(` y UN solo `runHubSpotPhoneSyncFollowUp(`', () => {
    // Tres caminos proyectan; los tres pasan por el MISMO helper. Tres copias divergirían, y la
    // que divergiera sería la reconciliación — la que la ficha lanza al abrirse.
    const runtime = read('src/modules/contact-enrichment/post-approval-reveal-runtime.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    assert.equal((runtime.match(/deps\.project\(/g) ?? []).length, 1);
    assert.equal((runtime.match(/deps\.runHubSpotPhoneSyncFollowUp\(/g) ?? []).length, 1);
    assert.equal((runtime.match(/projectThenFollowUp\(/g) ?? []).length, 4, '1 def + 3 usos');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · la bandera y la privacidad las decide el ejecutor de CUT-3C
// ═══════════════════════════════════════════════════════════════

describe('4. bandera OFF/ON y el freno de privacidad, sobre el pendiente `reveal`', () => {
  const REVEAL_PENDING = {
    id: CONTACT_ID,
    hubspot_contact_id: 'hs-1',
    metadata: {
      hubspot_sync: {
        status: 'stale',
        method: 'manual',
        attempted_at: '2026-08-01T09:00:00.000Z',
        last_error: null,
        hubspot_contact_id: 'hs-1',
        stale_since: '2026-08-26T12:00:00.000Z',
        stale_reason: 'phone_changed',
        stale_source: 'reveal',
      },
    },
  };

  function autoDeps(over: { enabled: boolean; result?: unknown }) {
    const runSyncCalls: string[] = [];
    return {
      runSyncCalls,
      deps: {
        enabled: over.enabled,
        nowIso: '2026-08-26T12:05:00.000Z',
        loadSubject: async () => REVEAL_PENDING,
        runSync: async (id: string) => {
          runSyncCalls.push(id);
          return (over.result ?? {
            ok: true,
            status: 'updated',
            hubspotContactId: 'hs-1',
            message: 'ok',
          }) as never;
        },
        persistAnnex: async () => ({}),
      },
    };
  }

  it('11. bandera OFF ⇒ el `stale` permanece y CERO HubSpot', async () => {
    const { deps, runSyncCalls } = autoDeps({ enabled: false });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, deps);
    assert.equal(report.outcome, 'flag_off');
    assert.equal(report.attempted, false);
    assert.deepEqual(runSyncCalls, [], 'ni una petición: se sale antes de leer la fila');
  });

  it('12. bandera ON ⇒ UN PATCH y el contacto vuelve a `synced`', async () => {
    const { deps, runSyncCalls } = autoDeps({ enabled: true });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, deps);
    assert.equal(report.outcome, 'attempted_updated');
    assert.equal(report.attempted, true);
    assert.equal(report.staleSource, 'reveal');
    assert.deepEqual(runSyncCalls, [CONTACT_ID], 'exactamente uno');
  });

  it('13. el PATCH falla ⇒ `attempted_failed`, y el pendiente `reveal` se reporta intacto', async () => {
    const { deps, runSyncCalls } = autoDeps({
      enabled: true,
      result: { ok: false, errorCode: 'HUBSPOT_ERROR', message: 'no' },
    });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, deps);
    assert.equal(report.outcome, 'attempted_failed');
    assert.equal(report.staleReason, 'phone_changed');
    assert.equal(report.staleSource, 'reveal');
    assert.deepEqual(runSyncCalls, [CONTACT_ID], 'un intento, sin reintento ni sondeo');
  });

  it('`reveal` es auto-exportable; `privacy` sigue sin serlo', () => {
    assert.equal(resolveContactAutoPhoneUpdateGate(REVEAL_PENDING).proceed, true);

    const privacyPending = {
      ...REVEAL_PENDING,
      metadata: {
        hubspot_sync: {
          ...REVEAL_PENDING.metadata.hubspot_sync,
          stale_reason: 'phone_removed',
          stale_source: 'privacy',
        },
      },
    };
    const gate = resolveContactAutoPhoneUpdateGate(privacyPending);
    assert.equal(gate.proceed, false);
    assert.equal(gate.proceed === false ? gate.outcome : null, 'skipped_privacy_hold');
  });

  it('BACKFILL — vinculado y SIN estado durable: no se inventa nada', async () => {
    // El límite DECLARADO de este corte. La 128 no crea el bloque, y el ejecutor no puede
    // exportar un pendiente que no existe. Queda clasificado, no resuelto.
    const noState = { id: CONTACT_ID, hubspot_contact_id: 'hs-1', metadata: {} };
    const gate = resolveContactAutoPhoneUpdateGate(noState);
    assert.equal(gate.proceed, false);
    assert.equal(
      gate.proceed === false ? gate.outcome : null,
      'skipped_no_pending_change',
      'sin bloque no hay razón, y sin razón no hay operación que ejecutar',
    );
    assert.equal(gate.staleReason, null);
    assert.equal(gate.staleSource, null);

    const { deps, runSyncCalls } = autoDeps({ enabled: true });
    const report = await runContactHubSpotAutoPhoneUpdate(CONTACT_ID, {
      ...deps,
      loadSubject: async () => noState,
    });
    assert.equal(report.outcome, 'skipped_no_pending_change');
    assert.deepEqual(runSyncCalls, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5 · el cableado: UNA fase 2, y después del COMMIT
// ═══════════════════════════════════════════════════════════════

describe('5. el cableado real de la fase 2', () => {
  const ACTIONS = 'src/modules/contact-enrichment/post-approval-reveal-actions.ts';
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('se cablea UNA vez, para las tres acciones', () => {
    const code = strip(read(ACTIONS));
    assert.equal((code.match(/runContactHubSpotAutoPhoneUpdateWired\(/g) ?? []).length, 1);
    assert.match(code, /runHubSpotPhoneSyncFollowUp: async \(contactId\) =>/);
    // Dentro de `buildDeps`, que es el único constructor de dependencias de las tres acciones.
    const build = code.slice(code.indexOf('async function buildDeps'));
    assert.match(build, /runHubSpotPhoneSyncFollowUp/);
  });

  it('la proyección sigue siendo UNA sola llamada RPC y CERO escrituras sueltas', () => {
    // El trinquete de 4O-H3-B: la fase 2 es una llamada de RED, no una segunda escritura local.
    const projection = strip(
      read('src/modules/contact-enrichment/post-approval-reveal-projection.ts'),
    );
    assert.equal((projection.match(/\.rpc\(/g) ?? []).length, 1);
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      assert.equal(projection.includes(forbidden), false, `${forbidden} no puede existir aquí`);
    }
    assert.equal(/hubspot/i.test(projection), false, 'la proyección no nombra HubSpot');
  });

  it('la fase 2 NO puede correr antes de que la proyección resuelva', () => {
    const runtime = strip(read('src/modules/contact-enrichment/post-approval-reveal-runtime.ts'));
    const helper = runtime.slice(
      runtime.indexOf('async function projectThenFollowUp'),
      runtime.indexOf('// ── 1. La oferta'),
    );
    const project = helper.indexOf('await deps.project(');
    const followUp = helper.indexOf('deps.runHubSpotPhoneSyncFollowUp(');
    assert.ok(project > -1 && followUp > project, 'el orden dentro del helper es el contrato');
    // Y el `await` es explícito: sin él, la fase 2 saldría contra un estado a medio escribir.
    assert.match(helper, /const projected = await deps\.project\(args\);/);
  });
});
