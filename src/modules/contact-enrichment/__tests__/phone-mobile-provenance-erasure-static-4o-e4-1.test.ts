/**
 * Agente 2A — guardas ESTÁTICAS de la preservación de `mobile_phone`
 * (AGENT2A-PHONE-REVEAL-4O-E4.1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE Y POR QUÉ NO BASTA EL TEST DE COMPORTAMIENTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * La propiedad de este hito es NEGATIVA —una columna que NO se toca— y su premisa es
 * un hecho del REPOSITORIO, no del core: que `contacts.mobile_phone` no tiene ningún
 * escritor de proveedor. El día que aparezca uno, la decisión de E4.1 deja de ser
 * correcta y hay que revisitarla ANTES de que un borrado quede corto.
 *
 * Un test de comportamiento sobre el core no puede ver eso: el core seguiría verde
 * mientras otro módulo empieza a escribir la columna desde un payload de proveedor.
 * Por eso aquí se lee el REPOSITORIO y se afirma su forma:
 *
 *   * aparece un escritor de `mobile_phone` fuera de los formularios manuales → falla
 *   * el subsistema de supresión vuelve a mencionar `mobile_phone` en CÓDIGO → falla
 *   * reaparece `MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES`                    → falla
 *   * el UPDATE deja de ser condicional por procedencia                      → falla
 *   * se crea `mobile_phone_source`, `contact_phones` o una migración         → falla
 *   * la suite deja de estar cableada al check obligatorio                    → falla
 *
 * Sin proveedores, sin créditos, sin DB, sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const SRC_DIR = join(repoRoot, 'src');
const MIGRATIONS_DIR = join(repoRoot, 'supabase', 'migrations');

const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

/**
 * Quita comentarios de bloque y de línea. Las guardas de «esto NO existe» miran
 * CÓDIGO: este subsistema documenta largamente por qué `mobile_phone` no tiene
 * procedencia, y una guarda que leyera el texto crudo se estaría midiendo a sí misma.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * SQL EJECUTABLE: el archivo sin las líneas de comentario `--` ni los bloques de
 * comentario delimitados. Misma convención (y mismo nombre) que `executable()` en
 * src/modules/contacts/__tests__/official-contact-phone-schema-static-4o-h1.test.ts.
 */
function executableSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/**
 * SQL ESTRUCTURAL: lo ejecutable menos los `COMMENT ON … IS '…';`, que son prosa dentro
 * de una sentencia. Misma convención que `structuralSql` en la suite hermana de 4O-H1,
 * que la definió para exactamente esta aserción de AUSENCIA.
 *
 * AGENT2A-PHONE-REVEAL-4O-H2: la 115 nombra `mobile_phone` en un comentario `--` y en el
 * `COMMENT ON FUNCTION`, y en los dos sitios lo que dice es que NO la toca. Una guarda que
 * leyera el texto crudo castigaría precisamente la frase que declara el límite, y la forma
 * de aprobarla sería borrarla.
 */
