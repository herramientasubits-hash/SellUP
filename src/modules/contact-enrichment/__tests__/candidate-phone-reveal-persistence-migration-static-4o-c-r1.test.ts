/**
 * Agente 2A — Lectura ESTÁTICA de la migración 110 (AGENT2A-PHONE-REVEAL-4O-C-R1)
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ HACE Y POR QUÉ NO BASTA CON LA SUITE DE POSTGRESQL
 * ═══════════════════════════════════════════════════════════════════
 *
 * `candidate-phone-reveal-persistence-postgres-4o-c-r1.test.ts` ejecuta la función
 * contra un PostgreSQL real y demuestra que se comporta. Lo que no puede demostrar
 * es cómo está ESCRITA: una función que compusiera SQL dinámico, o que fuera
 * SECURITY DEFINER, o que se concediera EXECUTE a PUBLIC, pasaría igualmente todas
 * las pruebas de comportamiento del camino feliz. Esas propiedades son del TEXTO, y
 * este archivo es el que las fija.
 *
 * Y el arnés de PostgreSQL es OPCIONAL a propósito (`embedded-postgres` no es
 * dependencia del repo, para no descargar un binario en cada `npm ci`), así que en
 * el check obligatorio este archivo es lo ÚNICO que mira la migración. De ahí que
 * cubra también, en versión textual, las propiedades que allí se comprueban
 * ejecutando.
 *
 * ═══════════════════════════════════════════════════════════════════
 * CADA COMPROBACIÓN SE PRUEBA CONTRA SÍ MISMA
 * ═══════════════════════════════════════════════════════════════════
 *
 * Un test estático mal escrito es el peor de los dos mundos: da confianza y no
 * comprueba nada. Un `assert.match` con una expresión que nunca podría fallar pasa
 * para siempre y nadie se entera.
 *
 * Así que cada comprobación se declara con su MUTACIÓN: el cambio mínimo al texto
 * que debería romperla. Cada una se evalúa DOS veces — contra el archivo real, donde
 * tiene que pasar, y contra el archivo mutado, donde tiene que fallar. Una
 * comprobación vacua se delata inmediatamente, porque también pasaría sobre la
 * mutación.
 *
 * Sin red, sin base de datos, sin proveedores, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATION = '110_persist_candidate_apollo_phone_reveal_result.sql';
const FN = 'persist_candidate_apollo_phone_reveal_result';

const raw = readFileSync(join(repoRoot, 'supabase/migrations', MIGRATION), 'utf8');

/**
 * SQL sin comentarios. Se mira SIEMPRE esto y nunca el archivo entero: los
 * comentarios de esta migración explican por qué NO hay backfill, por qué NO es
 * DEFINER y por qué NO se escribe el usage-log, así que nombran precisamente todo
 * lo que las comprobaciones prohíben. Un test que leyera el texto crudo estaría
 * fallando por la documentación.
 */
const sql = raw
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

/** La firma exacta, en el orden en que se declara. Los REVOKE/GRANT la repiten. */
const SIGNATURE =
  'uuid, text, text, timestamptz, jsonb, jsonb, jsonb, text, text, text, text, text, text,\n' +
  '  timestamptz, timestamptz, timestamptz, timestamptz, integer, text, text, text, text';

interface Check {
  /** Qué propiedad del texto se afirma. */
  name: string;
  /** Verdadero cuando el SQL tiene la propiedad. */
  ok: (statements: string) => boolean;
  /** El cambio mínimo que debe romperla. */
  mutate: (statements: string) => string;
}

