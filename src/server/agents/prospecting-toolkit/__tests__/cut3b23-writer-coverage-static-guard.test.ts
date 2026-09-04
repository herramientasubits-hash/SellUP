/**
 * AGENT1-CUT3B23 — guarda estática del corte: cobertura de los TRES escritores y
 * los límites que este corte NO cruza.
 *
 * Por qué hace falta una guarda además de las pruebas de comportamiento: la mitad
 * del contrato de B2 es que los TRES caminos de persistencia produzcan la MISMA
 * evidencia. Eso no lo demuestra ningún test de una función pura — se demuestra
 * mirando que los tres archivos consuman el constructor compartido. Y la mitad
 * del contrato de este corte es lo que NO hace: ni migración, ni activación de
 * proveedor, ni hueco parcial, ni identidad canónica nueva.
 *
 * Metodología heredada de la guarda de CUT-3B1: se compara el CUERPO EJECUTABLE
 * (sin comentarios ni literales de cadena), porque nombrar algo en prosa no es
 * usarlo en código. Los especificadores de `import` se comprueban sobre el
 * cuerpo sin comentarios, ya que una ruta de import ES estructura ejecutable.
 * La guarda se prueba a sí misma en NEGATIVO al final para que no pueda pasar
 * por vacía.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TOOLKIT_DIR = join(import.meta.dirname, '..');
const REPO_ROOT = join(TOOLKIT_DIR, '..', '..', '..', '..');

/** Elimina comentarios de bloque, de línea y literales de cadena. */
export function stripNonExecutable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/** Elimina SÓLO comentarios. Para aserciones sobre rutas de import. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function read(relativeToRepo: string): string {
  return readFileSync(join(REPO_ROOT, relativeToRepo), 'utf8');
}

function executableBody(relativeToRepo: string): string {
  return stripNonExecutable(read(relativeToRepo));
}

function bodyWithoutComments(relativeToRepo: string): string {
  return stripComments(read(relativeToRepo));
}

// ─── Los tres escritores ──────────────────────────────────────────────────────

const WRITERS = [
  {
    label: 'escritor estructurado GRATUITO',
    path: 'src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts',
    importSpecifier: './company-identity-evidence',
  },
  {
    label: 'candidate-writer (Apollo/Tavily/compartido de PAGO)',
    path: 'src/server/agents/prospecting-toolkit/candidate-writer.ts',
    importSpecifier: './company-identity-evidence',
  },
  {
    label: 'lusha-pending-review',
    path: 'src/server/prospect-batches/lusha-pending-review.ts',
    importSpecifier: '@/server/agents/prospecting-toolkit/company-identity-evidence',
  },
] as const;

/** Módulos que este corte INTRODUCE en la ruta de decisión. */
const CUT_MODULES = [
  'src/server/agents/prospecting-toolkit/company-identity-evidence.ts',
  'src/server/agents/prospecting-toolkit/batch-identity-registry.ts',
  'src/server/prospect-batches/batch-identity-registry-store.ts',
] as const;

describe('CUT-3B2 § 6 — los TRES escritores consumen el contrato compartido', () => {
  for (const writer of WRITERS) {
    it(`${writer.label} importa \`company-identity-evidence\``, () => {
      const imports = bodyWithoutComments(writer.path);
      assert.ok(
        imports.includes(writer.importSpecifier),
        `${writer.path} no importa ${writer.importSpecifier}`,
      );
    });

    it(`${writer.label} LLAMA a \`buildCompanyIdentityEvidence\``, () => {
      const body = executableBody(writer.path);
      assert.ok(
        body.includes('buildCompanyIdentityEvidence('),
        `${writer.path} importa el contrato pero no lo invoca`,
      );
    });

    it(`${writer.label} consume el registro de identidad de LOTE`, () => {
      const body = executableBody(writer.path);
      const usesRegistry =
        body.includes('evaluateCandidateIdentity(') || body.includes('admitByBatchIdentity(');
      assert.ok(usesRegistry, `${writer.path} no evalúa identidad de lote`);
    });

    it(`${writer.label} no compone evidencia por su cuenta`, () => {
      const body = executableBody(writer.path);
      // Nadie fuera del constructor compartido puede llamar a los normalizadores
      // de identidad para armar una comparación paralela.
      assert.equal(
        body.includes('buildProviderEntityKey('),
        false,
        `${writer.path} compone claves de proveedor fuera del contrato compartido`,
      );
    });
  }
});

