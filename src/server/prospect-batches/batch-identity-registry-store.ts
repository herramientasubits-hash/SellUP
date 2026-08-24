/**
 * AGENT1-CUT3B23 · CUT-3B3 — siembra del registro de identidad de lote.
 *
 * Único punto que LEE base de datos para el registro. El registro en sí
 * (`prospecting-toolkit/batch-identity-registry`) es puro; separar la lectura
 * es lo que permite probar toda la semántica de decisión sin Supabase.
 *
 * Lee EXCLUSIVAMENTE las filas del lote indicado, y sólo las que ocupan el lote
 * (`BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES`). No hay lectura histórica ni
 * entre lotes: eso es la memoria de novedad global, que es de otra capa.
 *
 * Degrada CERRADO en el sentido correcto para la admisión: si la lectura falla,
 * la siembra queda vacía y el escritor ADMITE (falso negativo de deduplicación),
 * nunca suprime un candidato legítimo por una consulta caída. Un fallo de
 * consulta no puede convertirse en «este candidato ya existía».
 *
 * ── AGENT1-CUT3B4 — la foto tiene que ser COHERENTE ──────────────────────────
 *
 * Desde el vallado optimista, una siembra no vale por sí sola: vale junto a la
 * ÉPOCA contra la que se decidió. Y leer las dos por separado puede producir una
 * foto imposible. El orden peligroso es concreto:
 *
 *     se leen las FILAS en el estado E
 *     otro escritor inserta y avanza a E+1
 *     se lee la ÉPOCA como E+1
 *
 * La decisión se tomaría contra las filas de E declarando la época E+1, y el
 * vallado la ACEPTARÍA porque la época coincide: exactamente la carrera que este
 * corte cierra, reintroducida por la puerta de la lectura.
 *
 * Por eso, cuando la migración 126 está aplicada, filas y época llegan de UNA
 * sola sentencia (`read_batch_identity_snapshot`), que ve UNA sola foto. El orden
 * inverso —leer una foto MÁS NUEVA de la que la época declara— es inofensivo: el
 * vallado devolvería `stale` y se reintenta.
 *
 * 🔴 Con la 126 SIN aplicar, la función no existe, `epoch` es `null` y el
 * comportamiento es EXACTAMENTE el anterior a B4 (dos consultas, sin vallado). No
 * es un flag ni una preferencia: lo decide el esquema.
 *
 * 🔴 Y sólo lo decide el ESQUEMA. Un cliente sin método `rpc`, una lectura que se
 * cae o un lote que no se ve NO son prueba de que la 126 falte: degradan CERRADO
 * (`epoch: null`, `fenceCapabilityAbsent: false`) y el bucle vallado se niega a
 * escribir. Antes de la corrección de este corte, la ausencia de `.rpc` en el
 * objeto cliente se contaba como prueba de esquema y abría una escritura sin
 * valla.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
  createBatchIdentityRegistry,
  seedBatchIdentityRegistry,
  type BatchIdentityRegistry,
  type RegisteredBatchIdentity,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import {
  buildCompanyIdentityEvidence,
  buildProviderEntityKey,
} from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import {
  BATCH_IDENTITY_SNAPSHOT_RPC,
  isMissingFenceCapabilityError,
} from './batch-identity-fence';

/**
 * Columnas leídas. Todas existen desde las migraciones 040/045: este corte NO
 * añade ninguna (MIGRATION_CREATED = NO).
 *
 * 🔴 `linkedin_url` se deja FUERA del `select` a propósito: la columna puede no
 * existir en un entorno donde su migración no se haya aplicado —`candidate-writer`
 * ya arrastra un reintento para ese caso exacto— y una consulta que la pida
 * fallaría entera, dejando la siembra vacía por una columna opcional. El
 * LinkedIn se recupera de la metadata, que es donde los tres escritores lo
 * escriben de todos modos.
 */
const SEED_COLUMNS =
  'id, name, domain, website, country_code, tax_id, tax_identifier, status, metadata, source_trace';

export type BatchIdentitySeedRow = {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  tax_id: string | null;
  tax_identifier: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  source_trace: Record<string, unknown> | null;
};

