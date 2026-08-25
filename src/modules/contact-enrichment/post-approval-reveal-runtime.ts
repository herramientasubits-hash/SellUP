// Agente 2A — ORQUESTACIÓN del reveal desde un contacto OFICIAL, con dependencias INYECTADAS
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// Sin red, sin DB, sin auth propia, sin reloj propio y sin un solo import de servidor: todo lo que
// toca el mundo entra por `deps`. Es el mismo reparto que el subsistema ya usa entre
// `phone-reveal-core.ts` (decide) y `phone-reveal-actions.ts` (cablea), y existe por la misma
// razón: las tres propiedades que este hito tiene que demostrar —«un clic delega en el pipeline
// que ya existe», «la reutilización no llama a ningún proveedor» y «sin candidato fuente no se
// gasta nada»— son afirmaciones sobre QUÉ dependencias se invocan y en qué orden. Con las
// dependencias inyectadas eso se mide contando llamadas; con las dependencias importadas habría
// que simular Supabase para no medir nada.
//
// LO QUE NO HAY AQUÍ, Y ES EL CONTRATO DEL HITO: ni un cliente de Apollo, ni uno de Lusha, ni el
// motor del waterfall, ni el reservador de créditos, ni el logger de uso, ni ningún cliente de
// CRM externo. La
// única vía a un proveedor es `deps.startCandidateReveal`, que es EL server action del reveal del
// candidato — el mismo que dispara la ficha del candidato, con sus gates, su presupuesto, su
// waterfall y su «no pagar dos veces».

import {
  classifyOfficialContactPhoneRevealOffer,
  type OfficialContactPhoneRevealOffer,
  type OfficialContactPhoneRevealOfferView,
  type OfficialContactPhoneRevealStartResult,
  type ProjectApprovedCandidatePhonesOutcome,
} from './post-approval-reveal-core';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import type { RevealCandidatePhoneStatus } from './phone-reveal-core';
import type { PhoneProcessingBasis } from './types';

/** Proyección mínima del contacto que la decisión necesita. Ningún teléfono sale de aquí. */
export interface OfficialContactRevealContact {
  readonly id: string;
  readonly archivedAt?: string | null;
  readonly phone?: string | null;
  readonly mobilePhone?: string | null;
  readonly metadata?: unknown;
}

/** El resultado del pipeline del candidato, reducido a lo que esta capa necesita. */
export interface DelegatedRevealResult {
  readonly ok: boolean;
  readonly status: RevealCandidatePhoneStatus;
  readonly errorCode: string | null;
}