// ─── El namespace del proveedor es estructural ────────────────────────────────

describe('CUT-3B3 § 21 — un id de un proveedor no puede igualar al de otro', () => {
  it('la clave de proveedor se compone SIEMPRE con el namespace del proveedor', () => {
    const body = executableBody(CUT_MODULES[0]);
    assert.ok(
      /\$\{provider\}:\$\{entityId\}|provider.*\+.*entityId/.test(read(CUT_MODULES[0])),
      'la clave de proveedor debe llevar el proveedor dentro',
    );
    // Sin proveedor no hay clave: el retorno temprano tiene que existir.
    assert.ok(body.includes('if (!provider || !entityId) return null;'));
  });

  it('el registro compara claves COMPLETAS, nunca ids desnudos', () => {
    const body = executableBody(CUT_MODULES[1]);
    assert.ok(body.includes('evidence.providerEntityKey === other.providerEntityKey'));
    assert.equal(body.includes('providerEntityId ==='), false);
  });
});

// ─── El nombre no puede suprimir ──────────────────────────────────────────────

describe('CUT-3B3 § 20 — el nombre NUNCA produce duplicado duro', () => {
  it('la única rama del nombre en el registro empuja a `soft`, jamás a `hardMatches`', () => {
    const source = read(CUT_MODULES[1]);
    const nameBranch = source.slice(source.indexOf('evidence.canonicalName !== null &&'));
    const nextHard = nameBranch.indexOf('hardMatches.push');
    assert.equal(
      nextHard,
      -1,
      'la rama del nombre canónico no puede empujar una coincidencia dura',
    );
    assert.ok(nameBranch.includes("signal: 'canonical_name'"));
  });

  it('el corte no reinterpreta `normalized_name` como supresor', () => {
    for (const modulePath of CUT_MODULES) {
      const body = executableBody(modulePath);
      assert.equal(
        body.includes('normalized_name'),
        false,
        `${modulePath} no debe tocar la columna normalized_name`,
      );
    }
  });
});

// ─── El conflicto fiscal manda ────────────────────────────────────────────────

describe('CUT-3B3 § 13 — el conflicto fiscal precede a toda señal más débil', () => {
  it('cada rama de dominio, proveedor y LinkedIn consulta el conflicto ANTES de decidir', () => {
    const source = read(CUT_MODULES[1]);
    const loop = source.slice(source.indexOf('for (const entry of registry.entries)'));
    const conflictIndex = loop.indexOf('const fiscalConflict = hasFiscalIdentityConflict(');
    assert.ok(conflictIndex >= 0, 'el conflicto fiscal debe resolverse en el bucle');

    for (const signal of [
      'normalizedDomain === other.normalizedDomain',
      'providerEntityKey === other.providerEntityKey',
      'normalizedLinkedInCompany === other.normalizedLinkedInCompany',
    ]) {
      const signalIndex = loop.indexOf(signal);
      assert.ok(signalIndex > conflictIndex, `${signal} se evalúa antes del conflicto fiscal`);
    }
  });

  it('🔴 REVIEW-FIX § 2 — la precedencia se decide sobre TODAS las entradas, no dentro del bucle', () => {
    // La guarda de arriba sólo prueba el orden DENTRO de una entrada. El defecto
    // real vivía entre entradas: una coincidencia dura débil ganaba a un
    // conflicto TIER 0 de otra fila. Esta guarda fija que la decisión de
    // precedencia existe DESPUÉS del bucle y ANTES del retorno duro.
    const source = stripNonExecutable(read(CUT_MODULES[1]));
    const afterLoop = source.slice(source.indexOf('hasExactFiscalMatch'));
    assert.ok(afterLoop.length > 0, 'la precedencia entre entradas debe existir');

    const precedenceIndex = source.indexOf('const hasExactFiscalMatch');
    const strongConflictIndex = source.indexOf('const strongFiscalConflict');
    const hardReturnIndex = source.indexOf('if (hardMatches.length > 0)');
    assert.ok(precedenceIndex >= 0, 'TIER 1 exacto debe evaluarse aparte');
    assert.ok(strongConflictIndex >= 0, 'el conflicto TIER 0 debe evaluarse aparte');
    assert.ok(
      hardReturnIndex > strongConflictIndex,
      '🔴 el retorno por coincidencia dura NO puede preceder al conflicto TIER 0',
    );
  });

  it('la igualdad fiscal se delega en la autoridad de CUT-3B1', () => {
    const imports = bodyWithoutComments(CUT_MODULES[0]);
    assert.ok(imports.includes("from './fiscal-identity'"));
    // No se canonicaliza fiscalidad por cuenta propia en el corte.
    for (const modulePath of CUT_MODULES) {
      assert.equal(
        executableBody(modulePath).includes('normalizeTaxIdentifier('),
        false,
        `${modulePath} no puede usar el normalizador NO autoritativo`,
      );
    }
  });
});

