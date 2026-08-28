'use server';

// Agente 2A — «Revelar teléfono» DESDE LA FICHA DEL CONTACTO OFICIAL: el cableado
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// ═══════════════════════════════════════════════════════════════
// EL CONTRATO DE ESTE ARCHIVO, Y CÓMO SE VERIFICA
// ═══════════════════════════════════════════════════════════════
//
// Este hito NO construye un segundo waterfall. Resuelve el candidato fuente de un contacto
// oficial y DELEGA en el pipeline que ya existe y ya está probado:
//
//   vista previa del tope  →  getPhoneRevealWaterfallAuthorizationPreviewAction(candidateId)
//   arranque de un clic    →  revealCandidatePhoneAction({ candidateId, … })
//
// Con eso vienen, sin una segunda implementación que pueda divergir: la identidad de proveedor, la
// supresión y el DNC, el presupuesto y las reservas, el techo de autorización, el waterfall
// Apollo → Lusha, el «no pagar dos veces», la colección de teléfonos del candidato con su
// procedencia, el ranking y los usage logs.
//
// Este archivo es DECLARATIVO: toda la decisión vive en `post-approval-reveal-runtime.ts`
// con dependencias inyectadas, igual que `phone-reveal-actions.ts` es el cableado de
// `phone-reveal-core.ts`. Aquí sólo se resuelve el actor y se enchufan las lecturas reales, la
// vista previa real, el reveal real y la RPC real.
//
// Que la delegación es real y no una promesa se verifica sin leer este comentario: este archivo NO
// importa el cliente de Apollo, ni el de Lusha, ni el motor del waterfall, ni el reservador de
// créditos, ni el logger de uso de proveedor, ni nada de HubSpot — y una guarda estática falla en
// el momento en que alguna de esas importaciones aparezca.
//
// ── LO ÚNICO PROPIO DE ESTE HITO ───────────────────────────────
//
// La PROYECCIÓN. El pipeline del candidato escribe en la colección del candidato y ahí se detiene:
// `110`/`111`/`122` no nombran la tabla de contactos ni la colección oficial de teléfonos, y
// `116`/`117` sólo promueven dentro de una aprobación o de un merge de duplicado. Un teléfono
// conseguido DESPUÉS de la aprobación no tenía ninguna sentencia en el esquema que lo llevara al
// contacto. La migración 128 es esa sentencia; este archivo es quien la invoca.
//
// ── HUBSPOT ────────────────────────────────────────────────────
//
// En #352 estaba FUERA DE ALCANCE por contrato (§8): 0 escrituras y 0 importaciones. Ese límite
// era correcto mientras la proyección no producía estado durable de HubSpot — y AGENT2-CUT-3A/3C lo
// convirtió en un defecto: la 128 escribe `contacts.phone` de un contacto que puede estar VINCULADO
// y `synced`, y sin nada más el CRM del cliente se queda con el número viejo mientras la ficha
// afirma estar al día.
//
// AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT cierra ese hueco así:
//
//   * la TRANSICIÓN durable la escribe SQL, dentro de la misma transacción que proyecta el
//     teléfono (`stale`, `stale_reason`, `stale_source = 'reveal'`). Desde SQL no hay red;
//   * el ENVÍO es una SEGUNDA fase, posterior al COMMIT, y este archivo la cablea a
//     `runContactHubSpotAutoPhoneUpdateWired` — EL ejecutor único que ya usan la edición manual y
//     el merge, siempre activo (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC quitó el interruptor),
//     quien relee el estado durable y quien se NIEGA a exportar un pendiente de privacidad.
//
// FUERA DE ALCANCE SIGUE ESTANDO, y una guarda estática lo fija: este archivo no importa el cliente
// HTTP de HubSpot, ni el motor de sincronización, ni `updateHubSpotContact`. El ÚNICO símbolo de
// HubSpot que nombra es ese entrypoint. `Approval → HubSpot` —el autosync que CREA la ficha— sigue
// siendo un contrato aparte y no se toca aquí.
//
// ── AUTORIZACIÓN ───────────────────────────────────────────────
//
// La MISMA autoridad de rol que revelar (`PHONE_REVEAL_AUTHORIZED_ROLE_KEYS`, aplicada dentro del
// runtime). No se inventa un permiso «ver la oferta» ni un permiso «reconciliar»: ofrecer, comprar
// y proyectar son partes de la misma operación, y partirlas en tres permisos sólo crea la
// posibilidad de que uno de los tres se relaje. Es un gate de SERVIDOR: que el botón no se pinte
// no es la protección.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// Ningún teléfono viaja en ninguna de estas respuestas. Las vistas son estados, booleanos y
// enteros. El id del candidato fuente NO se devuelve al navegador: las tres acciones reciben el id
// del CONTACTO y resuelven el candidato en el servidor, así que el cliente no puede apuntar esta
// operación a un candidato que él elija.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type {
  OfficialContactPhoneRevealOfferView,
  OfficialContactPhoneRevealStartResult,
} from './post-approval-reveal-core';
import {
  runOfficialContactPhoneReconcile,
  runOfficialContactPhoneRevealOffer,
  runOfficialContactPhoneRevealStart,
  type OfficialContactPhoneRevealDeps,
} from './post-approval-reveal-runtime';
import {
  countLiveCandidatePhones,
  countLiveOfficialPhones,
  readCandidateRescueFacts,
  readCandidateRevealDurableStatus,
  readCandidateScalarFactsForProjection,
  readOfficialContactForReveal,
} from './post-approval-reveal-read';
// PARIDAD DE RESCATE — las tres salidas que la ficha del CANDIDATO ya tenía y la del contacto no.
// Se importan sus ORQUESTADORES puros; las tuberías reales entran por `deps`, abajo.
import {
  runOfficialContactLushaContinuation,
  runOfficialContactRecoverReveal,
  runOfficialContactRescueOptions,
  runOfficialContactSearchMore,
  type OfficialContactRescueDeps,
  type OfficialContactRescueOutcome,
} from './post-approval-rescue-runtime';
import type { OfficialContactRescueView } from './post-approval-rescue-core';
// Las TRES tuberías que ya existen, keyed por candidato. Ninguna se reimplementa.
import { recoverCandidatePhoneRevealNowAction } from './phone-reveal-manual-recovery-actions';
import { startLegacyPhoneRevealWaterfallAction } from './phone-reveal-waterfall-legacy-actions';
import {
  getSearchMorePhonesPreflightAction,
  searchMoreCandidatePhonesAction,
} from './search-more-phones-actions';
import { getLegacyPhoneRevealAuthorizationPreviewAction } from './phone-reveal-waterfall-actions';
import { projectApprovedCandidatePhonesOntoContact } from './post-approval-reveal-projection';
import { checkProjectApprovedCandidatePhonesCapability } from './post-approval-reveal-capability';
import { buildCandidateScalarFallback } from './official-contact-approval-core';
// EL pipeline. No una copia suya.
import { revealCandidatePhoneAction } from './phone-reveal-actions';
import { getPhoneRevealWaterfallAuthorizationPreviewAction } from './phone-reveal-waterfall-actions';
// FINAL CUT — EL entrypoint único de la fase 2, el mismo que la edición manual y el merge. NO es
// un cliente de HubSpot: no construye el PATCH, no lee la conexión y no conoce el token. Lee la
// bandera, relee el estado durable y delega en el motor compartido. Es el ÚNICO símbolo de HubSpot
// que este hito nombra.
import { runContactHubSpotAutoPhoneUpdateWired } from '@/modules/contacts/contact-hubspot-sync-runner';
import type { PhoneProcessingBasis } from './types';

