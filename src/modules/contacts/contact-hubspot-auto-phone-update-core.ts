// Agente 2A — PATCH automático del teléfono hacia HubSpot
// (AGENT2-CONTACT-HUBSPOT-AUTO-PHONE-UPDATE-CUT3C)
//
// La SEGUNDA fase de una escritura local de teléfono. Corre DESPUÉS de que esa escritura haya
// confirmado, y su primera propiedad —la que ordena todo lo demás— es que no puede deshacer
// nada de lo anterior: el teléfono ya está guardado cuando esto empieza, así que un fallo de
// HubSpot no tiene ninguna vía por la que convertirse en un fallo de la edición, del merge o
// del reveal que lo causó.
//
// ── UN SOLO MOTOR, OTRA VEZ ───────────────────────────────────
// Este módulo NO habla con HubSpot. No construye el cuerpo del PATCH, no decide qué teléfono
// viaja y no sabe traducir un borrado. Todo eso ya existe en `runSyncContactToHubSpot` —cuya
// rama B hace exactamente este PATCH desde CUT-2— y se DELEGA, con `method: 'auto'` como única
// diferencia. Una segunda implementación «para el automático» tendría su propia idea de qué
// significa un saliente `null`, y el día que divergieran una de las dos borraría en el CRM del
// cliente un número que SellUp sí tiene.
//
// Lo que este módulo SÍ es: el PORTERO. Y aquí el portero pesa más que en CUT-3B, porque lo que
// deja pasar no crea una ficha nueva: modifica una que ya vive en el CRM del cliente.
//
// ── LAS TRES COSAS QUE EL PORTERO IMPIDE ──────────────────────
//
//   1. EXPORTAR UNA ERASURE. Un `stale` + `phone_removed` causado por una supresión de
//      privacidad es, campo a campo, idéntico a uno causado por alguien que borró el número a
//      mano. La operación pendiente es la misma; lo que NO es lo mismo es el permiso para
//      ejecutarla sin que nadie lo pida. Por eso la decisión se toma sobre `stale_source`, que
//      es durable, y no sobre quién llamó: una prohibición que dependiera del camino se caería
//      la primera vez que alguien añadiera un camino nuevo.
//
//   2. INVENTAR QUE HAY ALGO PENDIENTE. El portero NO recalcula si el teléfono cambió. Esa
//      pregunta ya la respondió la autoridad de CUT-3A dentro de la transacción que escribió el
//      número, y responderla otra vez aquí —contra una fila releída, con un «antes» que este
//      código no vio— produciría un segundo veredicto capaz de contradecir al primero. Un
//      teléfono que no cambió no deja `stale`, y sin `stale` no hay nada que enviar: el silencio
//      no se comprueba, se hereda.
//
//   3. CONVERTIR UNA CONDICIÓN DEL WORKSPACE EN UN FALLO DEL CONTACTO. Si HubSpot no está
//      conectado no hubo intento, y `stale` sigue siendo la verdad. Lo que se escribe es una
//      nota subordinada con su hora, nunca un `failed`.
//
// ── NADA DE PROVEEDORES ───────────────────────────────────────
// Este módulo no nombra Apollo ni Lusha, no reserva créditos y no participa en ningún reveal.
// Observa una proyección local YA terminada; que el número viniera de un proveedor es
// irrelevante para él, y tener que saberlo lo acoplaría al gasto.
//
// Sin red propia, sin DB propia, sin reloj propio: todo inyectado. NUNCA lanza.

import {
  HUBSPOT_AUTO_SYNC_BLOCKED_REASONS,
  hasPendingHubSpotPhoneChange,
  isHubSpotStaleSourceAutoExportable,
  readHubSpotSyncState,
  writeContactAutoPhoneUpdateAnnex,
  type HubSpotAutoSyncBlockedReason,
  type HubSpotSyncStaleReason,
  type HubSpotSyncStaleSource,
} from './contact-hubspot-sync-state';
import type { SyncContactToHubSpotResult } from './contact-hubspot-sync-core';

/**
 * Qué hizo —o qué no hizo— el PATCH automático en esta evaluación. Vocabulario CERRADO.
 *
 * No es un estado durable ni compite con `hubspot_sync.status`: es el informe de UNA ejecución,
 * viaja en memoria hasta el llamador y muere ahí. La autoridad durable sigue siendo, sin
 * excepción, el bloque `hubspot_sync`.
 */