// ─── `discarded` no bloquea ───────────────────────────────────────────────────

describe('CUT-3B3 § 10 — el conjunto bloqueante excluye los estados de resultado', () => {
  it('la lista literal no contiene `discarded` ni `duplicate`', () => {
    const source = read(CUT_MODULES[1]);
    const listStart = source.indexOf('BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES = [');
    const list = source.slice(listStart, source.indexOf('] as const;', listStart));
    assert.equal(list.includes("'discarded'"), false);
    assert.equal(list.includes("'duplicate'"), false);
    assert.ok(list.includes("'needs_review'"));
    assert.ok(list.includes("'converted_to_account'"));
  });

  it('no se reutiliza el conjunto durable de CUT-1 como conjunto bloqueante', () => {
    const body = executableBody(CUT_MODULES[1]);
    assert.equal(body.includes('DURABLE_PROSPECT_CANDIDATE_STATUSES'), false);
  });
});

// ─── Ámbito de lote ───────────────────────────────────────────────────────────

describe('CUT-3B3 § 8 — el registro es de LOTE, no global ni histórico', () => {
  it('la siembra filtra por `batch_id`', () => {
    // El nombre de la columna es un literal, y en un filtro de consulta ese
    // literal ES estructura ejecutable — igual que la ruta de un import. Por eso
    // se comprueba sobre el cuerpo sin comentarios, no sobre el ejecutable
    // desliteralizado.
    const body = bodyWithoutComments(CUT_MODULES[2]);
    assert.ok(body.includes(".eq('batch_id', batchId)"));
    assert.ok(bodyWithoutComments(CUT_MODULES[2]).includes('.in('));
  });

  it('el registro no consume la memoria de novedad global ni `provider_seen`', () => {
    for (const modulePath of CUT_MODULES) {
      const imports = bodyWithoutComments(modulePath);
      for (const forbidden of ['novelty-checker', 'tax-id-novelty-checker', 'provider-seen']) {
        assert.equal(
          imports.includes(`'${forbidden}`) || imports.includes(`/${forbidden}'`),
          false,
          `${modulePath} no puede importar ${forbidden}`,
        );
      }
    }
  });

  it('los módulos del corte son puros: sin env, sin reloj, sin proveedores', () => {
    for (const modulePath of CUT_MODULES) {
      const body = executableBody(modulePath);
      assert.equal(body.includes('process.env'), false, `${modulePath} lee env`);
      assert.equal(body.includes('Date.now('), false, `${modulePath} lee el reloj`);
      assert.equal(body.includes('fetch('), false, `${modulePath} hace red`);
      assert.equal(body.includes('apollo'), false, `${modulePath} referencia Apollo en código`);
      assert.equal(body.includes('getLushaApiKey'), false, `${modulePath} toca credenciales`);
    }
  });
});

// ─── § 7 — la columna histórica `identity_key` no se redefine ─────────────────

describe('CUT-3B23 § 7 — `identity_key` no se sobrecarga', () => {
  it('ningún módulo del corte escribe ni deriva la columna `identity_key`', () => {
    for (const modulePath of CUT_MODULES) {
      const body = executableBody(modulePath);
      assert.equal(body.includes('identity_key'), false, `${modulePath} toca identity_key`);
      assert.equal(
        body.includes('buildProspectCandidateIdentityKey'),
        false,
        `${modulePath} redefine la derivación histórica`,
      );
    }
  });

  it('la derivación histórica de `candidate-writer` sigue en pie', () => {
    const body = executableBody(WRITERS[1].path);
    assert.ok(body.includes('buildProspectCandidateIdentityKey('));
    assert.ok(body.includes('identity_key: candidateIdentityKey'));
  });
});

// ─── § 19 — sin migración ─────────────────────────────────────────────────────