const CHECKS: readonly Check[] = [
  {
    name: 'crea la función con su nombre exacto',
    ok: (s) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${FN}\\(`).test(s),
    mutate: (s) => s.replace(`CREATE OR REPLACE FUNCTION public.${FN}(`, 'CREATE OR REPLACE FUNCTION public.otra_cosa('),
  },
  {
    name: 'es SECURITY INVOKER y no DEFINER',
    // INVOKER es lo que mantiene en pie el techo de privilegios de la 109: la
    // función no puede borrar una fila de teléfono ni reescribir una procedencia.
    ok: (s) => /SECURITY INVOKER/.test(s) && !/SECURITY DEFINER/.test(s),
    mutate: (s) => s.replace('SECURITY INVOKER', 'SECURITY DEFINER'),
  },
  {
    name: 'fija un search_path seguro',
    ok: (s) => /SET search_path = pg_catalog, pg_temp/.test(s),
    mutate: (s) => s.replace('SET search_path = pg_catalog, pg_temp', 'SET search_path = public'),
  },
  {
    name: 'no compone SQL dinámico',
    // Un EXECUTE de una cadena, un `format()` o un `quote_ident()` convertirían la
    // función en un escritor de columnas arbitrarias.
    ok: (s) => !/\bEXECUTE\s+(?:'|format\(|quote_)/i.test(s) && !/\bquote_ident\b/i.test(s),
    mutate: (s) => s.replace('BEGIN\n', "BEGIN\n  EXECUTE 'UPDATE ' || 'x';\n"),
  },
  {
    name: 'bloquea el candidato con SELECT … FOR UPDATE',
    ok: (s) => /FROM public\.contact_enrichment_candidates c\s*\n\s*WHERE c\.id = p_candidate_id\s*\n\s*FOR UPDATE;/.test(s),
    mutate: (s) => s.replace('  FOR UPDATE;', '  ;'),
  },
  {
    name: 'hace upsert de la tabla canónica por (candidate_id, dedupe_key)',
    ok: (s) =>
      /INSERT INTO public\.contact_enrichment_candidate_phones AS t/.test(s) &&
      /ON CONFLICT \(candidate_id, dedupe_key\) DO UPDATE/.test(s),
    mutate: (s) => s.replace('ON CONFLICT (candidate_id, dedupe_key) DO UPDATE', 'ON CONFLICT DO NOTHING --'),
  },
  {
    name: 'hace upsert idempotente de las procedencias, sin UPDATE',
    // La 109 no concede UPDATE en esta tabla: una procedencia que su writer puede
    // reescribir no es procedencia.
    ok: (s) =>
      /INSERT INTO public\.contact_enrichment_candidate_phone_sources/.test(s) &&
      /ON CONFLICT \(candidate_phone_id, source_event_key\) DO NOTHING/.test(s) &&
      !/UPDATE public\.contact_enrichment_candidate_phone_sources/i.test(s),
    mutate: (s) =>
      s.replace(
        'ON CONFLICT (candidate_phone_id, source_event_key) DO NOTHING',
        'ON CONFLICT (candidate_phone_id, source_event_key) DO UPDATE SET observed_at = now()',
      ),
  },
  {
    name: 'comprueba el tombstone DENTRO de la escritura, no solo antes',
    // El `WHERE t.suppressed_at IS NULL` del DO UPDATE es lo que impide que un
    // tombstone recupere su número; sin él, la CHECK de la 109 convertiría una
    // regla de privacidad en un rollback.
    ok: (s) => /DO UPDATE[\s\S]*?WHERE t\.suppressed_at IS NULL\s*\n\s*RETURNING/.test(s),
    mutate: (s) => s.replace('WHERE t.suppressed_at IS NULL\n    RETURNING', 'RETURNING'),
  },
  {
    name: 'degrada el principal anterior ANTES de promover el nuevo',
    // El índice parcial único no admite dos principales ni por un instante.
    ok: (s) => {
      const demote = s.indexOf('SET is_primary = false');
      const promote = s.indexOf('SET is_primary = true');
      return demote > -1 && promote > -1 && demote < promote;
    },
    mutate: (s) =>
      s
        .replace('SET is_primary = false', 'SET is_primary = __PLACEHOLDER__')
        .replace('SET is_primary = true', 'SET is_primary = false')
        .replace('SET is_primary = __PLACEHOLDER__', 'SET is_primary = true'),
  },
  {
    name: 'actualiza el candidato DENTRO de la función',
    // Si esto viviera fuera, la persistencia volvería a ser dos escrituras y el
    // estado a medias volvería a ser alcanzable: es el bloqueo que R1 corrige.
    ok: (s) =>
      /UPDATE public\.contact_enrichment_candidates\s*\n\s*SET phone = v_scalar,[\s\S]*?WHERE id = p_candidate_id;/.test(s),
    mutate: (s) => s.replace('SET phone = v_scalar,', 'SET phone = phone,'),
  },
  {
    name: 'escribe el estado terminal y el escalar en la MISMA sentencia',
    ok: (s) => {
      const update = s.match(/UPDATE public\.contact_enrichment_candidates[\s\S]*?WHERE id = p_candidate_id;/)?.[0] ?? '';
      return (
        update.includes('phone = v_scalar') &&
        update.includes('phone_reveal_status') &&
        update.includes('enrichment_metadata')
      );
    },
    mutate: (s) => s.replace('phone_reveal_status              = p_phone_reveal_status,', ''),
  },
  {
    name: 'revoca EXECUTE de PUBLIC, anon y authenticated con la firma exacta',
    ok: (s) => {
      for (const role of ['PUBLIC', 'anon', 'authenticated']) {
        if (!s.includes(`) FROM ${role};`)) return false;
      }
      // Y las tres revocaciones nombran la MISMA firma que el CREATE.
      return (s.match(new RegExp(SIGNATURE.replace(/[()]/g, '\\$&'), 'g')) ?? []).length >= 4;
    },
    mutate: (s) => s.replace(') FROM anon;', ') FROM postgres;'),
  },
  {
    name: 'concede EXECUTE solo a postgres y service_role',
    ok: (s) =>
      /GRANT EXECUTE ON FUNCTION[\s\S]*?\) TO postgres, service_role;/.test(s) &&
      !/TO anon/.test(s) &&
      !/TO authenticated/.test(s),
    mutate: (s) => s.replace(') TO postgres, service_role;', ') TO postgres, service_role, authenticated;'),
  },
  {
    name: 'no crea, altera ni borra ninguna tabla, índice o trigger',
    ok: (s) => !/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX|CREATE TRIGGER|TRUNCATE/i.test(s),
    mutate: (s) => `${s}\nCREATE INDEX foo ON public.contact_enrichment_candidate_phones (candidate_id);`,
  },
  {
    name: 'no hace backfill',
    ok: (s) => !/backfill/i.test(s),
    mutate: (s) => `${s}\n-- placeholder\nSELECT 'backfill';`,
  },
  {
    name: 'no escribe contabilidad: ni usage-log, ni reserva, ni corrida',
    // El dinero se reconcilia con sus propias funciones (migración 104) y el log es
    // la evidencia: tiene que sobrevivir al fallo que describe.
    ok: (s) =>
      !/INSERT INTO public\.provider_usage_logs/i.test(s) &&
      !/(INSERT INTO|UPDATE) public\.phone_reveal_credit_reservations/i.test(s) &&
      !/(INSERT INTO|UPDATE) public\.phone_reveal_waterfall_runs/i.test(s),
    mutate: (s) => s.replace('  RETURN jsonb_build_object(\n', "  INSERT INTO public.provider_usage_logs DEFAULT VALUES;\n  RETURN jsonb_build_object(\n"),
  },
  {
    name: 'no se concede el DELETE que la 109 le niega',
    // Borrar una fila de teléfono borra un tombstone, y un tombstone borrado deja
    // que la siguiente observación reinserte el número como si nada.
    ok: (s) => !/DELETE FROM public\.contact_enrichment_candidate_phone/i.test(s),
    mutate: (s) => `${s}\n-- placeholder\nDELETE FROM public.contact_enrichment_candidate_phones WHERE false;`,
  },
  {
    name: 'solo acepta el camino `revealed`',
    ok: (s) => /p_phone_reveal_status IS DISTINCT FROM 'revealed'/.test(s),
    mutate: (s) => s.replace("p_phone_reveal_status IS DISTINCT FROM 'revealed'", 'false'),
  },
  {
    name: 'valida las colecciones con una lista de columnas CERRADA',
    // `jsonb_to_recordset` con lista explícita descarta las claves que el contrato
    // no menciona: no pueden convertirse en columnas.
    ok: (s) =>
      /jsonb_to_recordset\(p_phones\) AS x\(/.test(s) &&
      /jsonb_to_recordset\(p_sources\) AS s\(/.test(s) &&
      /jsonb_to_record\(e\.item\) AS r\(\s*\n?\s*dedupe_key text, phone text, phone_type text, raw_type text\s*\n?\s*\)/.test(s),
    // `replaceAll`: la conversión aparece varias veces, y mutar solo la primera
    // dejaría la comprobación pasando por las otras — una mutación que no muta.
    mutate: (s) =>
      s.replaceAll(
        'jsonb_to_recordset(p_phones) AS x(',
        'jsonb_populate_recordset(NULL::record, p_phones) AS x(',
      ),
  },
  {
    name: 'devuelve los cinco veredictos del contrato',
    ok: (s) =>
      ['persisted', 'idempotent', 'stale_event', 'candidate_not_eligible', 'suppressed'].every(
        (status) => s.includes(`'status', '${status}'`) || s.includes(`'status',                   '${status}'`),
      ),
    mutate: (s) => s.replace(/'status',\s+'suppressed'/, "'status', 'persisted'"),
  },
  {
    name: 'el fallback heredado nunca resucita un número suprimido',
    // El único camino que llega al fallback es «ninguna candidata elegible», y ahí un
    // heredado que sea tombstone volvería al campo visible. La condición mira las dos
    // mitades: fallback suprimido Y ninguna candidata viable.
    ok: (s) =>
      /IF v_legacy_suppressed AND v_viable_preference = 0 THEN[\s\S]*?'candidate_terminalized',   false[\s\S]*?END IF;/.test(s) &&
      /e\.dedupe_key = p_legacy_dedupe_key\s*\n\s*AND e\.suppressed_at IS NOT NULL/.test(s),
    mutate: (s) =>
      s.replace('IF v_legacy_suppressed AND v_viable_preference = 0 THEN', 'IF false THEN'),
  },
  {
    name: 'sin la clave del heredado la comprobación no se puede saltar en silencio',
    ok: (s) => /p_legacy_dedupe_key IS NULL OR LENGTH\(BTRIM\(p_legacy_dedupe_key\)\) = 0/.test(s),
    mutate: (s) =>
      s.replace(
        'p_legacy_dedupe_key IS NULL OR LENGTH(BTRIM(p_legacy_dedupe_key)) = 0',
        'false',
      ),
  },
  {
    name: 'ningún mensaje de excepción incluye un valor de dato',
    // Los RAISE nombran la operación. Interpolar un número, un display o una
    // dedupe_key metería PII en los logs del servidor.
    ok: (s) => {
      const raises = [...s.matchAll(/RAISE EXCEPTION '([^']*)'([^;]*);/g)];
      return raises.every(
        ([, message, tail]) =>
          !message.includes('%') &&
          !/v_scalar|p_legacy_phone|dedupe_key|normalized_phone|display_phone/.test(tail),
      );
    },
    mutate: (s) =>
      s.replace(
        /RAISE EXCEPTION '([^']*)';/,
        "RAISE EXCEPTION 'fallo con %', v_scalar;",
      ),
  },
];

describe('4O-C-R1 — la migración 110, leída como texto', () => {
  for (const check of CHECKS) {
    it(check.name, () => {
      assert.ok(check.ok(sql), `el SQL real debe cumplir: ${check.name}`);
    });
  }

  describe('las comprobaciones no están vacías', () => {
    for (const check of CHECKS) {
      it(`la mutación de «${check.name}» la rompe`, () => {
        const mutated = check.mutate(sql);
        assert.notEqual(mutated, sql, 'la mutación debe cambiar el texto');
        assert.equal(
          check.ok(mutated),
          false,
          `la comprobación «${check.name}» pasa sobre el SQL mutado, así que no comprueba nada`,
        );
      });
    }
  });

  it('la migración declara que NO se ha aplicado en remoto', () => {
    // El repositorio y el remoto llevan numeraciones divergentes desde la 105/106.
    // Que el archivo lo diga es lo que evita que alguien asuma que ya está puesta.
    assert.match(raw, /NOT APPLIED/);
  });

  it('la función se nombra igual en la migración y en el módulo que la invoca', () => {
    const persistence = readFileSync(
      join(here, '..', 'candidate-phone-collection-persistence.ts'),
      'utf8',
    );
    assert.match(
      persistence,
      new RegExp(`PERSIST_CANDIDATE_APOLLO_PHONE_REVEAL_RESULT_FN =\\s*\\n?\\s*'${FN}'`),
    );
  });

  it('cada parámetro de la función está TIPADO y nombrado', () => {
    const header = sql
      .slice(
        sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`),
        sql.indexOf('RETURNS jsonb'),
      )
      // El encabezado documenta cada parámetro con comentarios AL FINAL DE LÍNEA,
      // que el filtro global de comentarios (que solo mira el inicio de línea) no
      // quita. Aquí sí hay que quitarlos: la lista de parámetros es lo que se parsea.
      .replace(/--[^\n]*/g, '');
    const params = header
      .slice(header.indexOf('(') + 1, header.lastIndexOf(')'))
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    assert.equal(params.length, 22, 'los 22 parámetros del contrato');
    for (const param of params) {
      assert.match(
        param,
        /^p_[a-z_]+\s+(uuid|text|jsonb|timestamptz|integer)$/,
        `parámetro sin nombre o sin tipo cerrado: ${param}`,
      );
    }
    // Y ninguno tiene DEFAULT: PostgREST resuelve la función por el conjunto de
    // nombres recibidos, y un default permitiría invocarla a medias.
    assert.equal(/DEFAULT/i.test(header), false);
  });
});