export type BatchIdentitySeedOutcome = {
  registry: BatchIdentityRegistry;
  /** Filas realmente sembradas. */
  seededCount: number;
  /** `true` cuando la lectura falló o degradó: la cobertura es MENOR, no mayor. */
  degraded: boolean;
  /**
   * AGENT1-CUT3B4 — la época contra la que se sembró esta foto.
   *
   * `null` significa «no se pudo establecer una época coherente». NO significa
   * «la migración 126 no está aplicada»: para eso está `fenceCapabilityAbsent`, y
   * confundir las dos cosas era exactamente el defecto que la corrección de este
   * corte cierra. `null` NUNCA se trata como la época 0 tampoco: confundir «no lo
   * sé» con «cero» habría hecho pasar por vallada una escritura que no lo está.
   */
  epoch: number | null;
  /**
   * `true` SÓLO cuando la BASE probó que la 126 no está aplicada (42883 /
   * PGRST202). Distinto de `degraded`, y nunca deducible de la forma del cliente.
   *
   * 🔴 Con `degraded: true` a la vez, esta bandera NO autoriza la ruta anterior a
   * B4: la autorización exige `epoch === null` Y `fenceCapabilityAbsent === true`
   * Y `degraded === false`, y esa conjunción vive en
   * `isProvenFenceCapabilityAbsent`.
   */
  fenceCapabilityAbsent: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * LinkedIn de empresa tal como los tres escritores lo dejan en metadata:
 * la ruta canónica `linkedin_enrichment.company_url` y la plana `linkedin_url`
 * que las filas antiguas conservan. `normalizeLinkedinUrl` (dentro del
 * constructor de evidencia) rechaza después cualquier perfil personal.
 */
function readLinkedInFromMetadata(metadata: Record<string, unknown> | null): string | null {
  const enrichment = asRecord(metadata?.['linkedin_enrichment']);
  return readString(enrichment, 'company_url') ?? readString(metadata, 'linkedin_url');
}

/**
 * Identidad nativa del proveedor de una fila persistida.
 *
 * Se compone SÓLO cuando `source_trace` trae proveedor E id de empresa del
 * proveedor. Hoy eso ocurre en la ruta Lusha (`providerCompanyId`). Ninguna otra
 * ruta lo escribe, y no se inventa: sin las dos partes la clave es `null`.
 */
function readProviderEntityKey(sourceTrace: Record<string, unknown> | null): string | null {
  return buildProviderEntityKey({
    providerKey: readString(sourceTrace, 'sourceProvider'),
    providerEntityId: readString(sourceTrace, 'providerCompanyId'),
  });
}

/** Convierte una fila persistida en identidad registrada. Puro. */
export function toRegisteredBatchIdentity(row: BatchIdentitySeedRow): RegisteredBatchIdentity {
  const metadata = asRecord(row.metadata);
  const sourceTrace = asRecord(row.source_trace);
  return {
    candidateId: row.id,
    evidence: buildCompanyIdentityEvidence({
      countryCode: row.country_code,
      taxId: row.tax_id,
      taxIdentifier: row.tax_identifier,
      domain: row.domain,
      website: row.website,
      linkedinUrl: readLinkedInFromMetadata(metadata),
      providerKey: readString(sourceTrace, 'sourceProvider'),
      providerEntityId: readString(sourceTrace, 'providerCompanyId'),
      // 🔴 El nombre se siembra igual que las demás señales, y su ausencia era un
      // agujero silencioso: `SEED_COLUMNS` ya lo leía, pero no llegaba al
      // constructor, así que una fila PERSISTIDA entraba al registro sin nombre
      // canónico y la coincidencia por nombre no podía ni marcarse. Sigue siendo
      // evidencia DÉBIL: TIER 5 nunca suprime, sólo produce `possible_duplicate`.
      name: row.name,
    }),
  };
}

/** Expuesto para las guardas: la clave de proveedor de una fila persistida. */
export function providerEntityKeyForSeedRow(row: BatchIdentitySeedRow): string | null {
  return readProviderEntityKey(asRecord(row.source_trace));
}

/**
 * Convierte la carga útil de `read_batch_identity_snapshot` en filas de siembra.
 *
 * Puro y tolerante: una entrada ilegible se descarta —cubrir MENOS es el sentido
 * correcto de la degradación aquí—, pero una carga útil que no es objeto devuelve
 * `null` para que el llamador sepa que la foto no sirve y no la confunda con un
 * lote vacío.
 */
export function parseBatchIdentitySnapshotPayload(
  payload: unknown,
): { rows: BatchIdentitySeedRow[]; epoch: number | null } | null {
  const record = asRecord(payload);
  if (!record) return null;

  const rawEpoch = record['identity_epoch'];
  const epoch =
    typeof rawEpoch === 'number' && Number.isFinite(rawEpoch)
      ? Math.trunc(rawEpoch)
      : // PostgREST serializa `bigint` como cadena. Leerlo sólo como número dejaba
        // la época en `null` y desactivaba el vallado en silencio.
        typeof rawEpoch === 'string' && /^-?\d+$/.test(rawEpoch)
        ? Number.parseInt(rawEpoch, 10)
        : null;

  const rawRows = record['rows'];
  const rows = Array.isArray(rawRows)
    ? rawRows
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((entry) => entry as unknown as BatchIdentitySeedRow)
    : [];

  return { rows, epoch };
}

/**
 * Construye y siembra el registro de identidad de UN lote, junto a la ÉPOCA
 * contra la que esa siembra es válida.
 *
 * `batchId` nulo ⇒ registro vacío sin consulta: un lote que aún no existe no
 * puede contener nada, y tampoco tiene época.
 *
 * Dos caminos, y el esquema decide cuál:
 *
 *   1. La 126 aplicada ⇒ UNA sentencia devuelve filas y época del MISMO estado.
 *   2. La 126 sin aplicar ⇒ se conserva la consulta anterior a B4, `epoch` queda
 *      en `null` y el escritor NO valla. Ni mejor ni peor que hoy.
 */
export async function loadBatchIdentityRegistry(
  client: SupabaseClient,
  batchId: string | null,
): Promise<BatchIdentitySeedOutcome> {
  const registry = createBatchIdentityRegistry(batchId);
  if (!batchId) {
    return {
      registry,
      seededCount: 0,
      degraded: false,
      epoch: null,
      fenceCapabilityAbsent: false,
    };
  }

  // ── 0. Un cliente sin `rpc` NO es prueba de esquema ────────────────────────
  //
  // 🔴 CUT-3B4-CORRECCIÓN. Antes, un cliente sin método `rpc` se clasificaba como
  // `fenceCapabilityAbsent: true` —es decir, como PRUEBA de que la migración 126
  // no está aplicada— y eso habilitaba la ruta anterior a B4, una escritura SIN
  // valla, a partir de la FORMA de un objeto de JavaScript. La forma de un cliente
  // no puede decir nada sobre el esquema de la base: en producción `.rpc` es parte
  // del contrato del cliente de Supabase, así que su ausencia sólo puede venir de
  // un doble o de un cliente no soportado.
  //
  // Degrada CERRADO: sin época, sin siembra y SIN prueba de ausencia, de modo que
  // el bucle vallado no puede caer a la ruta legada. Las pruebas que quieran
  // modelar «la 126 no está aplicada» inyectan un `rpc` que responda PGRST202 /
  // 42883, que es lo que diría la base de verdad.
  const canCallRpc = typeof (client as { rpc?: unknown }).rpc === 'function';
  if (!canCallRpc) {
    return {
      registry,
      seededCount: 0,
      degraded: true,
      epoch: null,
      fenceCapabilityAbsent: false,
    };
  }

  // ── 1. Foto coherente (filas + época) en UNA sentencia ─────────────────────
  try {
    const { data, error } = await client.rpc(BATCH_IDENTITY_SNAPSHOT_RPC, {
      p_batch_id: batchId,
      // 🔴 Los estados que OCUPAN el lote viajan como PARÁMETRO. La lista no se
      // escribe en SQL a propósito: es política de admisión y su única autoridad
      // es `batch-identity-registry`. Codificarla también en la migración habría
      // creado dos vocabularios que divergen en la primera corrección.
      p_blocking_statuses: [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES],
    });

    if (!error) {
      const parsed = parseBatchIdentitySnapshotPayload(data);
      if (parsed) {
        const seeds = parsed.rows.map(toRegisteredBatchIdentity);
        return {
          registry: seedBatchIdentityRegistry(registry, seeds),
          seededCount: seeds.length,
          degraded: false,
          epoch: parsed.epoch,
          fenceCapabilityAbsent: false,
        };
      }
      // El lote no existe (la función devuelve NULL): sin filas y sin época.
      return {
        registry,
        seededCount: 0,
        degraded: true,
        epoch: null,
        fenceCapabilityAbsent: false,
      };
    }

    if (!isMissingFenceCapabilityError(error)) {
      // Un fallo REAL de lectura degrada la COBERTURA, nunca al revés, y deja la
      // época en `null` para que nadie valle contra una foto que no se leyó.
      return {
        registry,
        seededCount: 0,
        degraded: true,
        epoch: null,
        fenceCapabilityAbsent: false,
      };
    }
  } catch (err) {
    if (!isMissingFenceCapabilityError(err)) {
      return {
        registry,
        seededCount: 0,
        degraded: true,
        epoch: null,
        fenceCapabilityAbsent: false,
      };
    }
  }

  // ── 2. La 126 no está aplicada — ruta EXACTA anterior a B4 ─────────────────
  //
  // Sólo se llega aquí porque la BASE lo dijo: `isMissingFenceCapabilityError`
  // reconoció 42883 / PGRST202 sobre la propia RPC. Cualquier otro desenlace ya
  // volvió arriba con `fenceCapabilityAbsent: false`.
  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .select(SEED_COLUMNS)
      .eq('batch_id', batchId)
      .in('status', [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES]);

    if (error || !Array.isArray(data)) {
      return {
        registry,
        seededCount: 0,
        degraded: true,
        epoch: null,
        fenceCapabilityAbsent: true,
      };
    }

    const seeds = (data as unknown as BatchIdentitySeedRow[]).map(toRegisteredBatchIdentity);
    return {
      registry: seedBatchIdentityRegistry(registry, seeds),
      seededCount: seeds.length,
      degraded: false,
      epoch: null,
      fenceCapabilityAbsent: true,
    };
  } catch {
    return {
      registry,
      seededCount: 0,
      degraded: true,
      epoch: null,
      fenceCapabilityAbsent: true,
    };
  }
}
