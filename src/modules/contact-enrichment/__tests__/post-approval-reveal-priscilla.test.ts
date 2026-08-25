/**
 * Agente 2A — LA REGRESIÓN PRISCILLA: revelar teléfono desde un contacto oficial
 * (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL CASO REAL QUE ESTE ARCHIVO CONGELA
 * ═══════════════════════════════════════════════════════════════════
 *
 * Priscilla Dominguez existe como CONTACTO OFICIAL porque su candidato se aprobó. Su candidato es
 * `approved`, nació en Apollo, nunca tuvo un reveal y no tiene teléfono. Su contacto tampoco:
 * `phone` NULL, `mobile_phone` NULL, `phone_source` NULL, y `metadata.source_candidate_id`
 * apuntando al candidato del que nació.
 *
 * Antes de este hito su ficha no ofrecía nada y no podía: el pipeline de reveal existe entero pero
 * sólo era alcanzable desde la revisión del candidato — que ya salió de revisión — y, aunque se
 * disparara, el número se habría quedado en la colección del candidato, porque ninguna sentencia
 * del esquema lo llevaba al contacto.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ SE MIDE, Y POR QUÉ SE MIDE CONTANDO LLAMADAS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las tres propiedades del contrato que importan son afirmaciones sobre QUÉ dependencias se
 * invocan: «un clic delega en el pipeline que ya existe» (no en un waterfall nuevo), «la
 * reutilización no llama a ningún proveedor» y «sin candidato fuente no se gasta nada». Con las
 * dependencias inyectadas eso se cuenta; con las dependencias importadas habría que simular
 * Supabase para no medir nada.
 *
 * `startCandidateReveal` es la ÚNICA vía a un proveedor de todo el módulo. Cada aserción de la
 * forma «0 llamadas a `startCandidateReveal`» es, por construcción, «0 llamadas a Apollo, 0 a
 * Lusha, 0 reservas, 0 usage logs y 0 créditos».
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni ninguna base;
 * no gasta un crédito y no escribe nada. Todos los teléfonos son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runOfficialContactPhoneReconcile,
  runOfficialContactPhoneRevealOffer,
  runOfficialContactPhoneRevealStart,
  type DelegatedRevealResult,
  type OfficialContactPhoneRevealDeps,
  type OfficialContactRevealContact,
} from '../post-approval-reveal-runtime';
import type { ProjectApprovedCandidatePhonesOutcome } from '../post-approval-reveal-core';

// ── El caso real, con sus ids ──────────────────────────────────────

const CANDIDATE_ID = '6e28099a-ad4e-492f-9ec4-65d766877696';
const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';

/** Apollo hasta 8 + búsqueda de identidad Lusha 1 + revelado Lusha 5 = 14. */
const PRISCILLA_MAX_CREDITS = 14;

const PRISCILLA_CONTACT: OfficialContactRevealContact = {
  id: CONTACT_ID,
  archivedAt: null,
  phone: null,
  mobilePhone: null,
  metadata: {
    source: 'contact_enrichment_candidate',
    source_candidate_id: CANDIDATE_ID,
    candidate_source: 'apollo',
  },
};

const projectedOutcome = (
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
  ...over,
});

interface Spy {
  readonly deps: OfficialContactPhoneRevealDeps;
  readonly revealCalls: unknown[];
  readonly projectCalls: unknown[];
  readonly previewCalls: string[];
}

/**
 * Arnés con contadores. Todo lo que puede gastar entra por `startCandidateReveal`; todo lo que
 * puede escribir en el contacto entra por `project`. Si alguna de las dos aparece en un camino que
 * no debía, el contador lo dice.
 */
function makeDeps(
  over: {
    contact?: OfficialContactRevealContact | null;
    loadContactThrows?: boolean;
    liveOfficialPhoneCount?: number;
    candidateLivePhoneCount?: number;
    preview?: { maxCredits: number; requiresIdentitySearch: boolean; lushaEligible: boolean } | null;
    previewThrows?: boolean;
    revealResult?: DelegatedRevealResult;
    projectResult?: ProjectApprovedCandidatePhonesOutcome | null;
    roleKey?: string | null;
  } = {},
): Spy {
  const revealCalls: unknown[] = [];
  const projectCalls: unknown[] = [];
  const previewCalls: string[] = [];

  const deps: OfficialContactPhoneRevealDeps = {
    actor: {
      internalUserId: ACTOR_ID,
      roleKey: over.roleKey === undefined ? 'admin' : over.roleKey,
    },
    loadContact: async () => {
      if (over.loadContactThrows) throw new Error('official contact read failed');
      return over.contact === undefined ? PRISCILLA_CONTACT : over.contact;
    },
    countLiveOfficialPhones: async () => over.liveOfficialPhoneCount ?? 0,
    countLiveCandidatePhones: async () => over.candidateLivePhoneCount ?? 0,
    loadAuthorizationPreview: async (candidateId) => {
      previewCalls.push(candidateId);
      if (over.previewThrows) throw new Error('preview read failed');
      return over.preview === undefined
        ? { maxCredits: PRISCILLA_MAX_CREDITS, requiresIdentitySearch: true, lushaEligible: true }
        : over.preview;
    },
    startCandidateReveal: async (input) => {
      revealCalls.push(input);
      return (
        over.revealResult ?? { ok: true, status: 'requested', errorCode: null }
      );
    },
    project: async (args) => {
      projectCalls.push(args);
      return over.projectResult === undefined ? projectedOutcome() : over.projectResult;
    },
  };

  return { deps, revealCalls, projectCalls, previewCalls };
}

