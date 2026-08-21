// Agente 2A — «Ver más números»: la LECTURA (AGENT2A-PHONE-REVEAL-4O-G)
//
// Tres `SELECT` y nada más. Este archivo no tiene un `.insert()`, un `.update()`,
// un `.delete()` ni un `.rpc()`, y un test estático lo verifica leyendo el fichero:
// la garantía «ver números almacenados no escribe nada» no se sostiene en la
// intención de quien lo escribió, sino en que no exista aquí la llamada que
// escribiría.
//
// ── POR QUÉ SERVICE ROLE ───────────────────────────────────────
//
// La migración 109 crea las dos tablas con RLS activa y REVOCA todos los
// privilegios a `anon` y `authenticated`, dejando sólo `service_role`. El drawer
// no puede leerlas con el cliente de sesión como sí lee el candidato. Este módulo
// es el mismo patrón que `phone-reveal-waterfall-actions.ts` ya usa para
// `phone_reveal_waterfall_runs`: la lectura privilegiada vive detrás de una acción
// que ya autenticó y ya exigió rol. Aquí NO se comprueba autorización — eso es
// trabajo del llamador, y hacerlo en dos sitios invita a que uno de los dos se
// relaje. Por eso este módulo es `server-only` y no exporta ninguna server action:
// no exporta ninguna server action, así que no es invocable desde el navegador.
//
// No se debilita ninguna policy y no se concede nada nuevo: 109 ya otorgó SELECT a
// `service_role`, que es exactamente lo que se ejerce.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// No imprime nada. Los errores que propaga describen la operación con una cadena
// fija; jamás llevan un número, ni una fila, ni el mensaje crudo del driver.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type {
  StoredCandidatePhoneRow,
  StoredCandidatePhoneSourceRow,
} from './candidate-stored-phones-core';

export const CANDIDATE_PHONES_TABLE = 'contact_enrichment_candidate_phones';
export const CANDIDATE_PHONE_SOURCES_TABLE = 'contact_enrichment_candidate_phone_sources';
export const CANDIDATES_TABLE = 'contact_enrichment_candidates';

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

const SOURCE_COLUMNS = 'candidate_phone_id, provider, acquisition_mode';

export interface StoredCandidatePhonesReadResult {
  readonly phones: readonly StoredCandidatePhoneRow[];
  readonly sources: readonly StoredCandidatePhoneSourceRow[];
  /** El escalar que la pantalla ya muestra, para no listarlo como adicional. */
  readonly primaryScalarPhone: string | null;
}

/**
 * Lee la colección viva del candidato y su procedencia.
 *
 * `suppressed_at IS NULL` se filtra ya en la consulta —además de en el núcleo—
 * porque un tombstone no tiene ninguna razón para viajar hasta el servidor
 * siquiera: la fila suprimida no lleva número, pero sí lleva su razón y quién la
 * suprimió, y lo más barato que se puede hacer con datos que no se necesitan es
 * no traerlos. El filtro del núcleo sigue estando, y no es redundante: es el que
 * defiende la propiedad si alguien reescribe esta consulta.
 *
 * LANZA si cualquiera de las tres lecturas falla. No devuelve una colección vacía
 * ante un error: «no pudimos leer» y «no hay más números» son dos hechos distintos
 * y confundirlos le diría al operador que no existen números que sí existen.
 */
export async function readCandidateStoredPhones(
  candidateId: string,
): Promise<StoredCandidatePhonesReadResult> {
  const admin = createSupabaseAdminClient();

  const { data: candidate, error: candidateError } = await admin
    .from(CANDIDATES_TABLE)
    .select('phone')
    .eq('id', candidateId)
    .maybeSingle();
  if (candidateError) {
    throw new Error('stored candidate phones: candidate read failed');
  }

  const { data: phoneRows, error: phonesError } = await admin
    .from(CANDIDATE_PHONES_TABLE)
    .select(PHONE_COLUMNS)
    .eq('candidate_id', candidateId)
    .is('suppressed_at', null);
  if (phonesError) {
    throw new Error('stored candidate phones: collection read failed');
  }

  const phones = (phoneRows ?? []) as unknown as StoredCandidatePhoneRow[];
  if (phones.length === 0) {
    return {
      phones: [],
      sources: [],
      primaryScalarPhone:
        typeof candidate?.phone === 'string' ? candidate.phone : null,
    };
  }

  const { data: sourceRows, error: sourcesError } = await admin
    .from(CANDIDATE_PHONE_SOURCES_TABLE)
    .select(SOURCE_COLUMNS)
    .in(
      'candidate_phone_id',
      phones.map((phone) => phone.id),
    );
  if (sourcesError) {
    throw new Error('stored candidate phones: provenance read failed');
  }

  return {
    phones,
    sources: (sourceRows ?? []) as unknown as StoredCandidatePhoneSourceRow[],
    primaryScalarPhone: typeof candidate?.phone === 'string' ? candidate.phone : null,
  };
}
