/**
 * Tests ESTÁTICOS — alcance y cableado del check obligatorio
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-E1)
 *
 * La auditoría 4O-E0 encontró que el workflow obligatorio no ejecutaba las suites de
 * supresión: un defecto de esta familia podía llegar a `main` con el check en verde
 * simplemente porque nada lo corría. Este archivo cierra esa puerta desde dentro del
 * propio check —comprobando que el paso existe— y fija a la vez las propiedades de
 * ALCANCE que no fallan al compilar ni al ejecutar:
 *
 *   * la suite E1 está declarada en package.json Y ejecutada por el workflow;
 *   * el workflow no perdió ningún paso previo;
 *   * la escritura terminal es CONDICIONAL en el código fuente (nunca un
 *     `.eq('id', …)` suelto);
 *   * no se crearon ni modificaron migraciones, ni se tocaron las RPC 110/111;
 *   * no se escriben tombstones nuevos en la colección canónica;
 *   * el vocabulario terminal sigue siendo el de la columna, sin ampliarlo.
 *
 * Sin red, sin Supabase, sin proveedores: solo se leen archivos del repositorio.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const MODULE_DIR = join(REPO_ROOT, 'src', 'modules', 'contact-enrichment');

const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8');

/** Nombre EXACTO del script de la suite E1. Única fuente para los dos lados. */
const E1_TEST_SCRIPT = 'test:agent2a:phone-suppression-terminal';

const WORKFLOW_PATH = ['.github', 'workflows', 'automatic-routing-tests.yml'];