// ── PREVIEW ────────────────────────────────────────────────────────

describe('Priscilla — la vista previa, ANTES del clic', () => {
  it('ofrece una compra y muestra el tope 14, calculado por el servidor', async () => {
    const spy = makeDeps();
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);

    assert.equal(view.status, 'eligible');
    assert.equal(view.actionable, true);
    assert.equal(view.free, false);
    assert.equal(view.maxCredits, PRISCILLA_MAX_CREDITS);
    assert.equal(view.lushaEligible, true);
    assert.equal(view.requiresIdentitySearch, true);
  });

  it('el tope se pide para el candidato FUENTE resuelto, no para otro', async () => {
    const spy = makeDeps();
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
    assert.deepEqual(spy.previewCalls, [CANDIDATE_ID]);
  });

  it('la vista previa NO gasta y NO escribe: 0 reveals, 0 proyecciones', async () => {
    const spy = makeDeps();
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
    assert.equal(spy.revealCalls.length, 0);
    assert.equal(spy.projectCalls.length, 0);
  });

  it('sin vista previa del servidor el tope queda en null y NO se inventa un suelo', async () => {
    // Un suelo inventado menor que el real hace que el arranque rechace la autorización por techo;
    // uno mayor le promete al operador un gasto que nadie va a reservar.
    const spy = makeDeps({ preview: null });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
    assert.equal(view.status, 'eligible');
    assert.equal(view.maxCredits, null);
    assert.equal(view.lushaEligible, false);
  });

  it('si la vista previa LANZA, la oferta sigue abierta pero sin cifra', async () => {
    const spy = makeDeps({ previewThrows: true });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
    assert.equal(view.status, 'eligible');
    assert.equal(view.maxCredits, null);
  });
});

// ── UN CLIC ────────────────────────────────────────────────────────

