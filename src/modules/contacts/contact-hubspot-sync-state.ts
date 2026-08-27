// Agente 2A — Estado DURABLE de sincronización HubSpot de un contacto
// (AGENT2-CONTACT-HUBSPOT-SYNC-STATE-CUT1)
//
// UNA sola autoridad para la forma de `contacts.metadata.hubspot_sync`. Existe porque el
// estado tiene DOS escritores —la aprobación del candidato y la sincronización manual— y dos
// escritores del mismo hecho durable, cada uno con su propia idea de la forma, son el mismo
// contacto contando dos historias según quién lo mirara por última vez.
//
// CUT-1 usa `metadata` a propósito y NO inventa una columna: la columna se decide cuando el
// vocabulario esté probado contra datos reales, no antes.
//
// ── LO QUE `synced` SIGNIFICA Y LO QUE NO (CUT-1 → CUT-2) ──────
// `synced` dice EXACTAMENTE una cosa: existe un contacto en HubSpot y está vinculado a este
// contacto de SellUp. En CUT-1 no decía nada sobre si los campos estaban al día, porque no
// había PATCH: un teléfono cambiado después de vincular dejaba el estado intacto.
//
// CUT-2 añade `stale`, que es justo ese hueco convertido en un hecho comprobable: el vínculo
// existe y hay un cambio local POSTERIOR que todavía no viajó. `stale` no es un error —nadie
// falló— ni un estado en vuelo: es información local pendiente de enviar, y por eso sobrevive
// a un intento fallido en vez de desaparecer con él.
//
// El alcance de CUT-2 es TELÉFONO. No hay autosync: marcar `stale` NUNCA llama a HubSpot.
//
// ── CUT-3A ────────────────────────────────────────────────────
// CUT-3A cierra los dos huecos que CUT-2 dejó abiertos y declarados:
//   * BORRAR el teléfono saliente es una sincronización real y ahora se marca (`phone_removed`);
//   * la razón se REDERIVA del saliente actual, porque describe la operación que falta por
//     ejecutar y no el recuerdo de la que la originó.
// Sigue sin haber autosync, y marcar sigue sin llamar a HubSpot: ni siquiera desde la supresión
// de privacidad, que marca y no envía.
//
// ── CUT-3C ────────────────────────────────────────────────────
// CUT-3C introduce la primera actualización AUTOMÁTICA, y con ella la primera pregunta que el
// estado durable no sabía responder: QUIÉN causó el pendiente.
//
// Hasta aquí no hacía falta. Enviar era siempre un clic, y la persona que pulsaba sabía qué
// había cambiado y por qué. Un PATCH automático no tiene a nadie que lo sepa, y hay exactamente
// un causante cuyo pendiente NO debe salir nunca solo a la red: la supresión de privacidad. Una
// erasure que provocara una escritura en el CRM de un tercero a través de una bandera genérica
// sería el fallo más grave de toda esta línea de trabajo — y sería INVISIBLE, porque desde
// fuera un `stale` + `phone_removed` causado por una DSAR es idéntico a uno causado por alguien
// que borró el número a mano.
//
// Por eso `stale_source` es DURABLE y no un argumento del ejecutor: la prohibición tiene que
// viajar con el hecho, no con el camino que lo leyó. Un `stale_source` que fuera un parámetro
// del PATCH dejaría la protección en manos de que cada llamador futuro se acordara de pasarlo.
//
// Sin red, sin DB, sin reloj propio: puro y testeable en aislamiento.

/** Clave ÚNICA del bloque dentro de `contacts.metadata`. Un solo sitio la nombra. */
export const HUBSPOT_SYNC_METADATA_KEY = 'hubspot_sync' as const;

/**
 * El vocabulario cerrado del estado. Cada miembro nombra un hecho comprobado, no una
 * intención: no hay «en curso» porque un estado en vuelo que sobrevive a un crash es
 * indistinguible de una mentira.
 */
export type HubSpotSyncStatus =
  | 'never_attempted'
  | 'blocked_no_email'
  | 'blocked_no_hubspot_company'
  | 'synced'
  | 'stale'
  | 'failed';

/**
 * Por qué el estado quedó desactualizado. Vocabulario CERRADO y con exactamente dos miembros,
 * porque el PATCH sabe ejecutar exactamente dos operaciones: escribir un teléfono y BORRARLO.
 * Una razón que el PATCH no supiera enviar sería una promesa que nadie cumple.
 *
 * `phone_removed` entra en CUT-3A y no es un adorno del `phone_changed`: dice al ejecutor qué
 * cuerpo construir. Confundirlos tiene consecuencias opuestas —un `phone_removed` tratado como
 * `phone_changed` no envía nada y deja el número vivo en HubSpot; un `phone_changed` tratado
 * como `phone_removed` BORRARÍA en HubSpot un número que SellUp sí tiene.
 */
export type HubSpotSyncStaleReason = 'phone_changed' | 'phone_removed';

export const HUBSPOT_SYNC_STALE_REASONS = {
  phoneChanged: 'phone_changed',
  phoneRemoved: 'phone_removed',
} as const;

const STALE_REASONS: readonly HubSpotSyncStaleReason[] = ['phone_changed', 'phone_removed'];

/**
 * QUIÉN causó el pendiente (CUT-3C). Vocabulario CERRADO, y cerrado por una razón operativa:
 * el ejecutor automático decide si puede salir a la red comparando contra esta lista, así que
 * un miembro nuevo que nadie hubiera clasificado sería un pendiente de procedencia desconocida
 * — y la única respuesta segura ante eso es NO exportar.
 *
 * `privacy` es el miembro que justifica todo el campo. Los otros tres describen operaciones que
 * una persona pidió sobre datos que quiere en su CRM; `privacy` describe lo contrario: alguien
 * ejerciendo su derecho a que el dato desaparezca. Que las dos cosas produzcan el mismo `stale`
 * + `phone_removed` es correcto —la operación pendiente es la misma— y es exactamente por eso
 * que la RAZÓN no puede distinguirlas y hace falta este segundo eje.
 *
 * `reveal` se declaró SIN escritor: cuando se escribió CUT-3C, la proyección de un teléfono
 * revelado sobre un contacto YA vinculado sólo llegaba por el merge (117), que se registra como
 * `merge`. Se declaró porque el ejecutor tenía que saber ya qué hacer con él —es auto-exportable,
 * como `user_edit` y `merge`— y porque descubrirlo después habría obligado a abrir un vocabulario
 * que aquel corte cierra a propósito.
 *
 * AGENT2-POST-APPROVAL-REVEAL-STALE-PRODUCER-FINAL-CUT le da su escritor, y es UNO solo: la
 * re-emisión de la 128 (`131_agent2_post_approval_reveal_stale_producer.sql`), que marca
 * dentro de la MISMA transacción en la que proyecta el teléfono sobre el contacto. Ningún camino
 * de TypeScript escribe `reveal`: la procedencia viaja con el hecho, no con quien lo lee.
 */
export type HubSpotSyncStaleSource = 'user_edit' | 'merge' | 'reveal' | 'privacy';

