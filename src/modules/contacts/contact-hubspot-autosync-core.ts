// Agente 2A — Autosync HubSpot tras aprobar un candidato
// (AGENT2-CONTACT-HUBSPOT-AUTOSYNC-CUT3B)
//
// La SEGUNDA fase de la aprobación. Corre DESPUÉS de que la transacción local haya confirmado
// y el contacto oficial exista, y su primera propiedad —la que ordena todo lo demás— es que no
// puede deshacer nada de lo anterior: la aprobación ya está escrita cuando esto empieza, así
// que un fallo de HubSpot no tiene ninguna vía por la que convertirse en un fallo de aprobación.
//
// ── UN SOLO MOTOR DE SINCRONIZACIÓN ───────────────────────────
// Este módulo NO habla con HubSpot. No busca por email, no crea, no asocia y no construye
// payloads. Todo eso ya existe en `runSyncContactToHubSpot` y se DELEGA, con `method: 'auto'`
// como única diferencia. Una segunda implementación «para el autosync» tendría su propia idea
// de la deduplicación por email, y el día que divergieran el resultado sería un contacto
// duplicado en el CRM del cliente.
//
// Lo que este módulo SÍ es: el PORTERO. Decide si el motor llega a arrancar, y ésa es una
// decisión distinta de la que toma el motor, porque el motor fue escrito para un humano que
// pulsa un botón sabiendo lo que pide. Aquí no hay nadie mirando.
//
// ── LO QUE EL PORTERO IMPIDE ──────────────────────────────────
// El motor, ante un contacto YA vinculado con un cambio local pendiente, hace un PATCH. Eso es
// correcto cuando alguien pulsa «Actualizar»; sería incorrecto aquí. CUT-3B autosincroniza el
// ALTA y sólo el alta: un reintento de aprobación no es permiso para reescribir en HubSpot un
// teléfono que quizá el cliente corrigió a mano en su CRM. Por eso el portero se planta ANTES
// de delegar, y no confía en que el motor «no vaya a hacerlo».
//
// Sin red propia, sin DB propia, sin reloj propio: todo inyectado.

import {
  HUBSPOT_AUTO_SYNC_BLOCKED_REASONS,
  hasPendingHubSpotPhoneChange,
  readHubSpotSyncState,
  writeContactAutoSyncAnnex,
  type HubSpotAutoSyncBlockedReason,
} from './contact-hubspot-sync-state';
import type { SyncContactToHubSpotResult } from './contact-hubspot-sync-core';

/**
 * Qué hizo —o qué no hizo— el autosync en esta evaluación. Vocabulario CERRADO.
 *
 * No es un estado durable ni compite con `hubspot_sync.status`: es el informe de UNA ejecución,
 * viaja en memoria hasta el llamador y muere ahí. La autoridad durable sigue siendo, sin
 * excepción, el bloque `hubspot_sync`.
 */
export type ContactAutoSyncOutcome =
  /** La bandera está apagada. Ni siquiera se leyó el contacto. */
  | 'flag_off'
  /** El contacto no se pudo leer después de aprobar. Cero red. */
  | 'skipped_contact_unavailable'
  /** Ya existe vínculo y NO hay nada pendiente: el alta ya ocurrió. Cero red. */
  | 'skipped_already_synced'
  /** Ya existe vínculo y hay un cambio local pendiente: territorio MANUAL. Cero red. */
  | 'skipped_pending_manual_update'
  /** Sin email: no hay identidad con la que buscar ni crear. Cero red. */
  | 'blocked_no_email'
  /** La cuenta no tiene empresa en HubSpot. Cero red. Agente 1 es quien crea empresas. */
  | 'blocked_no_hubspot_company'
  /** El workspace no tiene HubSpot conectado. Cero red. Condición del workspace, no del contacto. */
  | 'blocked_workspace_not_connected'
  /** La conexión no puede escribir contactos. Igual que la anterior. */
  | 'blocked_scope_missing'
  /** Se creó el contacto en HubSpot y quedó vinculado. */
  | 'attempted_created'
  /** Ya existía en HubSpot por email y quedó vinculado, sin duplicar. */
  | 'attempted_linked_existing'
  /** Se intentó y falló. La aprobación sigue siendo un éxito. */
  | 'attempted_failed';

/**
 * Informe que la aprobación devuelve junto al resultado local.
 *
 * `syncResult` es el veredicto CRUDO del motor cuando llegó a arrancar, y se conserva sin
 * traducir para que quien depure no tenga que adivinar qué `outcome` corresponde a qué
 * `errorCode`. Es `null` en todos los desenlaces en los que el motor no corrió.
 */
