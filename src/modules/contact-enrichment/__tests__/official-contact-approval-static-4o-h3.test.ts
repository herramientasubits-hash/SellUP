/**
 * Agente 2A — el CONTRATO de la migración 116 y del cableado de aprobación
 * (AGENT2A-PHONE-REVEAL-4O-H3).
 *
 * Esta suite fija lo que el SQL DICE. La hermana `…-postgres-4o-h3` demuestra lo que GARANTIZA.
 * Las dos hacen falta: un `ON CONFLICT DO NOTHING` presente no prueba que no se resucite un
 * tombstone (eso lo prueba PostgreSQL), pero su AUSENCIA sí probaría que se puede — y esa es
 * una regresión que se introduce editando una línea, no rediseñando nada.
 *
 * Varias afirmaciones son deliberadamente NEGATIVAS (no existe DELETE, no existe un
 * `suppressed_at = NULL`, no se toca `mobile_phone`). Su valor entero está en lo que IMPIDEN.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');

const migration = readFileSync(
  join(repoRoot, 'supabase/migrations/116_approve_candidate_with_official_phones.sql'),
  'utf8',
);
const approvalCore = readFileSync(
  join(repoRoot, 'src/modules/contact-enrichment/candidate-review-core.ts'),
  'utf8',
);
const persistence = readFileSync(
  join(repoRoot, 'src/modules/contact-enrichment/official-contact-approval-persistence.ts'),
  'utf8',
);
const actions = readFileSync(
  join(repoRoot, 'src/modules/contact-enrichment/actions.ts'),
  'utf8',
);

/**
 * SÓLO el cuerpo ejecutable de la función, sin comentarios.
 *
 * Recortar aquí es load-bearing: la cabecera y el `COMMENT ON FUNCTION` describen EN PROSA
 * justo lo que estas pruebas afirman que no ocurre ("nunca toca mobile_phone", "promueve a
 * contact_phones"), así que medir sobre el archivo entero mediría la documentación en vez del
 * código — y una afirmación negativa que casa con su propia explicación no afirma nada.
 */
const fnStart = migration.indexOf('AS $function$');
const fnEnd = migration.indexOf('$function$;');
assert.ok(fnStart > 0 && fnEnd > fnStart, 'no se pudo aislar el cuerpo de la función');
const body = migration
  .slice(fnStart, fnEnd)
  .split('\n')
  .map((line) => {
    const at = line.indexOf('--');
    return at === -1 ? line : line.slice(0, at);
  })
  .join('\n');

const declaration = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.approve_contact_candidate_with_phones'),
  fnStart + 'AS $function$'.length,
);

/** Quita comentarios de línea y de bloque de una fuente TypeScript. */
const stripTs = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

/**
 * Devuelve el fragmento del cuerpo entre dos marcadores de paso. Los marcadores viven en
 * comentarios, que `body` ya eliminó, así que se localizan sobre el texto ORIGINAL y luego se
 * mapea el trozo equivalente ya limpio.
 */