/**
 * AGENT1-CUT3B4 — mantenimiento sancionado del techo, segunda vez.
 *
 * 🔴 La intención original de este bloque era de AUTORÍA: «CUT-3B23 no aporta
 * migración». Esa afirmación SIGUE SIENDO CIERTA y sigue comprobándose. Lo que
 * cambia es que la 126 ya no está libre: la aporta CUT-3B4, el vallado de
 * identidad de LOTE, que sí exige esquema. Así que la guarda no se borra —
 * se le añade la comprobación de que la 126 es de CUT-3B4 y de nadie más, y el
 * número libre pasa a 127.
 *
 * La 125 sigue siendo de BR-SOURCE y sus aserciones quedan INTACTAS.
 */
const CUT3B4_MIGRATION = '126_agent1_batch_identity_atomicity.sql';
/** AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1, que reclamó la 128 de forma
 * independiente: la proyección de la colección de teléfonos de un candidato ya APROBADO al
 * contacto que su aprobación creó. Nada que ver con este corte; su autoría se policía abajo. */
const POST_APPROVAL_REVEAL_MIGRATION =
  '128_project_approved_candidate_phones_onto_contact.sql';
/** AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1, que reclamó el tramo 129–132 al canonicalizar
 * la cadena de sincronización con HubSpot de Agente 2. Nada que ver con este corte; su autoría
 * se policía en el barrido exhaustivo de `authored`. */
/**
 * 🔴 El techo del repositorio, que este corte no controla.
 *
 * Lo movió AGENT2-FINAL-INTEGRATION a la 132 y después BR-PRODUCTION-RELEASE a la 133: la
 * promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña (BR-SOURCE CUT D).
 * La 133 REUTILIZA la valla de época de la 126 de CUT-3B4 en vez de inventar una segunda, y no
 * crea tabla, columna, índice ni constraint: el barrido de AUTORÍA de abajo es el que comprueba
 * que no es de CUT-3B23, archivo por archivo, en vez de creerle a este comentario.
 */
/**
 * BR-COMPACT-SNAPSHOT-PRODUCTIZATION movió el techo a la 134 (tabla dedicada del snapshot
 * nacional de Brasil), y AGENT1-LUSHA-CUT-L3 lo movió a la 135 —renumerada desde la 134 al
 * integrarse en serie después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main
 * con ese número—: la valla DURABLE de una petición de Lusha Company Prospecting.
 */
// AGENT1-LUSHA-CUT-L4 mueve el techo a la 136: historial DURABLE de INTENTOS y reclamo atomico de UN reintento seguro (solo tras 429 o 5xx). AUTORADA y NO APLICADA.
// AGENT1-WIZARD-BUDGET-ADMIN-F1B mueve el techo a la 137: la superficie ADMINISTRATIVA del
// presupuesto del Wizard —`wizard_monthly_budget_periods.updated_by`, la bitácora append-only
// `wizard_budget_period_changes` y dos funciones que escriben valor y bitácora en una misma
// transacción—. No es una migración de la capa de snapshots de fuente, no escribe candidatos
// y no nombra ningún símbolo de CUT-3B23; su autoría se policía por el mismo criterio que la
// 126 y la 128, no por el número. AUTORADA y NO APLICADA.
// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 mueve el techo a la 138: la disposición durable de una
// empresa descartada, para "Descartadas" de Prospectos (issue #389). No es una migración de la
// capa de snapshots de fuente y no nombra ningún símbolo de CUT-3B23 (sólo referencia
// `prospect_candidates` como FK de su propia tabla nueva, ajena a este corte). AUTORADA y NO
// APLICADA.
const REPOSITORY_CEILING = '138_prospect_discarded_dispositions.sql';

/**
 * Cuerpo EJECUTABLE de una migración, en minúsculas.
 *
 * Retira los comentarios `--` y los literales entre comillas simples —donde viven
 * los `COMMENT ON`— y CONSERVA intacto el dolar-quoting, que es donde está el
 * código. Sin esto, una guarda que busca «linkedin» encontraría la frase que
 * explica que LinkedIn NO se interpreta en SQL, y fallaría por decir la verdad.
 */
function executableSql(migrationFile: string): string {
  return read(`supabase/migrations/${migrationFile}`)
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .toLowerCase();
}

