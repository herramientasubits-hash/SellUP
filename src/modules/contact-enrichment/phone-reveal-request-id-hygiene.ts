/**
 * Higiene del id de correlación del phone reveal (Agente 2A ·
 * AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10).
 *
 * Problema que resuelve: `phone_reveal_request_id` y `phone_reveal_provider` son
 * dos columnas del MISMO desenlace, pero hasta ahora sólo Apollo escribía la
 * primera. Cuando Lusha cerraba el caso (fallback manual, 2ª pata del waterfall
 * o ruta `legacy_lusha_only`) su patch de persistencia no mencionaba el id, así
 * que la fila quedaba con `phone_reveal_provider = 'lusha'` y el id de correlación
 * del intento APOLLO ANTERIOR — un id que no corresponde al proveedor declarado y
 * que ninguna consulta puede interpretar correctamente.
 *
 * Este módulo es la ÚNICA fuente de la regla, para que las dos columnas no puedan
 * volver a discrepar según el camino. Es PURO: sin I/O, sin imports de servidor,
 * seguro en el bundle cliente.
 *
 * Lo que NO hace:
 *  - NO repara filas históricas (eso es un backfill, explícitamente fuera de
 *    alcance en este hito);
 *  - NO inventa ids;
 *  - NO copia ids desde metadata ambigua ni desde el intento de otro proveedor.
 *
 * Auditoría del intento Apollo previo: no se pierde al limpiar la columna. El id
 * HTTP con el que el recovery recupera un resultado Apollo se resuelve desde el
 * usage-log de START (`apollo_http_request_id`), no desde esta columna del
 * candidato — por eso limpiarla no rompe L1/L2/L3, que además sólo operan sobre
 * candidatos en vuelo (`requested`/`pending`), nunca sobre un desenlace Lusha ya
 * terminal.
 */

/**
 * Id de correlación a persistir junto a un desenlace de reveal.
 *
 * `null` significa explícitamente "este proveedor no entregó un id": es un valor
 * legítimo y esperado (Lusha resuelve de forma SÍNCRONA, sin webhook y sin id de
 * seguimiento), no una ausencia de dato que haya que rellenar con lo anterior.
 */
export type PhoneRevealRequestId = string | null;

/** Longitud máxima aceptada para un id de proveedor, por sanidad defensiva. */
const MAX_PROVIDER_REQUEST_ID_LENGTH = 256;

export interface ResolveFinalPhoneRevealRequestIdInput {
  /**
   * Proveedor que resolvió el caso — el MISMO valor que se persiste en
   * `phone_reveal_provider`. El id devuelto pertenece siempre a este proveedor.
   */
  readonly provider: 'apollo' | 'lusha';
  /**
   * Id que ESTE proveedor entregó en ESTA operación, si entregó alguno. No es el
   * id que ya estuviera en la fila: pasar el valor previo del candidato es
   * justamente el error que este módulo existe para impedir.
   *
   * Para Lusha hoy es siempre ausente: `enrichLushaContactPhonesForFallback`
   * responde de forma síncrona y su contrato no incluye ningún identificador de
   * seguimiento. El parámetro existe para que el contrato sea explícito y siga
   * siendo correcto si Lusha llegara a devolver uno.
   */
  readonly providerRequestId?: string | null;
}

/**
 * Resuelve el `phone_reveal_request_id` que corresponde a un desenlace terminal.
 *
 * Contrato:
 *  - Apollo con id válido → ese id;
 *  - Lusha con id válido  → ese id;
 *  - cualquier proveedor sin id (ausente, `null`, vacío, sólo espacios, no
 *    string, o absurdamente largo) → `null`.
 *
 * En ningún caso devuelve un id que no venga de `providerRequestId`, así que un
 * id Apollo anterior no puede sobrevivir a un desenlace Lusha: el resultado se
 * escribe siempre, y cuando es `null` LIMPIA la columna en vez de dejarla como
 * estaba.
 */
export function resolveFinalPhoneRevealRequestId(
  input: ResolveFinalPhoneRevealRequestIdInput,
): PhoneRevealRequestId {
  const raw = input.providerRequestId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_PROVIDER_REQUEST_ID_LENGTH) return null;
  return trimmed;
}