describe('Priscilla — un clic delega en el pipeline del candidato', () => {
  it('llama al pipeline UNA vez, con el candidato fuente y el tope que el operador leyó', async () => {
    const spy = makeDeps();
    await runOfficialContactPhoneRevealStart(
      {
        contactId: CONTACT_ID,
        confirmCost: true,
        phoneProcessingBasis: 'legitimate_interest_b2b',
        expectedMaxCredits: PRISCILLA_MAX_CREDITS,
      },
      spy.deps,
    );

    assert.equal(spy.revealCalls.length, 1);
    assert.deepEqual(spy.revealCalls[0], {
      candidateId: CANDIDATE_ID,
      confirmCost: true,
      phoneProcessingBasis: 'legitimate_interest_b2b',
      phoneProcessingBasisNote: undefined,
      expectedMaxCredits: PRISCILLA_MAX_CREDITS,
    });
  });

  it('Apollo acepta y contesta por webhook ⇒ `requested` y el teléfono AÚN NO está', async () => {
    // Decir «revelado» aquí sería afirmar que la ficha ya tiene un número. No lo tiene.
    const spy = makeDeps({
      revealResult: { ok: true, status: 'requested', errorCode: null },
      projectResult: projectedOutcome({ phonesInserted: 0, phonesSeen: 0, scalarSynced: false }),
    });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.gate, 'delegated');
    assert.equal(result.revealStatus, 'requested');
    assert.equal(result.phoneProjected, false);
  });

  it('éxito terminal de Apollo (hit ya pagado) ⇒ el teléfono queda EN EL CONTACTO', async () => {
    const spy = makeDeps({
      revealResult: { ok: true, status: 'revealed_from_cache', errorCode: null },
    });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );

    assert.equal(result.revealStatus, 'revealed_from_cache');
    assert.equal(result.projectionStatus, 'projected');
    assert.equal(result.phoneProjected, true);
    assert.deepEqual(spy.projectCalls, [
      { candidateId: CANDIDATE_ID, contactId: CONTACT_ID, actorId: ACTOR_ID },
    ]);
  });

  it('Apollo sin teléfono ⇒ NO se abre una segunda autorización desde esta capa', async () => {
    // La continuación a Lusha la decide y la ejecuta el pipeline del candidato (webhook / recovery
    // / continuación), bajo la MISMA corrida y el MISMO techo que el clic ya autorizó. Que aquí
    // haya UNA sola llamada es la prueba de que este hito no construyó un waterfall paralelo: si
    // lo hubiera, habría una segunda invocación con otro tope.
    const spy = makeDeps({
      revealResult: { ok: true, status: 'requested', errorCode: null },
      projectResult: projectedOutcome({ phonesInserted: 0, scalarSynced: false }),
    });
    await runOfficialContactPhoneRevealStart(
      {
        contactId: CONTACT_ID,
        confirmCost: true,
        phoneProcessingBasis: 'legitimate_interest_b2b',
        expectedMaxCredits: PRISCILLA_MAX_CREDITS,
      },
      spy.deps,
    );
    assert.equal(spy.revealCalls.length, 1);
  });

  it('el número que Lusha traiga después llega al contacto por la RECONCILIACIÓN, sin gastar', async () => {
    // Segundo acto del mismo caso: el clic terminó en `requested`, el webhook (o la pata Lusha)
    // escribió en la colección del candidato, y la ficha reconcilia.
    const spy = makeDeps();
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);

    assert.equal(result.phoneProjected, true);
    assert.equal(result.projectionStatus, 'projected');
    assert.equal(spy.revealCalls.length, 0, 'la reconciliación NUNCA llama a un proveedor');
  });

  it('un arranque que falló NO abre una transacción de proyección', async () => {
    const spy = makeDeps({
      revealResult: { ok: false, status: 'insufficient_credits', errorCode: 'insufficient_credits' },
    });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );

    assert.equal(result.ok, false);
    assert.equal(result.revealStatus, 'insufficient_credits');
    assert.equal(result.errorCode, 'insufficient_credits');
    assert.equal(spy.projectCalls.length, 0);
  });

  it('si la proyección no se pudo ejecutar, NO se afirma que el teléfono está', async () => {
    const spy = makeDeps({
      revealResult: { ok: true, status: 'revealed_from_cache', errorCode: null },
      projectResult: null,
    });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );
    assert.equal(result.phoneProjected, false);
    assert.equal(result.projectionStatus, null);
  });
});

// ── REUTILIZACIÓN GRATUITA (§10) ───────────────────────────────────

describe('el candidato YA tenía teléfonos: se reutilizan sin llamar a nadie', () => {
  it('la oferta es gratuita y no pide vista previa de tope', async () => {
    const spy = makeDeps({ candidateLivePhoneCount: 2 });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);

    assert.equal(view.status, 'reuse_from_candidate');
    assert.equal(view.actionable, true);
    assert.equal(view.free, true);
    assert.equal(view.maxCredits, 0);
    assert.equal(spy.previewCalls.length, 0, 'no se pide permiso de gasto para algo ya pagado');
  });

  it('el clic proyecta y NO toca ningún proveedor', async () => {
    const spy = makeDeps({ candidateLivePhoneCount: 2 });
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: CONTACT_ID, confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );

    assert.equal(result.gate, 'reuse_from_candidate');
    assert.equal(result.phoneProjected, true);
    assert.equal(spy.revealCalls.length, 0);
    assert.equal(spy.projectCalls.length, 1);
  });
});

// ── LOS GATES QUE NO GASTAN NADA ───────────────────────────────────

