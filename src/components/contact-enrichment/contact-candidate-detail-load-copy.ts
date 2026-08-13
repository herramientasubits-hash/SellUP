/**
 * Copy de los estados de NO-DATO del drawer de detalle de candidato
 * (AGENT2A-PROD-INCIDENT — candidate detail).
 *
 * Incidente de Producción: al abrir un candidato, el drawer mostraba
 * «Candidato no disponible» / «No fue posible cargar el detalle del candidato.».
 *
 * El defecto de diagnóstico: el cargador tenía UN solo estado (`notFound`) para
 * dos hechos distintos, y un `catch {}` vacío que descartaba el error. Así, «este
 * candidato ya salió de `pending_review`» (esperado, informativo) y «la lectura
 * falló» (un fallo real que hay que arreglar) se leían EXACTAMENTE igual en
 * pantalla y no dejaban ni un rastro. Con el error tirado, la causa raíz no se
 * puede sacar de Producción.
 *
 * Ahora son dos estados con dos textos. Ninguno expone stack, SQL, respuesta de
 * proveedor, identificadores internos ni datos personales.
 */

/** Título del drawer cuando el candidato ya no está en revisión. */
export const CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY = 'Candidato no disponible';

/**
 * Cuerpo del caso ESPERADO: la lectura funcionó y el candidato ya no está en
 * `pending_review` (lo aprobó o lo descartó alguien, o quedó terminal). No es un
 * error: no invita a reintentar, explica.
 */
export const CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY =
  'Este candidato ya no está en revisión. Puede que alguien lo haya aprobado o descartado.';

/** Título del drawer cuando la lectura del detalle falló. */
export const CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY = 'No se pudo cargar el candidato';

/**
 * Cuerpo del caso de FALLO: la lectura no se pudo completar. Accionable, porque
 * reintentar es lo que corresponde, y honesto: no afirma que el candidato no
 * exista, que es justo lo que hacía el copy anterior.
 */
export const CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY =
  'No fue posible cargar el detalle del candidato. Intenta nuevamente.';

/**
 * Resultado de cargar el detalle. `null` ⇒ hay candidato (o sigue cargando).
 * Se mantiene deliberadamente cerrado a estos dos casos: son los únicos que el
 * cargador puede distinguir hoy sin inventar taxonomía que el servidor no da.
 */
export type CandidateDetailLoadOutcome = 'not_found' | 'load_error';