export interface ContactAutoSyncReport {
  outcome: ContactAutoSyncOutcome;
  /** `true` sólo si alguna petición pudo salir hacia HubSpot en esta evaluación. */
  attempted: boolean;
  hubspotContactId: string | null;
  syncResult: SyncContactToHubSpotResult | null;
  /** Presente sólo en los dos bloqueos de WORKSPACE, que son los que se anotan durablemente. */
  blockedReason: HubSpotAutoSyncBlockedReason | null;
}

/** Proyección mínima del contacto que el portero necesita. Nada más: no construye payloads. */
export interface ContactAutoSyncSubject {
  id: string;
  hubspot_contact_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** Por qué el portero dejó pasar —o no— antes de tocar la red. */
export type ContactAutoSyncGateDecision =
  | { proceed: true }
  | {
      proceed: false;
      outcome: Extract<
        ContactAutoSyncOutcome,
        'skipped_already_synced' | 'skipped_pending_manual_update'
      >;
    };

/**
 * LA regla de idempotencia del autosync, aislada y pura para que se pueda afirmar sola.
 *
 * Se decide por el VÍNCULO de la fila (`hubspot_contact_id`), no por el `status` del bloque. El
 * vínculo es el hecho que responde exactamente a la pregunta del corte —«¿ya ocurrió el alta?»—
 * y sobrevive a un estado ilegible, a un contacto vinculado por otra vía y a cualquier bloque
 * escrito antes de este contrato. Un `status` puede mentir o faltar; una columna con un id de
 * HubSpot dentro, no.
 *
 * Consecuencia deliberada: un contacto SIN vínculo cuyo autosync anterior falló vuelve a
 * intentarse si alguien reaprueba. Eso no es un bucle —cada intento exige un clic humano nuevo
 * sobre «Aprobar»— y es justo la recuperación que el corte quiere: el alta que no llegó a
 * ocurrir sigue sin ocurrir, y el motor es idempotente por email.
 */
export function resolveContactAutoSyncGate(
  subject: ContactAutoSyncSubject,
): ContactAutoSyncGateDecision {
  const link =
    typeof subject.hubspot_contact_id === 'string' && subject.hubspot_contact_id.trim().length > 0;
  if (!link) return { proceed: true };

  // Hay vínculo. Quedan dos desenlaces y NINGUNO llega a la red.
  //
  // El pendiente se comprueba primero porque es el peligroso: si se colara, el motor haría un
  // PATCH automático sobre el CRM del cliente sin que nadie lo hubiera pedido. CUT-3B deja las
  // actualizaciones en manos del botón manual —una decisión explícita y anotada como tal—, no
  // porque el PATCH no funcione, sino porque «reintenté aprobar» no significa «reenvía mis
  // datos a HubSpot».
  const state = readHubSpotSyncState(subject.metadata);
  if (hasPendingHubSpotPhoneChange(state)) {
    return { proceed: false, outcome: 'skipped_pending_manual_update' };
  }
  return { proceed: false, outcome: 'skipped_already_synced' };
}

/**
 * Traduce el veredicto del motor al vocabulario del informe.
 *
 * `MISSING_ACCOUNT`, `CONTACT_NOT_FOUND` y `UNKNOWN_ERROR` caen en `attempted_failed` a
 * propósito: desde fuera son el mismo hecho —se intentó y el contacto no quedó en HubSpot— y
 * cada uno ya dejó, o deliberadamente no dejó, su propio rastro durable dentro del motor.
 */
function outcomeForSyncResult(result: SyncContactToHubSpotResult): ContactAutoSyncOutcome {
  if (result.ok) {
    if (result.status === 'created') return 'attempted_created';
    if (result.status === 'linked_existing') return 'attempted_linked_existing';
    // `already_synced` / `updated` son inalcanzables: el portero no deja pasar un contacto
    // vinculado. Si llegaran, decir «se creó» sería falso, así que se reporta como intento.
    return 'attempted_failed';
  }
  if (result.errorCode === 'MISSING_EMAIL') return 'blocked_no_email';
  if (result.errorCode === 'MISSING_HUBSPOT_COMPANY') return 'blocked_no_hubspot_company';
  if (result.errorCode === 'HUBSPOT_NOT_CONNECTED') return 'blocked_workspace_not_connected';
  if (result.errorCode === 'HUBSPOT_SCOPE_MISSING') return 'blocked_scope_missing';
  return 'attempted_failed';
}

/**
 * Los ÚNICOS dos desenlaces que dejan una anotación durable propia.
 *
 * El resto no la necesita: `blocked_no_email`, `blocked_no_hubspot_company` y `attempted_failed`
 * ya quedaron escritos por el motor como `status` + `method: 'auto'` + `attempted_at`, y los
 * éxitos como `synced`. Anotarlos otra vez sería una segunda máquina de estados contando la
 * misma historia con otras palabras.
 *
 * Estos dos, en cambio, no dejan NADA: el motor se niega —correctamente— a estampar `failed` en
 * la ficha por una condición del workspace. Con un humano delante eso bastaba, porque veía el
 * error en pantalla. Sin nadie delante, el contacto se queda diciendo «Nunca sincronizado» sin
 * distinguir «nadie lo intentó» de «HubSpot llevaba una semana desconectado».
 */
const DURABLY_ANNOTATED: Readonly<
  Partial<Record<ContactAutoSyncOutcome, HubSpotAutoSyncBlockedReason>>
> = {
  blocked_workspace_not_connected: HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.notConnected,
  blocked_scope_missing: HUBSPOT_AUTO_SYNC_BLOCKED_REASONS.scopeMissing,
};

export interface ContactAutoSyncDeps {
  /** Ya resuelto por el llamador. El motor NUNCA lee `process.env`. */
  enabled: boolean;
  nowIso: string;
  /** Relee el contacto recién aprobado. Es la fuente del portero. */
  loadSubject: (contactId: string) => Promise<ContactAutoSyncSubject | null>;
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
 * Que no lance no es una comodidad, es el contrato. Este código corre después de una aprobación
 * ya confirmada, y una excepción que escapara subiría hasta el `catch` de la server action, que
 * la convertiría en `{ ok: false }` — es decir, en una aprobación fallida que en realidad SÍ
 * ocurrió, dejando al humano creyendo que debe reintentar algo que ya está hecho.
 */
export async function runContactHubSpotAutoSync(
  contactId: string,
  deps: ContactAutoSyncDeps,
): Promise<ContactAutoSyncReport> {
  const report = (
    outcome: ContactAutoSyncOutcome,
    extra: Partial<ContactAutoSyncReport> = {},
  ): ContactAutoSyncReport => ({
    outcome,
    attempted: false,
    hubspotContactId: null,
    syncResult: null,
    blockedReason: null,
    ...extra,
  });

  // Bandera apagada: se sale ANTES de leer nada. No es sólo eficiencia — es la prueba de que
  // apagar la bandera devuelve el sistema exactamente al comportamiento de CUT-3A, sin una
  // sola lectura ni escritura nueva en ningún camino.
  if (!deps.enabled) return report('flag_off');

  try {
    const subject = await deps.loadSubject(contactId);
    if (!subject) return report('skipped_contact_unavailable');

    const gate = resolveContactAutoSyncGate(subject);
    if (!gate.proceed) {
      return report(gate.outcome, {
        hubspotContactId: subject.hubspot_contact_id ?? null,
      });
    }

    const result = await deps.runSync(contactId);
    const outcome = outcomeForSyncResult(result);
    const blockedReason = DURABLY_ANNOTATED[outcome] ?? null;

    if (blockedReason) {
      // El motor no escribió nada sobre este contacto y no debía: la anotación se hace aquí,
      // con un escritor que es estructuralmente incapaz de tocar `status` o el vínculo.
      try {
        await deps.persistAnnex(
          contactId,
          writeContactAutoSyncAnnex(subject.metadata, {
            blocked_reason: blockedReason,
            checked_at: deps.nowIso,
          }),
        );
      } catch {
        // Ver `persistAnnex`: registrar el bloqueo no puede convertirse en el hecho reportado.
      }
    }

    return report(outcome, {
      // Sólo cuenta como intento lo que pudo salir a la red. Los cuatro bloqueos se resuelven
      // con lecturas locales: ni una petición HubSpot sale de ninguno de ellos.
      attempted: outcome.startsWith('attempted_'),
      hubspotContactId: result.ok ? result.hubspotContactId : null,
      syncResult: result,
      blockedReason,
    });
  } catch {
    // Sin `syncResult`: no se sabe si la excepción vino de antes o de después de la red, y
    // afirmar cualquiera de las dos sería inventar. `attempted_failed` es lo único cierto.
    return report('attempted_failed', { attempted: true });
  }
}