export type ContactAutoPhoneUpdateOutcome =
  /** La bandera está apagada. Ni siquiera se leyó el contacto. */
  | 'flag_off'
  /** El contacto no se pudo releer después de la escritura local. Cero red. */
  | 'skipped_contact_unavailable'
  /** No hay vínculo: no existe ficha en HubSpot que actualizar. Cero red. */
  | 'skipped_not_linked'
  /** No hay nada pendiente. El caso NORMAL: el teléfono no cambió para HubSpot. Cero red. */
  | 'skipped_no_pending_change'
  /** El pendiente lo causó una supresión de privacidad. NUNCA se exporta solo. Cero red. */
  | 'skipped_privacy_hold'
  /** Hay pendiente pero su procedencia no se puede leer. Fail-closed. Cero red. */
  | 'skipped_unknown_source'
  /** El workspace no tiene HubSpot conectado. Cero red efectiva. No es culpa del contacto. */
  | 'blocked_workspace_not_connected'
  /** La conexión no puede escribir contactos. Igual que la anterior. */
  | 'blocked_scope_missing'
  /** El PATCH entró: HubSpot quedó al día y el estado volvió a `synced`. */
  | 'attempted_updated'
  /** Se intentó y falló. La escritura local sigue siendo un éxito. */
  | 'attempted_failed';

/**
 * Informe que el camino disparador devuelve junto a su resultado local.
 *
 * `syncResult` es el veredicto CRUDO del motor cuando llegó a arrancar, sin traducir, para que
 * quien depure no tenga que adivinar qué `outcome` corresponde a qué `errorCode`.
 */
export interface ContactAutoPhoneUpdateReport {
  outcome: ContactAutoPhoneUpdateOutcome;
  /** `true` sólo si alguna petición pudo salir hacia HubSpot en esta evaluación. */
  attempted: boolean;
  hubspotContactId: string | null;
  /**
   * El pendiente que se leyó, tal cual estaba escrito. Se reporta incluso cuando NO se intentó
   * nada: es lo que permite a un operador entender por qué un contacto sigue en `stale` sin
   * tener que abrir la metadata.
   */
  staleReason: HubSpotSyncStaleReason | null;
  staleSource: HubSpotSyncStaleSource | null;
  syncResult: SyncContactToHubSpotResult | null;
  /** Presente sólo en los dos bloqueos de WORKSPACE, que son los que se anotan durablemente. */
  blockedReason: HubSpotAutoSyncBlockedReason | null;
}

