/**
 * lusha-phone-fallback-phones.ts — Lectura COMPLETA de los teléfonos que Lusha ya
 * entregó en una respuesta exitosa (Agente 2A · AGENT2A-PHONE-REVEAL-4O-D).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * `/v3/contacts/enrich` con `reveal: ['phones']` responde
 * `results[0].phones[]`, un ARRAY. Hasta este hito el cliente lo reducía con
 * `extractFirstPhone()` — literalmente `phones[0]` — así que un teléfono `work`
 * en la posición 0 ganaba a un `mobile` en la posición 1, y el `mobile` se
 * perdía por completo. Ese número ya estaba pagado: perderlo al leerlo obliga a
 * pagar otra vez para recuperarlo, y además deja como teléfono visible el peor
 * de los dos.
 *
 * Este módulo sustituye esa reducción por la lectura completa del array. No
 * decide qué se persiste (eso es de la capa de captura) ni qué se cobra (el
 * costo lo reporta `billing.creditsCharged` POR RESPUESTA, nunca por número).
 *
 * ═══════════════════════════════════════════════════════════════════
 * PURO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Sin red, sin env, sin base de datos, sin reloj, sin `console`. Recibe el body
 * ya parseado y devuelve datos. Se puede probar offline y sin proveedor.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALCANCE — UNA SOLA FORMA DE PAYLOAD
 * ═══════════════════════════════════════════════════════════════════
 *
 * SOLO `results[0].phones[]`, que es la forma que produce el cliente del
 * fallback. La otra representación de teléfonos que existe en el repositorio
 * (`LushaPerson.phoneNumbers[]`, con `localizedNumber` / `countryCode`) pertenece
 * al search/enrich general y sigue PROHIBIDA para teléfonos: ese adaptador fuerza
 * `phone: null` y su cliente rechaza `reveal` con `'phones'` antes del fetch.
 * Este módulo no la conoce, no la importa y no la lee.
 *
 * `results[0]` y no todos los `results`: la petición manda exactamente UN id
 * (`ids: [contactId]`), así que hay una sola identidad solicitada, y el
 * clasificador de estado ya cerrado (`mapLushaPhoneRevealResponseToInternalStatus`)
 * cuenta también sobre `results[0].phones`. Leer más elementos haría que la
 * lista de teléfonos y el estado de la respuesta discrepasen sobre qué se
 * devolvió. LÍMITE DECLARADO: si Lusha llegara a responder varios `results` para
 * un único id solicitado, los adicionales no se leerían; hoy no hay evidencia de
 * que eso ocurra y fabricar el caso obligaría a inventar a qué persona pertenece
 * cada bloque.
 *
 * ═══════════════════════════════════════════════════════════════════
 * PRIVACIDAD
 * ═══════════════════════════════════════════════════════════════════
 *
 * Los números viajan en el valor de retorno, que va a la capa de captura y de ahí
 * al writer. Este módulo no registra nada: no hay ni un `console` y ningún error
 * se construye con un número.
 */

import type { PhoneType } from '@/server/agents/contact-enrichment-toolkit/phone-classification';

// ═══════════════════════════════════════════════════════════════════
// 1. Vocabulario de tipos
// ═══════════════════════════════════════════════════════════════════

/**
 * Mapa CERRADO de `phone.type` crudo → vocabulario interno `PhoneType`.
 *
 * Honestidad sobre su procedencia: Lusha no documenta la enumeración completa de
 * `type`, y la copy del fallback ya advierte al operador que Lusha no confirma el
 * tipo de teléfono. La lista recoge las formas cuyo significado es inequívoco.
 *
 * SESGO DELIBERADO, en una sola dirección: ningún token que no esté aquí se
 * promueve a `mobile`. Equivocarse llamando `other` a un móvil solo cuesta un
 * escalón de desempate; equivocarse llamando `mobile` a un conmutador pone el
 * número equivocado delante del comercial.
 *
 * `company` / `corporate` → `hq` y no `other`: es semánticamente la línea
 * principal de la empresa, y `hq` está POR DEBAJO de `work` en el ranking, así
 * que un `work` real sigue ganándole. No puede desplazar a un móvil ni a un
 * marcado directo.
 *
 * `home` NO añade un valor nuevo al vocabulario: cae en `other`, igual que en el
 * mapa del otro proveedor.
 */
const LUSHA_PHONE_TYPE_MAP: Record<string, PhoneType> = {
  // Móvil personal
  personal_mobile: 'personal_mobile',
  mobile_personal: 'personal_mobile',
  personal: 'personal_mobile',
  // Móvil
  mobile: 'mobile',
  cell: 'mobile',
  cellphone: 'mobile',
  cell_phone: 'mobile',
  // Marcado directo
  direct: 'direct_dial',
  direct_dial: 'direct_dial',
  direct_phone: 'direct_dial',
  // Trabajo
  work: 'work',
  work_phone: 'work',
  work_direct: 'work',
  office: 'work',
  landline: 'work',
  // Sede / conmutador
  hq: 'hq',
  headquarters: 'hq',
  main: 'hq',
  company: 'hq',
  company_phone: 'hq',
  corporate: 'hq',
  // Otros
  other: 'other',
  home: 'other',
  unknown: 'unknown',
};

