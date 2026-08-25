// Agente 2A — Las LECTURAS del reveal desde un contacto OFICIAL
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// `SELECT` y nada más. Este archivo no tiene un `.insert()`, un `.update()`, un `.delete()` ni
// un `.rpc()`, y una guarda estática lo verifica leyendo el fichero: la garantía «mirar si se
// puede ofrecer un reveal no escribe nada y no gasta nada» no se sostiene en la intención de
// quien lo escribió, sino en que la llamada que escribiría NO ESTÉ AQUÍ.
//
// ── POR QUÉ HAY DOS CLIENTES ───────────────────────────────────
//
// El CONTACTO se lee con el cliente de SESIÓN: `contacts` tiene RLS y una policy para
// `authenticated`, así que esa lectura es además el límite que impide preguntar por un contacto
// que el actor no puede ver. La COLECCIÓN DEL CANDIDATO se lee con service role porque la
// migración 109 revoca todo privilegio a `anon` y `authenticated`; es el mismo patrón que
// `candidate-stored-phones-read.ts` y `phone-reveal-waterfall-actions.ts` ya usan. Aquí NO se
// comprueba autorización —eso es trabajo del llamador, y hacerlo en dos sitios invita a que uno
// de los dos se relaje—, y por eso este módulo no exporta ninguna server action: no es
// invocable desde el navegador.
//
// No se debilita ninguna policy y no se concede nada nuevo: 109 y 114 ya otorgaron el SELECT
// que se ejerce.
//
// ── PRIVACIDAD ─────────────────────────────────────────────────
//
// El contacto se proyecta a lo mínimo que la decisión necesita, y de sus teléfonos sólo viaja
// la PRESENCIA (booleanos derivados aguas arriba) o un CONTEO. De la colección del candidato no
// se lee ni un número: sólo `COUNT(*)` de las filas vivas. No imprime nada.

import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export const OFFICIAL_CONTACTS_TABLE = 'contacts';
export const OFFICIAL_CONTACT_PHONES_TABLE = 'contact_phones';
export const CANDIDATE_PHONES_TABLE = 'contact_enrichment_candidate_phones';
export const CANDIDATES_TABLE = 'contact_enrichment_candidates';
export const CONTACT_ENRICHMENT_RUNS_TABLE = 'contact_enrichment_runs';

/**
 * Columnas del contacto. Lista EXPLÍCITA y no `*`: `select('*')` arrastraría toda columna que
 * una migración futura añada, incluidas las de teléfono que esta pantalla no debe traer al
 * servidor para decidir si ofrece un botón.
 */
const CONTACT_COLUMNS = 'id, account_id, archived_at, phone, mobile_phone, metadata';

/** Proyección mínima del contacto oficial para decidir la oferta. */
export interface OfficialContactRevealProjection {
  readonly id: string;
  readonly accountId: string | null;
  readonly archivedAt: string | null;
  readonly phone: string | null;
  readonly mobilePhone: string | null;
  readonly metadata: unknown;
}

/**
 * Lee el contacto con el cliente de SESIÓN. Devuelve `null` cuando no hay fila legible — que
 * cubre «no existe», «archivado fuera de alcance» y «el actor no puede verlo», tres cosas que
 * para esta decisión significan lo mismo: no se ofrece nada.
 *
 * LANZA si la lectura FALLA. «No pudimos leer» y «no hay contacto» son hechos distintos, y
 * colapsarlos convertiría una caída de base en la afirmación de que el contacto no existe.
 */
export async function readOfficialContactForReveal(
  contactId: string,
): Promise<OfficialContactRevealProjection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(OFFICIAL_CONTACTS_TABLE)
    .select(CONTACT_COLUMNS)
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw new Error('official contact read failed');
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: typeof row.id === 'string' ? row.id : contactId,
    accountId: typeof row.account_id === 'string' ? row.account_id : null,
    archivedAt: typeof row.archived_at === 'string' ? row.archived_at : null,
    phone: typeof row.phone === 'string' ? row.phone : null,
    mobilePhone: typeof row.mobile_phone === 'string' ? row.mobile_phone : null,
    metadata: row.metadata ?? null,
  };
}

/**
 * Cuántas filas VIVAS tiene la colección oficial del contacto. Un entero, nunca un número de
 * teléfono. `suppressed_at IS NULL` se filtra en la consulta: un tombstone no cuenta como
 * teléfono que el contacto tenga.
 */
export async function countLiveOfficialPhones(contactId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from(OFFICIAL_CONTACT_PHONES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contactId)
    .is('suppressed_at', null);
  if (error) throw new Error('official contact phone count failed');
  return typeof count === 'number' && count > 0 ? count : 0;
}

/**
 * Cuántas filas VIVAS tiene la colección del candidato fuente. Un entero, nunca un número.
 *
 * Es lo que distingue «hay algo ya pagado que el contacto no tiene» (§10) de «hay que comprar»:
 * la reutilización no puede ofrecerse por intención, sólo porque exista evidencia viva.
 */
export async function countLiveCandidatePhones(candidateId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { count, error } = await admin
    .from(CANDIDATE_PHONES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('candidate_id', candidateId)
    .is('suppressed_at', null);
  if (error) throw new Error('candidate phone count failed');
  return typeof count === 'number' && count > 0 ? count : 0;
}

/**
 * Los hechos del candidato que la PROMOCIÓN DEL ESCALAR necesita, y sólo esos.
 *
 * Alimentan `buildCandidateScalarFallback()` — EL builder, el mismo que usan la aprobación (116)
 * y el merge (117). Aquí no se invierte ninguna procedencia: se leen los tres campos y se
 * entregan.
 */
export interface CandidateScalarFactsForProjection {
  readonly candidateId: string;
  readonly phone: string | null;
  readonly phoneMetadata: { type?: unknown; source?: unknown; raw_type?: unknown } | null;
  readonly countryCode: string | null;
}

/**
 * Lee el escalar del candidato y su metadata de teléfono. Devuelve `null` cuando el candidato no
 * existe: la RPC volverá a comprobarlo bajo el lock, que es donde esa comprobación cuenta.
 */
export async function readCandidateScalarFactsForProjection(
  candidateId: string,
): Promise<CandidateScalarFactsForProjection | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(CANDIDATES_TABLE)
    .select('id, phone, enrichment_metadata, enrichment_run_id')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error('candidate scalar read failed');
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const meta =
    row.enrichment_metadata && typeof row.enrichment_metadata === 'object'
      ? (row.enrichment_metadata as Record<string, unknown>)
      : {};
  const phoneMeta =
    meta.phone && typeof meta.phone === 'object' && !Array.isArray(meta.phone)
      ? (meta.phone as { type?: unknown; source?: unknown; raw_type?: unknown })
      : null;

  // País del run: sólo alimenta la NORMALIZACIÓN del escalar. No fabrica prefijo — el
  // normalizador lo ignora para la clave — y su ausencia no impide nada.
  let countryCode: string | null = null;
  const runId = typeof row.enrichment_run_id === 'string' ? row.enrichment_run_id : null;
  if (runId) {
    const { data: run } = await admin
      .from(CONTACT_ENRICHMENT_RUNS_TABLE)
      .select('company_country_code')
      .eq('id', runId)
      .maybeSingle();
    const runRow = run as Record<string, unknown> | null;
    countryCode =
      runRow && typeof runRow.company_country_code === 'string'
        ? runRow.company_country_code
        : null;
  }

  return {
    candidateId,
    phone: typeof row.phone === 'string' ? row.phone : null,
    phoneMetadata: phoneMeta,
    countryCode,
  };
}