/**
 * Sesión + usuario interno activo + role key. Espejo del resto del subsistema: sin usuario
 * redirige a /login, y un actor sin rol conocido queda no autorizado.
 */
async function resolveActor(): Promise<{ internalUserId: string; roleKey: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();

  if (!internalUser) redirect('/login');
  const internalUserId = typeof internalUser.id === 'string' ? internalUser.id : '';
  if (!internalUser.role_id) return { internalUserId, roleKey: null };

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', internalUser.role_id)
    .single();
  return { internalUserId, roleKey: typeof role?.key === 'string' ? role.key : null };
}

/** Cablea las dependencias REALES. Un solo sitio las nombra, para las tres acciones. */
async function buildDeps(): Promise<OfficialContactPhoneRevealDeps> {
  const actor = await resolveActor();
  return {
    actor,
    loadContact: readOfficialContactForReveal,
    countLiveOfficialPhones,
    countLiveCandidatePhones,
    // DURABLE RESUME — la lectura que hace RESUMIBLE la espera. Un SELECT de UNA columna: sin
    // proveedor, sin créditos, sin escritura.
    loadCandidateRevealStatus: readCandidateRevealDurableStatus,

    loadAuthorizationPreview: async (candidateId) => {
      const preview = await getPhoneRevealWaterfallAuthorizationPreviewAction({ candidateId });
      return preview
        ? {
            maxCredits: preview.maxCredits,
            requiresIdentitySearch: preview.requiresIdentitySearch,
            lushaEligible: preview.lushaEligible,
          }
        : null;
    },

    startCandidateReveal: async (input) => {
      const result = await revealCandidatePhoneAction({
        candidateId: input.candidateId,
        confirmCost: input.confirmCost,
        phoneProcessingBasis: input.phoneProcessingBasis as PhoneProcessingBasis,
        phoneProcessingBasisNote: input.phoneProcessingBasisNote,
        expectedMaxCredits: input.expectedMaxCredits,
      });
      return { ok: result.ok, status: result.status, errorCode: result.errorCode };
    },

    project: async ({ candidateId, contactId, actorId }) => {
      try {
        const facts = await readCandidateScalarFactsForProjection(candidateId);
        // EL builder de la inversión de procedencia, el mismo que usan 116 y 117. `null` cuando el
        // candidato no tiene escalar o cuando su procedencia no invierte sin ambigüedad: la 128 lo
        // trata como «no promuevas nada», que no es un fallo.
        const scalarFallback = facts
          ? buildCandidateScalarFallback({
              phone: facts.phone,
              phoneMetadata: facts.phoneMetadata,
              countryCode: facts.countryCode,
            })
          : null;

        return await projectApprovedCandidatePhonesOntoContact({
          candidateId,
          contactId,
          scalarFallback: scalarFallback as Record<string, unknown> | null,
          actorId,
          nowIso: new Date().toISOString(),
        });
      } catch (err) {
        // `null` ⇒ el llamador reporta «el teléfono no está en el contacto todavía», que es la
        // verdad, en vez de un éxito que la base no confirmó.
        console.error(
          '[post-approval-reveal] projection failed:',
          err instanceof Error ? err.message : 'unknown error',
        );
        return null;
      }
    },

    checkProjectionCapability: checkProjectApprovedCandidatePhonesCapability,

    // FINAL CUT — LA fase 2. Se cablea UNA vez, aquí, para las tres acciones; el runtime decide
    // CUÁNDO invocarla (sólo si la proyección dejó un pendiente nuevo) y el ejecutor decide QUÉ
    // hacer (bandera, estado durable releído, procedencia). Ninguna de las dos decisiones vive en
    // este archivo, y por eso no hay dos formas de encender esto.
    //
    // `nowIso` se sella aquí y no dentro del ejecutor: es la hora de ESTA fase, y el ejecutor la
    // usa para anotar un bloqueo de workspace. La proyección tiene la suya —`p_now`— porque es
    // otra transacción y otro instante; fingir que son el mismo sería estampar en el registro de
    // HubSpot la hora de una transacción que ya cerró.
    runHubSpotPhoneSyncFollowUp: async (contactId) =>
      runContactHubSpotAutoPhoneUpdateWired(contactId, {
        actorId: actor.internalUserId,
        nowIso: new Date().toISOString(),
      }),

    onReadUnavailable: (message) => {
      console.error('[post-approval-reveal] read unavailable:', message);
    },
  };
}