export const HUBSPOT_SYNC_STALE_SOURCES = {
  userEdit: 'user_edit',
  merge: 'merge',
  reveal: 'reveal',
  privacy: 'privacy',
} as const;

const STALE_SOURCES: readonly HubSpotSyncStaleSource[] = [
  'user_edit',
  'merge',
  'reveal',
  'privacy',
];

/**
 * LA regla que decide si un pendiente puede salir a la red SIN que nadie lo pulse.
 *
 * Vive aquí, junto al vocabulario, y no en el ejecutor: es una propiedad del CAUSANTE, y
 * ponerla en el ejecutor permitiría que un segundo ejecutor —el día que exista— llegara a otra
 * conclusión sobre el mismo hecho durable.
 *
 * Enumera los que SÍ pueden en vez de excluir `privacy`, para que añadir un causante nuevo sin
 * clasificarlo lo deje fuera por omisión en vez de dentro por descuido. Un `null` —un pendiente
 * escrito antes de este contrato, o con una procedencia ilegible— tampoco pasa: no se sabe si
 * fue una erasure, y «no se sabe» no autoriza a exportar.
 */
export function isHubSpotStaleSourceAutoExportable(
  source: HubSpotSyncStaleSource | null,
): source is Exclude<HubSpotSyncStaleSource, 'privacy'> {
  return source === 'user_edit' || source === 'merge' || source === 'reveal';
}

/**
 * LA regla que traduce un teléfono saliente en una razón. Existe para que nadie elija la razón
 * a mano: la razón NO es un recuerdo de lo que pasó, es una descripción de lo que el PATCH debe
 * hacer AHORA. Un contacto marcado `phone_changed` cuyo teléfono se vacía después tiene que
 * pasar a `phone_removed`, o el siguiente clic enviaría un número que ya no existe.
 */
export function resolveHubSpotStaleReasonForOutbound(
  outbound: string | null,
): HubSpotSyncStaleReason {
  return outbound === null
    ? HUBSPOT_SYNC_STALE_REASONS.phoneRemoved
    : HUBSPOT_SYNC_STALE_REASONS.phoneChanged;
}

/**
 * Cómo se originó el intento.
 *
 * CUT-1 sólo tenía `manual`: no había autosync. CUT-3B añade `auto`, y la distinción NO es
 * cosmética. `manual` significa que una persona miró esta ficha y pulsó; `auto` significa que
 * la aprobación disparó el intento por su cuenta. Colapsarlos haría que la ficha atribuyera a
 * una persona una escritura que nadie decidió, y borraría la única señal que permite auditar
 * cuántos contactos llegaron a HubSpot sin intervención humana.
 */
export type HubSpotSyncMethod = 'manual' | 'auto';

const METHODS: readonly HubSpotSyncMethod[] = ['manual', 'auto'];

export interface HubSpotSyncState {
  status: HubSpotSyncStatus;
  /** `null` mientras nadie haya intentado sincronizar. */
  method: HubSpotSyncMethod | null;
  /** ISO del intento que produjo este estado. `null` si nunca se intentó. */
  attempted_at: string | null;
  /** Código MECÁNICO y sin PII. NUNCA el mensaje del proveedor: cita valores de la petición. */
  last_error: string | null;
  hubspot_contact_id: string | null;
  /**
   * ISO del PRIMER cambio local que quedó sin enviar, no del último. Un contacto que cambia
   * tres veces antes de que nadie pulse «Actualizar» lleva pendiente desde el primero: sellar
   * la hora más reciente borraría cuánto lleva HubSpot desactualizado.
   */
  stale_since: string | null;
  stale_reason: HubSpotSyncStaleReason | null;
  /**
   * CUT-3C — QUIÉN causó el pendiente. `null` cuando no hay nada pendiente y también en los
   * bloques escritos antes de este contrato, y los dos casos se tratan igual de fail-closed:
   * el ejecutor automático no exporta un pendiente cuya procedencia no puede leer.
   */
  stale_source: HubSpotSyncStaleSource | null;
}

/**
 * Códigos mecánicos de `last_error`. Estables, en snake_case y sin PII por construcción: el
 * mensaje crudo de HubSpot puede citar el email o el teléfono del contacto, así que no se
 * guarda nunca.
 */
export const HUBSPOT_SYNC_ERROR_CODES = {
  /**
   * La BÚSQUEDA por email no se pudo completar (CUT-3B). Es un código propio y no un
   * `hubspot_create_failed` porque describe el estado opuesto: no se creó nada precisamente
   * porque no se pudo comprobar si ya existía. Colapsarlos haría creer, al leer la ficha, que
   * hubo un intento de alta que HubSpot rechazó.
   */
  hubspotSearchFailed: 'hubspot_search_failed',
  /** HubSpot rechazó la creación del contacto. */
  hubspotCreateFailed: 'hubspot_create_failed',
  /** El contacto quedó en HubSpot pero SellUp no pudo guardar el vínculo. */
  localLinkFailed: 'local_link_failed',
  /** HubSpot rechazó el PATCH de un contacto YA vinculado (CUT-2). */
  hubspotUpdateFailed: 'hubspot_update_failed',
  /** El PATCH entró en HubSpot pero SellUp no pudo guardar el estado resultante. */
  localStateFailed: 'local_state_failed',
} as const;

export type HubSpotSyncErrorCode =
  (typeof HUBSPOT_SYNC_ERROR_CODES)[keyof typeof HUBSPOT_SYNC_ERROR_CODES];

const STATUSES: readonly HubSpotSyncStatus[] = [
  'never_attempted',
  'blocked_no_email',
  'blocked_no_hubspot_company',
  'synced',
  'stale',
  'failed',
];

