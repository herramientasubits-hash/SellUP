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
  // otra vez: RENUMERÓ esa migración de 125 a 126 —su cuerpo SQL no cambió en nada que afecte a
  // este corte— y añadió una migración 125 genérica y nueva (reconciliación de
  // `record_identity_key` sobre `source_company_snapshots` para fuentes NO brasileñas). El techo
  // pasa a 126 y el número libre a 127.
  //
  // Y en vez de sólo desplazar el número, se sigue probando la AFIRMACIÓN de verdad: que NI la
  // 125 NI la 126 son de CUT-3B23. Sus cuerpos no mencionan ninguna tabla ni símbolo de este
  // corte, lo que es estrictamente más fuerte que comparar un número.
  it('no existe una migración 127: este corte no añade la siguiente', () => {
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'));
    assert.equal(
      migrations.some((file) => file.startsWith('127')),
      false,
      'este corte no introduce la migración 127',
    );
  });

  it('la 126 es la última, y ni ella ni la 125 son de este corte', () => {
    const migrations = readdirSync(join(REPO_ROOT, 'supabase', 'migrations'))
      .filter((file) => /^\d{3}_/.test(file))
      .sort();
    const last = migrations[migrations.length - 1];
    assert.ok(last.startsWith('126'), `última migración inesperada: ${last}`);
    assert.equal(last, '126_br_receita_monthly_snapshot_identity.sql');
    assert.ok(migrations.includes('125_reconcile_source_snapshot_record_identity.sql'));

    // Ni la 125 (reconciliación genérica) ni la 126 (BR, renumerada) tocan una tabla de
    // CUT-3B23. Si un día este corte añadiera la suya disfrazada de cualquiera de las dos, esta
    // aserción caería.
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
      [last]: readFileSync(join(REPO_ROOT, 'supabase', 'migrations', last), 'utf8'),
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
      // 🔴 `record_identity_key` SÍ aparece en ambas — la 125 la EXIGE para no-Brasil y la 126 la
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
    for (const write of ['.insert(', '.update(', '.delete(', '.rpc(']) {
      assert.equal(body.includes(write), false, `la siembra no puede ${write}`);
    }
  });
});

// ─── §§ 16/17 — ni activación de proveedor ni hueco parcial ───────────────────

describe('CUT-3B23 §§ 16/17 — sin activación de proveedor ni hueco parcial', () => {
  it('el hueco parcial de Apollo sigue en `false`', () => {
    const source = read(
      'src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts',
    );
    assert.ok(source.includes('export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = false;'));
  });

  it('el hueco parcial de Lusha sigue en `false`', () => {
    const source = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    assert.ok(
      source.includes('export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false;'),
    );
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

describe('CUT-3B23 § 18 — la atomicidad NO se declara resuelta', () => {
  it('el registro documenta explícitamente que la concurrencia sigue abierta', () => {
    const source = read(CUT_MODULES[1]);
    assert.ok(
      source.includes('CUT3_CONCURRENCY_ATOMICITY_SOLVED = NO'),
      'la limitación de atomicidad tiene que quedar escrita en el módulo',
    );
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
