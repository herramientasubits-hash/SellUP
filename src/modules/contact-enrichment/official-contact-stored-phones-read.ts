// Agente 2A — «Ver más números» del contacto OFICIAL: la LECTURA
// (AGENT2A-PHONE-REVEAL-4O-H4)
//
// Tres `SELECT` y nada más. Este archivo no tiene un `.insert()`, un `.update()`,
// un `.delete()`, un `.upsert()` ni un `.rpc()`, y un test estático lo verifica
// leyendo el fichero: la garantía «ver números almacenados no escribe nada» no se
// sostiene en la intención de quien lo escribió, sino en que no exista aquí la
// llamada que escribiría.
//
// ── POR QUÉ **NO** SERVICE ROLE ────────────────────────────────
//
// Ésta es la diferencia deliberada con 4O-G, y merece decirse entera.
//
// La migración 109 dejó las tablas del CANDIDATO accesibles sólo a `service_role`,
// así que la lectura de 4O-G no tenía más opción que el cliente admin y tuvo que
// comprobar el rol a mano en la capa de acción. La 114 hizo lo contrario a
// propósito: `contact_phones` y `contact_phone_sources` OTORGAN `SELECT` a
// `authenticated` bajo dos policies que exigen `has_active_access(auth.uid())` y
// que además encadenan la fila al contacto padre.
//
// Leer con el cliente de SESIÓN significa que quien decide qué filas devuelve la
// consulta es PostgreSQL, no este archivo. Es estrictamente más fuerte que un `if`
// en TypeScript: un bug aquí no puede filtrar filas que la policy no habría
// devuelto, porque la policy se evalúa igual. Usar el service role habría
// SALTADO ese control para volver a implementarlo peor, en otro lenguaje y en otro
// sitio.
//
// Consecuencia buscada: si la sesión no está activa, esto devuelve cero filas por
// construcción, no por cortesía.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// No imprime nada. Los errores que propaga describen la operación con una cadena
// fija; jamás llevan un número, ni una fila, ni el mensaje crudo del driver.

import { createClient } from '@/lib/supabase/server';
import type {
  StoredOfficialPhoneRow,
  StoredOfficialPhoneSourceRow,
} from './official-contact-stored-phones-core';

export const OFFICIAL_CONTACT_PHONES_TABLE = 'contact_phones';
export const OFFICIAL_CONTACT_PHONE_SOURCES_TABLE = 'contact_phone_sources';
export const OFFICIAL_CONTACTS_TABLE = 'contacts';

/**
 * Columnas leídas de la colección. Lista EXPLÍCITA y no `*`: `select('*')`
 * arrastraría al servidor toda columna que una migración futura añada, incluidas
 * `suppression_reason` y `suppressed_by`, y la proyección tendría que acordarse de
 * volver a quitarlas. Se pide lo que se usa.
 *
 * `suppressed_at` SÍ se pide —hace falta para descartar la fila— y se consume
 * dentro del núcleo puro; no forma parte de lo que se devuelve a la UI.
 */
const PHONE_COLUMNS =
  'id, normalized_phone, display_phone, dedupe_key, phone_type, phone_status, is_primary, last_seen_at, suppressed_at';

/**
 * Igual, para la procedencia. Aquí NO se piden `waterfall_run_id`,
 * `reservation_id`, `provider_usage_log_id`, `candidate_phone_id` ni
 * `source_event_key`: son punteros de auditoría y contabilidad que la pantalla no
 * usa, y lo más barato que se puede hacer con datos que no se necesitan es no
 * traerlos.
 */
const SOURCE_COLUMNS = 'contact_phone_id, provider, acquisition_mode, suppressed_at';

export interface StoredOfficialPhonesReadResult {
  readonly phones: readonly StoredOfficialPhoneRow[];
  readonly sources: readonly StoredOfficialPhoneSourceRow[];
  /**
   * El escalar que la ficha ya muestra, para no listarlo como adicional.
   * Se LEE; no se escribe ni se promueve aquí.
   */
  readonly visibleScalarPhones: readonly (string | null)[];
}

/**
 * Lee la colección viva del contacto y su procedencia viva.
 *
 * `suppressed_at IS NULL` se filtra ya en la consulta —en las DOS tablas, y además
 * en el núcleo— porque un tombstone no tiene ninguna razón para viajar hasta el
 * servidor siquiera. El filtro del núcleo sigue estando, y no es redundante: es el
 * que defiende la propiedad si alguien reescribe esta consulta.
 *
 * El filtro sobre la PROCEDENCIA no tiene equivalente en 4O-G y no es decorativo:
 * en la 114 una erasure por proveedor retira observaciones sin tumbar el número,
 * así que una fila viva puede tener procedencias muertas colgando. Traerlas
 * rotularía el número con el proveedor cuya observación acaba de retirarse.
 *
 * LANZA si cualquiera de las tres lecturas falla. No devuelve una colección vacía
 * ante un error: «no pudimos leer» y «no hay más números» son dos hechos distintos
 * y confundirlos le diría al operador que no existen números que sí existen.
 */
export async function readOfficialContactStoredPhones(
  contactId: string,
): Promise<StoredOfficialPhonesReadResult> {
  const supabase = await createClient();

  const { data: contact, error: contactError } = await supabase
    .from(OFFICIAL_CONTACTS_TABLE)
    .select('phone')
    .eq('id', contactId)
    .maybeSingle();
  if (contactError) {
    throw new Error('stored official phones: contact read failed');
  }

  // SÓLO el escalar principal.
  //
  // La ficha también pinta el escalar HEREDADO de móvil, y la tentación evidente es
  // leerlo aquí para no listar como «adicional» un número que ya está en pantalla.
  // No se hace, y la razón es una auditoría existente: 4O-E4.1 fijó por prueba
  // estática la lista EXACTA de archivos que pueden nombrar ese escalar, porque no
  // tiene columna de procedencia y cada consumidor nuevo invalida la premisa sobre
  // la que se apoya la erasure del móvil. Un hito de SÓLO LECTURA no es quien debe
  // gastar esa premisa; la convergencia del escalar heredado es de H5.
  //
  // Consecuencia aceptada y acotada: si una fila de la colección tuviera el MISMO
  // número que el móvil heredado, se listaría como adicional. Hoy no puede pasar
  // por construcción — la colección nace vacía, sin backfill (114), y sólo la puebla
  // la aprobación (116) promoviendo el escalar PRINCIPAL del candidato.
  const visibleScalarPhones: readonly (string | null)[] = [
    typeof contact?.phone === 'string' ? contact.phone : null,
  ];

  const { data: phoneRows, error: phonesError } = await supabase
    .from(OFFICIAL_CONTACT_PHONES_TABLE)
    .select(PHONE_COLUMNS)
    .eq('contact_id', contactId)
    .is('suppressed_at', null);
  if (phonesError) {
    throw new Error('stored official phones: collection read failed');
  }

  const phones = (phoneRows ?? []) as unknown as StoredOfficialPhoneRow[];
  if (phones.length === 0) {
    return { phones: [], sources: [], visibleScalarPhones };
  }

  const { data: sourceRows, error: sourcesError } = await supabase
    .from(OFFICIAL_CONTACT_PHONE_SOURCES_TABLE)
    .select(SOURCE_COLUMNS)
    .in(
      'contact_phone_id',
      phones.map((phone) => phone.id),
    )
    .is('suppressed_at', null);
  if (sourcesError) {
    throw new Error('stored official phones: provenance read failed');
  }

  return {
    phones,
    sources: (sourceRows ?? []) as unknown as StoredOfficialPhoneSourceRow[],
    visibleScalarPhones,
  };
}
