/**
 * Agente 2A — Guardas ESTÁTICAS de «Ver más números» del contacto OFICIAL
 * (AGENT2A-PHONE-REVEAL-4O-H4)
 *
 * Estas pruebas sólo LEEN archivos del disco: no conectan con ninguna base, no
 * llaman a ningún proveedor y no gastan un crédito.
 *
 * Son el mecanismo que sostiene el contrato central del hito —ver números
 * almacenados cuesta CERO y no escribe NADA— cuando ya no quede nadie que recuerde
 * por qué. El contrato no se puede demostrar sólo ejecutando el código: un test de
 * comportamiento prueba que HOY no se llamó a Apollo; estas guardas prueban que la
 * llamada NO ESTÁ ESCRITA, y fallan en el momento en que alguien la añada.
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

const CORE = 'src/modules/contact-enrichment/official-contact-stored-phones-core.ts';
const READ = 'src/modules/contact-enrichment/official-contact-stored-phones-read.ts';
const ACTIONS = 'src/modules/contact-enrichment/official-contact-stored-phones-actions.ts';
const MAPPING = 'src/modules/contact-enrichment/stored-phone-provenance-mapping.ts';
const DISCLOSURE = 'src/components/contacts/official-contact-stored-phones-disclosure.tsx';
const COPY = 'src/components/contacts/official-contact-stored-phones-copy.ts';
const SHEET = 'src/components/contacts/contact-detail-sheet.tsx';

/** Todo lo que 4O-H4 añade o toca en `src/`. La lista es el alcance. */
const TOUCHED_FILES = [CORE, READ, ACTIONS, MAPPING, DISCLOSURE, COPY, SHEET] as const;

/** Los que el hito CREA. La ficha ya existía. */
const NEW_FILES = [CORE, READ, ACTIONS, MAPPING, DISCLOSURE, COPY] as const;

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
  TOUCHED_FILES.map((file) => [file, executable(read(file))]),
) as Record<(typeof TOUCHED_FILES)[number], string>;

// ═══════════════════════════════════════════════════════════════
// 1. Cero proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — ningún camino de lectura puede llamar a un proveedor', () => {
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