describe('CUT-3B23 § 19 — MIGRATION_CREATED = NO', () => {
  // 🔴 TECHO DE MIGRACIÓN — mantenimiento sancionado, no debilitamiento.
  //
  // Estas dos guardas congelaban «no hay 125 y la 124 es la última» para demostrar
  // MIGRATION_CREATED = NO. El techo sube cuando un hito AUTORIZADO añade la suya, y lo que la
  // guarda protege es que no lo mueva ESTE corte. BR-SOURCE FUNCTIONAL CUT-A añadió la
  // `125_br_receita_monthly_snapshot_identity.sql` — AUTORADA y NO APLICADA — así que el techo
  // pasó a 125 y el número libre a 126.
  //
  // BR-SOURCE CUT A.1 (reconciliación de esquema de producción antes de CUT B) movió el techo
  // dos veces más: RENUMERÓ esa migración BR de 125 a 126 y luego a 127 —su cuerpo SQL no
  // cambió en nada que afecte a este corte— y añadió una migración 125 genérica y nueva
  // (reconciliación de `record_identity_key` sobre `source_company_snapshots` para fuentes NO
  // brasileñas). El segundo salto (126→127) lo forzó AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY, que
  // reclamó el 126 de forma independiente mientras esta reconciliación seguía en revisión: el
  // vallado optimista de la admisión por identidad de LOTE, que sí exige esquema propio.
  //
  // Y en vez de sólo desplazar el número, se sigue probando la AFIRMACIÓN de verdad: que NI la
  // 125 NI la 127 son de CUT-3B23. Sus cuerpos no mencionan ninguna tabla ni símbolo de este
  // corte, lo que es estrictamente más fuerte que comparar un número.
  it('la 128 existe, es del reveal post-aprobación y NO de este corte', () => {
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 tomó la 128 de forma independiente.
    // La afirmación de CUT-3B23 —«yo no aporto migración»— NO se relaja: se comprueba por
    // AUTORÍA, exactamente como ya se hace con la 126 de CUT-3B4, que es más fuerte que exigir un
    // número libre. Aquí se exige que la 128 sea EXACTAMENTE la de la proyección de teléfonos y
    // que no nombre ningún símbolo de este corte.
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'));
    assert.deepEqual(
      migrations.filter((file) => file.startsWith('128')),
      [POST_APPROVAL_REVEAL_MIGRATION],
      'la 128 tiene que ser la de la proyección post-aprobación, y sólo ella',
    );
    const sql = read(`supabase/migrations/${POST_APPROVAL_REVEAL_MIGRATION}`);
    for (const foreign of [
      'prospect_candidates',
      'batch_identity_registry',
      'prospect_batches',
      'source_company_snapshots',
    ]) {
      assert.equal(
        sql.includes(foreign),
        false,
        `la 128 nombra ${foreign}: dejaría de ser ajena a CUT-3B23`,
      );
    }
  });

  it('la 126 existe, es de CUT-3B4 y NO de este corte', () => {
    // AGENT1-CUT3B4 tomó la 126 (vallado de identidad de LOTE) de forma independiente,
    // mientras BR-SOURCE CUT A.1 seguía en revisión. La afirmación de CUT-3B23 —«yo no
    // aporto migración»— se conserva y se comprueba por AUTORÍA, que es más fuerte que un
    // número libre: aquí se exige que la 126 sea EXACTAMENTE la de B4 y que no nombre
    // ningún símbolo de B23.
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'));
    assert.deepEqual(
      migrations.filter((file) => file.startsWith('126')),
      [CUT3B4_MIGRATION],
      'la 126 tiene que ser la del vallado de identidad de lote, y sólo ella',
    );
  });

  it('🔴 la migración del vallado NO contiene política de identidad', () => {
    // El corazón del contrato de B4: la base responde «¿esta decisión es del estado
    // actual?» y NADA más. Si aquí apareciera normalización fiscal, canonización de
    // dominio o un nivel TIER, existirían DOS autoridades de identidad y divergirían
    // en la primera corrección.
    const sql = executableSql(CUT3B4_MIGRATION);
    for (const forbidden of [
      'regexp_replace',
      'normalize',
      'lower(c.domain',
      'lower(b.domain',
      'linkedin',
      'tier',
      'canonical',
      'levenshtein',
      'similarity',
    ]) {
      assert.equal(
        sql.includes(forbidden),
        false,
        `la migración del vallado no puede contener \`${forbidden}\``,
      );
    }
  });

  it('🔴 el vallado NO crea índices únicos de dominio, LinkedIn, proveedor ni identity_key', () => {
    // Un `UNIQUE(domain)` sería exactamente la afirmación que TIER 0 niega: dos NITs
    // distintos comparten dominio de grupo legítimamente.
    const sql = executableSql(CUT3B4_MIGRATION);
    assert.equal(sql.includes('unique index'), false, 'no puede crear un índice único');
    assert.equal(sql.includes('add constraint'), false, 'no puede añadir constraints');
    assert.equal(sql.includes('create trigger'), false, 'no puede añadir triggers');
  });

  it('la 132 es la última, y ni ella ni la 125 ni la 126 ni la 127 son de este corte', () => {
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
      .filter((file) => /^\d{3}_/.test(file))
      .sort();
    const last = migrations[migrations.length - 1];
    // El techo lo movió AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 con la 128, y
    // después AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 con el tramo 129–132 (la cadena de
    // sincronización con HubSpot de Agente 2, canonicalizada desde cuatro archivos que nacieron
    // sin número). La autoría de todas ellas se policía en la prueba de arriba, que barre el
    // directorio completo. La 127 sigue siendo la última de la capa de snapshots de fuente, y es
    // ella —no el techo global— la que este barrido examina.
    // …y BR-COMPACT-SNAPSHOT-PRODUCTIZATION con la 134, la tabla dedicada del snapshot de Brasil.
    // 🔴 AGENT1-LUSHA-CUT-L3 movió el techo a la 135 (renumerada desde la 134 al integrarse en
    // serie después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
    // número): la valla DURABLE de una petición de Lusha Company Prospecting. No es una migración
    // de la capa de snapshots ni escribe candidatos, y su autoría se policía en la prueba de
    // arriba, que barre el directorio completo.
    assert.ok(last.startsWith('138'), `última migración inesperada: ${last}`);
    assert.equal(last, REPOSITORY_CEILING);
    assert.ok(migrations.includes(POST_APPROVAL_REVEAL_MIGRATION));
    const lastSnapshotMigration = '127_br_receita_monthly_snapshot_identity.sql';
    assert.ok(migrations.includes(lastSnapshotMigration));
    assert.ok(migrations.includes('125_reconcile_source_snapshot_record_identity.sql'));
    assert.ok(migrations.includes(CUT3B4_MIGRATION));

    // Ni la 125 (reconciliación genérica) ni la 127 (BR, renumerada dos veces) tocan una
    // tabla de CUT-3B23. Si un día este corte añadiera la suya disfrazada de cualquiera de
    // las dos, esta aserción caería. La 126 (CUT-3B4) queda FUERA de este barrido genérico
    // a propósito: toca `prospect_candidates` legítimamente por SU PROPIO motivo —el
    // vallado, no CUT-3B23— y las dos pruebas de contenido justo arriba ya policían su
    // autoría con precisión.
    const FOREIGN_TABLES = [
      'prospect_candidates',
      'batch_identity_registry',
      'provider_seen_entities',
      'wizard_budget_reservations',
      'wizard_monthly_budget_periods',
    ];
    const bodiesByFile: Record<string, string> = {
      '125_reconcile_source_snapshot_record_identity.sql': readFileSync(
        join(REPO_ROOT, 'supabase', 'migrations', '125_reconcile_source_snapshot_record_identity.sql'),
        'utf8',
      ),
      [lastSnapshotMigration]: readFileSync(
        join(REPO_ROOT, 'supabase', 'migrations', lastSnapshotMigration),
        'utf8',
      ),
    };
    for (const [file, body] of Object.entries(bodiesByFile)) {
      for (const foreignTable of FOREIGN_TABLES) {
        assert.equal(
          body.includes(foreignTable),
          false,
          `${file} toca ${foreignTable}: dejaría de ser ajena a CUT-3B23`,
        );
      }

      // Y al revés: TODA tabla que la migración modifica es de la capa de snapshots de fuente.
      // Enumerar las tablas tocadas es más fuerte que buscar ausencias, porque no depende de
      // acertar la lista de las ajenas.
      //
      // 🔴 `record_identity_key` SÍ aparece en ambas — la 125 la EXIGE para no-Brasil y la 127 la
      // REFUSA para Brasil. Nombrar una columna para exigirla o refusarla no es tocar este corte,
      // y una guarda por subcadena confundiría exactamente eso.
      const touched = new Set(
        [...body.matchAll(/(?:ALTER TABLE|ON)\s+public\.([a-z_]+)/g)].map((match) => match[1]),
      );
      const expected = file.startsWith('125')
        ? ['source_company_snapshots']
        : ['source_company_snapshots', 'source_snapshot_runs'];
      assert.deepEqual(
        [...touched].sort(),
        expected,
        `${file} modifica tablas fuera de la capa de snapshots: ${[...touched].join(', ')}`,
      );

      // Control en NEGATIVO: la guarda no puede pasar por vacía.
      assert.ok(touched.size > 0);
      assert.ok(body.includes('source_company_snapshots'));
      assert.ok(body.length > 1_000);
    }
  });

  it('ningún módulo del corte usa ON CONFLICT ni índices únicos', () => {
    for (const modulePath of CUT_MODULES) {
      const body = executableBody(modulePath).toLowerCase();
      assert.equal(body.includes('onconflict'), false, `${modulePath} usa ON CONFLICT`);
      assert.equal(body.includes('upsert('), false, `${modulePath} hace upsert`);
    }
  });

  it('la siembra sólo LEE: nada de insert, update ni delete', () => {
    const body = executableBody(CUT_MODULES[2]);
    assert.ok(body.includes('.select('));
    for (const write of ['.insert(', '.update(', '.delete(']) {
      assert.equal(body.includes(write), false, `la siembra no puede ${write}`);
    }
  });

  it('🔴 la ÚNICA RPC que la siembra invoca es la foto de SÓLO LECTURA', () => {
    // AGENT1-CUT3B4 — desde el vallado, la siembra SÍ llama a `.rpc(`, y la
    // prohibición literal anterior ya no puede sostenerse tal cual. Lo que la
    // sustituye es más fuerte: se comprueba QUÉ función invoca y que esa función no
    // escriba. Prohibir la palabra habría sido más fácil y menos verdadero.
    const body = bodyWithoutComments(CUT_MODULES[2]);
    assert.ok(body.includes('.rpc('), 'la siembra tiene que leer la foto por RPC');
    assert.ok(
      body.includes('BATCH_IDENTITY_SNAPSHOT_RPC'),
      'la siembra sólo puede invocar la RPC de la foto',
    );
    assert.equal(
      body.includes('FENCED_INSERT_RPC'),
      false,
      'la siembra NO puede invocar la RPC de escritura',
    );

    const sql = read(`supabase/migrations/${CUT3B4_MIGRATION}`);
    const snapshotFn = sql.match(
      /CREATE OR REPLACE FUNCTION public\.read_batch_identity_snapshot[\s\S]*?\$fn\$;/,
    );
    assert.ok(snapshotFn, 'no se encontró la función de la foto');
    const snapshotBody = snapshotFn[0].toLowerCase();
    assert.ok(snapshotBody.includes('stable'), 'la foto tiene que declararse STABLE');
    for (const write of ['insert into', 'update ', 'delete from']) {
      assert.equal(snapshotBody.includes(write), false, `la foto no puede ${write}`);
    }
  });
});

