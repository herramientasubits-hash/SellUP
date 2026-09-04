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
  // CUT-2: `resolveOutboundHubSpotPhone` decide QUÉ teléfono viaja a HubSpot y, con la misma
  // regla, si un cambio local dejó la ficha desactualizada. LEE la columna; no la escribe, no
  // le asigna procedencia y no participa de la erasure.
  'modules/contacts/contact-hubspot-sync-state.ts': 'lectura — teléfono saliente hacia HubSpot',
  // CUT-3A: la supresión de privacidad LEE la columna para saber si borrar `phone` cambia el
  // teléfono SALIENTE hacia HubSpot (`mobile_phone ?? phone`). Sin esa lectura marcaría
  // desactualizado un contacto cuyo saliente no se movió —o, peor, callaría uno que sí—. Sigue
  // FUERA del patch de borrado: leerla no le crea procedencia, y el principio de E4.1
  // —NO PROVENANCE → NO DESTRUCTIVE ERASURE— es sobre ESCRIBIRLA.
  // El CORE no aparece aquí, y es deliberado: nombra la columna a través de
  // `toHubSpotPhoneSource`, así que la prohibición LITERAL sobre el subsistema de erasure sigue
  // intacta. Sólo el lector de la fila la escribe, y sólo dentro del `select`.
  'modules/contact-enrichment/phone-cache-suppression-actions.ts':
    'lectura — la columna entra en el SELECT del plan, nunca en el patch',
  // CUT-3B: el cableado del motor sale de `contacts/actions.ts` hacia un runner compartido para
  // que el botón manual y el autosync de la aprobación no tengan dos cableados distintos. La
  // columna aparece EXACTAMENTE una vez, dentro de la lista de columnas del `select` — la misma
  // que ya estaba en actions.ts—, y jamás en un patch: el UPDATE del runner sólo escribe
  // `hubspot_contact_id`, `metadata` y `updated_by`. Leerla no le crea procedencia.
  'modules/contacts/contact-hubspot-sync-runner.ts':
    'lectura — la columna entra en el SELECT del contacto, nunca en el patch',
  'modules/contacts/contact-traceability.ts': 'etiqueta de UI',
  'modules/contacts/types.ts': 'tipo de la fila',
  'server/agents/contact-enrichment-toolkit/existing-contacts-reader.ts':
    'lectura — snapshot previo al enriquecimiento',
  // POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 — dos LECTURAS y ninguna escritura. La
  // proyección mínima del contacto trae `mobile_phone` porque la decisión de OFRECER una compra
  // depende de si el contacto ya tiene un número reutilizable, y un celular guardado a mano lo
  // es. Preguntarlo es lo que impide comprar un teléfono para alguien que ya tiene uno; NO se
  // escribe, no se le atribuye procedencia y no entra en ninguna erasure — la premisa de E4.1
  // sigue intacta.
  'modules/contact-enrichment/post-approval-reveal-read.ts':
    'lectura — ¿el contacto ya tiene un número reutilizable?',
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
  it('CUT-3B — el runner de sincronización LEE la columna y no puede escribirla', () => {
    const runner = stripComments(
      readFileSync(join(SRC_DIR, 'modules/contacts/contact-hubspot-sync-runner.ts'), 'utf8'),
    );
    // Una sola aparición, y dentro de la lista de columnas del SELECT.
    assert.equal((runner.match(/mobile_phone/g) ?? []).length, 1);
    assert.match(runner, /select\('id, account_id[^']*mobile_phone[^']*'\)|mobile_phone[^']*'/);
    // Y ningún patch la nombra.
    for (const patch of runner.match(/\.update\(\{[\s\S]*?\}\)/g) ?? []) {
      assert.equal(patch.includes('mobile_phone'), false);
      assert.equal(patch.includes('phone'), false);
    }
  });

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
      // CUT-3A afina el filtro, y hacia ARRIBA. Antes: «sólo la 039 puede nombrarla en SQL
      // estructural». Pero calcular el teléfono SALIENTE (`mobile_phone ?? phone`) obliga a
      // LEERLA, y prohibir la lectura habría hecho imposible saber si un borrado cambia algo
      // para HubSpot — es decir, habría defendido el `synced` falso. Lo que E4.1 protege es que
      // nadie la ESCRIBA sin procedencia, así que eso es lo que se prohíbe, en cualquier
      // migración y sin excepciones.
      assert.equal(
        /(?:SET|,)\s*mobile_phone\s*=/i.test(structuralSql(sql)),
        false,
        `${file} no puede ESCRIBIR mobile_phone: la columna no tiene procedencia`,
      );
      assert.equal(
        /INSERT\s+INTO\s+public\.contacts\s*\([^)]*mobile_phone/i.test(structuralSql(sql)),
        false,
        `${file} no puede poblar mobile_phone en un INSERT`,
      );
      // La 039 sigue siendo la ÚNICA que la DECLARA.
      // Anclado a principio de línea: una DECLARACIÓN de columna empieza la línea, mientras
      // que un PARÁMETRO de función se llama `p_mobile_phone` y nunca la empieza.
      if (/^\s*mobile_phone\s+TEXT\b|ADD COLUMN[^;]*\bmobile_phone\b/im.test(structuralSql(sql))) {
        assert.equal(file, '039_create_contacts_foundation.sql');
      }
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
        // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 la nombra por la MISMA razón:
        // el comentario de su paso 10 y su `COMMENT ON FUNCTION` afirman que `mobile_phone` NO
        // está en el UPDATE del escalar heredado y que MOBILE_PHONE_PROVENANCE_PENDING sigue
        // abierta. Nombrarla para prometer que no se toca es lo contrario de tocarla.
        '128_project_approved_candidate_phones_onto_contact.sql',
        // AGENT2-HUBSPOT-LEGACY-SYNC-STATE-BACKFILL-FINAL la nombra por la MISMA razón, y en
        // prosa dos veces: su cabecera declara que el backfill «NO escribe `contacts.phone` ni
        // `contacts.mobile_phone`. Ni siquiera las lee», y el `COMMENT ON FUNCTION` lo repite.
        // Es literalmente la única migración de esta lista que ni siquiera la LEE —CUT-3A y
        // CUT-3C sí, para calcular el saliente— y por eso su mención es enteramente prosa.
        '132_agent2_hubspot_legacy_sync_state_backfill.sql',
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
    it(`${label}: cero ESCRITURAS de mobile_phone fuera de los comentarios`, () => {
      // ⚠️ AFINADO POR CUT-3A. Antes se prohibía cualquier aparición; ahora se prohíbe la
      // ESCRITURA, que es lo que el principio de E4.1 protege. La lectura entró para decidir
      // si borrar `phone` cambia el teléfono saliente hacia HubSpot, y prohibirla habría
      // impedido corregir un `synced` falso — una guarda que fija el valor defectuoso bloquea
      // su corrección.
      const code = stripComments(read(...rel));
      // Ni en un patch (`mobile_phone: …`), ni en un predicado de UPDATE, ni asignada.
      assert.equal(
        /(?:^|[^.\w])mobile_phone\s*[:=](?!=)/m.test(code),
        false,
        'la columna no puede volver al patch ni al predicado sin un modelo de procedencia',
      );
      assert.equal(
        /\.eq\('mobile_phone'|'mobile_phone':/.test(code),
        false,
        'tampoco como predicado ni como clave de patch',
      );
      // En negativo: la guarda SÍ detecta una escritura real.
      assert.equal(/(?:^|[^.\w])mobile_phone\s*[:=](?!=)/m.test('  mobile_phone: null,'), true);
      assert.equal(/(?:^|[^.\w])mobile_phone\s*[:=](?!=)/m.test('payload.mobile_phone = x'), false);
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

  it('la fábrica del patch no recibe la PROCEDENCIA (no hay de dónde colgar columnas)', () => {
    // Lo que esta guarda impide es que la fábrica reciba `observedPhoneSource`: un parámetro
    // cuyo único uso sería decidir COLUMNAS volvería a invitar a extender la procedencia de
    // `phone` a otras. CUT-3A le pasa la FILA leída y el reloj —ni una ni otro deciden qué
    // columnas se nulan: las siete son siempre las mismas— así que la firma cambia y la
    // prohibición no.
    const core = read(...CORE);
    const signature = core.match(
      /export function buildContactPhoneSuppressionPatch\(([\s\S]*?)\): ContactPhoneSuppressionPatch \{/,
    );
    assert.ok(signature, 'la fábrica debe seguir existiendo y seguir siendo la única');
    assert.equal(
      /observedPhoneSource|phoneSource|procedencia:/.test(signature[1]),
      false,
      'la fábrica no puede recibir la procedencia observada',
    );
    assert.match(core, /patch: buildContactPhoneSuppressionPatch\(contact, context\.nowIso\),/);
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
      /export function buildContactPhoneSuppressionPatch\([\s\S]*?\n\}/,
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
    assert.match(
      core,
      /observedPhoneSource,\n[\s\S]{0,600}?patch: buildContactPhoneSuppressionPatch\(contact, context\.nowIso\),/,
    );
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
    assert.equal(
      numbered[numbered.length - 1],
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      // AGENT1-PROVIDER-SEEN-MEMORY-2 lo mueve a la 123: la memoria de qué empresa ya nos
      // mostró un proveedor de PAGO. NO es de teléfono: sólo guarda identidad de EMPRESA y
      // no nombra `mobile_phone` en ninguna parte, que es lo que esta guarda vigila.
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 lo mueve a la 124: la identidad
      // provider-native del reveal de teléfono. Es de teléfono, pero no nombra
      // `mobile_phone` en ninguna parte, que es lo que esta guarda vigila.
      // BR-SOURCE-FUNCTIONAL-CUT-A lo mueve a la 126: la identidad MENSUAL del snapshot de
      // Receita. NO es de teléfono y no nombra `mobile_phone` en ninguna parte, que es lo que
      // esta guarda vigila. AUTORADA y NO APLICADA. RENUMERADA dos veces por BR-SOURCE CUT A.1:
      // 125 → 126 → 127. El primer salto insertó por debajo una migración 125 genérica
      // (reconciliación de `record_identity_key` sobre `source_company_snapshots`, fuentes NO
      // brasileñas); el segundo lo forzó AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY, que reclamó el
      // 126 de forma independiente: el vallado optimista de la admisión por identidad de LOTE
      // (Agente 1), que toca `prospect_batches` y `prospect_candidates`. Ninguna de las tres
      // nombra `mobile_phone`.
      // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 lo mueve a la 128: la proyección de
      // la colección de un candidato YA APROBADO sobre el contacto que su aprobación creó. SÍ es
      // de teléfono, y NOMBRA `mobile_phone` — pero SÓLO en prosa, y para decir lo contrario de
      // tocarla: un comentario del paso 10 y su `COMMENT ON FUNCTION` declaran que la columna no
      // está en el UPDATE y que MOBILE_PHONE_PROVENANCE_PENDING sigue en pie. Por eso aparece en
      // la lista `proseOnly` de arriba y no entre los escritores. AUTORADA y NO APLICADA.
      // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: el tramo 129–132 de
      // la cadena de HubSpot de Agente 2. Ninguna de las cuatro ASIGNA `mobile_phone` —la 131 lo
      // LEE bajo el lock para calcular el saliente, y leer no es escribir— ni introduce
      // procedencia del escalar móvil, que es lo que esta guarda vigila. La lista exacta de
      // migraciones que pueden NOMBRARLO se declara arriba, archivo por archivo.
      // BR-COMPACT-SNAPSHOT-PRODUCTIZATION mueve el techo a la 134: la tabla dedicada del
      // snapshot nacional de Brasil. No ASIGNA `mobile_phone`, no lo NOMBRA siquiera, y no
      // introduce procedencia del escalar móvil, que es lo que esta guarda vigila.
      // AGENT1-LUSHA-CUT-L3 lo mueve a la 135 (renumerada desde la 134 al integrarse en serie
      // después de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese
      // número): la valla durable de petición de Lusha. No ASIGNA `mobile_phone` tampoco.
      // AGENT1-LUSHA-CUT-L4 mueve el techo a la 136: historial DURABLE de INTENTOS y reclamo atomico de UN reintento seguro (solo tras 429 o 5xx). AUTORADA y NO APLICADA.
      // AGENT1-WIZARD-BUDGET-ADMIN-F1B mueve el techo a la 137: la superficie ADMINISTRATIVA del
      // presupuesto del Wizard —`wizard_monthly_budget_periods.updated_by`, la bitácora
      // append-only `wizard_budget_period_changes` y dos funciones que escriben valor y
      // bitácora en una misma transacción—. Es de Agente 1 y de CONFIGURACIÓN de gasto:
      // no ASIGNA `mobile_phone`, no lo NOMBRA siquiera y no introduce
      // procedencia del escalar móvil, que es lo que esta guarda vigila. AUTORADA y NO APLICADA.
      137,
      'la 137 (la auditoría administrativa del presupuesto del Wizard, AGENT1-WIZARD-BUDGET-ADMIN-F1B) es la última',
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

  it('E4.1 no toca la UI ni LLAMA a HubSpot en código', () => {
    // ⚠️ AFINADO POR CUT-3A, igual que su hermana de 4O-H2 y por la misma razón: prohibir la
    // SUBCADENA impedía escribir la marca local que evita un `synced` falso. Lo prohibido es
    // llamar: cliente, endpoint o `fetch`.
    for (const rel of [CORE, ACTIONS]) {
      const code = stripComments(read(...rel));
      for (const forbidden of [
        'api.hubapi.com',
        'hubspot-contact-sync',
        'integrations/hubspot',
        'updateHubSpotContact',
        'createHubSpotContact',
        'fetch(',
      ]) {
        assert.equal(code.includes(forbidden), false, `E4.1 no puede contener ${forbidden}`);
      }
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