describe('gates cerrados: 0 llamadas a proveedor y 0 proyecciones', () => {
  const cases: ReadonlyArray<{
    readonly label: string;
    readonly over: Parameters<typeof makeDeps>[0];
    readonly gate: string;
  }> = [
    {
      label: 'sin candidato fuente durable (§9)',
      over: { contact: { ...PRISCILLA_CONTACT, metadata: { source: 'manual' } } },
      gate: 'missing_source_candidate',
    },
    {
      label: 'candidato fuente que no es un uuid',
      over: {
        contact: { ...PRISCILLA_CONTACT, metadata: { source_candidate_id: 'priscilla' } },
      },
      gate: 'missing_source_candidate',
    },
    {
      label: 'el contacto ya tiene teléfono (§11)',
      over: { contact: { ...PRISCILLA_CONTACT, phone: '+15550000001' } },
      gate: 'phone_already_present',
    },
    {
      label: 'el contacto está archivado',
      over: { contact: { ...PRISCILLA_CONTACT, archivedAt: '2026-08-01T00:00:00.000Z' } },
      gate: 'contact_archived',
    },
    {
      label: 'el contacto no es legible',
      over: { contact: null },
      gate: 'contact_unavailable',
    },
    {
      label: 'la lectura del contacto FALLA (fail-closed, no «se puede comprar»)',
      over: { loadContactThrows: true },
      gate: 'contact_unavailable',
    },
  ];

  for (const c of cases) {
    it(`${c.label} ⇒ gate ${c.gate}, sin gasto`, async () => {
      const spy = makeDeps(c.over);
      const result = await runOfficialContactPhoneRevealStart(
        {
          contactId: CONTACT_ID,
          confirmCost: true,
          phoneProcessingBasis: 'legitimate_interest_b2b',
        },
        spy.deps,
      );

      assert.equal(result.ok, false);
      assert.equal(result.gate, c.gate);
      assert.equal(result.revealStatus, null);
      assert.equal(spy.revealCalls.length, 0);
      assert.equal(spy.projectCalls.length, 0);
    });

    it(`${c.label} ⇒ la oferta tampoco se describe`, async () => {
      const spy = makeDeps(c.over);
      const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
      assert.equal(view.actionable, false);
      assert.equal(view.maxCredits, null);
      assert.equal(spy.previewCalls.length, 0);
    });
  }

  it('un id de contacto vacío no llega ni a leer', async () => {
    const spy = makeDeps();
    const result = await runOfficialContactPhoneRevealStart(
      { contactId: '   ', confirmCost: true, phoneProcessingBasis: 'legitimate_interest_b2b' },
      spy.deps,
    );
    assert.equal(result.gate, 'contact_unavailable');
    assert.equal(spy.revealCalls.length, 0);
    assert.equal(spy.projectCalls.length, 0);
  });
});

// ── AUTORIDAD DE ROL ───────────────────────────────────────────────

describe('la autoridad de rol es la MISMA que la de revelar', () => {
  for (const roleKey of ['admin', 'commercial_manager']) {
    it(`${roleKey} puede`, async () => {
      const spy = makeDeps({ roleKey });
      const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
      assert.equal(view.status, 'eligible');
    });
  }

  for (const roleKey of [null, '', '  ', 'viewer', 'sales_rep']) {
    it(`${JSON.stringify(roleKey)} NO puede, y no gasta nada`, async () => {
      const spy = makeDeps({ roleKey });

      const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, spy.deps);
      assert.equal(view.actionable, false);

      const start = await runOfficialContactPhoneRevealStart(
        {
          contactId: CONTACT_ID,
          confirmCost: true,
          phoneProcessingBasis: 'legitimate_interest_b2b',
        },
        spy.deps,
      );
      assert.equal(start.revealStatus, 'unauthorized_role');

      const reconcile = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);
      assert.equal(reconcile.gate, 'contact_unavailable');

      assert.equal(spy.revealCalls.length, 0);
      assert.equal(spy.projectCalls.length, 0);
      assert.equal(spy.previewCalls.length, 0);
    });
  }
});

// ── RECONCILIACIÓN ─────────────────────────────────────────────────

describe('la reconciliación: proyecta, nunca compra', () => {
  it('reconcilia aunque el contacto ya tenga un teléfono (puede haber llegado un segundo)', async () => {
    const spy = makeDeps({ contact: { ...PRISCILLA_CONTACT, phone: '+15550000001' } });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);
    assert.equal(result.gate, 'delegated');
    assert.equal(spy.projectCalls.length, 1);
    assert.equal(spy.revealCalls.length, 0);
  });

  it('sin candidato fuente durable NO reconcilia', async () => {
    const spy = makeDeps({ contact: { ...PRISCILLA_CONTACT, metadata: {} } });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);
    assert.equal(result.gate, 'missing_source_candidate');
    assert.equal(spy.projectCalls.length, 0);
  });

  it('la RPC que rechaza el vínculo NO se reporta como teléfono guardado', async () => {
    const spy = makeDeps({
      projectResult: projectedOutcome({ status: 'contact_link_mismatch', phonesInserted: 0 }),
    });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);
    assert.equal(result.ok, false);
    assert.equal(result.projectionStatus, 'contact_link_mismatch');
    assert.equal(result.phoneProjected, false);
  });

  it('una persona borrada (DSAR) no recibe su número de vuelta', async () => {
    const spy = makeDeps({
      projectResult: projectedOutcome({ status: 'person_suppressed', phonesInserted: 0 }),
    });
    const result = await runOfficialContactPhoneReconcile(CONTACT_ID, spy.deps);
    assert.equal(result.phoneProjected, false);
    assert.equal(result.projectionStatus, 'person_suppressed');
  });
});
