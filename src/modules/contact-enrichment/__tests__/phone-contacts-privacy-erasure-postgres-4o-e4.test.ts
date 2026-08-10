/**
 * Agente 2A — erasure provenance-safe de teléfonos OFICIALES contra PostgreSQL real
 * (AGENT2A-PHONE-REVEAL-4O-E4).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * 4O-E4 no añade RPC ni migración: el borrado del contacto oficial se hace con un
 * UPDATE condicional por PostgREST. Eso desplaza la propiedad crítica desde el plan
 * puro —que los tests deterministas ya cubren— hasta el PREDICADO de la escritura, y
 * un predicado sólo se demuestra contra un motor real.
 *
 * Lo que un fake NO puede demostrar:
 *
 *     Tx A lee la fila como `lusha_reveal`
 *     Tx B la reemplaza por un teléfono MANUAL y commitea
 *     Tx A ejecuta su UPDATE de privacidad
 *     ⇒ 0 filas afectadas, el teléfono manual SOBREVIVE
 *
 * En un doble esa secuencia se programa; aquí son dos conexiones reales y lo que se
 * mide después es el contenido de la tabla. Es la diferencia entre «el código tiene un
 * `.eq`» y «el `.eq` protege el dato».
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ REPRODUCE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * PostgreSQL 17 (Prod: 17.6);
 *   * `public.contacts` con las 8 columnas de teléfono REALES y los CHECK de
 *     Producción sobre `phone_source`, `phone_type` y `phone_confidence` —
 *     verificados contra `information_schema` / `pg_constraint` del proyecto;
 *   * el MISMO patch que construye el core (`buildContactPhoneSuppressionPatch`) y el
 *     MISMO predicado que aplica la server action (id + account_id + phone_source
 *     observado). El SQL se genera desde el patch, no se escribe a mano: si el core
 *     cambiara de columnas, este test cambia con él.
 *
 * ⚠️ 4O-E4.1 amplió el alcance de este archivo: `mobile_phone` SOBREVIVE ahora en
 * todos los caminos, incluidos los de Apollo, y aquí se demuestra contra el motor —
 * junto con la carrera en la que alguien teclea un celular mientras la DSAR corre.
 *
 * NO llama a Apollo, ni a Lusha, ni a HubSpot; no lee un flag; no toca Producción ni
 * ninguna base remota; no gasta un crédito; no ejecuta ninguna DSAR real. Todos los
 * números son sintéticos 555 y todos los ids son ficticios.
 *
 * ARNÉS OPCIONAL. `embedded-postgres` NO es dependencia del repo a propósito:
 * descargaría un binario de PostgreSQL en cada `npm ci`, incluido el del check
 * obligatorio. Si el módulo no está resuelto, el archivo se SALTA con un motivo
 * explícito en lugar de fallar. Para correrla:
 *
 *   npm install --no-save embedded-postgres@17.6.0-beta.15
 *   npm run test:agent2a:contacts-phone-privacy-erasure-postgres
 *
 * ⚠️ El rango `embedded-postgres@17` NO resuelve: todas las versiones del paquete son
 * prerelease y semver no las casa. La versión exacta de arriba es la serie 17.6, la
 * misma de Producción.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  SUPPRESSIBLE_CONTACT_PHONE_SOURCES,
  buildContactPhoneSuppressionPatch,
} from '../phone-cache-suppression-core';

// ═══════════════════════════════════════════════════════════════
// Resolución del arnés opcional
// ═══════════════════════════════════════════════════════════════

type PgLikeClient = {
  connect: () => Promise<void>;
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  end: () => Promise<void>;
};

type EmbeddedPostgresLike = {
  initialise: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getPgClient: () => PgLikeClient;
};

let EmbeddedPostgresCtor:
  | (new (options: Record<string, unknown>) => EmbeddedPostgresLike)
  | null = null;
let harnessSkipReason: string | false = false;

try {
  const require = createRequire(import.meta.url);
  const mod = require('embedded-postgres') as {
    default?: new (options: Record<string, unknown>) => EmbeddedPostgresLike;
  };
  const ctor =
    mod.default ??
    (mod as unknown as new (o: Record<string, unknown>) => EmbeddedPostgresLike);
  if (typeof ctor !== 'function') {
    harnessSkipReason = 'embedded-postgres resolvió sin constructor utilizable';
  } else {
    EmbeddedPostgresCtor = ctor;
  }
} catch {
  harnessSkipReason =
    'embedded-postgres no está instalado (arnés opcional a propósito: `npm install --no-save embedded-postgres@17.6.0-beta.15`)';
}

// ═══════════════════════════════════════════════════════════════
// Datos sintéticos
// ═══════════════════════════════════════════════════════════════

const ACCOUNT_A = '99999999-9999-4999-8999-999999999999';
const ACCOUNT_B = '88888888-8888-4888-8888-888888888888';
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-08-10T12:00:00.000Z';

const LUSHA_PHONE = '+15550000101';
const APOLLO_PHONE = '+15550000102';
const MANUAL_PHONE = '+15550000103';
const OTHER_MOBILE = '+15550000202';

/**
 * `public.contacts` reducida a lo que esta propiedad necesita, con los CHECK REALES
 * de Producción. No se recorta ninguno de los tres: son lo que impide que un patch
 * escriba un vocabulario inventado, y por tanto parte de lo que se está probando.
 */