function structuralSql(source: string): string {
  return executableSql(source).replace(/COMMENT ON [\s\S]*?';\n/g, '');
}

const CORE = ['src', 'modules', 'contact-enrichment', 'phone-cache-suppression-core.ts'];
const ACTIONS = [
  'src',
  'modules',
  'contact-enrichment',
  'phone-cache-suppression-actions.ts',
];
const CONTACT_ACTIONS = ['src', 'modules', 'contacts', 'actions.ts'];
const WORKFLOW = ['.github', 'workflows', 'automatic-routing-tests.yml'];
const PACKAGE_JSON = ['package.json'];

// ═══════════════════════════════════════════════════════════════
// 1. La AUDITORÍA DE ESCRITORES, congelada
// ═══════════════════════════════════════════════════════════════

/**
 * Ficheros de `src/` (excluidos los tests) cuyo CÓDIGO menciona `mobile_phone`, con
 * el papel que cumple cada uno. Es la auditoría de 4O-E4.1 convertida en guarda: la
 * conclusión «ningún proveedor escribe esta columna» sólo vale mientras esta lista no
 * crezca por sorpresa.
 *
 * Los DOS únicos escritores son `createContact` y `updateContact`; todo lo demás lee,
 * tipa o etiqueta.
 */
const EXPECTED_MOBILE_PHONE_FILES: Record<string, string> = {
  'app/(sellup)/contacts/[contactId]/page.tsx': 'lectura — UI de detalle',
  'components/contacts/contact-detail-sheet.tsx': 'lectura — UI de detalle',
  'components/contacts/contacts-data-table-client.tsx': 'lectura — columna de tabla',
  'components/contacts/contacts-tab.tsx': 'lectura — UI de cuenta',
  'components/contacts/contacts-table-client.tsx': 'lectura — tabla legacy',
  'components/contacts/create-contact-drawer.tsx': 'ESCRITOR MANUAL — formulario «Celular»',
  'components/contacts/edit-contact-drawer.tsx': 'ESCRITOR MANUAL — formulario «Celular»',
  'modules/contacts/actions.ts': 'ESCRITOR — createContact / updateContact (manual)',
  'modules/contacts/contact-hubspot-sync-core.ts': 'lectura — sync saliente a HubSpot',
  'modules/contacts/contact-traceability.ts': 'etiqueta de UI',
  'modules/contacts/types.ts': 'tipo de la fila',
  'server/agents/contact-enrichment-toolkit/existing-contacts-reader.ts':
    'lectura — snapshot previo al enriquecimiento',
};

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      listSourceFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('4O-E4.1 estático — la auditoría de escritores de mobile_phone', () => {
  const filesMentioningMobilePhone = () =>
    listSourceFiles(SRC_DIR)
      .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('mobile_phone'))
      .map((file) => relative(SRC_DIR, file).split(sep).join('/'))
      .sort();

  it('ningún fichero NUEVO menciona mobile_phone en código', () => {
    const unexpected = filesMentioningMobilePhone().filter(
      (file) => !(file in EXPECTED_MOBILE_PHONE_FILES),
    );
    assert.deepEqual(
      unexpected,
      [],
      'un escritor nuevo invalida la premisa de E4.1: revisa la procedencia antes de tocar la erasure',
    );
  });

  it('la lista esperada no tiene entradas muertas (la guarda no se afloja sola)', () => {
    const actual = new Set(filesMentioningMobilePhone());
    const stale = Object.keys(EXPECTED_MOBILE_PHONE_FILES).filter((f) => !actual.has(f));
    assert.deepEqual(stale, []);
  });

  it('los ÚNICOS escritores son los dos caminos manuales de contacts/actions.ts', () => {
    const code = stripComments(read(...CONTACT_ACTIONS));
    // createContact: el payload del INSERT.
    assert.match(code, /mobile_phone: input\.mobile_phone\?\.trim\(\) \|\| null,/);
    // updateContact: sólo si el input trae la clave.
    assert.match(
      code,
      /if \(input\.mobile_phone !== undefined\) payload\.mobile_phone =/,
    );
    // Y nada más: DOS asignaciones —la del INSERT y la del UPDATE—, ni una tercera.
    // Las lecturas (`input.mobile_phone !== undefined`, la proyección del SELECT) no
    // casan con este patrón porque no van seguidas de `:` ni de `=`.
    const assignments = code.match(/(?:payload\.)?mobile_phone\s*[:=][^=]/g) ?? [];
    assert.equal(
      assignments.length,
      2,
      `escrituras inesperadas de mobile_phone en contacts/actions.ts: ${assignments.join(', ')}`,
    );
  });

  it('la aprobación de un candidato NO puede escribir mobile_phone', () => {
    // `ContactInsertPayload` es lo ÚNICO que la aprobación inserta en `contacts`.
    const reviewCore = stripComments(
      read('src', 'modules', 'contact-enrichment', 'candidate-review-core.ts'),
    );
    const iface = reviewCore.match(/interface ContactInsertPayload \{([\s\S]*?)\n\}/);
    assert.ok(iface, 'ContactInsertPayload debe seguir existiendo');
    assert.equal(
      /mobile_phone/.test(iface[1]),
      false,
      'si la aprobación empieza a poblar mobile_phone, la columna gana procedencia y E4.1 debe revisitarse',
    );
  });

  it('ninguna migración escribe mobile_phone (sólo la 039 declara la columna)', () => {
    // AGENT2A-PHONE-REVEAL-4O-H2 — la guarda pasa a leer SQL ESTRUCTURAL, la misma vista
    // que la suite hermana de 4O-H1 definió para las aserciones de AUSENCIA.
    //
    // La 115 nombra `mobile_phone` en un comentario `--` y en su `COMMENT ON FUNCTION`, y
    // en los dos sitios lo que dice es que el borrado oficial NO la toca porque la columna
    // no tiene procedencia (MOBILE_PHONE_PROVENANCE_PENDING). Castigar la prosa empujaría
    // a borrar exactamente la frase que declara el límite. Los DIENTES no se caen: una
    // escritura en SQL estructural sobrevive al filtro y sigue rompiendo la guarda, y la
    // lista de migraciones que la mencionan SÓLO en prosa se fija abajo, nombre a nombre,
    // para que nadie añada una mención nueva sin que se note.
    const proseOnly: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      if (!/mobile_phone/i.test(sql)) continue;
      if (!/mobile_phone/i.test(structuralSql(sql))) {
        proseOnly.push(file);
        continue;
      }
      assert.equal(
        file,
        '039_create_contacts_foundation.sql',
        `${file} no debe tocar mobile_phone`,
      );
      assert.equal(
        /UPDATE\s+[^;]*mobile_phone|SET\s+mobile_phone/i.test(sql),
        false,
        'la 039 sólo DECLARA la columna; ninguna migración la puebla',
      );
    }
    assert.deepEqual(
      proseOnly.sort(),
      [
        '115_official_contact_phone_privacy.sql',
        // 4O-H3 la nombra por la MISMA razón y con el mismo efecto: un comentario y el
        // `COMMENT ON FUNCTION` que dejan escrito que la aprobación NO la escribe.
        '116_approve_candidate_with_official_phones.sql',
        // 4O-H3-B la nombra por la MISMA razón: sus comentarios declaran que el merge humano NO
        // escribe `mobile_phone` — un comentario dentro de la función y el `COMMENT ON
        // FUNCTION` afirman explícitamente «NEVER touches mobile_phone (4O-E4.1)». Nombrarla
        // para prometer que no se toca es lo contrario de tocarla, y es justo lo que esta
        // lista distingue.
        '117_merge_candidate_into_existing_contact.sql',
      ],
      'las únicas migraciones que pueden NOMBRAR mobile_phone sin tocarla son la 115 (4O-H2), la 116 (4O-H3) y la 117 (4O-H3-B), que documentan que no la tocan',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. El subsistema de supresión ya no toca la columna
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 estático — la supresión no menciona mobile_phone en código', () => {
  for (const [label, rel] of [
    ['core', CORE],
    ['actions', ACTIONS],
  ] as const) {
    it(`${label}: cero apariciones de mobile_phone fuera de los comentarios`, () => {
      const code = stripComments(read(...rel));
      assert.equal(
        /mobile_phone/.test(code),
        false,
        'la columna no puede volver al patch ni al predicado sin un modelo de procedencia',
      );
    });
  }

  it('la allowlist específica de mobile_phone NO existe en el core', () => {
    const code = stripComments(read(...CORE));
    for (const removed of [
      'MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES',
      'clearsMobilePhoneForSource',
    ]) {
      assert.equal(code.includes(removed), false, `${removed} no puede reaparecer`);
    }
  });

  it('la fábrica del patch no recibe la procedencia (no hay de dónde colgar columnas)', () => {
    const core = read(...CORE);
    assert.match(
      core,
      /export function buildContactPhoneSuppressionPatch\(\): ContactPhoneSuppressionPatch \{/,
    );
    assert.match(core, /patch: buildContactPhoneSuppressionPatch\(\),/);
  });

  it('el patch declara EXACTAMENTE las 7 columnas de la tupla de phone', () => {
    const core = read(...CORE);
    const iface = core.match(/interface ContactPhoneSuppressionPatch \{([\s\S]*?)\n\}/);
    assert.ok(iface);
    const declared = [...iface[1].matchAll(/(\w+)\??: null;/g)].map((m) => m[1]).sort();
    assert.deepEqual(declared, [
      'phone',
      'phone_confidence',
      'phone_processing_basis',
      'phone_raw_type',
      'phone_revealed_at',
      'phone_source',
      'phone_type',
    ]);
  });

  it('la erasure de `phone` NO se degrada: la tupla sigue nulándose entera', () => {
    const core = read(...CORE);
    const factory = core.match(
      /export function buildContactPhoneSuppressionPatch\(\)[\s\S]*?\n\}/,
    );
    assert.ok(factory);
    for (const column of [
      'phone',
      'phone_type',
      'phone_source',
      'phone_raw_type',
      'phone_revealed_at',
      'phone_processing_basis',
      'phone_confidence',
    ]) {
      assert.match(factory[0], new RegExp(`${column}: null`));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. §11 — el UPDATE condicional se conserva
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 estático — el writer sigue siendo condicional', () => {
  it('el UPDATE conserva id + cuenta + procedencia OBSERVADA', () => {
    const actions = read(...ACTIONS);
    const block = actions.match(
      /\.from\('contacts'\)\s*\n\s*\.update\(patch\)([\s\S]*?)\.select\('id'\)/,
    );
    assert.ok(block, 'el UPDATE de contacts debe seguir existiendo');
    assert.match(block[1], /\.eq\('id', contactId\)/);
    assert.match(block[1], /\.eq\('account_id', tombstone\.accountId\)/);
    assert.match(
      block[1],
      /\.eq\('phone_source', observedPhoneSource\)/,
      'sin el predicado, una escritura stale pisaría un reemplazo manual legítimo',
    );
  });

  it('NO vuelve a un UPDATE incondicional por id', () => {
    const actions = read(...ACTIONS);
    assert.equal(
      /\.in\('phone_source'/.test(actions),
      false,
      'un .in dejaría pasar un cambio entre procedencias admitidas',
    );
  });

  it('el core sigue emitiendo la procedencia observada con cada patch', () => {
    const core = read(...CORE);
    assert.match(core, /observedPhoneSource: string;/);
    assert.match(core, /observedPhoneSource,\n\s*patch: buildContactPhoneSuppressionPatch\(\),/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. §18 — alcance: E4.1 no crea esquema ni modelo nuevo
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 estático — alcance', () => {
  it('NO se creó ninguna migración (el fix es de código)', () => {
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_/.test(f) && f.endsWith('.sql'))
      .map((f) => Number.parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
    // El techo lo movió 4O-H1 con la 114 (esquema oficial multi-teléfono, INERTE) y
    // después 4O-H2 con la 115 (su privacidad: contadores de auditoría y
    // `suppress_official_contact_phone_sources`). Lo que esta guarda fija es que E4.1 se
    // resolvió en TypeScript, no cuál es el número más alto — y se sigue fijando un número
    // EXACTO para que una migración colada por encima rompa la guarda.
    // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119: catálogo de
    // Macro Industrias, sin relación con teléfono ni con `mobile_phone`.
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120: la
    // supresión de teléfono por identidad NATIVA del proveedor. SÍ es de teléfono, pero
    // NO introduce procedencia de `mobile_phone` —que es lo que esta guarda vigila— ni
    // toca esa columna en ninguna parte.
    // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación TRUTHFUL
    // del sobrepaso de presupuesto (Agente 1, contabilidad). NO es de teléfono en absoluto
    // —toca `wizard_budget_reservations` y `confirm_wizard_credits`— y no nombra
    // `mobile_phone` en ninguna parte, que es lo que esta guarda vigila.
    assert.equal(
      numbered[numbered.length - 1],
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      // AGENT1-PROVIDER-SEEN-MEMORY-2 lo mueve a la 123: la memoria de qué empresa ya nos
      // mostró un proveedor de PAGO. NO es de teléfono: sólo guarda identidad de EMPRESA y
      // no nombra `mobile_phone` en ninguna parte, que es lo que esta guarda vigila.
      123,
      'la 123 (memoria provider-seen) es la última',
    );
  });

  it('no se introduce `mobile_phone_source` ni ningún modelo de procedencia', () => {
    const forbidden = [
      'mobile_phone_source',
      'mobile_phone_provider',
      'mobile_phone_revealed_at',
    ];
    for (const file of listSourceFiles(SRC_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const term of forbidden) {
        assert.equal(
          code.includes(term),
          false,
          `${relative(repoRoot, file)} introduce ${term}: eso es otro milestone`,
        );
      }
    }
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const term of forbidden) {
        assert.equal(new RegExp(term, 'i').test(sql), false, `${file} introduce ${term}`);
      }
    }
  });

  it('sólo 4O-H1 crea la tabla contact_phones', () => {
    // Invertido por 4O-H1: la tabla ya existe. Lo que se sigue protegiendo es que la cree
    // EXACTAMENTE una migración, y que ninguna toque el escalar móvil (arriba).
    const creators: string[] = [];
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      if (
        /CREATE TABLE[^;]*\bpublic\.contact_phones\b/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        )
      ) {
        creators.push(file);
      }
    }
    assert.deepEqual(creators, ['114_official_contact_phones.sql']);
  });

  it('E4.1 no toca la UI ni HubSpot en código', () => {
    for (const rel of [CORE, ACTIONS]) {
      const code = stripComments(read(...rel));
      assert.equal(/hubspot/i.test(code), false, 'E4.1 no escribe ni lee HubSpot');
    }
    // La UI mantiene su lectura `mobile_phone ?? phone`: preservar la columna implica
    // que un valor manual siga visible, y eso NO se compensa ocultándolo (§13).
    const table = read('src', 'components', 'contacts', 'contacts-data-table-client.tsx');
    assert.match(table, /row\.mobile_phone \?\? row\.phone/);
  });

  it('la pata manual de Lusha no fue modificada por este hito', () => {
    const manual = read(
      'src',
      'modules',
      'contact-enrichment',
      'lusha-phone-fallback-actions.ts',
    );
    assert.equal(
      /4O-E4\.1/.test(manual),
      false,
      'MANUAL_LUSHA_MULTI_PHONE_PENDING sigue diferido',
    );
  });

  it('E4.1 no activa ningún flag', () => {
    for (const rel of [CORE, ACTIONS]) {
      assert.equal(/ENABLE_[A-Z_]+\s*=\s*true/.test(read(...rel)), false);
    }
  });

  it('el core sigue siendo PURO: sin Supabase, sin red, sin reloj', () => {
    const core = read(...CORE);
    for (const forbidden of [
      'createSupabaseAdminClient',
      '@/lib/supabase',
      'fetch(',
      'Date.now(',
      'new Date(',
    ]) {
      assert.equal(core.includes(forbidden), false, `el core no debe contener ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. §20 — cableado al check obligatorio
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 estático — la suite está cableada en el check obligatorio', () => {
  const SCRIPT = 'test:agent2a:mobile-phone-provenance-erasure';

  it(`package.json define ${SCRIPT}`, () => {
    const pkg = JSON.parse(read(...PACKAGE_JSON)) as { scripts: Record<string, string> };
    const script = pkg.scripts[SCRIPT];
    assert.ok(script, `${SCRIPT} debe existir`);
    assert.match(script, /phone-mobile-provenance-erasure-4o-e4-1\.test\.ts/);
    assert.match(script, /phone-mobile-provenance-erasure-static-4o-e4-1\.test\.ts/);
  });

  it('el workflow del check obligatorio ejecuta el script', () => {
    // Ancla al final de línea: sin `$`, el comentario del step satisfaría la
    // aserción aunque alguien borrase el `run:`.
    assert.match(
      read(...WORKFLOW),
      new RegExp(`^\\s*run: npm run ${SCRIPT}\\s*$`, 'm'),
      'un test que no se cablea no protege nada',
    );
  });

  it('el workflow sigue ejecutando E1, E2, E3 y E4', () => {
    const workflow = read(...WORKFLOW);
    for (const script of [
      'test:agent2a:phone-suppression-terminal',
      'test:agent2a:phone-suppression-propagation',
      'test:agent2a:phone-privacy-race-gates',
      'test:agent2a:contacts-phone-privacy-erasure',
    ]) {
      assert.ok(workflow.includes(`npm run ${script}`), `${script} debe seguir en el check`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. §22 — las deudas siguen abiertas y declaradas
// ═══════════════════════════════════════════════════════════════

describe('4O-E4.1 estático — deudas declaradas', () => {
  it('el core deja escrito que la procedencia de mobile_phone SIGUE pendiente', () => {
    const core = read(...CORE);
    assert.match(core, /MOBILE_PHONE_PROVENANCE_PENDING/);
    assert.match(
      core,
      /PERSON_LEVEL SUPPRESSION MODEL|CANDIDATE_LEVEL/,
      'el borrado integral por persona pertenece a otro modelo, y debe constar aquí',
    );
  });

  it('el core NO afirma que mobile_phone no sea dato personal', () => {
    const core = read(...CORE);
    assert.equal(
      /mobile_phone[^\n]*no es dato personal|not personal data/i.test(core),
      false,
      'E4.1 evita un borrado inseguro; no reclasifica el dato',
    );
  });

  it('el patch del contacto oficial sigue siendo ESCALAR (no multi-phone)', () => {
    const core = read(...CORE);
    const iface = core.match(/interface ContactPhoneSuppressionPatch \{([\s\S]*?)\n\}/);
    assert.ok(iface);
    assert.equal(
      /\[\]|Array</.test(iface[1]),
      false,
      'OFFICIAL_MULTI_PHONE_MODEL_PENDING sigue siendo cierto',
    );
  });
});