function step(from: string, to: string): string {
  const a = migration.indexOf(from, fnStart);
  const b = migration.indexOf(to, a + 1);
  assert.ok(a > 0 && b > a, `no se encontró el tramo ${from} → ${to}`);
  return migration
    .slice(a, b)
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

describe('4O-H3 — la migración 116 declara una transacción, no una secuencia', () => {
  it('crea la función de aprobación con la firma esperada', () => {
    assert.match(
      declaration,
      /CREATE OR REPLACE FUNCTION public\.approve_contact_candidate_with_phones\(/,
    );
    for (const param of [
      'p_candidate_id',
      'p_account_id',
      'p_contact_payload',
      'p_review_patch',
      'p_scalar_fallback',
      'p_actor_id',
      'p_now',
    ]) {
      assert.ok(declaration.includes(param), `falta el parámetro ${param}`);
    }
  });

  it('es SECURITY INVOKER con search_path fijado y objetos cualificados por esquema', () => {
    assert.match(declaration, /SECURITY INVOKER/);
    assert.equal(declaration.includes('SECURITY DEFINER'), false);
    assert.match(declaration, /SET search_path = pg_catalog, pg_temp/);
    // Ninguna referencia a una tabla del dominio sin `public.`
    for (const table of [
      'contact_phones',
      'contact_phone_sources',
      'contact_enrichment_candidates',
      'contact_enrichment_candidate_phones',
      'contacts',
      'accounts',
    ]) {
      const bare = new RegExp(`(FROM|JOIN|INTO|UPDATE)\\s+${table}\\b`, 'i');
      assert.equal(bare.test(body), false, `${table} debe ir cualificada con public.`);
    }
  });

  it('bloquea el candidato ANTES de decidir nada', () => {
    const lockAt = body.indexOf('FOR UPDATE');
    assert.ok(lockAt > 0, 'debe existir un FOR UPDATE');
    const insertAt = body.indexOf('INSERT INTO public.contacts');
    assert.ok(insertAt > lockAt, 'el contacto se crea DESPUÉS de tomar el lock del candidato');
    const suppressionAt = body.indexOf('phone_reveal_person_suppression_exists');
    assert.ok(
      suppressionAt > lockAt && suppressionAt < insertAt,
      'la supresión por persona se re-comprueba bajo el lock y antes de crear el contacto',
    );
  });

  it('reutiliza los helpers de supresión de la 113 y no inventa un segundo modelo', () => {
    assert.match(body, /public\.phone_reveal_person_suppression_exists\(/);
    assert.match(body, /public\.phone_reveal_normalized_apollo_person_id\(/);
    // Ninguna inferencia por teléfono, email, nombre o LinkedIn.
    for (const forbidden of ['email', 'full_name', 'linkedin']) {
      const inSuppression = step(
        'Step 4 — PERSON suppression',
        'Step 5 — create the contact',
      ).includes(forbidden);
      assert.equal(inSuppression, false, `la supresión no puede inferirse por ${forbidden}`);
    }
  });

  it('NUNCA borra una fila ni resucita un tombstone', () => {
    assert.equal(/\bDELETE\s+FROM\b/i.test(body), false, 'no existe ningún DELETE');
    assert.equal(/\bTRUNCATE\b/i.test(body), false);
    // Ningún statement devuelve a la vida una fila suprimida.
    assert.equal(
      /suppressed_at\s*=\s*NULL/i.test(body),
      false,
      'no existe ningún `suppressed_at = NULL`',
    );
    // Toda inserción canónica es DO NOTHING ante un conflicto de clave.
    const canonicalInserts = body.match(/INSERT INTO public\.contact_phones\b/g) ?? [];
    assert.ok(canonicalInserts.length >= 2, 'hay al menos dos inserciones canónicas');
    const doNothing = body.match(/ON CONFLICT \(contact_id, dedupe_key\) DO NOTHING/g) ?? [];
    assert.equal(
      doNothing.length,
      canonicalInserts.length,
      'cada INSERT canónico lleva su ON CONFLICT DO NOTHING',
    );
  });

  it('sólo promueve teléfonos VIVOS del candidato', () => {
    const promotion = step('Step 6 — promote the LIVE candidate collection', 'Step 7 — the scalar-only candidate');
    assert.ok(
      promotion.includes('p.suppressed_at IS NULL'),
      'la promoción filtra los tombstones de staging',
    );
    assert.ok(
      promotion.includes('op.suppressed_at IS NULL'),
      'una procedencia nueva nunca cuelga de una fila oficial ya suprimida',
    );
  });

  it('el paso terminal re-afirma `pending_review` y ABORTA si no escribió', () => {
    // Defensa en profundidad, no un camino vivo: mientras el lock del candidato se sostenga,
    // este UPDATE siempre casa una fila. Si el lock faltara, la guarda haría que la aprobación
    // perdedora abortara —arrastrando el contacto que ya había insertado— en vez de dejar un
    // contacto que nadie aprobó. Por eso se fija aquí y no se reclama como rama ejercitada.
    const terminal = step('Step 10 — terminalise the candidate', 'Step 11');
    assert.ok(terminal.includes("AND status = 'pending_review'"));
    assert.match(terminal, /RAISE EXCEPTION/);
    assert.match(terminal, /ERRCODE = 'serialization_failure'/);
    // Y el `matched_contacts_id` lo escribe la transacción, no el llamador.
    assert.ok(terminal.includes('matched_contacts_id = v_contact_id'));
  });

  it('la clave de evento oficial NO es la de staging verbatim', () => {
    assert.match(body, /'v1:promoted:'/);
    // Y no contiene el id del candidato: la misma observación pagada promovida bajo dos
    // candidatos debe colapsar en una sola procedencia oficial.
    const keyLines = body.split('\n').filter((l) => l.includes('v1:promoted:'));
    assert.ok(keyLines.length > 0);
    for (const line of keyLines) {
      assert.equal(
        line.includes('candidate_id') || line.includes('p_candidate_id'),
        false,
        'la clave oficial no puede llevar el id del candidato',
      );
    }
  });

  it('NO toca `mobile_phone` ni escribe `phone_confidence`', () => {
    const contactUpdates = step('Step 9 — project the legacy scalar tuple', 'Step 10');
    assert.equal(
      /\bmobile_phone\b/.test(contactUpdates),
      false,
      'MOBILE_PHONE_PROVENANCE_PENDING (4O-E4.1) sigue en pie',
    );
    assert.equal(
      /phone_confidence\s*=/.test(body),
      false,
      'phone_confidence sigue siendo la columna muerta que 4O-E4 encontró',
    );
  });

  it('no llama a ningún proveedor, no mueve créditos y no escribe contabilidad', () => {
    for (const forbidden of [
      'provider_usage_logs',
      'phone_reveal_credit_reservations',
      'phone_reveal_waterfall_runs',
      'wizard_budget_reservations',
      'http_post',
      'pg_net',
      'hubspot',
    ]) {
      assert.equal(
        new RegExp(`(INSERT INTO|UPDATE)\\s+public\\.${forbidden}\\b`, 'i').test(body),
        false,
        `la aprobación no puede escribir ${forbidden}`,
      );
    }
  });

  it('EXECUTE revocado a PUBLIC/anon/authenticated y concedido sólo a postgres+service_role', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      assert.ok(
        new RegExp(`REVOKE ALL ON FUNCTION[\\s\\S]*?FROM ${role};`).test(migration),
        `falta el REVOKE a ${role}`,
      );
    }
    assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO postgres, service_role;/);
  });

  it('es RETROCOMPATIBLE: no altera ninguna tabla, columna, índice, política ni grant previos', () => {
    // Éste es el requisito que hace seguro el despliegue SCHEMA-FIRST: la migración puede
    // aplicarse mientras el runtime de la H2 sigue vivo, porque no cambia nada que ese runtime
    // use. Sólo añade UNA función.
    assert.equal(/\bALTER TABLE\b/i.test(migration), false);
    assert.equal(/\bDROP\b/i.test(migration), false);
    assert.equal(/\bCREATE TABLE\b/i.test(migration), false);
    assert.equal(/\bCREATE INDEX\b/i.test(migration), false);
    assert.equal(/\bCREATE UNIQUE INDEX\b/i.test(migration), false);
    assert.equal(/\bCREATE POLICY\b/i.test(migration), false);
    assert.equal(/\bCREATE TRIGGER\b/i.test(migration), false);
    // Ni amplía privilegios sobre las tablas de la 114.
    assert.equal(
      /GRANT[^;]*ON TABLE public\.contact_phone/i.test(migration),
      false,
      'la 116 no puede ampliar el techo de privilegios de la 114',
    );
    // Y no reemplaza la función de la H2.
    assert.equal(migration.includes('suppress_official_contact_phone_sources('), false);
    const created = migration.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
    assert.deepEqual(created, [
      'CREATE OR REPLACE FUNCTION public.approve_contact_candidate_with_phones',
    ]);
  });

  it('declara explícitamente que NO se aplicó en Producción', () => {
    assert.match(migration, /APPLIED IN PRODUCTION: NO/);
  });
});

describe('4O-H3 — el runtime tiene UNA sola autoridad transaccional', () => {
  it('el core de aprobación ya no expone `insertContact`', () => {
    assert.equal(
      stripTs(approvalCore).includes('insertContact'),
      false,
      'el par INSERT + UPDATE sueltos desapareció del contrato',
    );
    assert.ok(approvalCore.includes('approveTransactionally'));
  });

  it('la server action no vuelve a insertar en `contacts` durante la aprobación', () => {
    const approveBlock = actions.slice(
      actions.indexOf('export async function approveContactCandidate('),
      actions.indexOf('// ── Bulk Enrichment Actions'),
    );
    assert.ok(approveBlock.length > 0);
    assert.equal(
      /\.from\('contacts'\)[\s\S]{0,80}\.insert\(/.test(approveBlock),
      false,
      'no puede quedar una segunda implementación de la inserción del contacto',
    );
    assert.ok(approveBlock.includes('approveContactCandidateWithPhones'));
  });

  it('la persistencia hace exactamente UNA llamada RPC y ninguna escritura suelta', () => {
    const persistenceCode = stripTs(persistence);
    const rpcCalls = persistenceCode.match(/\.rpc\(/g) ?? [];
    assert.equal(rpcCalls.length, 1);
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(
        persistenceCode.includes(forbidden),
        false,
        `la persistencia no puede contener ${forbidden}`,
      );
    }
  });

  it('la persistencia no reintenta a ciegas tras un fallo', () => {
    assert.ok(persistence.includes('throw new Error'));
    assert.equal(/\bretry\b/i.test(stripTs(persistence)), false);
  });

  it('ni el core ni la persistencia llaman a proveedores, presupuesto o HubSpot', () => {
    for (const source of [approvalCore, persistence]) {
      const code = stripTs(source);
      for (const forbidden of [
        'apollo-client',
        'lusha-client',
        'reveal_phone_number',
        'reserveBudget',
        'logProviderUsage',
        'hubspot-contact-sync',
        'hubspot-company-create',
        'syncContactToHubSpot',
      ]) {
        assert.equal(
          code.includes(forbidden),
          false,
          `la aprobación no puede referenciar ${forbidden}`,
        );
      }
    }
  });

  it('la auditoría ocurre FUERA de la transacción y sólo tras crear el contacto', () => {
    const auditAt = approvalCore.indexOf('deps.logAudit?.(');
    const txAt = approvalCore.indexOf('deps.approveTransactionally(');
    assert.ok(txAt > 0 && auditAt > txAt, 'la auditoría es posterior al COMMIT');
    assert.ok(
      approvalCore.includes('if (!approved.alreadyApproved)'),
      'una aprobación idempotente no vuelve a auditar una creación que no ocurrió',
    );
  });
});