// ═══════════════════════════════════════════════════════════════
// § 18 — El check obligatorio ejecuta la suite
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 18 · required check', () => {
  it('package.json declara el script de la suite E1', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts[E1_TEST_SCRIPT];
    assert.ok(script, `falta el script ${E1_TEST_SCRIPT} en package.json`);
    // Las tres suites del hito tienen que estar dentro del script, no solo una.
    for (const suite of [
      'phone-suppression-terminal-policy-4o-e1.test.ts',
      'phone-suppression-terminal-runtime-4o-e1.test.ts',
      'phone-suppression-terminal-static-4o-e1.test.ts',
    ]) {
      assert.ok(script.includes(suite), `el script no ejecuta ${suite}`);
    }
    // La suite runtime usa mock.module: sin el flag no arrancaría.
    assert.ok(
      script.includes('--experimental-test-module-mocks'),
      'el script necesita --experimental-test-module-mocks',
    );
  });

  it('el workflow obligatorio ejecuta ese script', () => {
    const workflow = read(...WORKFLOW_PATH);
    assert.ok(
      workflow.includes(`npm run ${E1_TEST_SCRIPT}`),
      `el workflow obligatorio no ejecuta ${E1_TEST_SCRIPT}`,
    );
  });

  it('no se eliminó ningún paso previo del workflow', () => {
    const workflow = read(...WORKFLOW_PATH);
    // Muestra representativa de los pasos que ya existían antes del hito. Si alguno
    // desapareciera, este test lo dice en vez de que el check adelgace en silencio.
    for (const step of [
      'npm run typecheck',
      'npm run test:agent2a:automatic-routing',
      'npm run test:agent2a:phone-waterfall',
      'npm run test:agent2a:phone-credit-reservation',
      'npm run test:agent2a:phone-budget-accounting',
      'npm run test:agent2a:candidate-phone-collection',
      'npm run test:agent2a:apollo-phone-collection-capture',
    ]) {
      assert.ok(workflow.includes(step), `el workflow perdió el paso: ${step}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 5.1 — La escritura terminal es condicional EN EL CÓDIGO
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 5.1 · el UPDATE terminal nunca es incondicional', () => {
  const source = read(
    'src',
    'modules',
    'contact-enrichment',
    'candidate-phone-suppression-persistence.ts',
  );

  it('condiciona por estado y por ausencia de teléfono', () => {
    assert.ok(
      source.includes(".in('phone_reveal_status'"),
      'falta la condición de estado',
    );
    assert.ok(source.includes(".is('phone', null)"), 'falta la condición de teléfono');
  });

  it('cuenta las filas afectadas en vez de asumir la escritura', () => {
    assert.ok(source.includes(".select('id')"), 'sin select no se pueden contar filas');
    assert.ok(source.includes('data.length === 1'));
  });

  it('no hace ningún INSERT ni DELETE: solo marca el estado', () => {
    assert.equal(source.includes('.insert('), false);
    assert.equal(source.includes('.delete('), false);
    assert.equal(source.includes('.upsert('), false);
    assert.equal(source.includes('.rpc('), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 13 / § 14 / § 20 — Alcance
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 13 · las RPC 110 y 111 quedan intactas', () => {
  it('el hito no llama a las funciones de persistencia por su nombre', () => {
    const source = read(
      'src',
      'modules',
      'contact-enrichment',
      'candidate-phone-suppression-persistence.ts',
    );
    assert.equal(source.includes('persist_candidate_apollo_phone_reveal_result'), false);
    assert.equal(source.includes('persist_candidate_lusha_phone_reveal_result'), false);
  });

  it('no se introdujo una RPC nueva para el cierre terminal', () => {
    const guard = read('src', 'modules', 'contact-enrichment', 'phone-reveal-suppression-guard.ts');
    assert.equal(guard.includes('.rpc('), false);
  });
});

describe('4O-E1 § 14 · no se escriben tombstones nuevos', () => {
  const touched = [
    'phone-reveal-suppression-guard.ts',
    'candidate-phone-suppression-persistence.ts',
    'phone-reveal-webhook-core.ts',
    'phone-reveal-recovery-core.ts',
    'phone-reveal-waterfall-core.ts',
    'lusha-phone-fallback-core.ts',
  ];

  it('ningún archivo tocado escribe `suppressed_at` ni toca las tablas de teléfonos', () => {
    for (const file of touched) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8');
      assert.equal(
        source.includes('suppressed_at:'),
        false,
        `${file} no puede escribir suppressed_at`,
      );
      assert.equal(
        source.includes('contact_enrichment_candidate_phones'),
        false,
        `${file} no puede tocar la colección canónica directamente`,
      );
    }
  });

  it('tampoco toca contactos ni HubSpot', () => {
    // Se buscan USOS, no menciones: los comentarios de estos módulos declaran
    // explícitamente que nunca escriben HubSpot, y prohibir la palabra castigaría
    // justo la documentación de la garantía.
    for (const file of touched) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8');
      assert.equal(/from\s+['"][^'"]*hubspot/i.test(source), false, `${file}`);
      assert.equal(/hubspot[A-Za-z]*\(/i.test(source), false, `${file}`);
      assert.equal(source.includes("from('contacts')"), false, `${file}`);
    }
  });
});

describe('4O-E1 § 20 · no se crearon ni modificaron migraciones', () => {
  it('4O-E1 no aportó ninguna migración, y el techo es el del último hito conocido', () => {
    // Lo que esta guarda protege NO es el número más alto del directorio —sube cada
    // vez que un bloque AUTORIZADO añade la suya—, sino que 4O-E1 no añadió ninguna:
    // su cierre terminal es un UPDATE condicional y nada más. El techo lo movió
    // AGENT2A-PHONE-REVEAL-4O-E2 con la 112 (propagación de la supresión a la
    // colección) y después AGENT2A-PHONE-REVEAL-4O-E3 con la 113 (re-comprobación de
    // la supresión POR PERSONA dentro de la transacción de persistencia); después
    // AGENT2A-PHONE-REVEAL-4O-H1 con la 114 (el esquema OFICIAL de múltiples teléfonos,
    // creado INERTE); las tres tienen su propia guarda estática.
    const files = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();
    const last = files[files.length - 1];
    assert.equal(
      last,
      '114_official_contact_phones.sql',
      `la última migración es ${last}: nadie puede colar una por encima del último hito conocido`,
    );
    // Y ninguna migración es AUTORÍA de 4O-E1: el hito no escribió SQL.
    //
    // Se comprueba la autoría, no la mención. Un hito posterior puede —y debe— citar a
    // 4O-E1 cuando delimita su alcance: la 113 lo hace para dejar escrito que el cierre
    // terminal (`error` + `blocked_suppressed`), el aborto de la corrida y la
    // liquidación de la reserva siguen viviendo en TypeScript y NO se duplican en SQL.
    // Prohibir la cita empujaría a borrar exactamente la frase que evita que alguien
    // reimplemente esa política dentro de una función.
    //
    // Autoría son las dos formas con las que este repositorio la declara: la PRIMERA
    // línea (`-- Migration NNN: … (AGENT2A-…)`) y el prefijo de los `COMMENT ON … IS`.
    for (const file of files) {
      const sql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', file), 'utf8');
      const titleLine = sql.slice(0, sql.indexOf('\n'));
      assert.equal(
        titleLine.includes('4O-E1'),
        false,
        `${file}: el título declara a 4O-E1 como autor de una migración`,
      );
      assert.equal(
        sql.includes("'AGENT2A-PHONE-REVEAL-4O-E1"),
        false,
        `${file}: un COMMENT atribuye un objeto a 4O-E1`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 3.1 — El vocabulario terminal no se amplía
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 3.1 · vocabulario', () => {
  const guard = read(
    'src',
    'modules',
    'contact-enrichment',
    'phone-reveal-suppression-guard.ts',
  );

  it('el estado terminal es `error`, no uno nuevo', () => {
    assert.ok(guard.includes("phone_reveal_status: 'error'"));
    // `suppressed` como VALOR de phone_reveal_status ampliaría el CHECK de la
    // columna (mig. 095/097) y exigiría una migración que este hito no autoriza.
    assert.equal(guard.includes("phone_reveal_status: 'suppressed'"), false);
    // `no_phone_found` sería peor que no escribir nada: es el estado que hace
    // elegible el fallback pagado de Lusha.
    assert.equal(guard.includes("phone_reveal_status: 'no_phone_found'"), false);
  });

  it('el código de error es el que ya existía', () => {
    assert.ok(guard.includes("SUPPRESSION_BLOCKED_ERROR_CODE = 'blocked_suppressed'"));
  });

  it('el vocabulario de `lusha_skipped_reason` no cambia', () => {
    const waterfall = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-reveal-waterfall-core.ts',
    );
    const block = waterfall.slice(
      waterfall.indexOf('PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS = ['),
      waterfall.indexOf('] as const;', waterfall.indexOf('PHONE_REVEAL_WATERFALL_LUSHA_SKIPPED_REASONS = [')),
    );
    for (const reason of [
      'missing_lusha_contact_id',
      'apollo_revealed',
      'suppressed',
      'suppression_check_unavailable',
      'dnc',
      'authorization_expired',
      'role_not_allowed',
      'feature_disabled',
      'already_attempted',
      'not_needed',
      'provider_error',
    ]) {
      assert.ok(block.includes(`'${reason}'`), `falta ${reason}`);
    }
    // Exactamente los once de siempre: ni uno más.
    assert.equal((block.match(/'/g) ?? []).length / 2, 11);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 12 / § 14 — Deuda declarada, no resuelta a escondidas
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 · deuda pendiente declarada', () => {
  it('el disparo manual de Lusha usa el cierre terminal CONDICIONAL con su colección', () => {
    // En 4O-E1 este test afirmaba que la acción manual seguía SIN
    // `persistPhoneCollection`: era la deuda `MANUAL_LUSHA_MULTI_PHONE_PENDING`.
    // AGENT2A-PHONE-REVEAL-4O-F la cierra cableando la MISMA transacción que el
    // waterfall. Lo que este hito tiene que seguir garantizando —y es lo que se
    // afirma ahora— es que ese camino nuevo llegue acompañado del cierre terminal
    // por supresión CONDICIONAL: sin él, un `suppressed` de la transacción devolvería
    // el candidato a `no_phone_found`, que es justo el estado que lo vuelve elegible
    // para volver a comprar el mismo número suprimido.
    // AGENT2A-PHONE-REVEAL-4O-F-R2: el cableado del disparo manual dejó de estar en la
    // acción y pasó a la pata COMPARTIDA (`callLushaFallbackLeg`, `manualInvocation:
    // true`), que es la misma que ya usaban el waterfall y la continuación legacy. La
    // garantía es la de siempre —colección transaccional acompañada del cierre terminal
    // CONDICIONAL— sólo que ahora hay UN punto donde verificarla en vez de dos.
    const deps = read(
      'src',
      'modules',
      'contact-enrichment',
      'phone-reveal-waterfall-deps.ts',
    );
    assert.ok(deps.includes('persistPhoneCollection: persistCandidateLushaPhoneCollection'));
    assert.ok(
      deps.includes('persistTerminalSuppression: persistTerminalPhoneSuppression'),
      'la colección manual sin cierre terminal condicional reabriría la compra del número suprimido',
    );
    // Y la acción manual ya no puede tener un camino pagado propio que se salte ese cierre.
    const actions = read(
      'src',
      'modules',
      'contact-enrichment',
      'lusha-phone-fallback-actions.ts',
    );
    assert.ok(actions.includes('executeLegacyLushaOnlyPhoneReveal'));
    assert.equal(actions.includes('callLusha:'), false);
  });

  it('la propagación DSAR a la colección sigue sin implementarse', () => {
    const persistence = read(
      'src',
      'modules',
      'contact-enrichment',
      'candidate-phone-suppression-persistence.ts',
    );
    assert.equal(persistence.includes('suppressed_at'), false);
  });
});