describe('4O-H4 — ningún camino de lectura puede reservar, gastar ni contabilizar', () => {
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

describe('4O-H4 — la cadena entera es de sólo lectura', () => {
  it('la lectura sólo hace SELECT: ni insert, ni update, ni delete, ni upsert', () => {
    const code = sources[READ];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(code.includes(forbidden), false, `${READ} no debe contener ${forbidden}`);
    }
    assert.ok(code.includes('.select('), 'la lectura sí debe hacer SELECT');
  });

  it('la lectura NO llama ninguna RPC — ni la aprobación ni la de privacidad', () => {
    // `approve_contact_candidate_with_phones` (116) y
    // `suppress_official_contact_phone_sources` (115) son transaccionales y
    // ESCRIBEN. Invocar cualquiera para «ver» teléfonos convertiría una consulta en
    // una mutación.
    assert.equal(
      /\.rpc\(|approve_contact_candidate|suppress_official_contact_phone|persist_candidate_/.test(
        sources[READ],
      ),
      false,
    );
  });

  it('ninguna acción escribe: sólo delega en la lectura y en el núcleo puro', () => {
    const code = sources[ACTIONS];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(code.includes(forbidden), false, `${ACTIONS} no debe contener ${forbidden}`);
    }
  });

  it('el núcleo puro no habla con ninguna base', () => {
    assert.equal(
      /createClient|createSupabaseAdminClient|supabase|\.from\(/.test(sources[CORE]),
      false,
      `${CORE} debe ser puro`,
    );
    assert.equal(/createClient|supabase|\.from\(/.test(sources[MAPPING]), false);
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

  it('nada de esto escribe en HubSpot', () => {
    for (const file of TOUCHED_FILES) {
      assert.equal(
        /runSyncContactToHubSpot|syncContactToHubSpot|hubspot-contact-sync/i.test(sources[file]),
        false,
        `${file} no debe sincronizar con HubSpot`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Aislamiento respecto de los hitos vecinos
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — no invade la aprobación, ni H3-B, ni la privacidad, ni la edición manual', () => {
  it('no importa la aprobación del candidato ni su persistencia', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /official-contact-approval|approveContactCandidate|candidate-review-core/.test(
          sources[file],
        ),
        false,
        `${file} no debe conocer la aprobación`,
      );
    }
  });

  it('no importa el merge a contacto existente (H3-B)', () => {
    // H3-B está en vuelo y es un hito de ESCRITURA. Que estos dos no se conozcan es
    // la propiedad que hace que puedan revisarse por separado.
    for (const file of TOUCHED_FILES) {
      assert.equal(
        /existing-contact-merge|mergeCandidateIntoExistingContact/.test(sources[file]),
        false,
        `${file} no debe conocer H3-B`,
      );
    }
  });

  it('no importa la supresión ni la RPC de privacidad', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /phone-cache-suppression|official-contact-phone-suppression|suppressOfficial|SUPPRESSIBLE_CONTACT_PHONE_SOURCES/.test(
          sources[file],
        ),
        false,
        `${file} no debe invocar la privacidad`,
      );
    }
  });

  it('no importa la edición manual del teléfono del contacto', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /contact-phone-provenance|buildManualContactPhoneEditPatch|resolveManualContactPhoneEdit/.test(
          sources[file],
        ),
        false,
        `${file} no debe tocar la edición manual`,
      );
    }
  });

  it('el escalar heredado de móvil NO se consulta en ningún archivo nuevo', () => {
    // Este hito NO toca el escalar heredado, ni para leerlo.
    //
    // La tentación era consultarlo para no listar como «adicional» un número que la
    // ficha ya pinta. No se hace: 4O-E4.1 fijó por prueba estática la lista EXACTA
    // de archivos que pueden nombrarlo, porque ese escalar no tiene columna de
    // procedencia y cada consumidor nuevo invalida la premisa sobre la que se apoya
    // su erasure. Un hito de sólo lectura no es quien debe gastar esa premisa; la
    // convergencia es de H5.
    //
    // Esta guarda es el espejo local de aquélla: si alguien vuelve a añadirlo aquí,
    // falla en los dos sitios a la vez.
    for (const file of NEW_FILES) {
      assert.equal(
        sources[file].includes('mobile_phone'),
        false,
        `${file} no debe consultar el escalar heredado de móvil`,
      );
    }
    assert.match(
      sources[READ],
      /\.select\('phone'\)/,
      'la lectura pide SÓLO el escalar principal',
    );

    // Y la ficha sigue pintando el móvil tal como lo pintaba: este hito no le quita
    // nada a lo que ya se veía.
    assert.match(sources[SHEET], /contact\.mobile_phone/);
  });

  it('no existe un CTA «Buscar más números», ni deshabilitado', () => {
    // Un botón gris con ese texto ya anuncia una capacidad que no existe.
    for (const file of TOUCHED_FILES) {
      assert.equal(sources[file].includes('Buscar más números'), false, `${file}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Independencia de flags de proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — un dato ya guardado no depende de que el proveedor esté encendido', () => {
  it('no se consulta ningún flag de reveal', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /isPhoneRevealWaterfallEnabled|ENABLE_PHONE_REVEAL_WATERFALL|isLushaPhoneRevealFallbackEnabled|ENABLE_LUSHA_PHONE_REVEAL_FALLBACK|ENABLE_APOLLO_PHONE_REVEAL/.test(
          sources[file],
        ),
        false,
        `${file} no debe depender de un flag de proveedor`,
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
// 6. Autorización y RLS
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — autorización de servidor, y RLS dentro de PostgreSQL', () => {
  it('las dos acciones exigen usuario interno ACTIVO antes de leer', () => {
    const code = sources[ACTIONS];
    assert.ok(code.includes('isActiveInternalUser'), 'debe resolver el actor');
    const gateCount = (code.match(/await isActiveInternalUser\(\)/g) ?? []).length;
    assert.equal(gateCount, 2, 'las DOS acciones deben pasar por el gate');
    assert.match(code, /access_status[^\n]*active/, 'el gate exige acceso activo');
  });

  it('la lectura usa el cliente de SESIÓN y NUNCA el service role', () => {
    // Ésta es la divergencia deliberada con la colección del candidato: la 114
    // concede SELECT a `authenticated` bajo `has_active_access(auth.uid())`, así
    // que quien decide qué filas se devuelven es PostgreSQL. Usar el cliente admin
    // saltaría ese control para reimplementarlo peor en TypeScript.
    assert.equal(
      /createSupabaseAdminClient|service_role|SERVICE_ROLE/.test(sources[READ]),
      false,
      'la lectura no debe escalar privilegios',
    );
    assert.ok(sources[READ].includes("from '@/lib/supabase/server'"));

    for (const file of NEW_FILES) {
      assert.equal(
        /createSupabaseAdminClient/.test(sources[file]),
        false,
        `${file} no debe usar el cliente admin`,
      );
    }
  });

  it('las policies de la 114 que este hito EJERCE siguen existiendo y son de SELECT', () => {
    // Si alguien retirase la policy de lectura, esta superficie dejaría de
    // funcionar en silencio y la tentación sería «arreglarlo» con el service role.
    const migration = read('supabase/migrations/114_official_contact_phones.sql');
    for (const policy of [
      'active_users_can_read_contact_phones',
      'active_users_can_read_contact_phone_sources',
    ]) {
      assert.ok(migration.includes(policy), `${policy} debe seguir existiendo`);
    }
    assert.match(migration, /GRANT SELECT ON TABLE public\.contact_phones TO authenticated/);
    assert.match(
      migration,
      /GRANT SELECT ON TABLE public\.contact_phone_sources TO authenticated/,
    );
  });

  it('el componente cliente sólo conoce las acciones, nunca la lectura directa', () => {
    assert.equal(sources[DISCLOSURE].includes('official-contact-stored-phones-read'), false);
    assert.equal(sources[DISCLOSURE].includes('createClient'), false);
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
      (path) => path.includes('stored-phone') || path.includes('contact-phone'),
    );
    assert.deepEqual(routes, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — privacidad', () => {
  it('la consulta pide columnas explícitas y nunca `*`', () => {
    assert.equal(/\.select\(\s*['"`]\*/.test(sources[READ]), false);
  });

  it('no se traen los metadatos del tombstone más allá de la marca que filtra', () => {
    assert.equal(
      /suppression_reason|suppressed_by/.test(sources[READ]),
      false,
      'la razón de la supresión y su autor no tienen por qué salir de la base',
    );
  });

  it('las DOS tablas se filtran por `suppressed_at IS NULL`', () => {
    // La de procedencia no tiene equivalente en el candidato y es la que permite
    // una erasure POR PROVEEDOR. Sin este filtro, un número seguiría rotulado con
    // el proveedor cuya observación acaba de retirarse.
    const filters = (sources[READ].match(/\.is\('suppressed_at', null\)/g) ?? []).length;
    assert.equal(filters, 2, 'colección Y procedencia');
  });

  it('no se traen punteros de auditoría ni de contabilidad', () => {
    for (const forbidden of [
      'waterfall_run_id',
      'reservation_id',
      'provider_usage_log_id',
      'candidate_phone_id',
      'source_event_key',
    ]) {
      assert.equal(
        sources[READ].includes(forbidden),
        false,
        `${forbidden} no se necesita para mostrar un número`,
      );
    }
  });

  it('ningún archivo nuevo imprime un teléfono', () => {
    for (const file of NEW_FILES) {
      const code = sources[file];
      // Se permite `console.error` con el CÓDIGO de la operación; lo que se prohíbe
      // es que un número, una fila o un payload entren en un log.
      assert.equal(
        /console\.(log|info|debug|warn)\s*\(/.test(code),
        false,
        `${file} no debe imprimir en consola fuera de errores`,
      );
      assert.equal(
        /console\.error\([^)]*(phone|number|row|data)\b[^)]*\)/i.test(
          code.replace(/console\.error\(\s*'\[official-contact-stored-phones\][^']*'/g, ''),
        ),
        false,
        `${file} no debe imprimir números ni filas`,
      );
    }
  });

  it('el conteo viaja solo: el resumen no devuelve ningún número', () => {
    const summary = sources[ACTIONS].match(
      /getOfficialContactStoredPhoneSummaryAction[\s\S]*?\n\}/,
    );
    assert.ok(summary, 'el resumen debe existir');
    assert.equal(
      /selectAdditionalStoredOfficialPhones/.test(summary[0]),
      false,
      'el resumen no debe construir la lista de números',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Copy: ver ≠ buscar
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — el copy no puede prometer una búsqueda', () => {
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
    for (const file of [COPY, DISCLOSURE] as const) {
      assert.equal(
        /crédito|credits|costó|costo/i.test(sources[file]),
        false,
        `${file} no debe hablar de costo`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Alcance
// ═══════════════════════════════════════════════════════════════

describe('4O-H4 — alcance', () => {
  const MIGRATIONS_DIR = join(repoRoot, 'supabase/migrations');

  it('4O-H4 no añade ninguna migración, y la numeración sigue siendo sana', () => {
    // Si hiciera falta schema para MOSTRAR teléfonos, el hito estaría mal planteado
    // y esto es el HARD STOP. Lo aporta la guarda siguiente, que es la que mira si
    // este milestone tocó SQL.
    //
    // Aquí NO se fija el número más alto a una constante. La tentación es hacerlo
    // —el resto de la cadena lo hace— pero un techo literal convierte «4O-H4 no
    // añadió SQL» en «nadie añadió SQL», y entonces la guarda se rompe cada vez que
    // un hito AJENO aporta legítimamente una migración (4O-H3-B ya trae la 117).
    // Cuando eso pasa, el arreglo mecánico es subir el número sin pensar — que es
    // exactamente el reflejo que la guarda existía para impedir.
    //
    // Lo que sí se conserva es lo que el techo literal compraba de verdad: que la
    // numeración sea CONTIGUA y sin repetidos. Dos archivos con el mismo número, o
    // uno colado sin renumerar, siguen rompiendo esto.
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((file) => /^\d{3}_.*\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 3)))
      .sort((a, b) => a - b);

    assert.ok(numbered.length >= 116, 'suelo de cordura: el directorio no puede vaciarse');
    assert.deepEqual(
      numbered,
      Array.from({ length: numbered.length }, (_, index) => index + 1),
      'la numeración debe ser 1..N, contigua y sin repetidos',
    );
  });

  it('ninguna migración menciona 4O-H4: el hito no tocó SQL existente tampoco', () => {
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      assert.equal(
        /4O-H4|official-contact-stored-phones/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        ),
        false,
        `${file} fue modificado por 4O-H4`,
      );
    }
  });

  it('NADIE fuera de la ficha del contacto importa los módulos de 4O-H4', () => {
    // La dirección que importa. Un diff limpio hoy no impide que mañana el motor
    // del waterfall, el reservador de créditos o la aprobación empiecen a colgarse
    // de esta lectura y la conviertan en parte de un camino que gasta.
    function sourceFiles(dir: string, acc: string[] = []): string[] {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, acc);
        else if (/\.tsx?$/.test(entry.name)) acc.push(full);
      }
      return acc;
    }

    const ALLOWED_IMPORTERS: readonly string[] = [
      SHEET,
      DISCLOSURE,
      CORE,
      READ,
      ACTIONS,
      'src/modules/contact-enrichment/__tests__/official-contact-stored-phones-core-4o-h4.test.ts',
      'src/modules/contact-enrichment/__tests__/official-contact-stored-phones-static-4o-h4.test.ts',
      'src/components/contacts/__tests__/official-contact-stored-phones-ui-4o-h4.test.tsx',
      // R2.1 — el arnés de PostgreSQL REAL. Importa la lectura, el núcleo y las dos
      // acciones a propósito: es la única suite que ejecuta la cadena entera contra un
      // servidor de verdad, y lo que mide —qué filas selecciona cada `SELECT` y qué
      // esconden las policies de la 114— no se puede medir sobre arrays escritos a mano.
      'src/modules/contact-enrichment/__tests__/official-contact-stored-phones-postgres-4o-h4.test.ts',
      // La guarda de 4O-H1 nombra la LECTURA porque es quien la admitió en su
      // allowlist de acceso a las tablas oficiales: H1 declaró «cero lectores» y
      // este hito añade el primero, así que el registro de esa decisión vive allí.
      'src/modules/contacts/__tests__/official-contact-phone-schema-static-4o-h1.test.ts',
    ];
    const offenders = sourceFiles(join(repoRoot, 'src'))
      .map((absolute) => absolute.slice(repoRoot.length + 1))
      .filter((relative) => !ALLOWED_IMPORTERS.includes(relative))
      .filter((relative) => /official-contact-stored-phones/.test(read(relative)));
    assert.deepEqual(offenders, []);
  });

  it('el código que GASTA no menciona 4O-H4', () => {
    const SPENDING_MODULES = [
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      'src/modules/contact-enrichment/phone-reveal-waterfall-core.ts',
      'src/modules/contact-enrichment/phone-reveal-waterfall-actions.ts',
      'src/modules/contact-enrichment/phone-reveal-credit-reservation-core.ts',
      'src/modules/contact-enrichment/phone-reveal-credit-budget-core.ts',
      'src/modules/contact-enrichment/lusha-phone-fallback-actions.ts',
      'src/modules/contact-enrichment/legacy-lusha-only-reveal-engine.ts',
      'src/modules/contact-enrichment/official-contact-approval-core.ts',
    ];
    for (const spendingModule of SPENDING_MODULES) {
      assert.equal(
        /4O-H4|official-contact-stored-phones|storedOfficialPhone/i.test(read(spendingModule)),
        false,
        `${spendingModule} no debe saber que 4O-H4 existe`,
      );
    }
  });

  it('el mapa de procedencia vive UNA sola vez, en el módulo neutral', () => {
    // Se extrajo precisamente para que las dos colecciones —la del candidato y la
    // oficial— no puedan responder distinto a «¿de dónde salió este número?».
    assert.ok(
      sources[MAPPING].includes("case 'apollo_cache':"),
      'el mapa debe estar en el módulo neutral',
    );
    assert.ok(
      sources[CORE].includes('stored-phone-provenance-mapping'),
      'el núcleo oficial debe importarlo, no copiarlo',
    );
    assert.equal(
      /case 'apollo':|case 'lusha':/.test(sources[CORE]),
      false,
      'el núcleo oficial no debe llevar su propia copia del mapa',
    );
  });

  it('la ficha del contacto sigue mostrando los escalares que ya mostraba', () => {
    // Este hito AÑADE una superficie de lectura; no reemplaza ninguna.
    const sheet = sources[SHEET];
    assert.match(sheet, /contact\.phone && \(/, '`contacts.phone` sigue pintándose');
    assert.match(sheet, /contact\.mobile_phone && \(/, 'el móvil sigue pintándose');
    // Y el CTA sólo existe si el servidor contó extras.
    assert.match(sheet, /additionalPhoneCount > 0 && \(/);
  });
});