export interface OfficialContactPhoneRevealDeps {
  /** Actor ya resuelto por el llamador. `roleKey` nulo o desconocido ⇒ no autorizado. */
  readonly actor: { readonly internalUserId: string; readonly roleKey: string | null };
  /** `null` ⇒ no hay contacto legible. LANZAR ⇒ se trata como no legible (fail-closed). */
  readonly loadContact: (contactId: string) => Promise<OfficialContactRevealContact | null>;
  readonly countLiveOfficialPhones: (contactId: string) => Promise<number>;
  readonly countLiveCandidatePhones: (candidateId: string) => Promise<number>;
  /**
   * LA vista previa del tope: `getPhoneRevealWaterfallAuthorizationPreviewAction`. `null` ⇒ no se
   * pudo calcular y el copy lo dirá, en vez de rellenarse con un suelo inventado.
   */
  readonly loadAuthorizationPreview: (candidateId: string) => Promise<{
    readonly maxCredits: number;
    readonly requiresIdentitySearch: boolean;
    readonly lushaEligible: boolean;
  } | null>;
  /** EL pipeline. La ÚNICA vía a un proveedor de todo este módulo. */
  readonly startCandidateReveal: (input: {
    readonly candidateId: string;
    readonly confirmCost: boolean;
    readonly phoneProcessingBasis: PhoneProcessingBasis | string | null | undefined;
    readonly phoneProcessingBasisNote?: string | null;
    readonly expectedMaxCredits?: number;
  }) => Promise<DelegatedRevealResult>;
  /**
   * La RPC de la 128. `null` ⇒ no se pudo ejecutar, y entonces se reporta «el teléfono no está en
   * el contacto todavía» —la verdad— en vez de un éxito que la base no confirmó.
   */
  readonly project: (args: {
    readonly candidateId: string;
    readonly contactId: string;
    readonly actorId: string;
  }) => Promise<ProjectApprovedCandidatePhonesOutcome | null>;
  /**
   * CAPABILITY GATE de la RPC de la 128, REAL: no es un número de migración, no es un flag y no
   * asume que la RPC existe. La migración puede desplegarse sin aplicar, y sin esta comprobación
   * un clic de compra podría reservar créditos y llamar a un proveedor ANTES de descubrir, al
   * proyectar, que no hay dónde escribir el resultado. `false` o una excepción ⇒ fail-closed: se
   * trata exactamente igual, y NINGÚN camino de este runtime llega a `startCandidateReveal` ni a
   * `project` sin haberla consultado primero. Inyectada para poder medir en tests, con un
   * contador de llamadas, que la respuesta real cierra la oferta ANTES de delegar.
   */
  readonly checkProjectionCapability: () => Promise<boolean>;
  /** Sumidero de diagnóstico. Recibe códigos, nunca filas ni números. */
  readonly onReadUnavailable?: (message: string) => void;
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function closedOffer(
  status: OfficialContactPhoneRevealOffer['status'],
): OfficialContactPhoneRevealOfferView {
  return {
    status,
    actionable: false,
    free: true,
    maxCredits: null,
    requiresIdentitySearch: false,
    lushaEligible: false,
  };
}

function closedStart(
  gate: OfficialContactPhoneRevealStartResult['gate'],
): OfficialContactPhoneRevealStartResult {
  return {
    ok: false,
    gate,
    revealStatus: null,
    projectionStatus: null,
    phoneProjected: false,
    errorCode: null,
  };
}

/**
 * Resuelve la oferta del contacto: candidato fuente, teléfonos que ya hay y teléfonos ya pagados.
 *
 * Fail-closed: cualquier lectura que falle devuelve `contact_unavailable`, NUNCA «se puede
 * comprar». Una caída de base no es una autorización de gasto.
 */
async function resolveOffer(
  contactId: string,
  deps: OfficialContactPhoneRevealDeps,
): Promise<OfficialContactPhoneRevealOffer> {
  try {
    const contact = await deps.loadContact(contactId);
    if (!contact) {
      return classifyOfficialContactPhoneRevealOffer({
        contact: null,
        liveOfficialPhoneCount: 0,
        candidateLivePhoneCount: 0,
      });
    }

    // El vínculo se clasifica ANTES de contar la colección del candidato: sin candidato fuente no
    // hay colección que contar, y contarla exigiría elegir un candidato por parecido — que es
    // exactamente lo que el contrato prohíbe (§9).
    const linkOnly = classifyOfficialContactPhoneRevealOffer({
      contact,
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    if (!linkOnly.candidateId) return linkOnly;

    const [liveOfficialPhoneCount, candidateLivePhoneCount] = await Promise.all([
      deps.countLiveOfficialPhones(contact.id),
      deps.countLiveCandidatePhones(linkOnly.candidateId),
    ]);

    const offer = classifyOfficialContactPhoneRevealOffer({
      contact,
      liveOfficialPhoneCount,
      candidateLivePhoneCount,
    });

    // ── El capability gate de la 128 ──────────────────────────────
    // Sólo se consulta cuando ya hay algo que accionar: un offer cerrado por otra razón
    // (archivado, sin vínculo, ya tiene teléfono) no necesita proyectar nada, así que no gana
    // una llamada a la RPC que no va a cambiar su respuesta. Pero NINGÚN camino accionable —ni
    // `eligible` (compra) ni `reuse_from_candidate` (gratis)— sobrevive a esta comprobación:
    // ambos habrían necesitado `deps.project` para terminar, y sin capacidad no hay dónde
    // proyectar. Se resuelve AQUÍ, dentro de `resolveOffer`, que es la función que TANTO la
    // vista previa COMO el clic recalculan fresca cada vez que se invocan — así que esto es, a
    // la vez, el gate de la oferta (Caso A) y el RE-CHECK inmediatamente antes de delegar
    // (Caso C): un clic nunca usa una respuesta cacheada de antes del capability check.
    if (!offer.actionable) return offer;

    let capable = false;
    try {
      capable = await deps.checkProjectionCapability();
    } catch (err) {
      deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
      capable = false;
    }
    if (!capable) {
      return {
        status: 'projection_capability_unavailable',
        candidateId: offer.candidateId,
        actionable: false,
        free: true,
      };
    }
    return offer;
  } catch (err) {
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    return {
      status: 'contact_unavailable',
      candidateId: null,
      actionable: false,
      free: true,
    };
  }
}

// ── 1. La oferta, ANTES del clic ───────────────────────────────────

/**
 * SOLO LECTURA. No crea corridas, no reclama patas, no llama a ningún proveedor, no reserva
 * créditos y no escribe: `deps.startCandidateReveal` y `deps.project` no se invocan en ningún
 * camino de esta función.
 */
export async function runOfficialContactPhoneRevealOffer(
  contactId: string,
  deps: OfficialContactPhoneRevealDeps,
): Promise<OfficialContactPhoneRevealOfferView> {
  const id = cleanId(contactId);
  if (!id) return closedOffer('contact_unavailable');

  // Sin autorización no se describe la oferta, y se devuelve el MISMO estado cerrado que un
  // contacto ilegible: a quien no puede revelar no se le confirma que este contacto sí tendría un
  // candidato fuente aprovechable.
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) {
    return closedOffer('contact_unavailable');
  }

  const offer = await resolveOffer(id, deps);
  if (!offer.actionable || !offer.candidateId) return closedOffer(offer.status);

  // Reutilización: no hay compra que autorizar, así que NO se pide vista previa de tope. Pedir 14
  // créditos de permiso para copiar un número ya pagado sería cobrar dos veces por el mismo dato,
  // aunque el cargo no llegase nunca a ejecutarse.
  if (offer.free) {
    return {
      status: offer.status,
      actionable: true,
      free: true,
      maxCredits: 0,
      requiresIdentitySearch: false,
      lushaEligible: false,
    };
  }

  let preview: Awaited<ReturnType<OfficialContactPhoneRevealDeps['loadAuthorizationPreview']>> =
    null;
  try {
    preview = await deps.loadAuthorizationPreview(offer.candidateId);
  } catch (err) {
    // Fail-closed hacia el copy conservador: sin vista previa NO se afirma una cifra.
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    preview = null;
  }

  return {
    status: offer.status,
    actionable: true,
    free: false,
    maxCredits: preview ? preview.maxCredits : null,
    requiresIdentitySearch: preview ? preview.requiresIdentitySearch : false,
    lushaEligible: preview ? preview.lushaEligible : false,
  };
}

// ── 2. El clic ─────────────────────────────────────────────────────

export interface OfficialContactPhoneRevealStartInput {
  readonly contactId: string;
  readonly confirmCost: boolean;
  readonly phoneProcessingBasis: PhoneProcessingBasis | string | null | undefined;
  readonly phoneProcessingBasisNote?: string | null;
  readonly expectedMaxCredits?: number;
}

/**
 * UN clic. Resuelve el candidato fuente y DELEGA; después proyecta.
 *
 * Los tres caminos, y qué se invoca en cada uno:
 *
 *   * gate cerrado (sin candidato fuente, contacto con teléfono, archivado, ilegible, rol no
 *     autorizado) ⇒ 0 llamadas a `startCandidateReveal` y 0 a `project`. Cero gasto por
 *     construcción, no por intención;
 *   * reutilización (§10: el candidato ya tenía teléfonos) ⇒ 0 llamadas a
 *     `startCandidateReveal`, 1 a `project`. Ningún proveedor puede ser alcanzado desde este
 *     camino porque la única vía no se invoca;
 *   * compra ⇒ 1 llamada a `startCandidateReveal` y, sólo si salió bien, 1 a `project`. Un gate
 *     que cortó antes del proveedor no produjo número nuevo, y abrir una transacción para
 *     descubrirlo sería una transacción por cada rechazo.
 *
 * En el camino ASÍNCRONO (Apollo acepta y contesta por webhook; Lusha continúa desde ahí) el
 * resultado es `requested` con `phoneProjected: false`, que es la verdad: el número no está
 * todavía. Lo recoge la reconciliación.
 */
export async function runOfficialContactPhoneRevealStart(
  input: OfficialContactPhoneRevealStartInput,
  deps: OfficialContactPhoneRevealDeps,
): Promise<OfficialContactPhoneRevealStartResult> {
  const contactId = cleanId(input?.contactId);
  if (!contactId) return closedStart('contact_unavailable');

  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) {
    // Se reutiliza el estado del pipeline del candidato: es el MISMO hecho y la UI ya sabe leerlo.
    return {
      ok: false,
      gate: 'delegated',
      revealStatus: 'unauthorized_role',
      projectionStatus: null,
      phoneProjected: false,
      errorCode: null,
    };
  }

  const offer = await resolveOffer(contactId, deps);
  if (!offer.actionable || !offer.candidateId) return closedStart(offer.status);

  if (offer.free) {
    const projected = await deps.project({
      candidateId: offer.candidateId,
      contactId,
      actorId: deps.actor.internalUserId,
    });
    return {
      ok: projected?.status === 'projected',
      gate: offer.status,
      revealStatus: null,
      projectionStatus: projected ? projected.status : null,
      phoneProjected: projected?.status === 'projected' && projected.phonesInserted > 0,
      errorCode: null,
    };
  }

  const result = await deps.startCandidateReveal({
    candidateId: offer.candidateId,
    confirmCost: input.confirmCost,
    phoneProcessingBasis: input.phoneProcessingBasis,
    phoneProcessingBasisNote: input.phoneProcessingBasisNote,
    expectedMaxCredits: input.expectedMaxCredits,
  });

  const projected = result.ok
    ? await deps.project({
        candidateId: offer.candidateId,
        contactId,
        actorId: deps.actor.internalUserId,
      })
    : null;

  return {
    ok: result.ok,
    gate: 'delegated',
    revealStatus: result.status,
    projectionStatus: projected ? projected.status : null,
    phoneProjected: projected?.status === 'projected' && projected.phonesInserted > 0,
    errorCode: result.errorCode,
  };
}

// ── 3. La reconciliación ───────────────────────────────────────────

/**
 * Lleva al contacto lo que el candidato ya tenga, SIN comprar nada: `deps.startCandidateReveal`
 * no se invoca en ningún camino de esta función.
 *
 * Existe porque el reveal de Apollo es ASÍNCRONO: el número llega por webhook (o por el recovery,
 * o por la continuación a Lusha) y esos tres caminos escriben en la colección del CANDIDATO. Esta
 * es la función donde ese resultado se proyecta al contacto.
 *
 * A diferencia del arranque, aquí NO se exige que la oferta sea «accionable»: el caso normal
 * después de un reveal asíncrono es «el contacto sigue sin teléfono y el candidato ya tiene uno»,
 * y también hay que cubrir «el contacto ya recibió el primero y llegó un segundo». Lo único que no
 * se hace nunca es reconciliar sin candidato fuente durable.
 */
export async function runOfficialContactPhoneReconcile(
  contactId: string,
  deps: OfficialContactPhoneRevealDeps,
): Promise<OfficialContactPhoneRevealStartResult> {
  const id = cleanId(contactId);
  if (!id) return closedStart('contact_unavailable');
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) {
    return closedStart('contact_unavailable');
  }

  let contact: OfficialContactRevealContact | null = null;
  try {
    contact = await deps.loadContact(id);
  } catch (err) {
    deps.onReadUnavailable?.(err instanceof Error ? err.message : 'unknown error');
    return closedStart('contact_unavailable');
  }
  if (!contact) return closedStart('contact_unavailable');

  const link = classifyOfficialContactPhoneRevealOffer({
    contact,
    liveOfficialPhoneCount: 0,
    candidateLivePhoneCount: 0,
  });
  if (!link.candidateId) return closedStart(link.status);

  const projected = await deps.project({
    candidateId: link.candidateId,
    contactId: id,
    actorId: deps.actor.internalUserId,
  });
  return {
    ok: projected?.status === 'projected',
    gate: 'delegated',
    revealStatus: null,
    projectionStatus: projected ? projected.status : null,
    phoneProjected: projected?.status === 'projected' && projected.phonesInserted > 0,
    errorCode: null,
  };
}
