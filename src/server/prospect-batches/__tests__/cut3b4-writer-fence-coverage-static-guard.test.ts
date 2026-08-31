/**
 * AGENT1-CUT3B4 — guarda de cobertura: NINGÚN escritor de B23 puede saltarse la
 * valla una vez la migración 126 esté aplicada.
 *
 * Por qué es estática. La afirmación «no existe un desvío» es sobre TODO el árbol
 * de producción, no sobre una ejecución concreta: una prueba de comportamiento
 * pasa por los caminos que recorre, y el desvío que importa es justamente el que
 * nadie recorre en las pruebas. Esta suite lee las fuentes REALES.
 *
 * Metodología heredada de CUT-3B1/B23: se compara el CUERPO EJECUTABLE, sin
 * comentarios ni literales, porque nombrar algo en prosa no es usarlo en código.
 * Donde el literal ES estructura ejecutable —un discriminante de unión, una ruta
 * de import— se usa el cuerpo con literales y se dice. La guarda se prueba a sí
 * misma en NEGATIVO al final.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 proveedores,
 * 0 créditos, 0 migraciones aplicadas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

const WRITER_A = 'src/server/agents/prospecting-toolkit/candidate-writer.ts';
const WRITER_B = 'src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts';
const WRITER_C_CORE = 'src/server/prospect-batches/lusha-pending-review.ts';
const WRITER_C_WIRING = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';

const FENCE = 'src/server/prospect-batches/batch-identity-fence.ts';
const LOOP = 'src/server/prospect-batches/batch-identity-fenced-persistence.ts';
const STORE = 'src/server/prospect-batches/batch-identity-registry-store.ts';
const REGISTRY = 'src/server/agents/prospecting-toolkit/batch-identity-registry.ts';
const EVIDENCE = 'src/server/agents/prospecting-toolkit/company-identity-evidence.ts';

const MIGRATION = 'supabase/migrations/126_agent1_batch_identity_atomicity.sql';
const AGENT2A_MIGRATION = 'supabase/migrations/124_cross_provider_phone_identity.sql';

/** Elimina comentarios de bloque, de línea y literales de cadena. */
export function stripNonExecutable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/** Elimina SÓLO comentarios: para aserciones donde el literal ES el código. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}
const executableBody = (r: string) => stripNonExecutable(read(r));
const bodyWithLiterals = (r: string) => stripComments(read(r));

// ═══════════════════════════════════════════════════════════════════════════
// §§ 20/21/22 — los tres escritores pasan por la MISMA valla
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 §§ 20/21/22 — cobertura de los tres escritores', () => {
  for (const [label, path] of [
    ['el escritor de PAGO (asistente)', WRITER_A],
    ['el escritor GRATUITO (fuente estructurada)', WRITER_B],
  ] as const) {
    it(`${label} persiste a través del bucle compartido`, () => {
      const body = executableBody(path);
      assert.ok(
        body.includes('runFencedPersistence('),
        `${path} dejó de usar el bucle vallado compartido`,
      );
    });

    it(`${label} NO implementa su propio bucle de reintento`, () => {
      // Tres políticas de concurrencia serían tres políticas distintas, y la
      // tercera divergiría en la primera corrección.
      const body = executableBody(path);
      assert.equal(
        body.includes('MAX_IDENTITY_EPOCH_RETRIES'),
        false,
        `${path} conoce el tope: el bucle tiene que ser el compartido`,
      );
      assert.equal(
        body.includes('insertFencedProspectCandidates('),
        false,
        `${path} llama al primitivo a pelo, saltándose el bucle`,
      );
    });

    it(`${label} RE-EVALÚA con la autoridad de B23 dentro del plan`, () => {
      // 🔴 Lo que impide que exista un SEGUNDO evaluador de duplicados: el plan
      // que el bucle vuelve a llamar tras un `stale` tiene que preguntar a
      // `evaluateCandidateIdentity`, no a una copia.
      const body = bodyWithLiterals(path);
      const planStart = body.indexOf('plan: (snap)');
      assert.ok(planStart > 0, `${path} no expone un plan re-evaluable`);
      const planBlock = body.slice(planStart, planStart + 700);
      assert.ok(
        planBlock.includes('evaluateCandidateIdentity(snap.registry'),
        `${path} re-evalúa contra algo que no es la foto recargada`,
      );
      assert.ok(
        planBlock.includes('isBatchIdentityHardDuplicate('),
        `${path} decide el duplicado sin la autoridad de B23`,
      );
    });
  }

  it('la ruta de LUSHA escribe su bloque a través de la dependencia VALLADA', () => {
    const core = bodyWithLiterals(WRITER_C_CORE);
    assert.ok(
      core.includes('deps.insertCandidatesFenced'),
      'el núcleo de Lusha dejó de declarar la escritura vallada',
    );
    const wiring = bodyWithLiterals(WRITER_C_WIRING);
    assert.ok(
      wiring.includes('insertCandidatesFenced:'),
      'el wiring real de Lusha dejó de implementar la escritura vallada',
    );
    assert.ok(
      wiring.includes('insertFencedProspectCandidates(supabase'),
      'la dependencia vallada de Lusha dejó de apuntar al transporte canónico',
    );
  });

  it('🔴 la ruta de LUSHA adopta, y por eso su época NO puede ser un literal', () => {
    // ── REANCLADA por AGENT1-LOCAL-CUT9A § 4 ────────────────────────────────
    //
    // Esta guarda decía «Lusha NO adopta lotes preexistentes», y dejaba escrito
    // qué había que hacer el día que eso cambiara: «la constante tiene que cambiar
    // con ello y esta guarda lo obliga». Ese día es éste, así que la guarda no se
    // retira — se REAPUNTA a la obligación que aquella dejó pendiente.
    //
    // Lo que protegía entonces: que la escritura en bloque pudiera prescindir de
    // la re-evaluación porque nadie más conocía ese `batchId`.
    // Lo que protege ahora: que la ADOPCIÓN no escriba contra una época inventada.
    // Es la MISMA propiedad —la escritura declara contra qué estado decidió— sobre
    // un mundo en el que el lote sí puede venir de otra mitad de la ejecución.
    const source = read(WRITER_C_CORE);
    assert.ok(
      source.includes('export const LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED = true;'),
      'la ruta de Lusha dejó de declarar que adopta el lote canónico de su ejecución',
    );

    // 🔴 Se mide DENTRO de `persistLushaPendingReviewBatch`, no en el archivo entero:
    // los constructores de resultado vecinos reciben su propio `input` con un
    // `batchId` que ya viene resuelto, y confundirlos con la entrada del escritor
    // haría fallar la guarda por leer el archivo en vez de la función.
    const body = bodyWithLiterals(WRITER_C_CORE);
    const persistStart = body.indexOf('export async function persistLushaPendingReviewBatch');
    assert.ok(persistStart > 0, 'no se encontró el escritor de Lusha');
    const persistBody = body.slice(persistStart);

    // 1. El lote nace de una RESERVA, no de un INSERT incondicional.
    assert.ok(
      persistBody.includes('const reservation = await deps.reserveBatch('),
      'el lote de Lusha dejó de nacer de `deps.reserveBatch` (reserve-or-return)',
    );
    assert.equal(
      /deps\.insertBatch\(/.test(persistBody),
      false,
      'volvió el INSERT incondicional de lote en la ruta de Lusha',
    );

    // 2. La entrada del escritor SIGUE sin traer lote: la adopción es del
    //    resolutor canónico de la ejecución, nunca un `batchId` de parámetro.
    assert.equal(
      /input\.batchId/.test(persistBody),
      false,
      'la entrada de Lusha empezó a traer un lote por parámetro',
    );

    // 3. 🔴 La época NO es un literal — y desde CUT9A-FIX-ADOPTED-EPOCH-REFRESH
    //    tampoco sale de la RESERVA.
    //
    //    La propiedad protegida es la MISMA que antes: la escritura declara contra
    //    el estado sobre el que decidió. Lo que cambió es QUIÉN es ese estado.
    //    Tomarlo de la reserva parecía suficiente mientras se creyó que la reserva
    //    traía la época del lote; V9A.1 demostró que trae la del NACIMIENTO del
    //    lote, porque el resolutor canónico memoiza el objeto entero. En la ruta
    //    gratuita→pago la capa gratuita ya había avanzado la época, así que la
    //    reserva declaraba un estado caduco y la valla respondía `stale` —bien— tras
    //    haber pagado al proveedor.
    //
    //    Por eso la guarda se REORIENTA, no se retira: ahora exige la lectura
    //    ACTUAL y PROHÍBE volver a la reserva, que es exactamente el defecto.
    const fenceCall = persistBody.slice(
      persistBody.indexOf('await deps.insertCandidatesFenced({'),
    );
    assert.ok(
      /expectedEpoch: epochEvidence\.epoch/.test(fenceCall),
      'la escritura vallada de Lusha dejó de tomar la época de la LECTURA ACTUAL',
    );
    assert.equal(
      /reservation\.(identityEpoch|adopted)/.test(fenceCall),
      false,
      'la época de la escritura vallada de Lusha volvió a salir de la reserva memoizada (defecto V9A.1)',
    );
    // Y la lectura ACTUAL existe, ocurre ANTES de la valla y es la del lote de ESTA
    // ejecución: sin esto, `epochEvidence` podría ser cualquier cosa.
    const freshRead = 'const epochEvidence = await deps.readBatchIdentityEpoch(batchId);';
    assert.ok(
      persistBody.includes(freshRead),
      'la mitad de pago de Lusha dejó de releer la época ACTUAL de su lote canónico',
    );
    assert.ok(
      persistBody.indexOf(freshRead) <
        persistBody.indexOf('await deps.insertCandidatesFenced({'),
      'la relectura de época dejó de preceder a la escritura vallada',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 10/26 — no hay desvío directo, y la única excepción la decide la BASE
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 10 — ningún desvío sin valla', () => {
  it('🔴 agotar el tope NO puede caer a un insert directo', () => {
    const loop = bodyWithLiterals(LOOP);
    const start = loop.indexOf("status: 'retry_exhausted'");
    assert.ok(start > 0, 'el bucle dejó de tener desenlace de tope agotado');
    // Entre el desenlace y el final de su bloque no puede haber escritura alguna.
    const block = loop.slice(start, start + 600);
    for (const write of ['.insert(', '.rpc(', '.upsert(', 'legacyInsert', 'insertCandidates(']) {
      assert.equal(block.includes(write), false, `el tope agotado escribe con ${write}`);
    }
  });

  it('🔴 el bucle está ACOTADO: el tope existe y es un número pequeño', () => {
    const fence = read(FENCE);
    const match = fence.match(/export const MAX_IDENTITY_EPOCH_RETRIES = (\d+);/);
    assert.ok(match, 'el tope de reintentos desapareció');
    const max = Number.parseInt(match[1], 10);
    assert.ok(max >= 1 && max <= 10, `tope fuera de rango razonable: ${max}`);
  });

  it('🔴 los módulos de la valla NO leen entorno ni flag alguno', () => {
    // La elección entre ruta vallada y ruta anterior a B4 la decide la BASE. Estos
    // tres módulos son los únicos que participan en esa decisión, y ninguno puede
    // consultar el entorno: un flag convertiría una garantía de esquema en una
    // preferencia de despliegue.
    for (const path of [LOOP, STORE, FENCE]) {
      const body = executableBody(path);
      for (const forbidden of [
        'process.env',
        'ENABLE_APOLLO_COMPANY_SEARCH',
        'ENABLE_LUSHA_PREVIEW',
        'ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING',
        'ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE',
      ]) {
        assert.equal(
          body.includes(forbidden),
          false,
          `${path} elige la ruta de escritura con ${forbidden}`,
        );
      }
    }
  });

  it('🔴 en los escritores, la rama anterior a B4 la discrimina `capability_absent`', () => {
    // Los escritores SÍ leen entorno para otras cosas (proveedores, límites), así
    // que la guarda no puede ser sobre el archivo entero: se mide el DISCRIMINANTE
    // de la rama, que es lo que decide si se escribe con valla o sin ella.
    for (const path of [WRITER_A, WRITER_B, WRITER_C_CORE]) {
      const body = bodyWithLiterals(path);
      assert.ok(
        body.includes("=== 'capability_absent'") || body.includes("'capability_absent'"),
        `${path} dejó de discriminar la rama anterior a B4 por la respuesta de la base`,
      );
    }
  });

  it('🔴 «la 126 no está aplicada» se reconoce de forma ESTRECHA, por código', () => {
    const body = bodyWithLiterals(FENCE);
    // Los dos códigos, y sólo ellos: PostgREST y PostgreSQL.
    assert.ok(body.includes("'42883'"), 'dejó de reconocer el undefined_function de PostgreSQL');
    assert.ok(body.includes("'PGRST202'"), 'dejó de reconocer el PGRST202 de PostgREST');
    // Y ningún comodín que convierta cualquier avería en «todavía no aplicada».
    const detector = body.slice(
      body.indexOf('export function isMissingFenceCapabilityError'),
      body.indexOf('function asRecord'),
    );
    assert.ok(detector.length > 0);
    assert.equal(
      detector.trim().endsWith('return true;'),
      false,
      'el detector degrada por defecto: cualquier error pasaría por migración ausente',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 11 — la política de identidad NO se duplica
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 § 11 — una sola autoridad de identidad', () => {
  it('la valla y su bucle NO conocen identidad: ni fiscal, ni dominio, ni LinkedIn', () => {
    for (const path of [FENCE, LOOP]) {
      const body = executableBody(path);
      for (const forbidden of [
        'normalizeTaxId',
        'buildFiscalIdentityKey',
        'normalizeDomain',
        'normalizeLinkedinUrl',
        'canonicalizeCompanyName',
        'buildCompanyIdentityEvidence',
      ]) {
        assert.equal(body.includes(forbidden), false, `${path} implementa identidad: ${forbidden}`);
      }
    }
  });

  it('la autoridad fiscal y el constructor de evidencia siguen donde estaban', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'src/server/agents/prospecting-toolkit/fiscal-identity.ts')));
    assert.ok(existsSync(join(REPO_ROOT, EVIDENCE)));
    assert.ok(existsSync(join(REPO_ROOT, REGISTRY)));
    assert.ok(
      bodyWithLiterals(EVIDENCE).includes("from './fiscal-identity'"),
      'la evidencia dejó de delegar en la autoridad fiscal de CUT-3B1',
    );
  });

  it('🔴 el bucle NO implementa un segundo evaluador de duplicados', () => {
    const body = executableBody(LOOP);
    for (const forbidden of ['hardMatches', 'matchedTier', 'fiscalIdentityKey', 'normalizedDomain']) {
      assert.equal(
        body.includes(forbidden),
        false,
        `el bucle reimplementa la decisión de identidad: ${forbidden}`,
      );
    }
  });

  it('🔴 los estados que OCUPAN el lote viajan como PARÁMETRO, no escritos en SQL', () => {
    const store = bodyWithLiterals(STORE);
    assert.ok(
      store.includes('p_blocking_statuses: [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES]'),
      'la lista de estados dejó de viajar desde TypeScript',
    );
    const sql = read(MIGRATION)
      .replace(/^\s*--.*$/gm, ' ')
      .replace(/'(?:''|[^'])*'/g, "''");
    for (const status of ['generated', 'normalized', 'needs_review', 'converted_to_account']) {
      assert.equal(
        sql.includes(status),
        false,
        `la migración escribe el estado ${status}: sería una segunda autoridad de admisión`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 6/29/30 — la migración: creada, no aplicada, y sin tocar Agente 2A
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-3B4 §§ 6/29/30 — el alcance de la migración', () => {
  it('la 126 es la ÚNICA migración que introduce este corte', () => {
    // 🔴 BR-SOURCE CUT A.1 (reconciliación de esquema de producción antes de CUT B) reclamó
    // independientemente el 127 —renombrando dos veces su propia migración de Brasil, 125→126→127,
    // tras que este corte tomara el 126 primero— mientras esa reconciliación seguía en revisión.
    // Lo que esta guarda defiende es AUTORÍA, no el número más alto: la 127 no menciona
    // `AGENT1-CUT3B4` en absoluto, así que la afirmación «este corte aporta exactamente una
    // migración, y es la 126» sigue siendo verdad palabra por palabra.
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort();
    const authored = migrations.filter((f) =>
      read(`supabase/migrations/${f}`).includes('AGENT1-CUT3B4'),
    );
    assert.deepEqual(authored, ['126_agent1_batch_identity_atomicity.sql']);
    // 🔴 AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 reclamó después el 128: la
    // proyección de la colección de teléfonos de un candidato ya APROBADO al contacto que su
    // aprobación creó. Y AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 reclamó luego el tramo
    // 129–132 al canonicalizar la cadena de sincronización con HubSpot de Agente 2. Mismo
    // razonamiento que con la 127: lo que esta guarda defiende es AUTORÍA, no el número más
    // alto, y ninguna de las cinco menciona `AGENT1-CUT3B4` — lo que la lista `authored` de
    // arriba ya comprueba de forma exhaustiva sobre TODAS las migraciones del repo, incluidas
    // las que aún no existían cuando se escribió.
    // 🔴 BR-PRODUCTION-RELEASE reclamó después la 133: la promoción VALLADA de la identidad
    // fiscal resuelta de una candidata brasileña (BR-SOURCE CUT D). Mismo razonamiento que con la
    // 127, la 128 y el tramo 129–132: lo que esta guarda defiende es AUTORÍA, no el número más
    // alto. La 133 es de hecho la CONSUMIDORA de la valla que este corte creó —reutiliza
    // `identity_epoch` y la 126 en vez de declarar una segunda valla—, y no menciona
    // `AGENT1-CUT3B4`, lo que la lista `authored` de arriba ya comprueba de forma exhaustiva
    // sobre TODAS las migraciones del repo, incluidas las que aún no existían al escribirla.
    const CEILING = '133_br_candidate_identity_promotion.sql';
    assert.equal(migrations[migrations.length - 1], CEILING);
    for (const foreign of [
      '127_br_receita_monthly_snapshot_identity.sql',
      '128_project_approved_candidate_phones_onto_contact.sql',
      '129_agent2_contact_hubspot_stale_completeness.sql',
      '130_agent2_contact_hubspot_stale_source.sql',
      '131_agent2_post_approval_reveal_stale_producer.sql',
      '132_agent2_hubspot_legacy_sync_state_backfill.sql',
      CEILING,
    ]) {
      assert.equal(
        read(`supabase/migrations/${foreign}`).includes('AGENT1-CUT3B4'),
        false,
        `${foreign} no puede ser autoría de este corte`,
      );
    }
    // Sin huecos: el conteo se mueve con el techo real del repositorio, no con el de este corte.
    assert.equal(migrations.length, 133);
  });

  it('🔴 la 124 (Agente 2A) queda intacta, y la 126 no depende de ella', () => {
    const b4 = read(MIGRATION);
    for (const agent2a of [
      'contact_provider_identities',
      'phone_reveal',
      'contact_enrichment',
      'provider_suppressions',
      'operation_key',
    ]) {
      assert.equal(
        b4.includes(agent2a),
        false,
        `la 126 nombra un objeto de Agente 2A: ${agent2a}`,
      );
    }
    // Y la 124 sigue siendo suya: este corte no la edita.
    assert.ok(read(AGENT2A_MIGRATION).length > 0);
    assert.equal(
      read(AGENT2A_MIGRATION).includes('AGENT1-CUT3B4'),
      false,
      'este corte editó la migración de Agente 2A',
    );
  });

  it('🔴 la migración declara NO estar aplicada en Producción', () => {
    const sql = read(MIGRATION);
    assert.ok(
      /NO esté aplicada|SIN aplicar/.test(sql),
      'la migración dejó de declarar que no está aplicada',
    );
  });

  it('la migración NO usa SQL dinámico ni nombres construidos en ejecución', () => {
    const sql = read(MIGRATION)
      .replace(/^\s*--.*$/gm, ' ')
      .replace(/'(?:''|[^'])*'/g, "''")
      .toUpperCase();
    // 🔴 `GRANT EXECUTE` / `REVOKE ALL ON FUNCTION` NO son SQL dinámico: son
    // privilegios. Lo que se prohíbe es el `EXECUTE` de plpgsql, que es el que
    // ejecuta una cadena construida en tiempo de ejecución.
    const withoutGrants = sql
      .replace(/GRANT EXECUTE/g, ' ')
      .replace(/REVOKE ALL ON FUNCTION/g, ' ');
    for (const forbidden of ['EXECUTE ', 'FORMAT(', 'QUOTE_IDENT', '|| P_']) {
      assert.equal(
        withoutGrants.includes(forbidden),
        false,
        `la migración usa SQL dinámico: ${forbidden}`,
      );
    }
    // El INSERT apunta ESTÁTICAMENTE a una tabla nombrada en el propio archivo.
    assert.ok(read(MIGRATION).includes('INSERT INTO public.prospect_candidates'));
  });

  it('la migración usa SECURITY INVOKER con `search_path` fijado', () => {
    // Cuerpo EJECUTABLE: la prosa que EXPLICA por qué son INVOKER no puede contar
    // como una tercera función.
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, ' ');
    const invokers = sql.match(/SECURITY INVOKER/g) ?? [];
    assert.equal(invokers.length, 2, 'las dos funciones tienen que ser SECURITY INVOKER');
    assert.equal(
      sql.includes('SECURITY DEFINER'),
      false,
      'ninguna función de este corte necesita DEFINER',
    );
    // CUT-3B5. Este trinquete EXIGÍA `pg_catalog, pg_temp`, y por tanto habría
    // bloqueado la corrección que el preflight de Producción obligó a hacer: con ese
    // camino restringido, la ejecución anidada de RLS —`has_active_access`, que en
    // Producción no fija `search_path` y nombra `internal_users` sin cualificar— muere
    // con 42P01 y la ruta de Lusha deja de persistir candidatos.
    //
    // `public` entra en el camino, y `pg_catalog` sigue PRIMERO para conservar la
    // precedencia del catálogo. Que la siembra en `public` no sea explotable se mide
    // aparte, contra privilegios reales, en la suite de PostgreSQL de CUT-3B5.
    const paths = sql.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? [];
    assert.equal(paths.length, 2, 'las dos funciones tienen que fijar `search_path`');
    assert.equal(
      /SET search_path = pg_catalog, pg_temp/.test(sql),
      false,
      'sobrevive el `search_path` restringido que el preflight de Producción bloqueó',
    );
    // `anon` y PUBLIC quedan fuera, y se revoca primero porque en Supabase toda
    // función nace ejecutable por PUBLIC.
    assert.equal((sql.match(/FROM PUBLIC;/g) ?? []).length, 2);
    assert.equal((sql.match(/FROM anon;/g) ?? []).length, 2);
    assert.equal(sql.includes('TO anon'), false, 'anon no puede ejecutar la valla');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CUT-3B4-CORRECCIÓN § 7 — el trinquete PRUEBA el predicado, no lo enuncia
//
// La guarda anterior decía «la única excepción la decide la BASE» y no lo
// demostraba: comprobaba que la palabra `capability_absent` apareciera, y con eso
// pasaba un bucle que autorizaba la ruta legada con `epoch === null` a secas. Este
// bloque comprueba la CONJUNCIÓN, la MONOTONÍA y la obligatoriedad de la
// dependencia vallada, y cada aserción se prueba a sí misma en negativo.
// ═══════════════════════════════════════════════════════════════════════════

/** El cuerpo del predicado de autorización, aislado del resto del módulo. */
function provenPredicateBody(): string {
  const body = bodyWithLiterals(LOOP);
  const start = body.indexOf('export function isProvenFenceCapabilityAbsent');
  assert.ok(start > 0, 'desapareció el predicado de autorización');
  const end = body.indexOf('\n}', start);
  assert.ok(end > start);
  return body.slice(start, end);
}