/** Proyección mínima del contacto que el portero necesita. Nada más: no construye payloads. */
export interface ContactAutoPhoneUpdateSubject {
  id: string;
  hubspot_contact_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** Por qué el portero dejó pasar —o no— antes de tocar la red. */
export type ContactAutoPhoneUpdateGateDecision =
  | { proceed: true; staleReason: HubSpotSyncStaleReason; staleSource: HubSpotSyncStaleSource }
  | {
      proceed: false;
      outcome: Extract<
        ContactAutoPhoneUpdateOutcome,
        | 'skipped_not_linked'
        | 'skipped_no_pending_change'
        | 'skipped_privacy_hold'
        | 'skipped_unknown_source'
      >;
      staleReason: HubSpotSyncStaleReason | null;
      staleSource: HubSpotSyncStaleSource | null;
    };

/**
 * LA regla del PATCH automático, aislada y pura para que se pueda afirmar sola.
 *
 * Se lee TODO del estado durable y NADA del llamador. El vínculo, de la columna de la fila; el
 * pendiente y su causante, del bloque. Esa asimetría es deliberada: la columna dice si el
 * vínculo existe HOY, mientras el bloque sólo recuerda el id que un intento guardó alguna vez.
 *
 * El orden de las comprobaciones no es estético. `privacy` se comprueba ANTES que cualquier
 * cosa que pudiera salir a la red, y la exportabilidad se decide por lista blanca
 * (`isHubSpotStaleSourceAutoExportable`), de modo que un causante futuro sin clasificar quede
 * fuera por omisión en vez de dentro por descuido.
 */
export function resolveContactAutoPhoneUpdateGate(
  subject: ContactAutoPhoneUpdateSubject,
): ContactAutoPhoneUpdateGateDecision {
  const linked =
    typeof subject.hubspot_contact_id === 'string' && subject.hubspot_contact_id.trim().length > 0;
  if (!linked) {
    return { proceed: false, outcome: 'skipped_not_linked', staleReason: null, staleSource: null };
  }

  const state = readHubSpotSyncState(subject.metadata);
  const staleReason = state?.stale_reason ?? null;
  const staleSource = state?.stale_source ?? null;

  // El veredicto durable de CUT-3A, heredado sin recalcular. Cubre a la vez el caso «el
  // teléfono no cambió» y el caso «cambió pero la fila nunca estuvo `synced`»: los dos dejaron
  // el bloque sin razón, y sin razón no hay operación que ejecutar.
  if (!hasPendingHubSpotPhoneChange(state)) {
    return {
      proceed: false,
      outcome: 'skipped_no_pending_change',
      staleReason,
      staleSource,
    };
  }

  // `hasPendingHubSpotPhoneChange` ya garantiza que la razón existe; el `if` está para que el
  // tipo lo sepa también, y para que un cambio futuro en esa función no rompa esta invariante
  // en silencio.
  if (staleReason === null) {
    return { proceed: false, outcome: 'skipped_no_pending_change', staleReason, staleSource };
  }

  if (staleSource === 'privacy') {
    return { proceed: false, outcome: 'skipped_privacy_hold', staleReason, staleSource };
  }

  // Procedencia ausente o ilegible. Se separa de `privacy` a propósito aunque el efecto sea el
  // mismo: son dos hechos distintos —«sé que fue una erasure» y «no sé qué fue»— y colapsarlos
  // haría imposible distinguir un contacto protegido de uno anterior a este contrato que nadie
  // ha vuelto a tocar. Los dos se quedan quietos; sólo uno de ellos es un pendiente que un
  // humano debería mirar.
  if (!isHubSpotStaleSourceAutoExportable(staleSource)) {
    return { proceed: false, outcome: 'skipped_unknown_source', staleReason, staleSource };
  }

  return { proceed: true, staleReason, staleSource };
}

/**
 * Traduce el veredicto del motor al vocabulario del informe.
 *
 * `MISSING_EMAIL`, `MISSING_ACCOUNT`, `CONTACT_NOT_FOUND` y `UNKNOWN_ERROR` caen en
 * `attempted_failed`: desde fuera son el mismo hecho —se pidió el PATCH y HubSpot no quedó al
 * día— y cada uno ya dejó, o deliberadamente no dejó, su propio rastro durable dentro del motor.
 *
 * `already_synced` merece una nota. El motor lo devuelve cuando el contacto está vinculado y no
 * hay nada pendiente, es decir cuando la fila cambió entre el portero y el motor —otra pestaña
 * pulsó «Actualizar», o una escritura concurrente ya lo envió—. No es un fallo y no se reporta
 * como tal: no había nada que hacer, y eso es exactamente `skipped_no_pending_change`.
 */
function outcomeForSyncResult(
  result: SyncContactToHubSpotResult,
): ContactAutoPhoneUpdateOutcome {
  if (result.ok) {
    if (result.status === 'updated') return 'attempted_updated';
    if (result.status === 'already_synced') return 'skipped_no_pending_change';
    // `created` / `linked_existing` son inalcanzables: el portero exige vínculo, y con vínculo
    // el motor nunca crea. Si llegaran, decir «actualizado» sería falso.
    return 'attempted_failed';
  }
  if (result.errorCode === 'HUBSPOT_NOT_CONNECTED') return 'blocked_workspace_not_connected';
  if (result.errorCode === 'HUBSPOT_SCOPE_MISSING') return 'blocked_scope_missing';
  return 'attempted_failed';
}

/**
 * Los ÚNICOS dos desenlaces que dejan una anotación durable propia.
 *
 * El resto no la necesita: un PATCH fallido ya quedó escrito por el motor como `failed` +
 * `method: 'auto'` + `attempted_at`, CONSERVANDO los marcadores de pendiente, y un PATCH
 * exitoso como `synced` con los marcadores limpios. Anotarlos otra vez sería una segunda
 * máquina de estados contando la misma historia con otras palabras.
 *
 * Estos dos, en cambio, no dejan NADA, y por decisión explícita de CUT-1: el motor se niega a
 * estampar `failed` en la ficha por una condición del workspace, porque sería culpar a cientos
 * de contactos de una configuración que no es suya. Con un humano delante eso bastaba —veía el
 * error en pantalla—. Sin nadie delante, el contacto se queda en `stale` sin distinguir «nadie
 * lo ha enviado todavía» de «HubSpot lleva una semana desconectado».
 */
const DURABLY_ANNOTATED: Readonly<
  Partial<Record<ContactAutoPhoneUpdateOutcome, HubSpotAutoSyncBlockedReason>>
> = {
  blocked_workspace_not_connected: HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.notConnected,
  blocked_scope_missing: HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.scopeMissing,
};

export interface ContactAutoPhoneUpdateDeps {
  /** Ya resuelto por el llamador. Este módulo NUNCA lee `process.env`. */
  enabled: boolean;
  nowIso: string;
  /** Relee el contacto después de la escritura local. Es la fuente del portero. */
  loadSubject: (contactId: string) => Promise<ContactAutoPhoneUpdateSubject | null>;
  /** EL motor único, ya cableado con `method: 'auto'` por quien construye estas deps. */
  runSync: (contactId: string) => Promise<SyncContactToHubSpotResult>;
  /**
   * Persiste el anexo de bloqueo de workspace. Best-effort por contrato: su fallo no cambia el
   * informe, porque el informe describe lo que pasó con HubSpot, no con su registro.
   */
  persistAnnex: (
    contactId: string,
    metadata: Record<string, unknown>,
  ) => Promise<{ error?: string }>;
}

/**
 * Ejecuta la segunda fase. NUNCA lanza: cualquier excepción se traduce en un informe.
 *
 * Que no lance no es una comodidad, es el contrato. Este código corre después de una escritura
 * local ya confirmada, y una excepción que escapara subiría hasta el `catch` de la server
 * action, que la convertiría en un `{ ok: false }` — es decir, en una edición fallida que en
 * realidad SÍ se guardó, dejando al humano creyendo que debe volver a teclear un número que ya
 * está en la base de datos.
 *
 * ── IDEMPOTENCIA ──────────────────────────────────────────────
 * UNA invocación, como máximo UN intento. No hay bucle, no hay reintento y no hay sondeo: si el
 * PATCH falla, el pendiente sobrevive intacto y el siguiente intento sólo puede venir de una
 * escritura disparadora NUEVA o del botón manual. Nada que se ejecute al leer o al renderizar
 * llama aquí, y eso es lo que impide que abrir una ficha se convierta en una escritura al CRM
 * del cliente.
 */
export async function runContactHubSpotAutoPhoneUpdate(
  contactId: string,
  deps: ContactAutoPhoneUpdateDeps,
): Promise<ContactAutoPhoneUpdateReport> {
  const report = (
    outcome: ContactAutoPhoneUpdateOutcome,
    extra: Partial<ContactAutoPhoneUpdateReport> = {},
  ): ContactAutoPhoneUpdateReport => ({
    outcome,
    attempted: false,
    hubspotContactId: null,
    staleReason: null,
    staleSource: null,
    syncResult: null,
    blockedReason: null,
    ...extra,
  });

  // Bandera apagada: se sale ANTES de leer nada. No es sólo eficiencia — es la prueba de que
  // apagarla devuelve el sistema exactamente al comportamiento de CUT-3B, sin una sola lectura
  // ni escritura nueva en ningún camino.
  if (!deps.enabled) return report('flag_off');

  try {
    const subject = await deps.loadSubject(contactId);
    if (!subject) return report('skipped_contact_unavailable');

    const gate = resolveContactAutoPhoneUpdateGate(subject);
    if (!gate.proceed) {
      return report(gate.outcome, {
        hubspotContactId: subject.hubspot_contact_id ?? null,
        staleReason: gate.staleReason,
        staleSource: gate.staleSource,
      });
    }

    const result = await deps.runSync(contactId);
    const outcome = outcomeForSyncResult(result);
    const blockedReason = DURABLY_ANNOTATED[outcome] ?? null;

    if (blockedReason) {
      // El motor no escribió nada sobre este contacto y no debía: la anotación se hace aquí, con
      // un escritor estructuralmente incapaz de tocar `status`, el vínculo o los marcadores de
      // pendiente. El `stale` sobrevive, que es la verdad: nadie ha enviado nada todavía.
      try {
        await deps.persistAnnex(
          contactId,
          writeContactAutoPhoneUpdateAnnex(subject.metadata, {
            blocked_reason: blockedReason,
            checked_at: deps.nowIso,
          }),
        );
      } catch {
        // Ver `persistAnnex`: registrar el bloqueo no puede convertirse en el hecho reportado.
      }
    }

    return report(outcome, {
      // Sólo cuenta como intento lo que pudo salir a la red. Los dos bloqueos de workspace los
      // resuelve el motor con una lectura de conexión: ni una petición de PATCH sale de ellos.
      attempted: outcome.startsWith('attempted_'),
      hubspotContactId: subject.hubspot_contact_id ?? null,
      staleReason: gate.staleReason,
      staleSource: gate.staleSource,
      syncResult: result,
      blockedReason,
    });
  } catch {
    // Sin `syncResult`: no se sabe si la excepción vino de antes o de después de la red, y
    // afirmar cualquiera de las dos sería inventar. `attempted_failed` es lo único cierto.
    return report('attempted_failed', { attempted: true });
  }
}
