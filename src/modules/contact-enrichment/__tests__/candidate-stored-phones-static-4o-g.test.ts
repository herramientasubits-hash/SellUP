/**
 * Agente 2A — Guardas ESTÁTICAS de «Ver más números»
 * (AGENT2A-PHONE-REVEAL-4O-G)
 *
 * Estas pruebas sólo LEEN archivos del disco: no conectan con ninguna base, no
 * llaman a ningún proveedor y no gastan un crédito.
 *
 * Son el mecanismo que sostiene el contrato central del hito —ver números
 * almacenados cuesta CERO— cuando ya no quede nadie que recuerde por qué. El
 * contrato no se puede demostrar sólo ejecutando el código: un test de
 * comportamiento prueba que HOY no se llamó a Apollo; estas guardas prueban que
 * la llamada NO ESTÁ ESCRITA, y fallan en el momento en que alguien la añada.
 *
 * Cada aserción vale por lo que PROHÍBE.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');

const CORE = 'src/modules/contact-enrichment/candidate-stored-phones-core.ts';
const READ = 'src/modules/contact-enrichment/candidate-stored-phones-read.ts';
const ACTIONS = 'src/modules/contact-enrichment/candidate-stored-phones-actions.ts';
// P0-R4: la lista de roles salió del fichero de acciones. No podía vivir ahí —un
// módulo `'use server'` sólo puede exportar funciones async— pero sigue siendo
// parte del alcance de 4O-G y se vigila con las mismas guardas.
const ROLES = 'src/modules/contact-enrichment/candidate-stored-phones-authorized-roles.ts';
const DISCLOSURE = 'src/components/contact-enrichment/candidate-stored-phones-disclosure.tsx';
const COPY = 'src/components/contact-enrichment/candidate-stored-phones-copy.ts';
const LABELS = 'src/components/contact-enrichment/phone-display-labels.ts';

/** Todo lo que 4O-G añade. La lista es el alcance. */
const NEW_FILES = [CORE, READ, ACTIONS, ROLES, DISCLOSURE, COPY, LABELS] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/** El archivo sin comentarios: lo que realmente se ejecuta. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

const sources = Object.fromEntries(
  NEW_FILES.map((file) => [file, executable(read(file))]),
) as Record<(typeof NEW_FILES)[number], string>;

// ═══════════════════════════════════════════════════════════════
// 1. Cero proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-G — ningún camino de lectura puede llamar a un proveedor', () => {
  it('ningún archivo nuevo importa o invoca el cliente de Apollo', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /apollo-client|startApolloPhoneReveal|callApollo/i.test(sources[file]),
        false,
        `${file} no debe tocar el cliente de Apollo`,
      );
    }
  });

  it('ningún archivo nuevo importa o invoca el cliente de Lusha', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /lusha-client|lusha-phone-fallback-actions|revealCandidatePhoneViaLusha|callLusha/i.test(
          sources[file],
        ),
        false,
        `${file} no debe tocar el cliente de Lusha`,
      );
    }
  });

  it('ningún archivo nuevo invoca una acción de reveal ni el motor del waterfall', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /revealCandidatePhone|phone-reveal-actions|phone-reveal-waterfall-core|phone-reveal-waterfall-actions|startPhoneRevealWaterfall|executeLegacyLushaOnly|legacy-lusha-only-reveal-engine/.test(
          sources[file],
        ),
        false,
        `${file} no debe poder disparar un reveal`,
      );
    }
  });

  it('ningún archivo nuevo hace red por su cuenta', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /\bfetch\s*\(|axios|https?:\/\/api\./.test(sources[file]),
        false,
        `${file} no debe hacer red`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Cero dinero
// ═══════════════════════════════════════════════════════════════

describe('4O-G — ningún camino de lectura puede reservar, gastar ni contabilizar', () => {
  it('ningún archivo nuevo toca reservas de crédito', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /credit-reservation|reserve_and_create|phone_reveal_credit_reservations|reserveCredits/i.test(
          sources[file],
        ),
        false,
        `${file} no debe reservar créditos`,
      );
    }
  });

  it('ningún archivo nuevo toca el presupuesto', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /credit-budget|budget_rules|computeEffectiveConsumption|wizard_monthly_budget/i.test(
          sources[file],
        ),
        false,
        `${file} no debe consultar ni mover presupuesto`,
      );
    }
  });

  it('ningún archivo nuevo escribe un usage log de proveedor', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /logProviderUsage|usage-tracking\/logging|provider_usage_logs/.test(sources[file]),
        false,
        `${file} no debe escribir contabilidad de proveedor`,
      );
    }
  });

  it('ningún archivo nuevo crea corridas de waterfall', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /phone_reveal_waterfall_runs|createWaterfallRun/.test(sources[file]),
        false,
        `${file} no debe crear corridas`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Cero escritura
// ═══════════════════════════════════════════════════════════════

describe('4O-G — la cadena entera es de sólo lectura', () => {
  it('la lectura sólo hace SELECT: ni insert, ni update, ni delete, ni upsert', () => {
    const code = sources[READ];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(code.includes(forbidden), false, `${READ} no debe contener ${forbidden}`);
    }
    assert.ok(code.includes('.select('), 'la lectura sí debe hacer SELECT');
  });

  it('la lectura NO llama ninguna RPC — ni siquiera las de 110/111/112/113', () => {
    // Las funciones de persistencia son transaccionales y ESCRIBEN. Invocar
    // cualquiera de ellas para «ver» teléfonos convertiría una consulta en una
    // mutación.
    assert.equal(
      /\.rpc\(|persist_candidate_|suppress_candidate_phone/.test(sources[READ]),
      false,
    );
  });

  it('ninguna acción escribe: sólo delega en la lectura y en el núcleo puro', () => {
    const code = sources[ACTIONS];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(code.includes(forbidden), false, `${ACTIONS} no debe contener ${forbidden}`);
    }
  });

  it('nada de esto toca el estado del reveal en el candidato', () => {
    // Abrir el disclosure no puede mover `phone_reveal_status` ni sus compañeros:
    // mirar un dato no es un intento de revelarlo.
    for (const file of NEW_FILES) {
      assert.equal(
        /phone_reveal_status|phone_reveal_provider|phone_reveal_cost_credits|phone_revealed_at/.test(
          sources[file],
        ),
        false,
        `${file} no debe tocar el estado del reveal`,
      );
    }
  });

  it('nada de esto escribe en contactos ni en HubSpot', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /hubspot|approveContactCandidate|from\('contacts'\)/i.test(sources[file]),
        false,
        `${file} no debe tocar contactos ni HubSpot`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Independencia de flags de proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-G — un dato ya guardado no depende de que el proveedor esté encendido', () => {
  it('no se consulta ENABLE_PHONE_REVEAL_WATERFALL', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /isPhoneRevealWaterfallEnabled|ENABLE_PHONE_REVEAL_WATERFALL/.test(sources[file]),
        false,
        `${file} no debe depender del flag del waterfall`,
      );
    }
  });

  it('no se consulta ENABLE_LUSHA_PHONE_REVEAL_FALLBACK', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /isLushaPhoneRevealFallbackEnabled|ENABLE_LUSHA_PHONE_REVEAL_FALLBACK/.test(
          sources[file],
        ),
        false,
        `${file} no debe depender del flag de Lusha`,
      );
    }
  });

  it('no se lee ningún feature flag en absoluto', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /feature-flags|process\.env/.test(sources[file]),
        false,
        `${file} no debe leer flags ni entorno`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Autorización
// ═══════════════════════════════════════════════════════════════

describe('4O-G — autorización de servidor, no de UI', () => {
  it('las dos acciones exigen rol antes de leer', () => {
    const code = sources[ACTIONS];
    assert.ok(code.includes('resolveActorRoleKey'), 'debe resolver el rol del actor');
    assert.ok(code.includes('isAuthorized'), 'debe comprobar el rol');
    // Ambas exportadas y ambas pasando por el gate.
    const gateCount = (code.match(/isAuthorized\(await resolveActorRoleKey\(\)\)/g) ?? [])
      .length;
    assert.equal(gateCount, 2, 'las DOS acciones deben pasar por el gate');
  });

  it('el rol autorizado es el mismo `admin` de la revisión del candidato', () => {
    assert.match(
      sources[ROLES],
      /CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS: readonly string\[\] = \['admin'\]/,
    );
    // Y la acción lo consume de ahí, en vez de declarar una segunda lista propia.
    assert.match(
      sources[ACTIONS],
      /import \{ CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS \} from '\.\/candidate-stored-phones-authorized-roles'/,
    );
    // AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: el waterfall YA NO es el espejo de
    // esta lista — dejó de tener lista propia y reutiliza la autoridad canónica del
    // reveal (`admin` + `commercial_manager`). Lo que se verifica ahora es justamente
    // que no haya vuelto a nacer una segunda lista ahí.
    assert.doesNotMatch(
      executable(read('src/modules/contact-enrichment/phone-reveal-waterfall-core.ts')),
      /PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS/,
    );
    // Y la lectura de teléfonos almacenados sigue siendo admin-only por su cuenta:
    // que el waterfall se haya ensanchado no la arrastra.
  });

  it('la lectura privilegiada NO es invocable desde el navegador', () => {
    // El módulo que usa el service role no lleva 'use server': no puede
    // convertirse en un endpoint por accidente.
    assert.equal(sources[READ].includes("'use server'"), false);
    assert.ok(sources[READ].includes('createSupabaseAdminClient'));
    // Y el componente cliente sólo conoce las acciones, nunca la lectura directa.
    assert.equal(sources[DISCLOSURE].includes('candidate-stored-phones-read'), false);
    assert.equal(sources[DISCLOSURE].includes('createSupabaseAdminClient'), false);
  });

  it('no se crea ninguna ruta pública que consulte teléfonos por UUID', () => {
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else acc.push(full.slice(repoRoot.length + 1));
      }
      return acc;
    };
    const routes = walk(join(repoRoot, 'src/app/api')).filter(
      (path) => path.includes('stored-phone') || path.includes('candidate-phone'),
    );
    assert.deepEqual(routes, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-G — privacidad', () => {
  it('la consulta pide columnas explícitas y nunca `*`', () => {
    // `select('*')` arrastraría toda columna futura, incluidas la razón de
    // supresión y quién la aplicó.
    assert.equal(/\.select\(\s*['"`]\*/.test(sources[READ]), false);
  });

  it('no se traen los metadatos del tombstone más allá de la marca que filtra', () => {
    assert.equal(
      /suppression_reason|suppressed_by/.test(sources[READ]),
      false,
      'la razón de la supresión y su autor no tienen por qué salir de la base',
    );
  });

  it('ningún archivo nuevo imprime un teléfono', () => {
    for (const file of NEW_FILES) {
      const code = sources[file];
      // Se permite `console.error` con el CÓDIGO de la operación; lo que se
      // prohíbe es que un número, una fila o un payload entren en un log.
      assert.equal(
        /console\.(log|info|debug|warn)\s*\(/.test(code),
        false,
        `${file} no debe imprimir en consola fuera de errores`,
      );
      assert.equal(
        /console\.error\([^)]*(phone|number|row|data)\b[^)]*\)/i.test(
          code.replace(/console\.error\(\s*'\[candidate-stored-phones\][^']*'/g, ''),
        ),
        false,
        `${file} no debe imprimir números ni filas`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Copy: ver ≠ buscar
// ═══════════════════════════════════════════════════════════════

describe('4O-G — el copy no puede prometer una búsqueda', () => {
  it('ningún verbo de búsqueda aparece en el copy', () => {
    const code = sources[COPY];
    for (const forbidden of ['Buscar', 'Encontrar', 'Revelar', 'Enriquecer', 'Consultando']) {
      assert.equal(
        code.includes(forbidden),
        false,
        `«${forbidden}» implicaría gasto: este bloque sólo muestra lo guardado`,
      );
    }
  });

  it('el CTA usa el verbo VER', () => {
    assert.match(sources[COPY], /Ver 1 número más/);
    assert.match(sources[COPY], /Ver \$\{additionalCount\} números más/);
  });

  it('no se muestra costo por número', () => {
    // Los teléfonos guardados vinieron de respuestas cobradas POR RESPUESTA:
    // un precio unitario sería una cifra que nadie facturó.
    for (const file of [COPY, DISCLOSURE] as const) {
      assert.equal(
        /crédito|credits|costó|costo/i.test(sources[file]),
        false,
        `${file} no debe hablar de costo`,
      );
    }
  });

  // INVERSIÓN DELIBERADA (AGENT2A-SEARCH-MORE-PHONES-1). Esta guarda decía «todavía NO
  // existe un CTA "Buscar más números", ni deshabilitado», con el argumento correcto para su
  // momento: un botón gris con ese texto anunciaba una capacidad que no existía.
  //
  // Ahora existe. Lo que se invierte es la PREMISA, no la protección: la regla que de verdad
  // protegía algo era que 4O-G —la operación GRATUITA— no se contaminara con la pagada, y esa
  // regla sobrevive intacta. El disclosure sigue sin poder nombrar la búsqueda, y sigue sin
  // poder hablar de costo (lo fija el caso de arriba).
  //
  // Borrar el caso en vez de invertirlo dejaría sin vigilancia justo la frontera que este
  // hito hace más frágil: los dos CTA viven a centímetros en el mismo panel.
  it('«Buscar más números» vive en su PROPIO componente, nunca dentro del disclosure gratuito', () => {
    assert.equal(
      sources[DISCLOSURE].includes('Buscar más números'),
      false,
      'el disclosure GRATUITO no puede nombrar la operación pagada: es la confusión que separa VER de BUSCAR',
    );
    assert.equal(
      sources[COPY].includes('Buscar más números'),
      false,
      'el copy de 4O-G tampoco: cada operación tiene su propio archivo de copy',
    );

    // El drawer sí lo monta —es la superficie del CANDIDATO— pero por COMPOSICIÓN: el CTA y
    // su máquina de estados viven en `candidate-search-more-phones-cta.tsx`.
    const sheet = executable(
      read('src/components/contact-enrichment/contact-candidate-detail-sheet.tsx'),
    );
    assert.equal(
      sheet.includes('CandidateSearchMorePhonesCta'),
      true,
      'el drawer monta el CTA pagado por composición',
    );
    assert.equal(
      sheet.includes('searchMoreCandidatePhonesAction'),
      false,
      'el drawer NO invoca la acción que paga: sólo el componente, y sólo desde su propio botón',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Alcance: lo que el hito NO toca
// ═══════════════════════════════════════════════════════════════

// Estas guardas NO se apoyan en `git diff` contra `origin/main`.
//
// La primera versión sí lo hacía y pasaba en local, pero el checkout de CI es un
// clon superficial de una sola rama: `origin/main` no existe ahí y las tres
// aserciones reventaban. La lección no es «arreglar el ref»: una guarda que
// depende de la topología del clon comprueba cosas distintas según dónde corra, y
// la tentación entonces es hacerla saltarse en silencio cuando el ref falta — es
// decir, apagarla justo en el único sitio que bloquea un merge.
//
// Se sustituye por invariantes de CONTENIDO, que valen lo mismo en el portátil, en
// CI y dentro de un tarball sin `.git`, y que además vigilan la dirección que de
// verdad importa: que 4O-G no se filtre hacia el código que gasta.
describe('4O-G — alcance', () => {
  /** Todos los `.ts`/`.tsx` bajo `src/`. */
  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, acc);
      else if (/\.tsx?$/.test(entry.name)) acc.push(full);
    }
    return acc;
  }

  const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations');

  it('4O-G no añade ninguna migración: el techo lo movió 4O-H3 con la 116', () => {
    // 4O-B ya creó todo el esquema necesario. Si hiciera falta schema para
    // MOSTRAR teléfonos, el hito estaría mal planteado y esto es el HARD STOP.
    //
    // El techo lo movió AGENT2A-PHONE-REVEAL-4O-H1 con la 114 —el esquema OFICIAL de
    // múltiples teléfonos, creado INERTE— y después AGENT2A-PHONE-REVEAL-4O-H2 con la 115
    // —la PRIVACIDAD de ese esquema: contadores de auditoría y
    // `suppress_official_contact_phone_sources`—, dos hitos distintos y cada uno con su
    // propia guarda. Lo que aquí se protege es que 4O-G no aportó SQL, y el test siguiente
    // que tampoco editó el existente. Se siguen fijando el número más alto Y la CUENTA:
    // dos archivos con el mismo número, o uno colado sin renumerar, rompen la guarda.
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 3)))
      .sort((a, b) => a - b);
    // AGENT2A-PHONE-REVEAL-4O-H3 subió el techo a la 116: la APROBACIÓN atómica del
    // candidato sobre el esquema oficial. 4O-H3-B lo sube a la 117: el MERGE humano hacia un
    // contacto EXISTENTE, otra función transaccional. 4O-G sigue sin aportar ni editar SQL.
    // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119: catálogo de
    // Macro Industrias (siembra en `draft` y cutover), sin relación con teléfono.
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) lo sube a la 120, y
    // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 a la 121 (contabilidad de presupuesto: la
    // liquidación TRUTHFUL del sobrepaso, sin relación con teléfono). 4O-G sigue sin
    // aportar ni editar SQL.
    // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números» (la
    // modalidad `search_more` y el writer append-only). Toca la MISMA colección que 4O-G
    // LEE, pero sólo la escribe: los módulos de 4O-G siguen siendo de sólo lectura y
    // siguen sin aportar SQL, que es lo que esta guarda afirma.
    // AGENT1-PROVIDER-SEEN-MEMORY-2 lo mueve a la 123: la memoria de qué empresa ya nos
    // mostró un proveedor de PAGO. NO toca la colección que 4O-G lee: crea una tabla de
    // identidad de EMPRESA y no nombra ninguna tabla de teléfono.
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 lo mueve a la 124: la identidad
    // provider-native del reveal. Crea `contact_provider_identities` y añade columnas a la
    // reserva y a la corrida; NO toca la colección de teléfonos que 4O-G lee, y 4O-G sigue
    // sin aportar ni editar SQL, que es lo que esta guarda afirma.
    // BR-SOURCE-FUNCTIONAL-CUT-A lo movió a la 125, y luego a la 126: la identidad MENSUAL
    // del snapshot de Receita. NO toca la colección de teléfonos que 4O-G lee, y 4O-G sigue
    // sin aportar ni editar SQL, que es lo que esta guarda afirma. AUTORADA y NO APLICADA.
    // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY reclamó el 126 de forma independiente mientras
    // la reconciliación de BR-SOURCE CUT A.1 seguía en revisión: el vallado optimista de la
    // admisión por identidad de LOTE (Agente 1). Añade `prospect_batches.identity_epoch` y
    // dos funciones sobre `prospect_batches` y `prospect_candidates`; NO es de teléfono en
    // absoluto y no nombra ninguna tabla, columna ni función de teléfono, que es lo que esta
    // guarda vigila. Trae su propia guarda estática y NO edita ninguna migración anterior.
    // NO aplicada en Producción.
    // BR-SOURCE CUT A.1 RENUMERÓ su propia migración una segunda vez, de 126 a 127, para no
    // colisionar con la de AGENT1-CUT3B4, y dejó sitio a una migración 125 genérica
    // (reconciliación de `record_identity_key` sobre `source_company_snapshots`, fuentes NO
    // brasileñas) — ninguna de las tres toca la colección de teléfonos que 4O-G lee.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128:
    // `project_approved_candidate_phones_onto_contact`, la proyección de la colección de un
    // candidato YA APROBADO sobre el contacto que su propia aprobación creó. Sin tablas,
    // columnas, índices, triggers ni policies nuevas; M128 únicamente crea/reemplaza una
    // función y sus permisos. Sin backfill: no crea contactos, no re-terminaliza
    // candidatos y no re-declara ninguna función anterior. AUTORADA y NO APLICADA.
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: el tramo 129–132 de
    // la cadena de sincronización con HubSpot de Agente 2 (129 la completitud del estado durable
    // `stale`, 130 su procedencia, 131 la 128 re-emitida para producirlo con procedencia
    // `reveal`, 132 la línea base de los contactos ya vinculados). Las cuatro nacieron sin número
    // a propósito y lo reciben ahora que la disputa 125/126/127 está cerrada. 4O-G sigue sin aportar SQL.
    // BR-PRODUCTION-RELEASE mueve el techo a la 133: `133_br_candidate_identity_promotion.sql`,
    // la promoción VALLADA de la identidad fiscal resuelta de una candidata brasileña
    // (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub después de haber vivido en local
    // sin número mientras el espacio de nombres estaba en disputa. Crea UNA función
    // (`promote_candidate_fiscal_identity_fenced`) y sus permisos: sin tabla, sin columna, sin
    // índice, sin constraint y sin backfill. NO es de teléfono y no nombra ninguna tabla, columna
    // ni función de teléfono, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
    // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134:
    // `134_br_receita_compact_snapshot.sql`, la tabla dedicada y particionada del snapshot
    // nacional de Brasil. NO es de teléfono, no nombra ninguna tabla, columna ni función de
    // teléfono, y no edita el archivo de ninguna migración anterior. AUTORADA y NO APLICADA.
    // 🔴 AGENT1-LUSHA-CUT-L3 mueve el techo a la 135 (renumerada desde la 134 al integrarse en
    // serie después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
    // número): `135_agent1_lusha_prospecting_request_fence.sql`, la valla DURABLE de una
    // petición de Lusha Company Prospecting: una tabla (`lusha_prospecting_request_fence`) y
    // tres funciones que se escriben ANTES del envío, para que una caída dura no repita una
    // petición que el proveedor quizá ya cobró. Es de Agente 1 y de seguridad de GASTO: no es de
    // teléfono, no es del catálogo y no nombra ninguna tabla, columna ni función de las cadenas
    // que esta guarda vigila. AUTORADA y NO APLICADA.
    // AGENT1-LUSHA-CUT-L4 mueve el techo a la 136: historial DURABLE de INTENTOS y reclamo atomico de UN reintento seguro (solo tras 429 o 5xx). AUTORADA y NO APLICADA.
    // AGENT1-WIZARD-BUDGET-ADMIN-F1B mueve el techo a la 137: la superficie ADMINISTRATIVA
    // del presupuesto del Wizard —`wizard_monthly_budget_periods.updated_by`, la bitácora
    // append-only `wizard_budget_period_changes` y dos funciones que escriben valor y
    // bitácora en una misma transacción—. Es de Agente 1 y de CONFIGURACIÓN de gasto: no
    // es de teléfono, no es del catálogo y no nombra ninguna tabla, columna ni función de
    // las cadenas que esta guarda vigila. AUTORADA y NO APLICADA.
    // AGENT1-DISCARDED-PROSPECTS-REVIEW-1 mueve el techo a la 138: la disposición durable de
    // una empresa descartada, para "Descartadas" de Prospectos (issue #389). No es de
    // teléfono, no es del catálogo y no nombra ninguna tabla, columna ni función de las
    // cadenas que esta guarda vigila. AUTORADA y NO APLICADA.
    assert.equal(numbered[numbered.length - 1], 138);
    // El CONTEO, no el techo: 121 archivos para los números 001–121, es decir SIN un solo
    // hueco. Valía 118 mientras la 117 —aplicada en Producción desde el 2026-08-12— no
    // estaba en el repo: el hueco no era histórico, era el drift. Reconciliada la
    // historia, cuenta y techo coinciden, y esa coincidencia es en sí misma la guarda:
    // vuelve a fallar si alguien borra un archivo aplicado o cuela uno sin renumerar.
    // 127 archivos para los números 001-127 (124 previos + 125 reconciliación genérica + 126
    // AGENT1-CUT3B4 + 127 BR-CUT-A renumerada): sigue SIN un solo hueco, y conteo y techo
    // vuelven a coincidir. Esa coincidencia ES la guarda.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128:
    // `project_approved_candidate_phones_onto_contact`, la proyección de la colección de un
    // candidato YA APROBADO sobre el contacto que su propia aprobación creó. Sin tablas,
    // columnas, índices, triggers ni policies nuevas; M128 únicamente crea/reemplaza una
    // función y sus permisos. Sin backfill: no crea contactos, no re-terminaliza
    // candidatos y no re-declara ninguna función anterior. AUTORADA y NO APLICADA.
    // 135 archivos para los números 001-135: la 134 del compacto de BR y la 135 de
    // AGENT1-LUSHA-CUT-L3 (renumerada desde la 134) tampoco dejan hueco, así
    // que conteo y techo siguen coincidiendo. Esa coincidencia ES la guarda.
    // 137 archivos para los números 001-137: la 136 del historial de intentos seguros de
    // Lusha y la 137 de la auditoría administrativa del presupuesto del Wizard tampoco dejan
    // hueco, así que conteo y techo siguen coincidiendo. Esa coincidencia ES la guarda.
    // 138 archivos para los números 001-138: la 138 de la disposición durable de descartes de
    // Prospectos tampoco deja hueco. Esa coincidencia ES la guarda.
    assert.equal(numbered.length, 138);
  });

  it('ninguna migración menciona 4O-G: el hito no tocó SQL existente tampoco', () => {
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      assert.equal(
        /4O-G|stored-candidate-phones|stored_candidate_phones/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        ),
        false,
        `${file} fue modificado por 4O-G`,
      );
    }
  });

  it('NADIE fuera del drawer importa los módulos de 4O-G', () => {
    // La dirección que importa. Un `git diff` limpio hoy no impide que mañana el
    // motor del waterfall, el reservador de créditos o la aprobación empiecen a
    // colgarse de esta lectura y la conviertan en parte de un camino que gasta.
    // Esto sí lo impide, y para siempre.
    const ALLOWED_IMPORTERS = [
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
      'src/components/contact-enrichment/candidate-stored-phones-disclosure.tsx',
      'src/modules/contact-enrichment/candidate-stored-phones-actions.ts',
      'src/modules/contact-enrichment/candidate-stored-phones-authorized-roles.ts',
      'src/modules/contact-enrichment/candidate-stored-phones-read.ts',
      'src/modules/contact-enrichment/__tests__/candidate-stored-phones-core-4o-g.test.ts',
      'src/modules/contact-enrichment/__tests__/candidate-stored-phones-static-4o-g.test.ts',
      'src/components/contact-enrichment/__tests__/candidate-stored-phones-ui-4o-g.test.tsx',
      // ASYNC-UI-REFRESH-1: consumidor de PRUEBA, no de producción. Mockea la acción
      // de resumen para fijar las dos mitades de la regla de 4O-G sobre el ciclo de
      // vida asíncrono — 1 teléfono guardado NO ofrece el CTA, >1 sí— justo después de
      // que el reveal cierre. No importa la lectura ni ningún camino de gasto.
      'src/components/contact-enrichment/__tests__/contact-candidate-detail-phone-async-ui-refresh.test.tsx',
      // No importa nada: nombra el módulo para fijar que el barrido de P0-R4
      // sigue cubriéndolo. Es una guarda sobre 4O-G, no un consumidor suyo.
      'src/__tests__/use-server-export-contract-p0-r4.test.ts',
      // SEARCH-MORE-PHONES-1: el copy de «Buscar más números». NO importa ningún módulo
      // de 4O-G — sólo lo NOMBRA en un comentario, para explicar que su regla del verbo
      // es el ESPEJO de la de 4O-G: allí ninguna cadena puede sugerir que se busca algo
      // (la acción es gratis y abre lo ya guardado), y aquí el verbo tiene que ser BUSCAR
      // porque la acción PAGA. Las dos viven a centímetros en el mismo panel.
      'src/components/contact-enrichment/search-more-phones-copy.ts',
      // Y su suite, que LEE el archivo de 4O-G con `readFileSync` —no lo importa— para
      // afirmar la frontera en las DOS direcciones: que este copy diga BUSCAR y que el de
      // 4O-G siga sin poder usar ningún verbo de búsqueda. Es exactamente la guarda que
      // esta lista protege, aplicada desde el otro lado.
      'src/components/contact-enrichment/__tests__/search-more-phones-copy.test.ts',
      // SEARCH-MORE-PHONES-1B: la LECTURA de preflight de la operación pagada. NO importa
      // ningún módulo de 4O-G — sólo NOMBRA `candidate-stored-phones-read.ts` en un comentario,
      // para declarar que usa el MISMO patrón de lectura privilegiada (service role detrás de
      // una acción que ya autenticó y ya exigió rol) en vez de inventar otro. Su propio
      // contrato es idéntico al de 4O-G en lo que esta guarda protege: sólo `SELECT`.
      'src/modules/contact-enrichment/search-more-phones-read.ts',
      // Y su suite de UI, que MOCKEA la acción de resumen de 4O-G con `mock.module`. Registrar
      // un mock no es importar el módulo en un camino de producción: es lo que le permite
      // afirmar la propiedad que más importa de la frontera —que abrir el disclosure GRATUITO
      // sigue costando 0 mientras el CTA PAGADO existe a su lado— sin ejecutar la lectura real.
      'src/components/contact-enrichment/__tests__/search-more-phones-ui.test.tsx',
      // POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1: la LECTURA del reveal disparado desde la
      // ficha del contacto OFICIAL. NO importa ningún módulo de 4O-G — sólo NOMBRA
      // `candidate-stored-phones-read.ts` en un comentario, para declarar que usa el MISMO patrón
      // de lectura privilegiada (service role detrás de una acción que ya autenticó y ya exigió
      // rol) en vez de inventar otro. Su contrato es idéntico al de 4O-G en lo que esta guarda
      // protege: sólo `SELECT`, y sus conteos son enteros — ni un número de teléfono viaja.
      'src/modules/contact-enrichment/post-approval-reveal-read.ts',
      // AGENT2-CONTACT-HUBSPOT-AUTO-PHONE-UPDATE-CUT3C: inspección de PRUEBA, no acoplamiento
      // de runtime. NO importa ningún módulo de 4O-G: los LEE con `readFileSync` para afirmar
      // exactamente lo contrario de un consumo — que los módulos de teléfono guardado NO
      // llaman al entrypoint de HubSpot, así que abrir el disclosure gratuito de 4O-G no puede
      // disparar un PATCH. Es la misma guarda que esta lista protege, aplicada desde el otro
      // lado; precedente idéntico: ASYNC-UI-REFRESH-1 y la suite de copy de SEARCH-MORE.
      'src/modules/contacts/__tests__/contact-hubspot-auto-phone-update-cut3c.test.ts',
    ];
    const offenders = sourceFiles(join(repoRoot, 'src'))
      .map((absolute) => absolute.slice(repoRoot.length + 1))
      .filter((relative) => !ALLOWED_IMPORTERS.includes(relative))
      .filter((relative) => /candidate-stored-phones/.test(read(relative)));
    assert.deepEqual(offenders, []);
  });

  it('el código que GASTA no menciona 4O-G', () => {
    // Espejo de la guarda anterior sobre los archivos concretos cuyo asunto es
    // el dinero: si alguno los nombrara, la lectura habría entrado en un camino
    // de gasto aunque no lo importara por su ruta.
    const SPENDING_MODULES = [
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      'src/modules/contact-enrichment/phone-reveal-waterfall-core.ts',
      'src/modules/contact-enrichment/phone-reveal-waterfall-actions.ts',
      'src/modules/contact-enrichment/phone-reveal-credit-reservation-core.ts',
      'src/modules/contact-enrichment/phone-reveal-credit-budget-core.ts',
      'src/modules/contact-enrichment/lusha-phone-fallback-actions.ts',
      'src/modules/contact-enrichment/legacy-lusha-only-reveal-engine.ts',
      'src/modules/contact-enrichment/candidate-review-core.ts',
    ];
    for (const spendingModule of SPENDING_MODULES) {
      assert.equal(
        /4O-G|stored-candidate-phones|storedPhone/i.test(read(spendingModule)),
        false,
        `${spendingModule} no debe saber que 4O-G existe`,
      );
    }
  });

  it('la aprobación del candidato sigue siendo ESCALAR', () => {
    // 4O-G muestra la colección; NO la propaga al contacto oficial.
    // OFFICIAL_MULTI_PHONE_MODEL_PENDING sigue abierto.
    const core = read('src/modules/contact-enrichment/candidate-review-core.ts');
    const payload = core.match(/interface ContactInsertPayload \{([\s\S]*?)\n\}/);
    assert.ok(payload, '`ContactInsertPayload` debe seguir existiendo');
    assert.match(payload[1], /phone: string \| null;/);
    assert.equal(/phones\s*:\s*(readonly )?\w+\[\]|phones\s*:\s*Array</.test(payload[1]), false);
  });
});