const CONTACTS_DDL = `
  CREATE TABLE public.contacts (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id             uuid NOT NULL,
    full_name              text NOT NULL,
    email                  text NULL,
    phone                  text NULL,
    mobile_phone           text NULL,
    phone_type             text NULL,
    phone_source           text NULL,
    phone_raw_type         text NULL,
    phone_revealed_at      timestamptz NULL,
    phone_processing_basis text NULL,
    phone_confidence       text NULL,
    metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT contacts_phone_source_check CHECK (
      phone_source IS NULL OR phone_source = ANY (ARRAY[
        'apollo_search','apollo_reveal','apollo_cache','lusha_reveal',
        'provider_payload','manual','unknown'
      ])
    ),
    CONSTRAINT contacts_phone_type_check CHECK (
      phone_type IS NULL OR phone_type = ANY (ARRAY[
        'personal_mobile','mobile','direct_dial','work','hq','other','unknown'
      ])
    ),
    CONSTRAINT contacts_phone_confidence_check CHECK (
      phone_confidence IS NULL OR phone_confidence = ANY (ARRAY[
        'unknown','low','medium','high','verified'
      ])
    )
  );
`;

describe(
  '4O-E4 — la erasure de teléfonos oficiales contra PostgreSQL real',
  { skip: harnessSkipReason },
  () => {
    let postgres: EmbeddedPostgresLike;
    /** Conexión principal: hace de "server action". */
    let client: PgLikeClient;
    /** Segunda conexión: hace de escritor legítimo concurrente. */
    let other: PgLikeClient;
    let dataDir = '';

    before(async () => {
      assert.ok(EmbeddedPostgresCtor);
      dataDir = mkdtempSync(join(tmpdir(), 'sellup-e4-pg-'));
      postgres = new EmbeddedPostgresCtor({
        databaseDir: dataDir,
        user: 'postgres',
        password: 'postgres',
        port: 54329,
        persistent: false,
      });
      await postgres.initialise();
      await postgres.start();

      client = postgres.getPgClient();
      await client.connect();
      other = postgres.getPgClient();
      await other.connect();

      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      await client.query(CONTACTS_DDL);
    });

    after(async () => {
      await client?.end().catch(() => {});
      await other?.end().catch(() => {});
      await postgres?.stop().catch(() => {});
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Utilidades ─────────────────────────────────────────────

    let seq = 0;
    /** Inserta un contacto y devuelve su id. */
    async function insertContact(args: {
      accountId?: string;
      phone: string | null;
      phoneSource: string | null;
      mobilePhone?: string | null;
    }): Promise<string> {
      seq += 1;
      const { rows } = await client.query(
        `INSERT INTO public.contacts (
           account_id, full_name, email, phone, mobile_phone, phone_type,
           phone_source, phone_raw_type, phone_revealed_at,
           phone_processing_basis, phone_confidence, metadata
         ) VALUES ($1,$2,$3,$4,$5,'mobile',$6,'mobile',$7,'legitimate_interest','high',$8)
         RETURNING id`,
        [
          args.accountId ?? ACCOUNT_A,
          `Contacto Sintetico ${seq}`,
          `sintetico${seq}@example.invalid`,
          args.phone,
          args.mobilePhone ?? null,
          args.phoneSource,
          NOW,
          JSON.stringify({ source_candidate_id: CANDIDATE_ID }),
        ],
      );
      return rows[0].id as string;
    }

    /**
     * Ejecuta EXACTAMENTE la escritura de la server action: el patch que construye el
     * core, con el predicado id + account_id + procedencia OBSERVADA.
     *
     * El SQL se DERIVA del patch en vez de escribirse a mano, así que si el core
     * dejara de nular una columna este test lo reflejaría en lugar de taparlo.
     */
    async function suppress(args: {
      conn?: PgLikeClient;
      contactId: string;
      accountId?: string;
      observedPhoneSource: string;
    }): Promise<number> {
      const conn = args.conn ?? client;
      const patch = buildContactPhoneSuppressionPatch();
      const columns = Object.keys(patch);
      assert.ok(columns.length > 0);
      const setClause = columns.map((c) => `${c} = NULL`).join(', ');
      const { rows } = await conn.query(
        `UPDATE public.contacts
            SET ${setClause}
          WHERE id = $1 AND account_id = $2 AND phone_source = $3
        RETURNING id`,
        [args.contactId, args.accountId ?? ACCOUNT_A, args.observedPhoneSource],
      );
      return rows.length;
    }

    async function readContact(id: string): Promise<Record<string, unknown>> {
      const { rows } = await client.query(
        `SELECT phone, mobile_phone, phone_type, phone_source, phone_raw_type,
                phone_revealed_at, phone_processing_basis, phone_confidence
           FROM public.contacts WHERE id = $1`,
        [id],
      );
      assert.equal(rows.length, 1);
      return rows[0];
    }

    // ── 1. Lusha: el teléfono oficial se borra ─────────────────

    it('lusha_reveal: el teléfono y TODA su tupla quedan NULL en un solo UPDATE', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      assert.equal(await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' }), 1);

      const row = await readContact(id);
      assert.equal(row.phone, null, 'el teléfono Lusha debe desaparecer');
      assert.equal(row.phone_source, null);
      assert.equal(row.phone_type, null);
      assert.equal(row.phone_raw_type, null);
      assert.equal(row.phone_revealed_at, null);
      assert.equal(row.phone_processing_basis, null);
      assert.equal(row.phone_confidence, null);
    });

    it('lusha_reveal: mobile_phone SOBREVIVE — no tiene procedencia propia', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
        mobilePhone: OTHER_MOBILE,
      });

      await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' });

      const row = await readContact(id);
      assert.equal(row.phone, null);
      assert.equal(
        row.mobile_phone,
        OTHER_MOBILE,
        'mobile_phone debe quedar EXACTAMENTE igual',
      );

      // El límite se declara: la UI resuelve `mobile_phone ?? phone`, así que este
      // contacto sigue mostrando un número. Es una erasure PARCIAL, y consta.
      const erasurePartialDueToMissingMobileProvenance = row.mobile_phone !== null;
      assert.equal(erasurePartialDueToMissingMobileProvenance, true);
    });

    // ── 2. Regresión Apollo ────────────────────────────────────

    for (const source of ['apollo_reveal', 'apollo_cache']) {
      it(`${source}: el teléfono y su tupla se borran`, async () => {
        const id = await insertContact({
          phone: APOLLO_PHONE,
          phoneSource: source,
          mobilePhone: OTHER_MOBILE,
        });

        assert.equal(await suppress({ contactId: id, observedPhoneSource: source }), 1);

        const row = await readContact(id);
        assert.equal(row.phone, null);
        assert.equal(row.phone_source, null);
        assert.equal(row.phone_revealed_at, null);
        assert.equal(row.phone_confidence, null);
      });

      // 4O-E4.1: la aserción de este caso era la contraria hasta este hito. El
      // borrado de `mobile_phone` en el camino Apollo era heredado, no demostrado:
      // ningún proveedor escribe esa columna, ni hoy ni en el historial.
      it(`${source}: mobile_phone SOBREVIVE (4O-E4.1)`, async () => {
        const id = await insertContact({
          phone: APOLLO_PHONE,
          phoneSource: source,
          mobilePhone: OTHER_MOBILE,
        });

        await suppress({ contactId: id, observedPhoneSource: source });

        const row = await readContact(id);
        assert.equal(row.phone, null);
        assert.equal(
          row.mobile_phone,
          OTHER_MOBILE,
          `${source} describe la columna phone, no mobile_phone`,
        );
      });
    }

    it('el SET del UPDATE no nombra mobile_phone para NINGUNA procedencia', () => {
      // El SQL se deriva del patch; si la columna volviera al core, aparecería aquí.
      assert.equal(
        Object.keys(buildContactPhoneSuppressionPatch()).includes('mobile_phone'),
        false,
      );
    });

    // §11 — el caso obligatorio de 4O-E4.1 contra el motor real: la fila lleva un
    // teléfono de proveedor Y un celular escrito a mano; sólo el primero desaparece.
    it('CASO OBLIGATORIO: phone de proveedor borrado, celular MANUAL intacto', async () => {
      const id = await insertContact({
        phone: APOLLO_PHONE,
        phoneSource: 'apollo_reveal',
        mobilePhone: OTHER_MOBILE,
      });

      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'apollo_reveal' }),
        1,
      );

      const row = await readContact(id);
      assert.equal(row.phone, null);
      assert.equal(row.mobile_phone, OTHER_MOBILE);

      // Consecuencia declarada (§13): la UI resuelve `mobile_phone ?? phone`, así que
      // el número manual sigue siendo visible. No se compensa ocultándolo.
      assert.equal((row.mobile_phone ?? row.phone) as string | null, OTHER_MOBILE);
    });

    it('CARRERA: un celular escrito DESPUÉS de la lectura sobrevive a la erasure', async () => {
      const id = await insertContact({
        phone: APOLLO_PHONE,
        phoneSource: 'apollo_reveal',
        mobilePhone: null,
      });

      // Tx B: alguien teclea un celular en el formulario mientras la DSAR corre.
      await other.query('UPDATE public.contacts SET mobile_phone = $2 WHERE id = $1', [
        id,
        OTHER_MOBILE,
      ]);

      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'apollo_reveal' }),
        1,
      );

      const row = await readContact(id);
      assert.equal(row.phone, null, 'el teléfono con procedencia sí se borra');
      assert.equal(row.mobile_phone, OTHER_MOBILE, 'el celular manual sobrevive');
    });

    // ── 3. Preservación: sin procedencia, el teléfono vive ─────

    for (const source of ['manual', 'unknown', 'apollo_search', 'provider_payload']) {
      it(`${source}: ningún predicado de la allowlist lo alcanza`, async () => {
        const id = await insertContact({ phone: MANUAL_PHONE, phoneSource: source });

        // Se intenta con TODAS las procedencias borrables: ninguna puede tocarlo,
        // porque el predicado exige que la fila declare esa misma procedencia.
        for (const observed of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
          assert.equal(
            await suppress({ contactId: id, observedPhoneSource: observed }),
            0,
            `${observed} no debe alcanzar una fila ${source}`,
          );
        }

        const row = await readContact(id);
        assert.equal(row.phone, MANUAL_PHONE, `el teléfono ${source} debe sobrevivir`);
        assert.equal(row.phone_source, source);
      });
    }

    it('phone_source NULL: el predicado no puede casarlo (NULL nunca iguala)', async () => {
      const id = await insertContact({ phone: MANUAL_PHONE, phoneSource: null });

      for (const observed of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
        assert.equal(
          await suppress({ contactId: id, observedPhoneSource: observed }),
          0,
        );
      }

      const row = await readContact(id);
      assert.equal(row.phone, MANUAL_PHONE, 'procedencia NULL ⇒ el teléfono sobrevive');
    });

    it('otra cuenta: el filtro de cuenta sigue siendo simétrico', async () => {
      const id = await insertContact({
        accountId: ACCOUNT_B,
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      assert.equal(
        await suppress({
          contactId: id,
          accountId: ACCOUNT_A,
          observedPhoneSource: 'lusha_reveal',
        }),
        0,
      );

      const row = await readContact(id);
      assert.equal(row.phone, LUSHA_PHONE);
    });

    // ── 4. §16 — el escritor STALE afecta 0 filas ──────────────

    it('CARRERA: si el teléfono pasa a MANUAL entre la lectura y el borrado, sobrevive', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      // Tx A: la supresión LEE la fila y la clasifica como lusha_reveal.
      await client.query('BEGIN');
      const { rows: observedRows } = await client.query(
        'SELECT phone_source FROM public.contacts WHERE id = $1',
        [id],
      );
      assert.equal(observedRows[0].phone_source, 'lusha_reveal');
      await client.query('COMMIT');

      // Tx B: un escritor legítimo reemplaza el número por uno MANUAL y commitea.
      await other.query(
        `UPDATE public.contacts
            SET phone = $2, phone_source = 'manual', phone_type = NULL,
                phone_raw_type = NULL, phone_revealed_at = NULL,
                phone_processing_basis = NULL, phone_confidence = NULL
          WHERE id = $1`,
        [id, MANUAL_PHONE],
      );

      // Tx A: ejecuta su borrado con la procedencia que OBSERVÓ. Llega tarde.
      const affected = await suppress({
        contactId: id,
        observedPhoneSource: 'lusha_reveal',
      });

      assert.equal(affected, 0, 'la escritura stale debe afectar 0 filas');
      const row = await readContact(id);
      assert.equal(
        row.phone,
        MANUAL_PHONE,
        'el teléfono manual posterior debe SOBREVIVIR',
      );
      assert.equal(row.phone_source, 'manual');
    });

    it('CARRERA: un cambio Lusha → Apollo tampoco deja aplicar el patch equivocado', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
        mobilePhone: OTHER_MOBILE,
      });

      // La fila pasa a Apollo tras la lectura.
      await other.query(
        `UPDATE public.contacts SET phone_source = 'apollo_reveal' WHERE id = $1`,
        [id],
      );

      // Con la procedencia vieja el UPDATE no alcanza la fila…
      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' }),
        0,
      );
      let row = await readContact(id);
      assert.equal(row.phone, LUSHA_PHONE, 'nada se borró con la procedencia vieja');
      assert.equal(row.mobile_phone, OTHER_MOBILE);

      // …y con la procedencia REAL sí. El celular sigue intacto también aquí
      // (4O-E4.1): ninguna procedencia de `phone` lo autoriza.
      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'apollo_reveal' }),
        1,
      );
      row = await readContact(id);
      assert.equal(row.phone, null);
      assert.equal(row.mobile_phone, OTHER_MOBILE);
    });

    // ── 5. §17 — orden inverso ─────────────────────────────────

    it('ORDEN INVERSO: un teléfono manual posterior a la erasure sobrevive', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      // La erasure commitea primero y hace su trabajo.
      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' }),
        1,
      );
      assert.equal((await readContact(id)).phone, null);

      // Después, una escritura legítima añade un teléfono manual.
      await other.query(
        `UPDATE public.contacts SET phone = $2, phone_source = 'manual' WHERE id = $1`,
        [id, MANUAL_PHONE],
      );

      const row = await readContact(id);
      assert.equal(
        row.phone,
        MANUAL_PHONE,
        'E4 no prohíbe teléfonos manuales posteriores: eso es del modelo person-level',
      );
      assert.equal(row.phone_source, 'manual');
    });

    // ── 6. Atomicidad y rollback ───────────────────────────────

    it('la tupla se limpia en UN solo UPDATE: no hay estado parcial en la fila', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      // Dentro de una transacción abierta, la fila aún no ha cambiado para nadie más.
      await client.query('BEGIN');
      await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' });
      const { rows: outside } = await other.query(
        'SELECT phone, phone_source FROM public.contacts WHERE id = $1',
        [id],
      );
      assert.equal(outside[0].phone, LUSHA_PHONE, 'sin commit no se ve nada');
      assert.equal(outside[0].phone_source, 'lusha_reveal');
      await client.query('COMMIT');

      const row = await readContact(id);
      assert.equal(row.phone, null);
      assert.equal(row.phone_source, null);
    });

    it('ROLLBACK: si la transacción aborta, el teléfono queda intacto', async () => {
      const id = await insertContact({
        phone: LUSHA_PHONE,
        phoneSource: 'lusha_reveal',
      });

      await client.query('BEGIN');
      assert.equal(
        await suppress({ contactId: id, observedPhoneSource: 'lusha_reveal' }),
        1,
      );
      await client.query('ROLLBACK');

      const row = await readContact(id);
      assert.equal(row.phone, LUSHA_PHONE, 'un rollback no deja media erasure');
      assert.equal(row.phone_source, 'lusha_reveal');
      assert.equal(row.phone_confidence, 'high');
    });

    // ── 7. El CHECK real no admite vocabulario inventado ───────

    it('los CHECK de Producción rechazan una procedencia fuera del vocabulario', async () => {
      await assert.rejects(
        () =>
          client.query(
            `INSERT INTO public.contacts (account_id, full_name, phone, phone_source)
             VALUES ($1, 'X', $2, 'lusha_search')`,
            [ACCOUNT_A, LUSHA_PHONE],
          ),
        /contacts_phone_source_check/,
      );
    });

    it('todas las procedencias de la allowlist son válidas para el CHECK real', async () => {
      for (const source of SUPPRESSIBLE_CONTACT_PHONE_SOURCES) {
        const id = await insertContact({ phone: APOLLO_PHONE, phoneSource: source });
        assert.equal((await readContact(id)).phone_source, source);
      }
    });
  },
);