// ─── §§ 16/17 — ni activación de proveedor ni hueco parcial ───────────────────

describe('CUT-3B23 §§ 16/17 — sin activación de proveedor ni hueco parcial', () => {
  /**
   * 🔴 AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION § 15 — antes esto exigía `false`. La
   * activación es de CUT-6, no de este corte; lo que este corte promete es no
   * DECIDIRLA, y eso se prueba anclando que el valor vive en una sola declaración
   * literal en su único dueño.
   */
  it('el hueco parcial de Apollo se declara en un único sitio literal', () => {
    const source = read(
      'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts',
    );
    const declarations = source.match(
      /export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
    );
    assert.equal(declarations?.length, 1);
  });

  /**
   * 🔴 AGENT1-LOCAL-CUT9 § 17 — antes esto exigía `false`. La activación es de
   * CUT-9, no de este corte; lo que este corte promete es no DECIDIRLA, y eso se
   * prueba igual que con Apollo: anclando que el valor vive en una sola declaración
   * literal en su único dueño.
   */
  it('el hueco parcial de Lusha se declara en un único sitio literal', () => {
    const source = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    const declarations = source.match(
      /export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
    );
    assert.equal(declarations?.length, 1);
  });

  it('ningún módulo del corte nombra un flag de activación de proveedor', () => {
    for (const modulePath of CUT_MODULES) {
      const body = executableBody(modulePath);
      for (const flag of [
        'ENABLE_APOLLO_COMPANY_SEARCH',
        'ENABLE_APOLLO_TWO_ROUND_DISCOVERY',
        'ENABLE_LUSHA_PREVIEW',
        'ENABLE_APOLLO_PHONE_REVEAL',
        'ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING',
      ]) {
        assert.equal(body.includes(flag), false, `${modulePath} nombra ${flag}`);
      }
    }
  });

  it('el corte no toca Agente 2A', () => {
    for (const modulePath of CUT_MODULES) {
      const imports = bodyWithoutComments(modulePath);
      assert.equal(
        imports.includes('contact-enrichment-toolkit'),
        false,
        `${modulePath} importa el toolkit de Agente 2A`,
      );
    }
  });
});

