/**
 * Verificación de la migración 123 contra un PostgreSQL REAL y efímero
 * (Agente 1 · AGENT1-PROVIDER-SEEN-MEMORY-2)
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué la suite estática no basta)
 * ═══════════════════════════════════════════════════════════════════
 *
 * La afirmación central de este hito es de IDENTIDAD: qué cuenta como «la misma
 * empresa» para la memoria de lo que ya pagamos. Esa afirmación no vive en TypeScript
 * —vive en DOS índices únicos PARCIALES y en un `ON CONFLICT ... DO UPDATE` con mezcla
 * ordenada— y no se puede comprobar leyendo SQL. Hay que insertar el duplicado y ver si
 * PostgreSQL lo acepta.
 *
 * Los cinco casos que la dueña pidió resolver ANTES de congelar el esquema se prueban
 * aquí, con el nombre del caso en el título, y cada uno tiene una respuesta que también
 * es una decisión de diseño:
 *
 *   A. dominio suelto y después id+dominio  ⇒ DOS filas. Fusionarlas exigiría afirmar
 *      que un dominio identifica una entidad, que es exactamente lo que el caso C
 *      prohíbe. No se pierde nada: la memoria une las dos señales en conjuntos
 *      independientes y un acierto por cualquiera de ellas vale.
 *   B. mismo id, dominio nuevo              ⇒ UNA fila, `first_seen_*` intacto y el
 *      dominio AVANZA. Conservar el primero para siempre haría que la fila afirmara un
 *      emparejamiento que el proveedor dejó de emitir mientras `last_seen_at` la
 *      presenta como fresca.
 *   C. ids distintos, dominio compartido    ⇒ DOS filas. Una unicidad global por
 *      dominio colapsaría entidades legítimamente distintas —un grupo y su filial— y la
 *      memoria diría «ya la vi» de una empresa que nunca vio.
 *   D. id solo y después id+dominio         ⇒ UNA fila, el dominio se COMPLETA.
 *   E. la misma observación dos veces a la vez ⇒ UNA fila, sin excepción visible.
 *
 * Y una segunda mitad que ninguna suite de TypeScript alcanza: que la 123 APLIQUE
 * (cinco `COMMENT ON` y una función `plpgsql` con dolar-quoting anidado son justo la
 * superficie donde un lexer de comillas pasa y PostgreSQL falla con 42601), que los
 * GRANT dejen el estado esperado —se responde con `has_table_privilege`, no con
 * `information_schema`: Supabase concede los 8 privilegios por DEFAULT PRIVILEGES y
 * `GRANT` sólo SUMA—, y que la reaplicación no cambie ni una fila.
 *
 * DATOS SINTÉTICOS. Ni una fila viene de Producción. No hay teléfono, ni email, ni
 * nombre de persona: la tabla no tiene dónde ponerlos, y eso es parte de lo que se
 * comprueba.
 *
 * En local se SALTA con motivo explícito si falta el arnés. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:a1-provider-seen-memory:postgres
 *
 * No llama a Lusha, ni a Apollo, ni a Tavily, ni a HubSpot; no lee un flag; no toca
 * Producción ni ninguna base remota; no gasta un crédito.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyProviderSeenMigration,
  bootstrapPlatform,
  PROVIDER_SEEN_MIGRATION,
  resolveEmbeddedPostgres,
  type EmbeddedPostgresLike,
  type PgLikeClient,
} from './support/provider-seen-real-migration';

import { collectProviderSeenObservations } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { createInMemoryProviderSeenStore } from '../provider-seen-store';
import { createSupabaseProviderSeenStore } from '../provider-seen-supabase-store';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → provider-seen → prospect-batches → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..');

const { ctor: EmbeddedPostgresCtor, skip: harnessSkipReason } = resolveEmbeddedPostgres(
  import.meta.url,
);

const TABLE = 'public.provider_seen_entities';

const T0 = '2026-08-19T10:00:00.000Z';
const T1 = '2026-08-20T10:00:00.000Z';
const T2 = '2026-08-21T10:00:00.000Z';

type Row = {
  id: string;
  provider: string;
  provider_entity_type: string;
  provider_entity_id: string | null;
  normalized_domain: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  first_seen_correlation: string | null;
  last_seen_correlation: string | null;
};

let dataDir: string;
let postgres: EmbeddedPostgresLike;
let client: PgLikeClient;

type Observation = {
  provider?: string;
  entity_type?: string;
  provider_entity_id?: string | null;
  normalized_domain?: string | null;
};

/** Llama a la función REAL de la migración. Nunca se reescribe el SQL en el test. */
async function record(
  observations: readonly Observation[],
  correlation: string | null,
  observedAt: string,
  conn: PgLikeClient = client,
): Promise<Record<string, number>> {
  const { rows } = await conn.query(
    'SELECT public.record_provider_seen_entities($1::jsonb, $2, $3::timestamptz) AS result',
    [JSON.stringify(observations), correlation, observedAt],
  );
  return rows[0]!.result as Record<string, number>;
}

