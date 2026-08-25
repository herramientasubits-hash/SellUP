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
// FUERA DE ALCANCE por contrato (§8): 0 escrituras en HubSpot y 0 importaciones de HubSpot.
// `Approval → HubSpot` es un contrato aparte.
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
  readCandidateScalarFactsForProjection,
  readOfficialContactForReveal,
} from './post-approval-reveal-read';
import { projectApprovedCandidatePhonesOntoContact } from './post-approval-reveal-projection';
import { buildCandidateScalarFallback } from './official-contact-approval-core';
// EL pipeline. No una copia suya.
import { revealCandidatePhoneAction } from './phone-reveal-actions';
import { getPhoneRevealWaterfallAuthorizationPreviewAction } from './phone-reveal-waterfall-actions';
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

    onReadUnavailable: (message) => {
      console.error('[post-approval-reveal] read unavailable:', message);
    },
  };
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