describe('CUT-3B4-CORRECCIÓN § 7 — la ruta legada exige ausencia PROBADA', () => {
  it('🔴 el predicado exige las TRES condiciones, y las tres están escritas', () => {
    const predicate = provenPredicateBody();
    assert.ok(
      /snapshot\.epoch === null/.test(predicate),
      'el predicado dejó de exigir que no haya época',
    );
    assert.ok(
      /snapshot\.fenceCapabilityAbsent === true/.test(predicate),
      'el predicado dejó de exigir la PRUEBA de esquema',
    );
    assert.ok(
      /snapshot\.degraded === false/.test(predicate),
      'el predicado dejó de exigir que la lectura NO haya degradado',
    );
    // Conjunción, no disyunción: un `||` aquí volvería a autorizar de más.
    assert.equal(
      predicate.includes('||'),
      false,
      'el predicado combina las condiciones con OR: cualquiera de ellas autorizaría',
    );
    assert.equal((predicate.match(/&&/g) ?? []).length, 2, 'faltan conjunciones');
  });

  it('🔴 `epoch === null` A SECAS ya no decide la ruta legada en el bucle', () => {
    const body = bodyWithLiterals(LOOP);
    const branch = body.indexOf('if (snapshot.epoch === null)');
    assert.ok(branch > 0, 'desapareció la rama de «no hay época»');
    // Lo que hay dentro de esa rama antes de cualquier `return` tiene que ser la
    // consulta del predicado. Sin ella, `epoch === null` volvería a bastar.
    const inner = body.slice(branch, body.indexOf('const outcome', branch));
    assert.ok(
      inner.includes('legacyFallbackAllowed'),
      'la rama de «no hay época» volvió a decidir sin consultar la autorización',
    );
    assert.ok(
      inner.includes("status: 'snapshot_unavailable'"),
      'la rama de «no hay época» dejó de tener salida de fallo CERRADO',
    );
    // Y el fallo cerrado NO puede llevar plan: el plan es lo que los escritores
    // insertan directo.
    const closed = inner.slice(inner.indexOf("status: 'snapshot_unavailable'"));
    assert.equal(
      /\bplan,/.test(closed),
      false,
      'el fallo CERRADO devuelve el plan: el escritor podría insertarlo sin valla',
    );
  });

  it('🔴 la autorización se toma UNA vez, sobre la foto INICIAL', () => {
    const body = bodyWithLiterals(LOOP);
    // `const`, no `let`: la monotonía es del lenguaje, no de la disciplina.
    assert.ok(
      /const legacyFallbackAllowed = isProvenFenceCapabilityAbsent\(args\.snapshot\)/.test(body),
      'la autorización dejó de derivarse UNA vez de la foto inicial',
    );
    assert.equal(
      /let legacyFallbackAllowed/.test(body),
      false,
      'la autorización volvió a ser mutable: podría re-descubrirse a mitad de la tentativa',
    );
    // Y DENTRO del bucle no se vuelve a consultar: se mide el cuerpo de
    // `runFencedPersistence`, no el archivo, porque `initialFencedPersistenceTelemetry`
    // lo consulta legítimamente sobre su propio parámetro y confundir las dos
    // cosas haría fallar la guarda por leer el archivo en vez de la función.
    const runStart = body.indexOf('export async function runFencedPersistence');
    assert.ok(runStart > 0, 'desapareció el bucle vallado');
    const runBody = body.slice(runStart);
    assert.equal(
      (runBody.match(/isProvenFenceCapabilityAbsent\(/g) ?? []).length,
      1,
      'la autorización se consulta más de una vez dentro del bucle: dejaría de ser monótona',
    );
    assert.equal(
      /isProvenFenceCapabilityAbsent\(snapshot\)/.test(runBody),
      false,
      'la autorización se recalcula sobre la foto recargada: la capacidad dejaría de ser monótona',
    );
  });

  it('🔴 vista la valla activa, `capability_absent` de la RPC de escritura falla CERRADO', () => {
    const body = bodyWithLiterals(LOOP);
    const branch = body.indexOf("if (outcome.status === 'capability_absent')");
    assert.ok(branch > 0, 'desapareció la rama de la RPC sin capacidad');
    const block = body.slice(branch, body.indexOf('if (outcome.status ===', branch + 10));
    assert.ok(
      block.includes("status: 'snapshot_unavailable'"),
      'la RPC que pierde la capacidad volvió a degradar a la ruta legada',
    );
    assert.ok(
      block.includes("reason: 'fence_capability_lost'"),
      'la pérdida de capacidad dejó de nombrarse como tal',
    );
    assert.equal(
      block.includes("status: 'capability_absent'"),
      false,
      'la RPC que responde «no existe» tras observar la valla vuelve a autorizar la ruta legada',
    );
    assert.equal(
      /\bplan,/.test(block),
      false,
      'la pérdida de capacidad devuelve el plan: el escritor podría insertarlo sin valla',
    );
  });

  it('🔴 la FORMA del cliente no puede pasar por prueba de esquema', () => {
    const store = bodyWithLiterals(STORE);
    const branch = store.indexOf('if (!canCallRpc)');
    assert.ok(branch > 0, 'el almacén dejó de tratar por separado al cliente sin `rpc`');
    const block = store.slice(branch, store.indexOf('try {', branch));
    assert.ok(
      /fenceCapabilityAbsent: false/.test(block),
      'un cliente sin `rpc` volvió a contar como «la 126 no está aplicada»',
    );
    assert.ok(/degraded: true/.test(block), 'un cliente sin `rpc` dejó de degradar');
    assert.ok(/epoch: null/.test(block));
    // Y no cae a la lectura anterior a B4: el `return` es incondicional.
    assert.equal(
      block.includes(".from('prospect_candidates')"),
      false,
      'el cliente sin `rpc` volvió a caer a la lectura legada',
    );
  });

  it('🔴 los tres escritores tratan `snapshot_unavailable` como ERROR, sin insertar', () => {
    for (const path of [WRITER_A, WRITER_B]) {
      const body = bodyWithLiterals(path);
      const branch = body.indexOf("=== 'snapshot_unavailable'");
      assert.ok(branch > 0, `${path} no discrimina el fallo CERRADO del vallado`);
      // Su bloque tiene que contar error y NO puede escribir.
      const block = body.slice(branch, branch + 900);
      assert.ok(
        /tallyBatchIdentityError\(/.test(block),
        `${path} no cuenta el fallo CERRADO como error`,
      );
      for (const write of ['.insert(', '.rpc(', '.upsert(']) {
        assert.equal(
          block.includes(write),
          false,
          `${path} escribe (${write}) tras un fallo CERRADO del vallado`,
        );
      }
    }
  });

  it('🔴 en LUSHA, la dependencia vallada NO es opcional', () => {
    const core = bodyWithLiterals(WRITER_C_CORE);
    assert.equal(
      core.includes('insertCandidatesFenced?'),
      false,
      'volvió el `?`: la ausencia de la dependencia autorizaría una escritura sin valla',
    );
    assert.ok(
      /\n\s*insertCandidatesFenced: \(args: \{/.test(core),
      'la dependencia vallada dejó de declararse OBLIGATORIA',
    );
  });

  it('🔴 en LUSHA, ningún `else` escribe por la sola ausencia de la valla', () => {
    const core = bodyWithLiterals(WRITER_C_CORE);
    const calls = core.match(/deps\.insertCandidates\(/g) ?? [];
    assert.equal(calls.length, 1, 'la escritura legada de Lusha tiene más de una puerta');
    // La única llamada la gobierna `capability_absent`.
    const before = core.slice(0, core.indexOf('deps.insertCandidates('));
    const lastIf = before.lastIndexOf('if (');
    assert.ok(
      before.slice(lastIf, before.indexOf(')', lastIf) + 1).includes(
        "fenced.status === 'capability_absent'",
      ),
      'la escritura legada de Lusha dejó de estar gobernada por la respuesta de la base',
    );
    // Y la valla se llama sin comprobar si existe.
    assert.ok(
      core.includes('await deps.insertCandidatesFenced({'),
      'la valla de Lusha dejó de llamarse directamente',
    );
    assert.equal(
      /if \(fencedInsert\)/.test(core),
      false,
      'volvió la rama que decide vallar según haya o no dependencia inyectada',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// La guarda, en NEGATIVO
// ═══════════════════════════════════════════════════════════════════════════

describe('la guarda no puede pasar por vacía', () => {
  it('los archivos que inspecciona existen de verdad', () => {
    for (const target of [
      WRITER_A, WRITER_B, WRITER_C_CORE, WRITER_C_WIRING,
      FENCE, LOOP, STORE, REGISTRY, EVIDENCE, MIGRATION, AGENT2A_MIGRATION,
    ]) {
      assert.ok(existsSync(join(REPO_ROOT, target)), `no existe ${target}`);
      assert.ok(read(target).length > 500, `${target} está sospechosamente vacío`);
    }
  });

  it('`stripNonExecutable` borra prosa y literales, y conserva el código', () => {
    const stripped = stripNonExecutable(
      "// runFencedPersistence(\nconst x = 'runFencedPersistence(';\nrunFencedPersistence(a);",
    );
    assert.equal((stripped.match(/runFencedPersistence\(/g) ?? []).length, 1);
  });

  it('la aserción de cobertura FALLA sobre un escritor que NO usa el bucle', () => {
    const fake = stripNonExecutable('await admin.from("prospect_candidates").insert(row);');
    assert.equal(fake.includes('runFencedPersistence('), false);
  });

  it('la aserción de política FALLA sobre un bucle que SÍ reimplementa identidad', () => {
    const fake = stripNonExecutable('const k = evidence.fiscalIdentityKey;');
    assert.ok(fake.includes('fiscalIdentityKey'));
  });

  // ── CUT-3B4-CORRECCIÓN — mutaciones del predicado y del `else` ────────────

  it('🔴 el trinquete del predicado FALLA sobre la versión DEFECTUOSA', () => {
    // Exactamente el código que había antes de la corrección: la condición débil.
    const buggy = stripComments(`
      export function isProvenFenceCapabilityAbsent(snapshot) {
        return snapshot.epoch === null;
      }
    `);
    assert.equal(
      /snapshot\.fenceCapabilityAbsent === true/.test(buggy),
      false,
      'el trinquete no distingue el predicado débil del fuerte',
    );
    assert.equal(/snapshot\.degraded === false/.test(buggy), false);
  });

  it('🔴 el trinquete del predicado FALLA sobre una DISYUNCIÓN', () => {
    const buggy = stripComments(`
      return snapshot.epoch === null || snapshot.fenceCapabilityAbsent === true;
    `);
    assert.ok(buggy.includes('||'), 'el detector de disyunción no detecta nada');
  });

  it('🔴 el trinquete de monotonía FALLA sobre una autoridad MUTABLE', () => {
    const buggy = stripComments('let legacyFallbackAllowed = isProvenFenceCapabilityAbsent(snap);');
    assert.ok(
      /let legacyFallbackAllowed/.test(buggy),
      'el detector de autoridad mutable no detecta nada',
    );
  });

  it('🔴 el trinquete del `else` FALLA sobre la versión con dependencia OPCIONAL', () => {
    const buggy = stripComments(`
      insertCandidatesFenced?: (args: { batchId: string }) => Promise<unknown>;
      if (fencedInsert) { await fencedInsert(a); } else { await deps.insertCandidates(rows); }
    `);
    assert.ok(
      buggy.includes('insertCandidatesFenced?'),
      'el detector del marcador opcional no detecta nada',
    );
    assert.ok(/if \(fencedInsert\)/.test(buggy), 'el detector del `if` de dependencia no detecta nada');
    // Y el gobierno de la llamada legada: el `if` anterior NO nombra la base.
    const before = buggy.slice(0, buggy.indexOf('deps.insertCandidates('));
    const lastIf = before.lastIndexOf('if (');
    assert.equal(
      before.slice(lastIf).includes("fenced.status === 'capability_absent'"),
      false,
      'el detector de gobierno aceptaría un `else` suelto',
    );
  });
});