/** Etiquetas legibles. Vive aquí para que UI y contrato no puedan divergir. */
export const HUBSPOT_SYNC_STATUS_LABELS: Readonly<Record<HubSpotSyncStatus, string>> = {
  never_attempted: 'Nunca sincronizado',
  blocked_no_email: 'Bloqueado: falta email',
  blocked_no_hubspot_company: 'Bloqueado: empresa no está en HubSpot',
  synced: 'Sincronizado',
  stale: 'Pendiente de actualizar',
  failed: 'Error de sincronización',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Decide el estado INICIAL a partir de los dos requisitos que la sincronización manual
 * comprueba después. El email manda sobre la empresa: sin email no hay nada que sincronizar
 * aunque la cuenta esté en HubSpot, y decir «falta la empresa» ocultaría el bloqueo real.
 *
 * Ambos argumentos deben venir YA normalizados por quien los escribe (el email tal cual queda
 * en `contacts.email`, el id tal cual está en `accounts.hubspot_company_id`), para que el
 * estado y la sincronización posterior no puedan discrepar sobre el mismo dato.
 */
export function resolveInitialHubSpotSyncStatus(args: {
  email: string | null;
  hubspotCompanyId: string | null;
}): HubSpotSyncStatus {
  if (!text(args.email)) return 'blocked_no_email';
  if (!text(args.hubspotCompanyId)) return 'blocked_no_hubspot_company';
  return 'never_attempted';
}

/**
 * Estado inicial completo para un contacto recién aprobado. `method`, `attempted_at`,
 * `last_error` y `hubspot_contact_id` son `null` PORQUE aprobar no llama a HubSpot: escribir
 * cualquier otra cosa afirmaría un intento que nunca ocurrió.
 */
export function buildInitialHubSpotSyncState(args: {
  email: string | null;
  hubspotCompanyId: string | null;
}): HubSpotSyncState {
  return {
    status: resolveInitialHubSpotSyncStatus(args),
    method: null,
    attempted_at: null,
    last_error: null,
    hubspot_contact_id: null,
    stale_since: null,
    stale_reason: null,
    stale_source: null,
  };
}

/**
 * Lee el estado durable SIN confiar en su forma. Devuelve `null` cuando no hay bloque o su
 * `status` está fuera del vocabulario: un estado desconocido no se disfraza de conocido, y
 * quien lo lea debe decidir qué decir ante la ausencia en vez de inventar un valor.
 */
export function readHubSpotSyncState(
  metadata: Record<string, unknown> | null | undefined,
): HubSpotSyncState | null {
  const raw = metadata?.[HUBSPOT_SYNC_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const block = raw as Record<string, unknown>;
  const status = block.status;
  if (typeof status !== 'string' || !STATUSES.includes(status as HubSpotSyncStatus)) return null;
  return {
    status: status as HubSpotSyncStatus,
    // Igual que `status`: un método fuera del vocabulario NO se disfraza de conocido. Se lee
    // contra la lista para que añadir un miembro no exija recordar este `if`.
    method: METHODS.includes(block.method as HubSpotSyncMethod)
      ? (block.method as HubSpotSyncMethod)
      : null,
    attempted_at: text(block.attempted_at),
    last_error: text(block.last_error),
    hubspot_contact_id: text(block.hubspot_contact_id),
    stale_since: text(block.stale_since),
    // Igual que `status`: una razón fuera del vocabulario NO se disfraza de conocida.
    stale_reason: STALE_REASONS.includes(block.stale_reason as HubSpotSyncStaleReason)
      ? (block.stale_reason as HubSpotSyncStaleReason)
      : null,
    // CUT-3C — y aquí la lectura estricta es lo que SOSTIENE la protección de privacidad: una
    // procedencia irreconocible se lee como `null`, y `null` no autoriza a exportar. Si esto
    // cayera al valor crudo, un `stale_source: 'privacidad'` mal escrito —o un
    // `stale_source: 'user_edit '` con un espacio— dejaría de coincidir con `privacy` y el
    // pendiente saldría a la red.
    stale_source: STALE_SOURCES.includes(block.stale_source as HubSpotSyncStaleSource)
      ? (block.stale_source as HubSpotSyncStaleSource)
      : null,
  };
}

/**
 * Proyecta un estado sobre la metadata del contacto devolviendo una metadata NUEVA.
 *
 * Preserva dos cosas distintas y por dos razones distintas:
 *  - el resto de `metadata` (trazabilidad de origen, normalización, títulos): este bloque no
 *    es dueño de nada de eso;
 *  - los campos del bloque anterior que este contrato NO nombra (`synced_at`, `synced_by`,
 *    `mode`, `hubspot_company_id`, `company_association`), que ya escribía el hito 17A.4C y
 *    que la UI sigue leyendo. Sobrescribirlos con nada sería perder auditoría existente.
 *
 * `extras` se aplica al final para los campos de auditoría que el llamador sí conoce.
 */
export function writeHubSpotSyncState(
  metadata: Record<string, unknown> | null | undefined,
  state: HubSpotSyncState,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadata ?? {};
  const priorBlock = existing[HUBSPOT_SYNC_METADATA_KEY];
  const prior =
    priorBlock && typeof priorBlock === 'object' && !Array.isArray(priorBlock)
      ? (priorBlock as Record<string, unknown>)
      : {};
  return {
    ...existing,
    [HUBSPOT_SYNC_METADATA_KEY]: {
      ...prior,
      ...state,
      ...(extras ?? {}),
    },
  };
}

// ── CUT-2 · Teléfono saliente y transición a `stale` ────────────

/**
 * Fuente de teléfono de un contacto, tal cual está en la fila.
 *
 * Es un tipo estructural a propósito: lo cumplen `ContactForSync`, la fila de `updateContact`
 * y cualquier proyección futura, sin que ninguna tenga que importar a las otras.
 */
export interface HubSpotPhoneSource {
  phone: string | null | undefined;
  mobile_phone: string | null | undefined;
}

/**
 * Construye una `HubSpotPhoneSource` a partir de los dos valores sueltos.
 *
 * Existe para que un llamador cuya proyección usa otros nombres —la supresión de privacidad
 * lee `phone` / `mobilePhone`— no tenga que escribir la clave `mobile_phone` a mano. No es
 * cosmética: la guarda de 4O-E4.1 prohíbe que el subsistema de erasure NOMBRE esa columna en
 * código, precisamente para que no pueda reaparecer en un patch de borrado, y esa prohibición
 * merece seguir siendo literal ahí. La lectura vive aquí, donde la columna ya está declarada.
 */
export function toHubSpotPhoneSource(
  phone: string | null | undefined,
  mobilePhone: string | null | undefined,
): HubSpotPhoneSource {
  return { phone: phone ?? null, mobile_phone: mobilePhone ?? null };
}

/**
 * `mobile_phone ?? phone`, recortado: el saliente colapsado con prioridad al móvil.
 *
 * AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC (Task A4) redujo su alcance. Hasta entonces era
 * el pivote de CUT-2: la usaban a la vez quien CONSTRUÍA el payload de HubSpot (un solo campo
 * de destino) y quien decidía si el contacto había quedado desactualizado. Ya no construye
 * ningún payload —el alta (Task A3) y el PATCH (Task A4) leen `phone` y `mobile_phone` cada
 * uno de su propio campo, sin colapsar— ni decide si algo quedó pendiente —esa comparación es
 * `haveOutboundHubSpotPhonesChanged`, que mira el PAR completo—.
 *
 * Su único uso restante en todo el árbol: dentro de `markContactHubSpotSyncStaleForPhoneChange`,
 * para clasificar la RAZÓN (`phone_changed` vs `phone_removed`) una vez que ya se decidió que
 * SÍ hay algo pendiente. Esa clasificación sigue siendo, a propósito, un único slot de razón —no
 * dos— y responde «¿queda algo que mostrar?», no «cuál de los dos campos cambió».
 *
 * Devuelve `null` cuando no hay número: ausencia, no cadena vacía.
 */
export function resolveOutboundHubSpotPhone(source: HubSpotPhoneSource): string | null {
  const mobile = typeof source.mobile_phone === 'string' ? source.mobile_phone.trim() : '';
  if (mobile.length > 0) return mobile;
  const phone = typeof source.phone === 'string' ? source.phone.trim() : '';
  return phone.length > 0 ? phone : null;
}

function normalizedOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * ¿Cambió CUALQUIERA de los dos campos salientes? A diferencia de `resolveOutboundHubSpotPhone`
 * —que colapsa los dos en uno con prioridad para decidir QUÉ enviar cuando sólo hay un campo de
 * destino—, esta comparación mira los DOS de forma independiente. Es la que decide SI hay que
 * re-sincronizar, y colapsar aquí escondería un cambio en el campo sin prioridad mientras el
 * otro no se mueva — exactamente el defecto que motivó esta función.
 */
export function haveOutboundHubSpotPhonesChanged(
  previous: HubSpotPhoneSource,
  next: HubSpotPhoneSource,
): boolean {
  return (
    normalizedOrNull(previous.phone) !== normalizedOrNull(next.phone) ||
    normalizedOrNull(previous.mobile_phone) !== normalizedOrNull(next.mobile_phone)
  );
}

/**
 * ¿Queda información local que este contrato sabe enviar y todavía no envió?
 *
 * Se pregunta por la RAZÓN, no por el `status`: tras un PATCH fallido el estado es `failed`
 * —el último intento sí falló— pero la razón sobrevive, porque el cambio local sigue ahí.
 * `failed` y `stale` responden dos preguntas distintas y CUT-2 necesita las dos a la vez.
 */
export function hasPendingHubSpotPhoneChange(state: HubSpotSyncState | null): boolean {
  if (!state) return false;
  // CUT-3A: las DOS razones cuentan como pendiente. Borrar el teléfono en HubSpot es una
  // sincronización tan real como escribirlo, y excluir `phone_removed` aquí dejaría al
  // ejecutor sin ver el único caso en el que HubSpot conserva un dato que SellUp ya no tiene.
  if (state.stale_reason === null) return false;
  return state.status === 'stale' || state.status === 'failed';
}

/**
 * Marcadores de pendiente que un intento BLOQUEADO o FALLIDO debe arrastrar tal cual.
 *
 * Un intento que no llegó a enviar nada no puede borrar la prueba de que hay algo por enviar:
 * si `blocked_no_email` limpiara los marcadores, vaciar el email de un contacto haría
 * desaparecer para siempre el teléfono pendiente, sin que nadie lo hubiera enviado.
 */
export function preservePendingHubSpotPhoneChange(
  metadata: Record<string, unknown> | null | undefined,
): Pick<HubSpotSyncState, 'stale_since' | 'stale_reason' | 'stale_source'> {
  const prior = readHubSpotSyncState(metadata);
  return {
    stale_since: prior?.stale_since ?? null,
    stale_reason: prior?.stale_reason ?? null,
    // CUT-3C — la procedencia viaja con los otros dos marcadores o la protección se cae justo
    // donde más importa: un PATCH automático que falla escribe `failed`, y si ese `failed`
    // perdiera el `privacy` del pendiente, el siguiente lector vería una procedencia `null`…
    // que también es fail-closed, sí, pero por accidente y sin poder explicar por qué. Peor
    // aún en el otro sentido: perder un `user_edit` convertiría un pendiente legítimo en uno
    // inexportable para siempre.
    stale_source: prior?.stale_source ?? null,
  };
}

/** Por qué NO se marcó. Explícito para que las pruebas afirmen la razón, no sólo el silencio. */
export type HubSpotSyncStaleSkipReason =
  /** La fila no tiene vínculo: no hay nada en HubSpot que pueda estar desactualizado. */
  | 'not_linked'
  /** No hay estado durable legible: territorio de REPARACIÓN (CUT-1), no de `stale`. */
  | 'no_durable_state'
  /** El teléfono saliente no cambió: nada que enviar. */
  | 'no_outbound_change'
  /** Ya había un cambio pendiente Y su razón sigue describiendo lo que el PATCH debe hacer. */
  | 'already_pending'
  /** El contacto nunca llegó a estar sincronizado: `never_attempted`, bloqueado o fallido. */
  | 'not_previously_synced';

export type HubSpotSyncStaleDecision =
  | { marked: false; reason: HubSpotSyncStaleSkipReason }
  | { marked: true; state: HubSpotSyncState; metadata: Record<string, unknown> };

/**
 * LA autoridad de la transición a `stale` por cambio de teléfono (CUT-2).
 *
 * Existe una sola porque los caminos que tocan el teléfono oficial son varios y cada uno con
 * su propia copia de la regla acabaría con fichas que discrepan sobre si HubSpot está al día.
 * No escribe, no llama a HubSpot y no conoce el reloj: devuelve la metadata NUEVA y quien la
 * pidió decide cuándo persistirla —dentro de su propia escritura, no en una aparte.
 *
 * ── AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC — la comparación deja de colapsar los dos campos ──
 *
 * ── OLD_ASSERTION ──
 * "Cambiar `phone` en un contacto cuyo `mobile_phone` lo tapa no cambia lo que HubSpot
 * recibiría, así que marcarlo prometería una actualización que sería un no-op." Verdad
 * mientras SellUp sólo mandara UN campo (`phone`) a HubSpot, con `mobile_phone` ganando por
 * prioridad cuando ambos estaban presentes.
 *
 * ── WHY_OBSOLETE ──
 * SellUp ahora manda los DOS campos a HubSpot, cada uno a su propio destino (`phone` →
 * `phone`, `mobile_phone` → `mobilephone`) — Tasks A2-A4 de este mismo plan, que terminan de
 * construir el envío en esta misma sesión. Ya no hay "campo que tapa a otro": un cambio en
 * CUALQUIERA de los dos es un cambio real en lo que HubSpot debe reflejar, incluso si el otro
 * campo se queda igual.
 *
 * ── NEW_INVARIANT ──
 * La comparación mira el PAR completo (`haveOutboundHubSpotPhonesChanged`), no un valor
 * colapsado con prioridad. `resolveOutboundHubSpotPhone` se conserva tal cual para UNA cosa
 * distinta: clasificar la RAZÓN (`phone_changed` vs `phone_removed`) sobre el estado
 * resultante — sigue siendo un único slot de razón, no dos, así que la razón describe "¿queda
 * algo que mostrar?" y no "cuál de los dos campos cambió".
 *
 * ── VACIAR EL TELÉFONO **SÍ** MARCA (CUT-3A) ──────────────────
 * CUT-2 dejaba pasar el saliente que caía a `null` porque no existía contrato para BORRAR una
 * propiedad en HubSpot, y prometer una actualización que nadie sabía ejecutar habría sido una
 * promesa muerta. CUT-3A construye ese contrato —el PATCH sabe limpiar la propiedad— y con él
 * el silencio deja de ser prudencia y pasa a ser una MENTIRA: SellUp borra un número y la ficha
 * sigue diciendo `synced` mientras HubSpot conserva el que ya no existe aquí. Ese caso se marca
 * con `phone_removed`.
 *
 * ── LA RAZÓN SE REDERIVA; LA HORA NO ─────────────────────────
 * Cuando ya había algo pendiente, `stale_since` y `status` se conservan intactos —desde cuándo
 * HubSpot está desactualizado no lo pone al día un segundo cambio, y un `failed` no se degrada
 * a `stale` por ello—, pero la RAZÓN se recalcula sobre el saliente de ahora. La razón no
 * recuerda: instruye. Un `phone_changed` que sobreviviera a un borrado posterior haría que el
 * siguiente clic enviase un número que SellUp ya no tiene; un `phone_removed` que sobreviviera
 * a un número nuevo haría que ese clic lo BORRARA en HubSpot.
 *
 * ── LA PROCEDENCIA SE REDERIVA IGUAL QUE LA RAZÓN (CUT-3C) ────
 * `source` es OBLIGATORIO y describe QUIÉN causa ESTE cambio, no quién causó el anterior.
 * Cuando ya había algo pendiente se sobrescribe por la misma razón que la razón: instruye al
 * ejecutor sobre la operación que falta AHORA.
 *
 * Las dos direcciones importan y son opuestas:
 *   * un `privacy` que sobreviviera a un número tecleado después dejaría ese número atrapado
 *     para siempre —nunca se auto-enviaría, y nadie sabría por qué—;
 *   * un `user_edit` que sobreviviera a una erasure posterior haría que la erasure exportara.
 *     Ése es el fallo grave, y es la razón por la que este parámetro no tiene valor por
 *     defecto: un olvido de cableado sería una autorización silenciosa para exportar.
 */
export function markContactHubSpotSyncStaleForPhoneChange(args: {
  metadata: Record<string, unknown> | null | undefined;
  /** `contacts.hubspot_contact_id` de la FILA: el vínculo real, no el que recuerda el bloque. */
  hubspotContactId: string | null | undefined;
  previous: HubSpotPhoneSource;
  next: HubSpotPhoneSource;
  nowIso: string;
  /** CUT-3C — quién causa ESTE cambio. Sin valor por defecto, y a propósito. */
  source: HubSpotSyncStaleSource;
}): HubSpotSyncStaleDecision {
  if (!text(args.hubspotContactId)) return { marked: false, reason: 'not_linked' };

  const prior = readHubSpotSyncState(args.metadata);
  if (!prior) return { marked: false, reason: 'no_durable_state' };

  if (!haveOutboundHubSpotPhonesChanged(args.previous, args.next)) {
    return { marked: false, reason: 'no_outbound_change' };
  }
  const after = resolveOutboundHubSpotPhone(args.next);

  const reason = resolveHubSpotStaleReasonForOutbound(after);

  // Ya había algo pendiente. La hora NO se re-sella y el `status` NO se toca —un `failed`
  // sigue siendo `failed`—, pero si el saliente de ahora pide otra operación que la registrada,
  // la razón se corrige. Sólo entonces hay algo que escribir: cuando la razón ya es la correcta
  // no se devuelve metadata, porque no hay ni un campo que cambiar.
  if (hasPendingHubSpotPhoneChange(prior)) {
    // CUT-3C — se compara el PAR. Una razón que ya coincide no basta para callar: un pendiente
    // `phone_changed`/`user_edit` sobre el que el merge proyecta otro número sigue siendo
    // `phone_changed`, pero ya lo causa el merge, y dejar escrito `user_edit` atribuiría a una
    // persona un cambio que no hizo. En el sentido peligroso: un `phone_removed` que pasa de
    // `user_edit` a `privacy` NO cambia de razón y tiene que dejar de ser auto-exportable.
    if (prior.stale_reason === reason && prior.stale_source === args.source) {
      return { marked: false, reason: 'already_pending' };
    }
    const corrected: HubSpotSyncState = {
      ...prior,
      stale_reason: reason,
      stale_source: args.source,
    };
    return {
      marked: true,
      state: corrected,
      metadata: writeHubSpotSyncState(args.metadata, corrected),
    };
  }

  if (prior.status !== 'synced') return { marked: false, reason: 'not_previously_synced' };

  const state: HubSpotSyncState = {
    status: 'stale',
    // Se conserva la procedencia del intento que creó el vínculo. Este cambio no fue un
    // intento de sincronización: no estampa `attempted_at` ni inventa un `method`.
    method: prior.method,
    attempted_at: prior.attempted_at,
    last_error: null,
    // El vínculo NO se toca: `stale` describe los datos, no la existencia del contacto.
    hubspot_contact_id: prior.hubspot_contact_id,
    stale_since: args.nowIso,
    stale_reason: reason,
    stale_source: args.source,
  };

  return { marked: true, state, metadata: writeHubSpotSyncState(args.metadata, state) };
}

// ── CUT-3B · Anexo operativo del AUTOSYNC ──────────────────────
//
// El problema que resuelve: CUT-1 decidió —y CUT-3B lo mantiene— que `HUBSPOT_NOT_CONNECTED` y
// `HUBSPOT_SCOPE_MISSING` NO se escriben como `failed` en la ficha del contacto. Son condiciones
// del WORKSPACE, iguales para todos los contactos, y culpar de ellas a cada ficha dejaría
// cientos de estados falsos que nadie limpiaría al reconectar HubSpot.
//
// Mientras la sincronización era MANUAL ese silencio no costaba nada: la persona que pulsaba
// veía el error en pantalla en ese mismo instante. El autosync no tiene a nadie mirando, así que
// el mismo silencio se convierte en un contacto que dice «Nunca sincronizado» sin que nadie
// pueda saber si es porque nadie lo intentó o porque HubSpot llevaba una semana desconectado.
//
// La salida NO es sobrecargar `failed` ni multiplicar el vocabulario de `status` con dos
// miembros más que ninguna transición sabría abandonar. Es un ANEXO subordinado: el `status`
// sigue siendo `never_attempted` —que es la verdad: no hubo intento— y junto a él queda escrito,
// con su hora, qué encontró el autosync la última vez que miró.
//
// El anexo NO es un segundo estado. No participa en ninguna decisión, nadie lo lee para elegir
// qué hacer, y `readHubSpotSyncState` lo ignora por completo. Es una nota de operación, y por
// eso lleva `checked_at`: describe un MOMENTO, no una condición vigente.

/** Clave del anexo DENTRO del bloque `hubspot_sync`. Su anidamiento es su subordinación. */
export const HUBSPOT_AUTO_SYNC_ANNEX_KEY = 'auto_sync' as const;

/**
 * Clave del anexo del PATCH automático (CUT-3C). SEPARADA de la del autosync, y no por
 * simetría: son dos momentos distintos de la vida del contacto y las dos notas pueden coexistir
 * sobre la misma ficha —un contacto cuyo alta se bloqueó por conexión y que meses después, ya
 * vinculado, vuelve a encontrarse la conexión caída al intentar actualizar—. Con una sola clave
 * la segunda nota borraría la primera y nadie podría reconstruir qué pasó cuándo.
 */
export const HUBSPOT_AUTO_PHONE_UPDATE_ANNEX_KEY = 'auto_update' as const;

/**
 * Por qué el autosync no llegó a intentar nada. Vocabulario CERRADO y con exactamente los dos
 * miembros que el `status` no sabe representar.
 *
 * `blocked_no_email` y `blocked_no_hubspot_company` NO están aquí a propósito: ésos SÍ son
 * hechos del contacto y ya tienen su propio `status` durable. Repetirlos en el anexo crearía
 * justo las dos máquinas de estados que este diseño evita.
 */
export type HubSpotAutoSyncBlockedReason = 'hubspot_not_connected' | 'hubspot_scope_missing';

export const HUBSPOT_AUTO_SYNC_BLOCKED_REASONS = {
  notConnected: 'hubspot_not_connected',
  scopeMissing: 'hubspot_scope_missing',
} as const;

const AUTO_SYNC_BLOCKED_REASONS: readonly HubSpotAutoSyncBlockedReason[] = [
  'hubspot_not_connected',
  'hubspot_scope_missing',
];

export interface HubSpotAutoSyncAnnex {
  blocked_reason: HubSpotAutoSyncBlockedReason;
  /** ISO del momento en que el autosync miró y encontró el bloqueo. */
  checked_at: string;
}

/** Etiquetas legibles del anexo. Vive junto al vocabulario para que no puedan divergir. */
export const HUBSPOT_AUTO_SYNC_BLOCKED_LABELS: Readonly<
  Record<HubSpotAutoSyncBlockedReason, string>
> = {
  hubspot_not_connected: 'HubSpot no estaba conectado al aprobar',
  hubspot_scope_missing: 'La conexión de HubSpot no permite escribir contactos',
};

/**
 * Las mismas dos razones en forma de SUBORDINADA, para el anexo del PATCH automático (CUT-3C).
 *
 * Son un mapa aparte y no una reutilización porque las de arriba dicen «al aprobar»: pegarlas
 * detrás de «No se pudo actualizar automáticamente porque…» produciría una frase que sitúa el
 * bloqueo en un momento equivocado —el del alta— cuando lo que falló fue una actualización
 * posterior. Viven aquí, junto al vocabulario, para que no puedan divergir de él.
 */
export const HUBSPOT_AUTO_UPDATE_BLOCKED_DETAIL: Readonly<
  Record<HubSpotAutoSyncBlockedReason, string>
> = {
  hubspot_not_connected: 'HubSpot no estaba conectado',
  hubspot_scope_missing: 'la conexión de HubSpot no permite escribir contactos',
};

/**
 * Lee UN anexo SIN confiar en su forma, igual que `readHubSpotSyncState`. Una razón fuera del
 * vocabulario devuelve `null` en vez de disfrazarse de conocida.
 *
 * La clave es un parámetro y las dos lecturas concretas son envoltorios de una línea: CUT-3C
 * necesita exactamente la misma validación sobre otra clave, y una segunda copia del `if` que
 * comprueba el vocabulario sería la copia que un día se olvidara de comprobarlo.
 */
function readAnnexAt(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): HubSpotAutoSyncAnnex | null {
  const block = metadata?.[HUBSPOT_SYNC_METADATA_KEY];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const raw = (block as Record<string, unknown>)[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const annex = raw as Record<string, unknown>;
  const reason = annex.blocked_reason;
  if (!AUTO_SYNC_BLOCKED_REASONS.includes(reason as HubSpotAutoSyncBlockedReason)) return null;
  const checkedAt = text(annex.checked_at);
  if (!checkedAt) return null;
  return { blocked_reason: reason as HubSpotAutoSyncBlockedReason, checked_at: checkedAt };
}

/** El anexo del ALTA automática (CUT-3B). */
export function readContactAutoSyncAnnex(
  metadata: Record<string, unknown> | null | undefined,
): HubSpotAutoSyncAnnex | null {
  return readAnnexAt(metadata, HUBSPOT_AUTO_SYNC_ANNEX_KEY);
}

/** El anexo del PATCH automático (CUT-3C). Mismo vocabulario, otra clave, otro momento. */
export function readContactAutoPhoneUpdateAnnex(
  metadata: Record<string, unknown> | null | undefined,
): HubSpotAutoSyncAnnex | null {
  return readAnnexAt(metadata, HUBSPOT_AUTO_PHONE_UPDATE_ANNEX_KEY);
}

/**
 * Escribe el anexo y NADA más, devolviendo una metadata nueva.
 *
 * Es deliberadamente incapaz de tocar `status`, `method`, `attempted_at` o el vínculo: un
 * escritor que pudiera hacerlo acabaría, un día, estampando `failed` por un workspace
 * desconectado —exactamente lo que este anexo existe para no hacer—. Por eso NO pasa por
 * `writeHubSpotSyncState`, que exige un estado completo y por tanto obligaría a inventar uno.
 *
 * Cuando no había bloque previo, el resultado es un bloque que sólo contiene el anexo y
 * ningún `status`: `readHubSpotSyncState` lo sigue leyendo como «sin estado durable», que es
 * la verdad, y ninguna decisión cambia por ello.
 */
function writeAnnexAt(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  annex: HubSpotAutoSyncAnnex,
): Record<string, unknown> {
  const existing = metadata ?? {};
  const priorBlock = existing[HUBSPOT_SYNC_METADATA_KEY];
  const prior =
    priorBlock && typeof priorBlock === 'object' && !Array.isArray(priorBlock)
      ? (priorBlock as Record<string, unknown>)
      : {};
  return {
    ...existing,
    [HUBSPOT_SYNC_METADATA_KEY]: {
      ...prior,
      [key]: { ...annex },
    },
  };
}

export function writeContactAutoSyncAnnex(
  metadata: Record<string, unknown> | null | undefined,
  annex: HubSpotAutoSyncAnnex,
): Record<string, unknown> {
  return writeAnnexAt(metadata, HUBSPOT_AUTO_SYNC_ANNEX_KEY, annex);
}

/**
 * Escribe el anexo del PATCH automático y NADA más (CUT-3C).
 *
 * Hereda la incapacidad estructural del de CUT-3B, y aquí es todavía más importante: este anexo
 * se escribe sobre contactos que SÍ tienen algo pendiente. Un escritor capaz de tocar `status`
 * podría degradar un `stale` a `failed` por una conexión caída —convirtiendo «no se intentó» en
 * «se intentó y falló»— o, peor, limpiar los marcadores y perder el pendiente entero.
 */
export function writeContactAutoPhoneUpdateAnnex(
  metadata: Record<string, unknown> | null | undefined,
  annex: HubSpotAutoSyncAnnex,
): Record<string, unknown> {
  return writeAnnexAt(metadata, HUBSPOT_AUTO_PHONE_UPDATE_ANNEX_KEY, annex);
}

// ── BACKFILL LEGACY · La PROCEDENCIA del `synced` ───────────────
//
// (AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL)
//
// Hay contactos que llevan `contacts.hubspot_contact_id` desde antes de que existiera este
// contrato y NO tienen bloque durable legible. Para toda la maquinaria de `stale` esos
// contactos son invisibles: la autoridad devuelve `no_durable_state` y se calla, así que un
// teléfono cambiado después nunca se marca y HubSpot conserva el viejo para siempre.
//
// El backfill (`132_agent2_hubspot_legacy_sync_state_backfill.sql`) les escribe una
// LÍNEA BASE: `status = 'synced'`, que aquí significa EXACTAMENTE una cosa —existía un vínculo
// durable con HubSpot en el momento del backfill— y NO significa que se haya comprobado que
// cada propiedad local coincida con la de HubSpot. Nadie lo comprobó: el backfill no llama a
// HubSpot.
//
// Esa diferencia tiene que ser LEGIBLE, o la ficha diría «Sincronizado» con el mismo tono para
// dos hechos distintos: uno observado (alguien pulsó, hubo respuesta, hay `attempted_at`) y uno
// deducido de la existencia de un vínculo. Por eso el bloque gana un campo propio con
// vocabulario CERRADO en vez de dejar que la UI infiera la diferencia por la ausencia de
// `attempted_at` — inferir es exactamente el defecto que este corte cierra, sólo que un paso
// más adentro.
//
// NO entra en `HubSpotSyncState` a propósito. `HubSpotSyncState` es el estado que los escritores
// CONSTRUYEN entero en cada escritura; este campo es una anotación de PROCEDENCIA que sobrevive
// a esas escrituras por el `...prior` de `writeHubSpotSyncState`, igual que `synced_at`, `mode`
// o `company_association`. Meterlo en el estado obligaría a cada constructor a acordarse de
// arrastrarlo, y un olvido borraría la advertencia sin que nada fallara.

/** Vocabulario CERRADO de procedencias de una línea base. Hoy tiene exactamente un miembro. */
export type HubSpotSyncBaselineSource = 'legacy_link_backfill';

export const HUBSPOT_SYNC_BASELINE_SOURCES = {
  legacyLinkBackfill: 'legacy_link_backfill',
} as const;

const BASELINE_SOURCES: readonly HubSpotSyncBaselineSource[] = ['legacy_link_backfill'];

/** Clave del campo dentro del bloque `hubspot_sync`. Un solo sitio la nombra. */
export const HUBSPOT_SYNC_BASELINE_SOURCE_FIELD = 'baseline_source' as const;
/** Clave de la hora en que el backfill OBSERVÓ el vínculo. No es una hora de sincronización. */
export const HUBSPOT_SYNC_BASELINE_AT_FIELD = 'baseline_at' as const;

/**
 * Lee la procedencia de la línea base SIN confiar en su forma, igual que `readHubSpotSyncState`.
 * Un valor fuera del vocabulario se lee como AUSENTE, no como su valor crudo: la UI decide el
 * copy con esto, y un `baseline_source: 'legacy'` mal escrito no debe hacerse pasar por un
 * `synced` observado.
 */
export function readHubSpotSyncBaselineSource(
  metadata: Record<string, unknown> | null | undefined,
): HubSpotSyncBaselineSource | null {
  const raw = metadata?.[HUBSPOT_SYNC_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[HUBSPOT_SYNC_BASELINE_SOURCE_FIELD];
  return BASELINE_SOURCES.includes(value as HubSpotSyncBaselineSource)
    ? (value as HubSpotSyncBaselineSource)
    : null;
}

/**
 * Los `extras` que BORRAN la línea base. Se aplican en los dos constructores que registran un
 * intento REAL con respuesta de HubSpot (`buildSyncMetadata`, `buildUpdatedSyncMetadata`).
 *
 * A partir de ese momento el `synced` ya no es deducido: hay `attempted_at`, hubo petición y
 * hubo respuesta. Dejar la anotación puesta haría que la ficha siguiera advirtiendo sobre un
 * estado que ya nadie dedujo.
 *
 * Un intento FALLIDO no la borra —`buildFailedSyncMetadata` no la nombra y el `...prior` la
 * conserva—: un PATCH que HubSpot rechazó no observó nada.
 */
export function clearedHubSpotSyncBaselineExtras(): Record<string, unknown> {
  return {
    [HUBSPOT_SYNC_BASELINE_SOURCE_FIELD]: null,
    [HUBSPOT_SYNC_BASELINE_AT_FIELD]: null,
  };
}

// ── UNA sola autoridad para lo que la ficha DICE ────────────────

/**
 * Tono del badge. Vocabulario CERRADO y sin colores: el componente traduce tono → clases, para
 * que esta autoridad siga sin saber nada de Tailwind y siga siendo testeable en aislamiento.
 */
export type HubSpotSyncPresentationTone = 'synced' | 'neutral' | 'pending' | 'error';

export interface HubSpotSyncPresentation {
  label: string;
  tone: HubSpotSyncPresentationTone;
}

/** Copy del vínculo sin estado observado. NO dice «Sincronizado»: no consta que lo esté. */
export const HUBSPOT_SYNC_BASELINE_LABEL = 'Vinculado a HubSpot' as const;
/** Copy del vínculo SIN estado durable legible. Nombra la ignorancia en vez de taparla. */
export const HUBSPOT_SYNC_UNKNOWN_STATE_LABEL = 'Estado de sincronización desconocido' as const;
/** Copy de la ausencia de vínculo. */
export const HUBSPOT_SYNC_NOT_LINKED_LABEL = 'Sin sincronizar' as const;

/**
 * LO QUE LA FICHA DICE sobre la sincronización, en UN solo sitio.
 *
 * Existe porque hasta este corte había DOS lugares deduciendo la respuesta —el badge del
 * drawer y la tarjeta de trazabilidad—, los dos con la misma regla equivocada: «hay
 * `hubspot_contact_id` ⇒ Sincronizado». Esa regla convierte la existencia de un vínculo en una
 * afirmación sobre la FRESCURA de los datos, que es justo lo que el vínculo no sabe.
 *
 * Las tres respuestas posibles y por qué son tres:
 *   * estado durable legible ⇒ manda el estado, con su tono. Es lo observado;
 *   * vínculo SIN estado legible ⇒ NEUTRO y explícito: «Estado de sincronización desconocido».
 *     No es un error —nadie falló— ni un éxito. Es una anomalía anterior al backfill, y decirlo
 *     es lo que permite verla;
 *   * sin vínculo ⇒ «Sin sincronizar».
 *
 * Y un cuarto matiz DENTRO del primero: un `synced` cuya procedencia es una línea base se dice
 * «Vinculado a HubSpot», en tono neutro. El vínculo consta; la frescura de los campos no.
 */
export function resolveHubSpotSyncPresentation(args: {
  state: HubSpotSyncState | null;
  baselineSource: HubSpotSyncBaselineSource | null;
  hubspotContactId: string | null | undefined;
}): HubSpotSyncPresentation {
  const { state, baselineSource } = args;

  if (state) {
    // Un fallo CON cambio pendiente no es «error de sincronización» a secas: el contacto está
    // en HubSpot y lo que falló fue enviar el cambio.
    if (state.status === 'failed') {
      return {
        label: hasPendingHubSpotPhoneChange(state)
          ? 'Error al actualizar'
          : HUBSPOT_SYNC_STATUS_LABELS.failed,
        tone: 'error',
      };
    }
    if (state.status === 'synced') {
      // La línea base manda sobre el `method`: antes de preguntarse CÓMO se sincronizó hay que
      // saber si consta que se sincronizara. Un backfill no tiene `method` y no lo inventa.
      if (baselineSource !== null) {
        return { label: HUBSPOT_SYNC_BASELINE_LABEL, tone: 'neutral' };
      }
      return {
        label:
          state.method === 'auto'
            ? 'Sincronizado automáticamente'
            : HUBSPOT_SYNC_STATUS_LABELS.synced,
        tone: 'synced',
      };
    }
    if (state.status === 'never_attempted') {
      return { label: HUBSPOT_SYNC_STATUS_LABELS.never_attempted, tone: 'neutral' };
    }
    return { label: HUBSPOT_SYNC_STATUS_LABELS[state.status], tone: 'pending' };
  }

  if (text(args.hubspotContactId)) {
    return { label: HUBSPOT_SYNC_UNKNOWN_STATE_LABEL, tone: 'neutral' };
  }
  return { label: HUBSPOT_SYNC_NOT_LINKED_LABEL, tone: 'neutral' };
}

// ── UNA sola autoridad para lo que la ficha OFRECE ──────────────

/**
 * AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX
 *
 * Qué ACCIÓN cabe ofrecer, en UN solo sitio. Es el hermano de
 * `resolveHubSpotSyncPresentation`: aquella decide lo que la ficha DICE, esta decide lo que la
 * ficha PERMITE PULSAR. Son dos preguntas distintas sobre el mismo estado durable y por eso son
 * dos funciones, pero comparten fuente: el label de los estados NO accionables lo devuelve la
 * autoridad de presentación, para que el badge y el botón no puedan contradecirse nunca.
 *
 * Existe porque hasta este microfix había TRES superficies deduciendo la respuesta a mano
 * —`contact-detail-sheet.tsx`, `contact-row-actions.tsx` y la página de detalle— y las tres con
 * la misma regla equivocada: «hay `hubspot_contact_id` ⇒ Sincronizado», con check verde y
 * deshabilitado. Un vínculo NO es una afirmación sobre la frescura de los campos, y la línea
 * base del backfill (`baseline_source = legacy_link_backfill`) es exactamente el caso en el que
 * el vínculo consta y la paridad NUNCA se observó. En una fila así, la MISMA tarjeta llegaba a
 * mostrar el badge neutro «Vinculado a HubSpot» al lado del botón verde «Sincronizado».
 *
 * `triggersNetwork` es el campo que hace la regla comprobable en vez de confiable: sólo tres
 * miembros lo tienen en `true`, y son los tres que el ejecutor sabe convertir en una petición.
 *
 * Por qué un vínculo sin paridad observada NO ofrece acción: el ejecutor, ante un vínculo sin
 * pendiente, cae en su rama C —`already_synced`, CERO escrituras y CERO red— o en su rama D,
 * que escribe `status: 'synced'` SIN haber llamado a HubSpot ni una vez. Habilitar el botón no
 * establecería paridad ninguna; en el caso de la rama D la EMPEORARÍA, porque ese `synced`
 * escrito a ciegas no lleva `baseline_source` y el badge pasaría de un neutro honesto a un
 * «Sincronizado» verde que nadie observó. La rama D queda, por tanto, inalcanzable desde la UI
 * A PROPÓSITO y declarado: repararla es trabajo de otro corte, no de este.
 */
export type HubSpotSyncActionKind =
  /** Hay pendiente que el PATCH sabe enviar. */
  | 'update'
  /** Hay pendiente y el último intento falló. */
  | 'retry_update'
  /** Sin vínculo: crear o vincular por email. */
  | 'sync'
  /** Sin vínculo y sin email: no hay nada que sincronizar. */
  | 'no_email'
  /** `synced` OBSERVADO y sin pendiente. El único caso que puede lucir check verde. */
  | 'observed_synced'
  /** Vínculo cuya paridad NUNCA se observó (línea base, estado ilegible, fallo sin pendiente). */
  | 'linked_no_parity';

export interface HubSpotSyncActionEligibility {
  kind: HubSpotSyncActionKind;
  /** `true` sólo si pulsar puede producir una petición a HubSpot. */
  triggersNetwork: boolean;
  /** Copy del control. En los dos estados no accionables lo dicta la autoridad de presentación. */
  label: string;
  /** Copy de apoyo cuando la ficha debe explicar por qué no ofrece nada. `null` si no aplica. */
  detail: string | null;
}

/** Por qué un vínculo de línea base no ofrece acción. Se dice, no se deja adivinar. */
export const HUBSPOT_SYNC_BASELINE_DETAIL =
  'El contacto está vinculado, pero no se verificó que los datos actuales coincidan con HubSpot.' as const;

/** Copy del control sin vínculo y sin email. */
export const HUBSPOT_SYNC_NO_EMAIL_LABEL = 'No se puede sincronizar' as const;
/** Copy del control sin vínculo. */
export const HUBSPOT_SYNC_ACTION_LABEL = 'Sincronizar con HubSpot' as const;
/** Copy del control con pendiente. */
export const HUBSPOT_SYNC_UPDATE_LABEL = 'Actualizar en HubSpot' as const;
/** Copy del control con pendiente tras un intento fallido. */
export const HUBSPOT_SYNC_RETRY_UPDATE_LABEL = 'Reintentar actualización' as const;

export function resolveHubSpotSyncAction(args: {
  state: HubSpotSyncState | null;
  baselineSource: HubSpotSyncBaselineSource | null;
  hubspotContactId: string | null | undefined;
  hasEmail: boolean;
}): HubSpotSyncActionEligibility {
  const { state, baselineSource, hubspotContactId, hasEmail } = args;

  // Lo PENDIENTE manda sobre lo vinculado, igual que en CUT-2: un contacto vinculado con un
  // cambio sin enviar NO está al día, y ofrecerle un control deshabilitado dejaría al humano
  // sin forma de enviar un cambio que sí tiene pendiente.
  if (hasPendingHubSpotPhoneChange(state)) {
    const retry = state?.status === 'failed';
    return {
      kind: retry ? 'retry_update' : 'update',
      triggersNetwork: true,
      label: retry ? HUBSPOT_SYNC_RETRY_UPDATE_LABEL : HUBSPOT_SYNC_UPDATE_LABEL,
      detail: null,
    };
  }

  // «Vinculado» es el vínculo durable O el estado que lo declara: las dos formas existen en
  // datos reales y preguntar sólo por una dejaría la otra deduciendo a mano en la superficie.
  const linked = text(hubspotContactId) !== null || state?.status === 'synced';

  if (linked) {
    const presentation = resolveHubSpotSyncPresentation({
      state,
      baselineSource,
      hubspotContactId,
    });

    // El ÚNICO caso con paridad observada: el estado dice `synced` y NO es una línea base
    // deducida. Hubo petición y hubo respuesta.
    if (state?.status === 'synced' && baselineSource === null) {
      return {
        kind: 'observed_synced',
        triggersNetwork: false,
        label: presentation.label,
        detail: null,
      };
    }

    return {
      kind: 'linked_no_parity',
      triggersNetwork: false,
      label: presentation.label,
      detail: baselineSource !== null ? HUBSPOT_SYNC_BASELINE_DETAIL : null,
    };
  }

  if (!hasEmail) {
    return {
      kind: 'no_email',
      triggersNetwork: false,
      label: HUBSPOT_SYNC_NO_EMAIL_LABEL,
      detail: 'No se puede sincronizar: el contacto no tiene email.',
    };
  }

  return {
    kind: 'sync',
    triggersNetwork: true,
    label: HUBSPOT_SYNC_ACTION_LABEL,
    detail: null,
  };
}