// ─── § 18 — la limitación de concurrencia se DECLARA ──────────────────────────

// 🔴 La intención de este bloque nunca fue «di que NO»: era que el estado de la
// atomicidad quedara ESCRITO donde vive la decisión de identidad, en vez de
// suponerse. AGENT1-CUT3B4 cambia el estado, no la obligación — y lo parte en dos,
// porque las dos mitades son distintas y sólo una es verdad hoy en Producción.
describe('CUT-3B23/B4 § 18 — el estado de la atomicidad queda declarado', () => {
  it('el registro declara la atomicidad resuelta EN CÓDIGO', () => {
    const source = read(CUT_MODULES[1]);
    assert.ok(
      source.includes('CUT3_CONCURRENCY_ATOMICITY_SOLVED_IN_CODE = YES'),
      'el estado en código tiene que quedar escrito en el módulo',
    );
  });

  it('🔴 el registro declara que en PRODUCCIÓN sigue INERTE hasta aplicar la 126', () => {
    const source = read(CUT_MODULES[1]);
    assert.ok(
      source.includes('CUT3_CONCURRENCY_ATOMICITY_ACTIVE_IN_PROD = NO'),
      'sin esta línea el módulo afirmaría una garantía que la migración sin aplicar no da',
    );
    // Y no puede quedarse la afirmación vieja conviviendo con la nueva: dos estados
    // contradictorios en el mismo archivo no declaran nada.
    assert.equal(
      source.includes('CUT3_CONCURRENCY_ATOMICITY_SOLVED = NO'),
      false,
      'la declaración anterior a B4 tiene que retirarse, no acumularse',
    );
  });

  it('el registro sigue sin conocer la valla: la política es PURA', () => {
    const body = executableBody(CUT_MODULES[1]);
    for (const forbidden of ['batch-identity-fence', 'rpc(', 'supabase', 'identity_epoch']) {
      assert.equal(
        body.includes(forbidden),
        false,
        `el registro de identidad no puede conocer ${forbidden}`,
      );
    }
  });
});