/**
 * Normaliza un `phone.type` crudo de Lusha al vocabulario interno.
 *
 * DOS ausencias distintas, deliberadamente:
 *   * tipo AUSENTE o vacío        ⇒ `unknown` (no hay evidencia).
 *   * tipo PRESENTE no reconocido ⇒ `other`   (hay evidencia, no la entendemos).
 *
 * Esa distinción es el contrato que ya tenía el cliente del fallback y se
 * conserva byte a byte: `type: 'fax'` sigue siendo `other`, no `unknown`.
 */
export function mapLushaPhoneTypeToPhoneType(
  raw: string | null | undefined,
): PhoneType {
  if (typeof raw !== 'string') return 'unknown';
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return 'unknown';
  return LUSHA_PHONE_TYPE_MAP[key] ?? 'other';
}

// ═══════════════════════════════════════════════════════════════════
// 2. Extracción completa
// ═══════════════════════════════════════════════════════════════════

/** Un teléfono tal como Lusha lo entregó, con su tipo crudo intacto. */
export interface LushaRevealedPhone {
  /** Número no vacío. Una entrada sin número no llega a existir aquí. */
  number: string;
  /** `phone.type` CRUDO, tal cual. null si Lusha no lo mandó. */
  rawType: string | null;
  /** Tipo normalizado al vocabulario interno. */
  phoneType: PhoneType;
}

interface RawLushaPhoneFallbackPhonesBody {
  results?: Array<{ phones?: Array<{ number?: unknown; type?: unknown }> }>;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Devuelve TODOS los teléfonos utilizables de la respuesta, en el orden en que
 * Lusha los mandó.
 *
 * Qué garantiza:
 *   * ninguna entrada con número se pierde — no hay `[0]` en ninguna parte;
 *   * una entrada sin `number` utilizable se DESCARTA por completo: no produce
 *     teléfono, ni procedencia, ni ruido. No es un teléfono perdido, es un hueco
 *     del payload, y conservarla obligaría a inventar una identidad para algo que
 *     no tiene número;
 *   * el `type` crudo se conserva aunque no se reconozca;
 *   * los duplicados NO se tocan aquí. Deduplicar exige normalizar el número, y
 *     eso es trabajo de la capa canónica, que ya lo hace por `dedupe_key`. Este
 *     módulo entrega lo que llegó.
 *
 * El orden se preserva porque la capa de arriba lo necesita para nada decisivo:
 * la elección del principal canónico es independiente del orden por contrato.
 */
export function extractAllLushaPhones(
  body: unknown,
): readonly LushaRevealedPhone[] {
  if (body === null || typeof body !== 'object') return [];
  const raw = body as RawLushaPhoneFallbackPhonesBody;
  const firstResult = Array.isArray(raw.results) ? raw.results[0] : undefined;
  if (!firstResult || !Array.isArray(firstResult.phones)) return [];

  const out: LushaRevealedPhone[] = [];
  for (const entry of firstResult.phones) {
    if (entry === null || typeof entry !== 'object') continue;
    const number = cleanText(entry.number);
    if (!number) continue;
    const rawType = cleanText(entry.type);
    out.push({ number, rawType, phoneType: mapLushaPhoneTypeToPhoneType(rawType) });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 3. Teléfono escalar del cliente
// ═══════════════════════════════════════════════════════════════════

/**
 * Prioridad de tipo, IDÉNTICA a `PHONE_TYPE_PRIORITY` de
 * `phone-classification.ts` y a `CANDIDATE_PHONE_TYPE_RANKING` de
 * `phone-collection-core.ts`. Si las tres listas divergieran, el escalar que
 * publica el cliente y el principal que elige la capa canónica podrían señalar
 * teléfonos distintos.
 */
const LUSHA_PHONE_TYPE_RANKING: readonly PhoneType[] = [
  'personal_mobile',
  'mobile',
  'direct_dial',
  'work',
  'hq',
  'other',
  'unknown',
];

function phoneTypeRank(type: PhoneType): number {
  const index = LUSHA_PHONE_TYPE_RANKING.indexOf(type);
  return index === -1 ? LUSHA_PHONE_TYPE_RANKING.length : index;
}

/**
 * Elige el teléfono que el cliente publica como escalar (`phoneNumber` /
 * `phoneType` / `phoneRawType`).
 *
 * EL CAMBIO DE COMPORTAMIENTO DE ESTE HITO VIVE AQUÍ. Antes era `phones[0]`, así
 * que el orden del proveedor decidía. Ahora manda el ranking de tipo: un móvil
 * válido en la posición 1 gana a un `work` en la posición 0. Es la decisión de
 * producto vinculante — el móvil debe ser el principal — y es visible.
 *
 * DESEMPATE SIN ORDEN DE PAYLOAD: ante dos teléfonos del mismo tipo se toma el
 * menor por comparación de texto del número. Es arbitrario pero TOTAL y
 * determinista, y lo importante es lo que NO es: no es «el primero que mandó
 * Lusha». Si lo fuera, reordenar el array entre dos reintentos cambiaría el
 * teléfono visible del candidato sin que nadie hubiera pedido nada.
 *
 * Devuelve null solo si la lista está vacía.
 */
export function selectPrimaryLushaPhone(
  phones: readonly LushaRevealedPhone[],
): LushaRevealedPhone | null {
  if (phones.length === 0) return null;
  return [...phones].sort((a, b) => {
    const byType = phoneTypeRank(a.phoneType) - phoneTypeRank(b.phoneType);
    if (byType !== 0) return byType;
    return a.number < b.number ? -1 : a.number > b.number ? 1 : 0;
  })[0];
}