/**
 * PARIDAD DE RESCATE — las mismas dependencias, más las tres tuberías de rescate.
 *
 * Se construye SOBRE `buildDeps()` y no en paralelo: la resolución del actor, la lectura del
 * contacto y —sobre todo— la costura de proyección con su fase 2 de HubSpot tienen que ser las
 * MISMAS. Un segundo juego de dependencias sería un segundo sitio donde decidir cuándo se sale a
 * la red, y el día que divergieran una de las dos exportaría de más.
 */
async function buildRescueDeps(): Promise<OfficialContactRescueDeps> {
  const base = await buildDeps();
  return {
    ...base,
    loadRescueFacts: readCandidateRescueFacts,

    loadLegacyPreview: async (candidateId) => {
      const preview = await getLegacyPhoneRevealAuthorizationPreviewAction({ candidateId });
      return preview
        ? {
            eligible: preview.eligible === true,
            maxCredits: typeof preview.maxCredits === 'number' ? preview.maxCredits : null,
            requiresIdentitySearch: preview.requiresIdentitySearch === true,
          }
        : null;
    },

    // La disponibilidad y el tope salen del PLAN que el propio preflight ya calculó
    // (`plan.eligible` / `plan.maxCreditRequirement`), no de una segunda derivación aquí: ese
    // umbral es EXACTAMENTE el que la compra reservará, y recalcularlo sería la forma de que el
    // botón prometiera una cifra distinta de la que se cobra.
    loadSearchMorePreflight: async (candidateId) => {
      const result = await getSearchMorePhonesPreflightAction({ candidateId });
      if (result.status !== 'ok') return null;
      const plan = result.summary.plan;
      return {
        available: plan.eligible === true,
        maxCredits: typeof plan.maxCreditRequirement === 'number' ? plan.maxCreditRequirement : null,
      };
    },

    // GRATIS por contrato: un `GET` al resultado ya producido. No inicia un reveal nuevo y no
    // consume créditos de revelación — es la salida del «se queda cargando».
    recoverRevealNow: async (candidateId) => {
      const r = await recoverCandidatePhoneRevealNowAction({ candidateId });
      return {
        ok: r.ok === true,
        status: typeof r.status === 'string' ? r.status : 'error',
        phoneRevealed: r.phoneRevealed === true,
        noPhoneFound: r.noPhoneFound === true,
        stillPending: r.stillPending === true,
      };
    },

    startLushaContinuation: async ({ candidateId, acceptedMaxCredits }) => {
      const r = await startLegacyPhoneRevealWaterfallAction({ candidateId, acceptedMaxCredits });
      return {
        status: r.status,
        reason: r.reason,
        maxCreditsAuthorized: r.maxCreditsAuthorized,
        requiredMaxCredits: r.requiredMaxCredits,
      };
    },

    startSearchMore: async (candidateId) => {
      const r = await searchMoreCandidatePhonesAction({ candidateId });
      return {
        outcome: r.outcome,
        reason: r.reason ?? null,
        newDistinctPhoneCount: r.newDistinctPhoneCount ?? 0,
      };
    },
  };
}