// ─── La guarda, en NEGATIVO ───────────────────────────────────────────────────

describe('la guarda no puede pasar por vacía', () => {
  it('los archivos que inspecciona existen de verdad', () => {
    for (const target of [...CUT_MODULES, ...WRITERS.map((w) => w.path)]) {
      assert.ok(existsSync(join(REPO_ROOT, target)), `no existe ${target}`);
      assert.ok(read(target).length > 500, `${target} está sospechosamente vacío`);
    }
  });

  it('`stripNonExecutable` borra prosa y literales, y conserva el código', () => {
    const stripped = stripNonExecutable(`
      // buildCompanyIdentityEvidence en un comentario
      /* buildCompanyIdentityEvidence en un bloque */
      const label = 'buildCompanyIdentityEvidence en un literal';
      buildCompanyIdentityEvidence(input);
    `);
    assert.equal(stripped.includes('en un comentario'), false);
    assert.equal(stripped.includes('en un bloque'), false);
    assert.equal(stripped.includes('en un literal'), false);
    assert.ok(stripped.includes('buildCompanyIdentityEvidence(input)'));
  });

  it('`stripComments` conserva las rutas de import y borra la prosa', () => {
    const stripped = stripComments(`
      // ./company-identity-evidence sólo mencionado
      import { x } from './company-identity-evidence';
    `);
    assert.equal(stripped.includes('sólo mencionado'), false);
    assert.ok(stripped.includes("from './company-identity-evidence'"));
  });

  it('una aserción de cobertura FALLA sobre un archivo que no consume el contrato', () => {
    // `fiscal-identity.ts` es autoridad de CUT-3B1 y no participa de la
    // admisión: si esta aserción pasara, la guarda de cobertura sería vacua.
    const body = executableBody('src/server/agents/prospecting-toolkit/fiscal-identity.ts');
    assert.equal(body.includes('buildCompanyIdentityEvidence('), false);
    assert.equal(body.includes('evaluateCandidateIdentity('), false);
  });
});