async function rows(conn: PgLikeClient = client): Promise<Row[]> {
  const { rows: found } = await conn.query(
    `SELECT * FROM ${TABLE} ORDER BY first_seen_at, provider, provider_entity_id NULLS LAST, normalized_domain`,
  );
  return found as unknown as Row[];
}

async function reset(): Promise<void> {
  // TRUNCATE lo ejecuta el DUEÑO de la tabla (postgres), no `service_role`, a quien la
  // migración deliberadamente no le concede ni DELETE ni TRUNCATE.
  await client.query(`TRUNCATE ${TABLE}`);
}

/** El SQLSTATE de un fallo, para poder afirmar CUÁL constraint rechazó, no sólo que falló. */
async function expectFailure(sql: string, values?: unknown[]): Promise<string> {
  try {
    await client.query(sql, values);
  } catch (err) {
    return (err as { code?: string }).code ?? 'sin SQLSTATE';
  }
  assert.fail(`se esperaba un fallo y la sentencia pasó: ${sql}`);
}

describe('123 — memoria provider-seen contra PostgreSQL real', { skip: harnessSkipReason }, () => {
  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'pg-provider-seen-'));
    postgres = new EmbeddedPostgresCtor!({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: 54529 + Math.floor(process.pid % 100),
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    client = postgres.getPgClient();
    await client.connect();
    await bootstrapPlatform(client);
    await applyProviderSeenMigration(client, repoRoot);
  });

  after(async () => {
    try {
      await client?.end();
    } finally {
      await postgres?.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // ── § 1. Que aplique, y que aplicarla dos veces no cambie nada ──────────────

  describe('§ 1 — aplicabilidad e idempotencia', () => {
    it('la migración vuelve a aplicar sobre su propio resultado sin tocar filas', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'v1.idem', normalized_domain: null }], 'run-idem', T1);
      const before = await rows();

      await applyProviderSeenMigration(client, repoRoot, PROVIDER_SEEN_MIGRATION);

      const after = await rows();
      assert.equal(after.length, 1, 'no hay backfill: la migración no inventa filas');
      assert.deepEqual(after[0]!.id, before[0]!.id, 'ni reescribe las existentes');
    });
  });

  // ── § 2. Los cinco casos de identidad ──────────────────────────────────────

  describe('§ 2 — semántica de identidad (casos A–E)', () => {
    it('CASO A — dominio suelto y después id+dominio ⇒ DOS filas, ninguna se pierde', async () => {
      await reset();
      const first = await record(
        [{ provider: 'lusha', provider_entity_id: null, normalized_domain: 'acme.com' }],
        'run-1',
        T1,
      );
      assert.equal(first.new_domains_recorded, 1);
      assert.equal(first.new_ids_recorded, 0, 'no había id que estrenar');

      const second = await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'acme.com' }],
        'run-2',
        T2,
      );
      assert.equal(second.new_ids_recorded, 1, 'el id es nuevo');
      assert.equal(
        second.new_domains_recorded,
        0,
        'el dominio NO es nuevo: ya lo conocíamos por la fila suelta',
      );
      assert.equal(second.refreshed_count, 0, 'no refrescó nada: es una identidad distinta');

      const found = await rows();
      assert.equal(found.length, 2, 'dos filas: no se afirma que el dominio identifique la entidad');
      assert.deepEqual(
        found.map((r) => [r.provider_entity_id, r.normalized_domain]),
        [
          [null, 'acme.com'],
          ['id-123', 'acme.com'],
        ],
      );
      // 🔴 Lo que importa aguas abajo: las dos señales siguen disponibles, así que un
      // acierto por id o por dominio vale igual. Nada quedó inalcanzable.
      assert.equal(found[0]!.first_seen_correlation, 'run-1');
      assert.equal(found[1]!.first_seen_correlation, 'run-2');
    });

    it('CASO B — mismo id con dominio NUEVO ⇒ UNA fila, origen intacto y dominio avanzado', async () => {
      await reset();
      await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'old.com' }],
        'run-1',
        T1,
      );
      const second = await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'new.com' }],
        'run-2',
        T2,
      );

      assert.equal(second.refreshed_count, 1, 'la ventana se extiende, no se duplica');
      assert.equal(second.new_ids_recorded, 0, 'el id ya lo conocíamos');
      assert.equal(second.new_domains_recorded, 1, 'el dominio sí es nuevo');

      const found = await rows();
      assert.equal(found.length, 1);
      assert.equal(found[0]!.first_seen_at.toISOString(), T1, 'first_seen_at NO se reescribe');
      assert.equal(found[0]!.first_seen_correlation, 'run-1', 'ni su correlación');
      assert.equal(found[0]!.last_seen_at.toISOString(), T2, 'last_seen_at avanza');
      assert.equal(found[0]!.last_seen_correlation, 'run-2', 'y su correlación le sigue');
      assert.equal(
        found[0]!.normalized_domain,
        'new.com',
        'el dominio es el que el proveedor emite AHORA, no el que dejó de emitir',
      );
    });

    it('CASO B (fuera de orden) — el resultado depende del CONJUNTO de escrituras, no del orden', async () => {
      // Dos escrituras iguales aplicadas en los dos órdenes posibles tienen que dejar la
      // MISMA fila. Con un last-write-wins simple no la dejarían: convergería a la que
      // llegara segunda, así que dos escritores concurrentes producirían filas distintas
      // según cómo los planificara el servidor.
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-9', normalized_domain: 'nuevo.com' }], 'run-nuevo', T2);
      await record([{ provider: 'lusha', provider_entity_id: 'id-9', normalized_domain: 'viejo.com' }], 'run-viejo', T1);
      const ascending = (await rows())[0]!;

      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-9', normalized_domain: 'viejo.com' }], 'run-viejo', T1);
      await record([{ provider: 'lusha', provider_entity_id: 'id-9', normalized_domain: 'nuevo.com' }], 'run-nuevo', T2);
      const descending = (await rows())[0]!;

      assert.equal(ascending.last_seen_at.toISOString(), T2);
      assert.equal(ascending.last_seen_correlation, 'run-nuevo');
      assert.equal(ascending.normalized_domain, 'nuevo.com');

      assert.equal(descending.last_seen_at.toISOString(), T2);
      assert.equal(descending.last_seen_correlation, 'run-nuevo');
      assert.equal(descending.normalized_domain, 'nuevo.com');

      // El origen sí depende de cuál llegó primero, y tiene que ser así: `first_seen_at`
      // es «la primera escritura que procesamos», no «el instante más antiguo que existió».
      assert.equal(ascending.first_seen_at.toISOString(), T2);
      assert.equal(descending.first_seen_at.toISOString(), T1);
    });

    it('CASO C — ids nativos DISTINTOS con dominio compartido ⇒ DOS filas', async () => {
      await reset();
      await record(
        [
          { provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'shared.com' },
          { provider: 'lusha', provider_entity_id: 'id-456', normalized_domain: 'shared.com' },
        ],
        'run-1',
        T1,
      );

      const found = await rows();
      assert.equal(found.length, 2, 'un grupo y su filial no son la misma empresa');
      assert.deepEqual(
        found.map((r) => r.provider_entity_id).sort(),
        ['id-123', 'id-456'],
      );

      // Y la prueba directa de que NO hay unicidad global por dominio: el índice que
      // cubre dominios es PARCIAL sobre las filas sin id.
      // La PK queda fuera a propósito: `id` es un sustituto sin significado y no
      // expresa ninguna afirmación de identidad. Lo que se mide son las claves de
      // NEGOCIO.
      const { rows: indexes } = await client.query(
        `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS def
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = 'public.provider_seen_entities'::regclass
            AND i.indisunique AND NOT i.indisprimary
          ORDER BY c.relname`,
      );
      assert.deepEqual(
        (indexes as Array<{ name: string }>).map((r) => r.name),
        ['provider_seen_entities_domain_only_key', 'provider_seen_entities_native_id_key'],
        'exactamente dos claves de negocio, una por señal',
      );
      for (const index of indexes as Array<{ name: string; def: string }>) {
        // 🔴 Sin `WHERE` el índice sería GLOBAL: el del dominio colapsaría entidades
        // distintas que comparten sitio web, y una clave que nombrara las dos columnas
        // a la vez sería la semántica combinada que § 5 congela.
        assert.match(index.def, /WHERE /, `unicidad global detectada: ${index.def}`);
        const target = index.def.slice(index.def.indexOf('('), index.def.indexOf('WHERE'));
        assert.ok(
          !(target.includes('provider_entity_id') && target.includes('normalized_domain')),
          `unicidad COMBINADA detectada: ${index.def}`,
        );
      }
    });

    it('CASO D — id solo y después id+dominio ⇒ UNA fila, el dominio se COMPLETA', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: null }], 'run-1', T1);
      await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'tarde.com' }],
        'run-2',
        T2,
      );

      const found = await rows();
      assert.equal(found.length, 1);
      assert.equal(found[0]!.normalized_domain, 'tarde.com');
      assert.equal(found[0]!.first_seen_at.toISOString(), T1, 'completar no reescribe el origen');
      assert.equal(found[0]!.first_seen_correlation, 'run-1');
    });

    it('CASO D (inverso) — una observación SIN dominio nunca borra el que ya había', async () => {
      await reset();
      await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'sigue.com' }],
        'run-1',
        T1,
      );
      await record([{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: null }], 'run-2', T2);

      const found = await rows();
      assert.equal(found.length, 1);
      assert.equal(
        found[0]!.normalized_domain,
        'sigue.com',
        'la ausencia de observación no es una observación de ausencia',
      );
      assert.equal(found[0]!.last_seen_at.toISOString(), T2, 'la ventana sí avanza');
    });

    it('CASO D (más viejo) — un dominio que llega tarde pero es ANTERIOR también completa', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: null }], 'run-2', T2);
      await record(
        [{ provider: 'lusha', provider_entity_id: 'id-123', normalized_domain: 'anterior.com' }],
        'run-1',
        T1,
      );

      const found = await rows();
      assert.equal(
        found[0]!.normalized_domain,
        'anterior.com',
        'completar donde no había nada no pierde nada, aunque la observación sea vieja',
      );
      assert.equal(found[0]!.last_seen_at.toISOString(), T2, 'pero la ventana NO retrocede');
      assert.equal(found[0]!.last_seen_correlation, 'run-2', 'ni la correlación de la más reciente');
    });

    it('CASO E — la MISMA observación concurrente dos veces converge, sin excepción visible', async () => {
      await reset();
      const other = postgres.getPgClient();
      await other.connect();
      try {
        const observation = [
          { provider: 'lusha', provider_entity_id: 'id-race', normalized_domain: 'race.com' },
        ];

        await client.query('BEGIN');
        await other.query('BEGIN');

        // La primera inserta y NO commitea todavía.
        await record(observation, 'run-a', T1, client);

        // La segunda choca contra una fila que aún no ve. Se BLOQUEA: no falla.
        const blocked = record(observation, 'run-b', T2, other);
        await client.query('COMMIT');

        // Si `ON CONFLICT` no cubriera este camino, esto lanzaría 23505.
        const result = await blocked;
        await other.query('COMMIT');

        assert.equal(result.refreshed_count, 1, 'la segunda REFRESCÓ, no duplicó');
        const found = await rows();
        assert.equal(found.length, 1, 'una sola fila');
        assert.equal(found[0]!.first_seen_correlation, 'run-a', 'el origen es el de la primera');
        assert.equal(found[0]!.last_seen_correlation, 'run-b');
      } finally {
        await other.end();
      }
    });

    it('CASO E (mismo lote) — la misma identidad repetida dentro de UNA respuesta no rompe', async () => {
      await reset();
      // 🔴 Sin colapsar el lote por clave de conflicto, PostgreSQL responde «ON CONFLICT
      // DO UPDATE command cannot affect row a second time» — una excepción visible al
      // llamador provocada por un duplicado que es completamente normal en una página.
      const result = await record(
        [
          { provider: 'lusha', provider_entity_id: 'id-dup', normalized_domain: null },
          { provider: 'lusha', provider_entity_id: 'id-dup', normalized_domain: 'dup.com' },
          { provider: 'lusha', provider_entity_id: 'id-dup', normalized_domain: null },
        ],
        'run-1',
        T1,
      );

      assert.equal(result.accepted_count, 1, 'tres observaciones, una identidad');
      // 🔴 Una repetición NO es un rechazo. Mezclarlas haría que una página que trae la
      // misma empresa dos veces reportara rechazos que nunca ocurrieron.
      assert.equal(result.duplicate_count, 2);
      assert.equal(result.rejected_count, 0, 'las tres eran perfectamente identificables');
      const found = await rows();
      assert.equal(found.length, 1);
      assert.equal(
        found[0]!.normalized_domain,
        'dup.com',
        'el nulo posterior no borra el dominio que trajo la repetición del medio',
      );
    });
  });

  // ── § 3. Invariantes que la TABLA hace cumplir ─────────────────────────────

  describe('§ 3 — invariantes de esquema', () => {
    it('una fila SIN ninguna señal es rechazada por la tabla', async () => {
      await reset();
      const code = await expectFailure(
        `INSERT INTO ${TABLE} (provider, provider_entity_type, provider_entity_id, normalized_domain, first_seen_at, last_seen_at)
         VALUES ('lusha', 'company', NULL, NULL, $1, $1)`,
        [T1],
      );
      assert.equal(code, '23514', 'CHECK, no un fallo genérico');

      // Y la función la REPORTA en vez de lanzarla: una escritura de memoria no puede
      // tumbar la corrida a la que pertenece.
      const result = await record([{ provider: 'lusha', provider_entity_id: null, normalized_domain: null }], 'run-1', T1);
      assert.equal(result.accepted_count, 0);
      assert.equal(result.rejected_count, 1);
      assert.equal((await rows()).length, 0);
    });

    it('un proveedor o un tipo de entidad fuera del vocabulario es rechazado (fail-closed)', async () => {
      await reset();
      assert.equal(
        await expectFailure(
          `INSERT INTO ${TABLE} (provider, provider_entity_type, provider_entity_id, first_seen_at, last_seen_at)
           VALUES ('co_siis', 'company', 'x', $1, $1)`,
          [T1],
        ),
        '23514',
        'una fuente GRATUITA no puede entrar en la memoria de lo pagado',
      );
      assert.equal(
        await expectFailure(
          `INSERT INTO ${TABLE} (provider, provider_entity_type, provider_entity_id, first_seen_at, last_seen_at)
           VALUES ('lusha', 'person', 'x', $1, $1)`,
          [T1],
        ),
        '23514',
        'la memoria de personas es un problema distinto, con sus propias reglas',
      );

      // Por la función, lo mismo se reporta sin lanzar.
      const result = await record(
        [
          { provider: 'co_siis', provider_entity_id: 'x', normalized_domain: null },
          { provider: 'hubspot', provider_entity_id: 'y', normalized_domain: null },
          { provider: 'lusha', entity_type: 'person', provider_entity_id: 'z', normalized_domain: null },
          { provider: 'apollo', provider_entity_id: 'ok', normalized_domain: null },
        ],
        'run-1',
        T1,
      );
      assert.equal(result.accepted_count, 1);
      assert.equal(result.rejected_count, 3);
      assert.equal(result.duplicate_count, 0, 'ninguna era una repetición');
    });

    it('un dominio SIN normalizar es rechazado en la frontera, no guardado para no coincidir jamás', async () => {
      await reset();
      for (const bad of ['ACME.com', 'www.acme.com', 'https://acme.com', 'acme']) {
        assert.equal(
          await expectFailure(
            `INSERT INTO ${TABLE} (provider, provider_entity_type, normalized_domain, first_seen_at, last_seen_at)
             VALUES ('lusha', 'company', $2, $1, $1)`,
            [T1, bad],
          ),
          '23514',
          `un dominio guardado con otro normalizador nunca coincidiría con uno enviado: ${bad}`,
        );
      }
      // El normalizador canónico vive en TypeScript; el CHECK sólo impide DESHACERLO.
      await client.query(
        `INSERT INTO ${TABLE} (provider, provider_entity_type, normalized_domain, first_seen_at, last_seen_at)
         VALUES ('lusha', 'company', 'acme.com', $1, $1)`,
        [T1],
      );
      assert.equal((await rows()).length, 1);
    });

    it('first_seen_* es INMUTABLE aunque se intente escribir directamente en la tabla', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-fix', normalized_domain: 'fix.com' }], 'run-1', T1);

      await client.query(
        `UPDATE ${TABLE}
            SET first_seen_at = $1, first_seen_correlation = 'reescrito',
                provider_entity_id = 'otro', provider = 'apollo'`,
        [T0],
      );

      const found = (await rows())[0]!;
      assert.equal(found.first_seen_at.toISOString(), T1, 'el origen del registro no se mueve');
      assert.equal(found.first_seen_correlation, 'run-1');
      assert.equal(found.provider_entity_id, 'id-fix', 'ni la identidad: un UPDATE no convierte una empresa en otra');
      assert.equal(found.provider, 'lusha');
    });

    it('un UPDATE directo tampoco puede NULAR un dominio ya recordado', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-keep', normalized_domain: 'keep.com' }], 'run-1', T1);
      await client.query(`UPDATE ${TABLE} SET normalized_domain = NULL`);
      assert.equal((await rows())[0]!.normalized_domain, 'keep.com');
    });

    it('en una fila SIN id nativo, el dominio ES la identidad y tampoco se puede cambiar', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: null, normalized_domain: 'identidad.com' }], 'run-1', T1);
      await client.query(`UPDATE ${TABLE} SET normalized_domain = 'otra.com'`);
      // Es la columna sobre la que decide su índice único parcial: cambiarla por un
      // UPDATE convertiría una empresa en otra, igual que cambiar el id en el caso
      // contrario.
      assert.equal((await rows())[0]!.normalized_domain, 'identidad.com');
    });

    it('la ventana no puede quedar invertida', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'id-w', normalized_domain: null }], 'run-1', T1);
      assert.equal(
        await expectFailure(`UPDATE ${TABLE} SET last_seen_at = $1`, [T0]),
        '23514',
        'last_seen_at nunca puede quedar antes de first_seen_at',
      );
    });

    it('la tabla NO tiene ninguna columna del perfil comprado', async () => {
      const { rows: columns } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'provider_seen_entities'
          ORDER BY column_name`,
      );
      const names = (columns as Array<{ column_name: string }>).map((c) => c.column_name);

      assert.deepEqual(names, [
        'first_seen_at',
        'first_seen_correlation',
        'id',
        'last_seen_at',
        'last_seen_correlation',
        'normalized_domain',
        'provider',
        'provider_entity_id',
        'provider_entity_type',
      ]);

      // 🔴 Recordar «ya vi este id» no es conservar el dato que se pagó, y esa distinción
      // es la que mantiene la memoria fuera del alcance de una cláusula de
      // redistribución. Una columna añadida sin pensar la rompería en silencio.
      for (const forbidden of [
        'name', 'company_name', 'employee_count', 'size', 'industry', 'sector',
        'phone', 'email', 'address', 'revenue', 'linkedin_url', 'account_id',
      ]) {
        assert.ok(!names.includes(forbidden), `columna de perfil comprado: ${forbidden}`);
      }
    });
  });

  // ── § 4. Separación por proveedor ──────────────────────────────────────────

  describe('§ 4 — separación por proveedor', () => {
    it('el MISMO texto de id en Apollo y en Lusha son DOS entidades', async () => {
      await reset();
      const result = await record(
        [
          { provider: 'lusha', provider_entity_id: 'colision', normalized_domain: null },
          { provider: 'apollo', provider_entity_id: 'colision', normalized_domain: null },
        ],
        'run-1',
        T1,
      );
      assert.equal(result.accepted_count, 2);
      assert.equal(result.new_ids_recorded, 2, 'ninguno de los dos se come al otro');

      const found = await rows();
      assert.equal(found.length, 2);
      assert.deepEqual(found.map((r) => r.provider).sort(), ['apollo', 'lusha']);
      // Un id sólo significa algo DENTRO del espacio de nombres de su proveedor:
      // traducirlo entre proveedores es una inferencia que este esquema no hace.
    });

    it('el mismo dominio suelto en los dos proveedores también son dos filas', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: null, normalized_domain: 'ambos.com' }], 'run-1', T1);
      await record([{ provider: 'apollo', provider_entity_id: null, normalized_domain: 'ambos.com' }], 'run-1', T1);
      assert.equal((await rows()).length, 2);
    });
  });

  // ── § 5. RLS, GRANTS y la carga acotada ────────────────────────────────────

  describe('§ 5 — frontera de servidor', () => {
    it('la RLS está activa y la ÚNICA policy es la de service_role', async () => {
      const { rows: rls } = await client.query(
        `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.provider_seen_entities'::regclass`,
      );
      assert.equal((rls[0] as { relrowsecurity: boolean }).relrowsecurity, true);

      const { rows: policies } = await client.query(
        `SELECT policyname, roles::text AS roles FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'provider_seen_entities'`,
      );
      assert.equal(policies.length, 1);
      assert.equal((policies[0] as { policyname: string }).policyname, 'service_role_all_provider_seen_entities');
      assert.match((policies[0] as { roles: string }).roles, /service_role/);
    });

    it('🔴 ni anon ni authenticated conservan UN SOLO privilegio: RLS sola no bastaba', async () => {
      // Supabase concede los 8 por DEFAULT PRIVILEGES y `GRANT` sólo SUMA, así que
      // habilitar RLS sin revocar dejaría el GRANT intacto. Se pregunta con
      // `has_table_privilege`, no con `information_schema`.
      const privileges = [
        'SELECT', 'INSERT', 'UPDATE', 'DELETE',
        'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN',
      ];
      for (const role of ['anon', 'authenticated']) {
        for (const privilege of privileges) {
          const { rows: has } = await client.query(
            `SELECT has_table_privilege($1, 'public.provider_seen_entities', $2) AS granted`,
            [role, privilege],
          );
          assert.equal(
            (has[0] as { granted: boolean }).granted,
            false,
            `${role} conserva ${privilege}`,
          );
        }
      }
    });

    it('service_role conserva EXACTAMENTE leer, insertar y actualizar — nunca borrar', async () => {
      const expected: Record<string, boolean> = {
        SELECT: true, INSERT: true, UPDATE: true,
        DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false, MAINTAIN: false,
      };
      for (const [privilege, granted] of Object.entries(expected)) {
        const { rows: has } = await client.query(
          `SELECT has_table_privilege('service_role', 'public.provider_seen_entities', $1) AS granted`,
          [privilege],
        );
        assert.equal(
          (has[0] as { granted: boolean }).granted,
          granted,
          // Borrar una fila de memoria vuelve a hacernos pagar esa empresa en silencio.
          `service_role: ${privilege} debería ser ${granted}`,
        );
      }
    });

    it('un cliente de sesión que INTENTA leer recibe permiso denegado', async () => {
      await reset();
      await record([{ provider: 'lusha', provider_entity_id: 'secreto', normalized_domain: null }], 'run-1', T1);

      for (const role of ['anon', 'authenticated']) {
        await client.query('BEGIN');
        try {
          await client.query(`SET LOCAL ROLE ${role}`);
          const code = await expectFailure(`SELECT count(*) FROM ${TABLE}`);
          assert.equal(code, '42501', `${role} tendría que recibir permiso denegado`);
        } finally {
          await client.query('ROLLBACK');
        }
      }
    });

    it('la función de escritura tampoco es ejecutable por un cliente de sesión', async () => {
      for (const [role, expected] of [
        ['anon', false],
        ['authenticated', false],
        ['service_role', true],
      ] as const) {
        const { rows: has } = await client.query(
          `SELECT has_function_privilege($1, 'public.record_provider_seen_entities(jsonb, text, timestamptz)', 'EXECUTE') AS granted`,
          [role],
        );
        assert.equal((has[0] as { granted: boolean }).granted, expected, `${role} EXECUTE`);
      }
    });

    it('la carga es acotada y su orden DETERMINISTA', async () => {
      await reset();
      for (let i = 0; i < 7; i++) {
        await record(
          [{ provider: 'lusha', provider_entity_id: `id-${i}`, normalized_domain: null }],
          `run-${i}`,
          new Date(Date.parse(T1) + i * 1000).toISOString(),
        );
      }

      // El mismo orden que emite el store persistente: lo más reciente primero,
      // desempate por `id`, para que dos corridas idénticas carguen la misma página.
      const page = async (limit: number) =>
        (
          await client.query(
            `SELECT provider_entity_id FROM ${TABLE}
              WHERE provider = 'lusha' AND provider_entity_type = 'company'
              ORDER BY last_seen_at DESC, id ASC LIMIT ${limit}`,
          )
        ).rows.map((r) => (r as { provider_entity_id: string }).provider_entity_id);

      assert.deepEqual(await page(3), ['id-6', 'id-5', 'id-4']);
      assert.deepEqual(await page(3), ['id-6', 'id-5', 'id-4'], 'dos cargas iguales, misma página');
      assert.equal((await page(7)).length, 7);
    });
  });

  // ── § 6. Una sola idea de identidad, no dos ────────────────────────────────

  describe('§ 6 — el TypeScript y el SQL comparten la semántica, no sólo el nombre', () => {
    /**
     * 🔴 El riesgo que esta sección cubre es el más silencioso del hito: que la tabla y
     * su cliente acaben con dos nociones distintas de «la misma empresa». No fallaría
     * nada — la memoria simplemente no acertaría nunca, y el gasto seguiría igual sin
     * que ninguna prueba se pusiera roja.
     *
     * Así que el payload no se reescribe a mano aquí: se toma EL QUE EL STORE EMITE y
     * se ejecuta contra la función REAL de la migración.
     */
    const captureStorePayload = async (
      candidates: readonly { providerEntityId?: string | null; domain?: string | null }[],
    ) => {
      const captured: Array<{ fn: string; args: Record<string, unknown> }> = [];
      const double = {
        from: () => ({
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }),
        }),
        rpc: async (fn: string, args: Record<string, unknown>) => {
          captured.push({ fn, args });
          return { data: null, error: null };
        },
      };
      const store = createSupabaseProviderSeenStore(
        double as unknown as Parameters<typeof createSupabaseProviderSeenStore>[0],
      );
      await store.record({
        observations: collectProviderSeenObservations('lusha', candidates).observations,
        correlationId: 'run-cross',
        observedAt: T1,
      });
      return captured[0]!;
    };

    it('la función SQL acepta el payload EXACTO que construye el store persistente', async () => {
      await reset();
      const call = await captureStorePayload([
        { providerEntityId: 'v1.cross', domain: 'CROSS.com' },
        { providerEntityId: null, domain: 'https://www.solo-dominio.com/algo' },
        { providerEntityId: '  ', domain: '   ' },
      ]);

      const { rows: out } = await client.query(
        'SELECT public.record_provider_seen_entities($1::jsonb, $2, $3::timestamptz) AS result',
        [JSON.stringify(call.args.p_observations), call.args.p_correlation, call.args.p_observed_at],
      );
      const result = (out[0] as { result: Record<string, number> }).result;

      // Dos identificables; la tercera no traía ni id ni dominio, así que el colector ni
      // siquiera la emitió — y por eso el SQL no ve nada que rechazar.
      assert.equal(result.accepted_count, 2);
      assert.equal(result.rejected_count, 0, 'el store no manda basura a la base');

      const found = await rows();
      assert.deepEqual(
        found.map((r) => [r.provider_entity_id, r.normalized_domain]).sort(),
        [
          [null, 'solo-dominio.com'],
          ['v1.cross', 'cross.com'],
        ].sort(),
      );
      // 🔴 Los dominios llegaron normalizados por `normalizeExclusionDomain` —minúsculas,
      // sin esquema y sin `www.`— que es el MISMO normalizador con el que viajan a Lusha.
      // Guardarlos con el laxo y enviarlos con el estricto haría que un dominio recordado
      // no coincidiera jamás con uno enviado, y la memoria sería inerte sin fallar.
    });

    it('el doble en memoria y la tabla real convergen a la MISMA fila en los casos A–D', async () => {
      const script: Array<{ candidates: Array<{ providerEntityId: string | null; domain: string | null }>; correlation: string; at: string }> = [
        { candidates: [{ providerEntityId: null, domain: 'conv.com' }], correlation: 'r1', at: T1 },
        { candidates: [{ providerEntityId: 'id-conv', domain: null }], correlation: 'r1', at: T1 },
        { candidates: [{ providerEntityId: 'id-conv', domain: 'conv.com' }], correlation: 'r2', at: T2 },
        { candidates: [{ providerEntityId: 'id-conv', domain: 'otro.com' }], correlation: 'r3', at: T2 },
        { candidates: [{ providerEntityId: 'id-conv', domain: null }], correlation: 'r4', at: T2 },
      ];

      await reset();
      const memory = createInMemoryProviderSeenStore();
      for (const step of script) {
        const observations = collectProviderSeenObservations('lusha', step.candidates).observations;
        await memory.record({ observations, correlationId: step.correlation, observedAt: step.at });
        await record(
          observations.map((o) => ({
            provider: o.provider,
            entity_type: o.entityType,
            provider_entity_id: o.providerEntityId,
            normalized_domain: o.normalizedDomain,
          })),
          step.correlation,
          step.at,
        );
      }

      const shape = (r: {
        providerEntityId: string | null;
        normalizedDomain: string | null;
        firstSeenAt: string;
        lastSeenAt: string;
        firstSeenCorrelation: string | null;
        lastSeenCorrelation: string | null;
      }) => [r.providerEntityId, r.normalizedDomain, r.firstSeenAt, r.lastSeenAt, r.firstSeenCorrelation, r.lastSeenCorrelation];

      const fromMemory = [...(await memory.load({ provider: 'lusha', limit: 50 }))]
        .map(shape)
        .sort();
      const fromTable = (await rows())
        .map((r) => [
          r.provider_entity_id,
          r.normalized_domain,
          r.first_seen_at.toISOString(),
          r.last_seen_at.toISOString(),
          r.first_seen_correlation,
          r.last_seen_correlation,
        ])
        .sort();

      // Dos filas (caso A) y, en la del id, `first_seen_*` intacto con el dominio
      // avanzado al último no nulo (casos B y D).
      assert.equal(fromTable.length, 2);
      assert.deepEqual(fromMemory, fromTable, 'el doble de pruebas no puede mentir sobre la tabla');
    });
  });
});