// ── Acción 4: qué salidas de rescate hay ───────────────────────────

/**
 * SOLO LECTURA: ninguna de las tres tuberías se invoca. Preguntar «¿qué puedo hacer con este
 * teléfono atascado?» no cuesta un crédito, así que la ficha puede hacerlo al abrirse y cada vez
 * que el estado cambie.
 */
export async function getOfficialContactPhoneRescueOptionsAction(input: {
  contactId: string;
}): Promise<OfficialContactRescueView> {
  const deps = await buildRescueDeps();
  return runOfficialContactRescueOptions(input?.contactId ?? '', deps);
}

// ── Acción 5: revisar AHORA (gratis) ───────────────────────────────

/**
 * LA salida del «se queda cargando». No espera al webhook: pregunta por el resultado ya
 * solicitado y, si ya hay número, lo proyecta al contacto en la misma llamada.
 */
export async function recoverOfficialContactPhoneRevealAction(input: {
  contactId: string;
}): Promise<OfficialContactRescueOutcome> {
  const deps = await buildRescueDeps();
  return runOfficialContactRecoverReveal(input?.contactId ?? '', deps);
}

// ── Acción 6: continuar a Lusha ────────────────────────────────────

/**
 * Apollo cerró sin número ⇒ se continúa a Lusha. NUNCA llama a Apollo. El tope que el operador
 * acaba de leer viaja como límite superior duro.
 */
export async function continueOfficialContactPhoneRevealWithLushaAction(input: {
  contactId: string;
  acceptedMaxCredits: number;
}): Promise<OfficialContactRescueOutcome> {
  const deps = await buildRescueDeps();
  return runOfficialContactLushaContinuation(
    {
      contactId: input?.contactId ?? '',
      acceptedMaxCredits:
        typeof input?.acceptedMaxCredits === 'number' ? input.acceptedMaxCredits : 0,
    },
    deps,
  );
}

// ── Acción 7: buscar más números ───────────────────────────────────

/** La MISMA operación que «Buscar más números» del candidato, con proyección al contacto. */
export async function searchMoreOfficialContactPhonesAction(input: {
  contactId: string;
}): Promise<OfficialContactRescueOutcome> {
  const deps = await buildRescueDeps();
  return runOfficialContactSearchMore(input?.contactId ?? '', deps);
}

// ── Acción 1: la oferta, ANTES del clic ────────────────────────────

/**
 * Qué puede ofrecer la ficha del contacto oficial, y a qué tope. SOLO LECTURA: no crea corridas,
 * no reclama patas, no llama a ningún proveedor, no reserva créditos y no escribe.
 */
export async function getOfficialContactPhoneRevealOfferAction(input: {
  contactId: string;
}): Promise<OfficialContactPhoneRevealOfferView> {
  const deps = await buildDeps();
  return runOfficialContactPhoneRevealOffer(input?.contactId ?? '', deps);
}

// ── Acción 2: el clic ──────────────────────────────────────────────

/**
 * UN clic: delega en el pipeline del candidato y, cuando ya hay número, lo proyecta al contacto.
 * `revealCandidatePhoneAction` sigue siendo el único punto que llama a un proveedor y el único que
 * escribe un usage log, exactamente igual que cuando se dispara desde la ficha del candidato.
 */
export async function revealOfficialContactPhoneAction(input: {
  contactId: string;
  confirmCost: boolean;
  phoneProcessingBasis: PhoneProcessingBasis | string | null | undefined;
  phoneProcessingBasisNote?: string | null;
  expectedMaxCredits?: number;
}): Promise<OfficialContactPhoneRevealStartResult> {
  const deps = await buildDeps();
  return runOfficialContactPhoneRevealStart(
    {
      contactId: input?.contactId ?? '',
      confirmCost: input?.confirmCost === true,
      phoneProcessingBasis: input?.phoneProcessingBasis,
      phoneProcessingBasisNote: input?.phoneProcessingBasisNote,
      expectedMaxCredits: input?.expectedMaxCredits,
    },
    deps,
  );
}

// ── Acción 3: la reconciliación ────────────────────────────────────

/**
 * Lleva al contacto oficial lo que el candidato ya tenga, sin comprar nada. Idempotente por
 * construcción de la 128, así que la ficha puede llamarla al abrirse y mientras haya un reveal en
 * vuelo sin riesgo de duplicar nada.
 *
 * FINAL CUT — esa idempotencia es también la de la fase 2, y es la razón por la que la puerta de
 * la red pregunta «¿lo dejó ESTA proyección?» y no «¿hay algo pendiente?». Una reconciliación que
 * no movió el teléfono saliente devuelve `no_outbound_change` y no sale ni una petición: abrir una
 * ficha nunca escribe en el CRM del cliente, ni siquiera cuando esa ficha tiene un pendiente que
 * causó otra cosa.
 *
 * LÍMITE CONOCIDO Y DECLARADO de este hito: la proyección NO se dispara desde el webhook de Apollo
 * ni desde el cron de recovery ni desde la continuación a Lusha. Se dispara desde AQUÍ. Un
 * teléfono que llegue por webhook aparece en el contacto la próxima vez que su ficha reconcilie
 * —lo que la propia UI hace al abrirse y mientras espera— y no en el instante en que el proveedor
 * contesta. Enganchar esos tres caminos de persistencia es una superficie VIVA en Producción y se
 * deja para un corte propio en vez de tocarla de paso en este.
 */
export async function reconcileOfficialContactPhoneFromCandidateAction(input: {
  contactId: string;
}): Promise<OfficialContactPhoneRevealStartResult> {
  const deps = await buildDeps();
  return runOfficialContactPhoneReconcile(input?.contactId ?? '', deps);
}
