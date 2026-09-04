/**
 * Agente 2A — guardas ESTÁTICAS de la erasure provenance-safe
 * (AGENT2A-PHONE-REVEAL-4O-E4).
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ PROTEGE ESTE ARCHIVO Y POR QUÉ NO BASTAN LOS TESTS DE COMPORTAMIENTO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las propiedades de 4O-E4 son en su mayoría NEGATIVAS: que un teléfono manual no se
 * borre, que `mobile_phone` no se toque, que el UPDATE no deje de ser condicional,
 * que no se cree una migración. Una propiedad negativa se rompe BORRANDO código, y
 * un test de comportamiento que ejercita el camino bueno no lo nota: si alguien
 * cambia `.eq('phone_source', …)` por un UPDATE por id, todos los tests del plan
 * puro siguen verdes porque el plan no cambió — lo que cambió es quién lo aplica.
 *
 * Por eso aquí se leen los FUENTES y se afirma su forma. Son las mutaciones que §25
 * exige detectar:
 *
 *   * quitar `lusha_reveal` de la allowlist              → falla
 *   * volver el UPDATE incondicional                     → falla
 *   * añadir `manual` (o cualquier fuente sin procedencia) → falla
 *   * limpiar `mobile_phone` sin procedencia             → falla
 *   * dejar `phone_source` tras borrar `phone`           → falla
 *
 * Y las guardas de ALCANCE: E4 no crea migraciones, no toca la colección de
 * candidatos, no añade `contact_phones`, no amplía el multi-phone manual, no toca UI,
 * ni HubSpot, ni flags, ni presupuestos.
 *
 * Sin proveedores, sin créditos, sin DB, sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const repoRoot = join(here, '..', '..', '..', '..');
const MIGRATIONS_DIR = join(repoRoot, 'supabase', 'migrations');

const read = (...parts: string[]) => readFileSync(join(repoRoot, ...parts), 'utf8');

/**
 * Quita comentarios de bloque y de línea.
 *
 * Las guardas de «esto NO existe» tienen que mirar CÓDIGO, no prosa: los archivos de
 * este subsistema documentan largamente por qué `mobile_phone` no tiene procedencia y
 * qué pasa con HubSpot, así que un `includes('mobile_phone_source')` sobre el texto
 * crudo se dispararía contra la explicación de que ese campo NO se creó. Se leería
 * como una guarda cumpliéndose cuando en realidad está midiendo el comentario.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CORE = ['src', 'modules', 'contact-enrichment', 'phone-cache-suppression-core.ts'];
const ACTIONS = [
  'src',
  'modules',
  'contact-enrichment',
  'phone-cache-suppression-actions.ts',
];
const WORKFLOW = ['.github', 'workflows', 'automatic-routing-tests.yml'];
const PACKAGE_JSON = ['package.json'];

/** Procedencias que NUNCA pueden ser borrables: no tienen procedencia demostrable. */
const NEVER_ERASABLE = [
  'manual',
  'unknown',
  'apollo_search',
  'provider_payload',
] as const;

// ═══════════════════════════════════════════════════════════════
// 1. Allowlist de erasure — mutaciones
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — la allowlist de procedencias borrables', () => {
  const allowlist = () => {
    const core = read(...CORE);
    const m = core.match(
      /SUPPRESSIBLE_CONTACT_PHONE_SOURCES: readonly string\[\] = \[([\s\S]*?)\]/,
    );
    assert.ok(m, 'SUPPRESSIBLE_CONTACT_PHONE_SOURCES debe existir en el core');
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  };

  it('contiene lusha_reveal (quitarlo reabre el defecto que E4 cierra)', () => {
    assert.ok(allowlist().includes('lusha_reveal'));
  });

  it('conserva apollo_reveal y apollo_cache (E1/E2/E3 no se degradan)', () => {
    const values = allowlist();
    assert.ok(values.includes('apollo_reveal'));
    assert.ok(values.includes('apollo_cache'));
  });

  it('es EXACTAMENTE esos tres valores y nada más', () => {
    assert.deepEqual(allowlist().sort(), [
      'apollo_cache',
      'apollo_reveal',
      'lusha_reveal',
    ]);
  });

  for (const source of NEVER_ERASABLE) {
    it(`NO contiene ${source}: sin procedencia no hay borrado destructivo`, () => {
      assert.equal(
        allowlist().includes(source),
        false,
        `${source} nunca puede entrar en la allowlist`,
      );
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. mobile_phone — subconjunto estricto, sin provenance no se borra
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — mobile_phone no se borra sin procedencia', () => {
  // 4O-E4.1: la allowlist específica de `mobile_phone` desapareció. Mientras existió,
  // el camino Apollo nulaba la columna por herencia; la auditoría de escritores
  // demostró que ningún proveedor la escribe, así que el borrado se retiró entero.
  // Las guardas de forma detalladas viven en
  // `phone-mobile-provenance-erasure-static-4o-e4-1.test.ts`.
  it('la allowlist específica de mobile_phone ya NO existe', () => {
    const code = stripComments(read(...CORE));
    for (const removed of [
      'MOBILE_PHONE_SUPPRESSIBLE_PHONE_SOURCES',
      'clearsMobilePhoneForSource',
    ]) {
      assert.equal(code.includes(removed), false, `${removed} no puede reaparecer`);
    }
  });

  it('`mobile_phone` no está en el patch para NINGUNA procedencia', () => {
    const core = read(...CORE);
    const iface = core.match(/interface ContactPhoneSuppressionPatch \{([\s\S]*?)\n\}/);
    assert.ok(iface);
    assert.equal(
      /mobile_phone/.test(iface[1]),
      false,
      'la procedencia de `phone` no se extiende a otra columna',
    );
  });

  it('el patch se construye por una sola fábrica, independiente de la PROCEDENCIA', () => {
    // CUT-3A cambia la FIRMA (recibe la fila leída y el reloj para decidir si el borrado deja
    // a HubSpot desactualizado) y NO la propiedad: lo prohibido es un parámetro de
    // PROCEDENCIA, porque su único uso sería decidir COLUMNAS y eso reabriría la inferencia
    // entre ellas. Ni la fila ni el reloj deciden columnas: las siete son siempre las mismas.
    const core = read(...CORE);
    const signature = core.match(
      /export function buildContactPhoneSuppressionPatch\(([\s\S]*?)\): ContactPhoneSuppressionPatch \{/,
    );
    assert.ok(signature, 'la fábrica sigue siendo UNA y sigue devolviendo el mismo tipo');
    assert.equal(
      /observedPhoneSource|phoneSource/.test(signature[1]),
      false,
      'la fábrica no puede recibir la procedencia observada',
    );
    // Y sigue habiendo UNA sola: dos fábricas serían dos patches que divergen.
    assert.equal(
      (core.match(/export function buildContactPhoneSuppressionPatch\(/g) ?? []).length,
      1,
    );
  });

  it('no se creó una columna ni un modelo de procedencia para mobile_phone', () => {
    // Sólo CÓDIGO: el core explica en prosa por qué esa columna no existe.
    const code = stripComments(read(...CORE));
    for (const forbidden of [
      'mobile_phone_source',
      'mobile_phone_provider',
      'mobile_phone_revealed_at',
    ]) {
      assert.equal(
        code.includes(forbidden),
        false,
        `${forbidden} está diferido (MOBILE_PHONE_PROVENANCE_PENDING)`,
      );
    }
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      assert.equal(
        /mobile_phone_source/i.test(sql),
        false,
        `${file} no debe introducir mobile_phone_source`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. La tupla — sin metadata huérfana
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — la tupla telefónica del patch', () => {
  const TUPLE = [
    'phone',
    'phone_type',
    'phone_source',
    'phone_raw_type',
    'phone_revealed_at',
    'phone_processing_basis',
    'phone_confidence',
  ];

  it('declara las 7 columnas de la tupla', () => {
    const core = read(...CORE);
    const iface = core.match(
      /interface ContactPhoneSuppressionPatch \{([\s\S]*?)\n\}/,
    );
    assert.ok(iface);
    for (const column of TUPLE) {
      assert.match(
        iface[1],
        new RegExp(`\\b${column}\\??: null;`),
        `${column} debe estar en el patch: dejarlo vivo es metadata delatora`,
      );
    }
  });

  it('la fábrica nula phone_source, phone_revealed_at y phone_processing_basis', () => {
    const core = read(...CORE);
    const factory = core.match(
      /export function buildContactPhoneSuppressionPatch\([\s\S]*?\n\}/,
    );
    assert.ok(factory);
    for (const column of [
      'phone_source',
      'phone_revealed_at',
      'phone_processing_basis',
      'phone_confidence',
    ]) {
      assert.match(factory[0], new RegExp(`${column}: null`));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. El UPDATE tiene que seguir siendo CONDICIONAL
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — el write de contacts es condicional por procedencia', () => {
  it('filtra por la procedencia EXACTA observada, no por la allowlist entera', () => {
    const actions = read(...ACTIONS);
    assert.match(
      actions,
      /\.eq\('phone_source', observedPhoneSource\)/,
      'el UPDATE debe repetir la procedencia observada como predicado',
    );
  });

  it('ya NO usa `.in(...)` sobre phone_source (permitía cruzar patches)', () => {
    const actions = read(...ACTIONS);
    assert.equal(
      /\.in\('phone_source'/.test(actions),
      false,
      'un .in permitiría aplicar el patch de una procedencia a una fila de otra',
    );
  });

  it('el UPDATE sigue acotado por id Y por cuenta', () => {
    const actions = read(...ACTIONS);
    const block = actions.match(
      /\.from\('contacts'\)\s*\n\s*\.update\(patch\)([\s\S]*?)\.select\('id'\)/,
    );
    assert.ok(block, 'el UPDATE de contacts debe seguir existiendo');
    assert.match(block[1], /\.eq\('id', contactId\)/);
    assert.match(block[1], /\.eq\('account_id', tombstone\.accountId\)/);
    assert.match(block[1], /\.eq\('phone_source', observedPhoneSource\)/);
  });

  it('la procedencia observada se DESESTRUCTURA del plan (no se recalcula aquí)', () => {
    const actions = read(...ACTIONS);
    assert.match(
      actions,
      /for \(const \{ contactId, patch, observedPhoneSource \} of plan\.contactPatches\)/,
    );
  });

  it('el core NO deja escapar un patch sin procedencia observada', () => {
    const core = read(...CORE);
    assert.match(core, /observedPhoneSource: string;/);
    assert.match(
      core,
      /observedPhoneSource,\n[\s\S]{0,600}?patch: buildContactPhoneSuppressionPatch\(contact, context\.nowIso\),/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Cableado del check obligatorio
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — la suite está cableada en el check obligatorio', () => {
  const SCRIPT = 'test:agent2a:contacts-phone-privacy-erasure';

  it(`package.json define ${SCRIPT}`, () => {
    const pkg = JSON.parse(read(...PACKAGE_JSON)) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts[SCRIPT];
    assert.ok(script, `${SCRIPT} debe existir`);
    assert.match(script, /phone-contacts-privacy-erasure-4o-e4\.test\.ts/);
    assert.match(script, /phone-contacts-privacy-erasure-static-4o-e4\.test\.ts/);
  });

  it('el workflow del check obligatorio ejecuta el script', () => {
    const workflow = read(...WORKFLOW);
    // Ancla al FINAL de línea a propósito. Sin `$`, el propio comentario del step
    // —que menciona la variante `…-postgres`— satisfaría la aserción aunque alguien
    // borrase el `run:`. Sería una guarda midiendo su propia documentación.
    assert.match(
      workflow,
      new RegExp(`^\\s*run: npm run ${SCRIPT}\\s*$`, 'm'),
      'un test que no se cablea no protege nada',
    );
  });

  it('el step del check NO es la variante postgres (depende de un binario)', () => {
    const workflow = read(...WORKFLOW);
    assert.equal(
      new RegExp(`^\\s*run: npm run ${SCRIPT}-postgres\\s*$`, 'm').test(workflow),
      false,
      'la suite postgres queda FUERA del check obligatorio',
    );
  });

  it('el workflow sigue ejecutando E1, E2 y E3', () => {
    const workflow = read(...WORKFLOW);
    for (const script of [
      'test:agent2a:phone-suppression-terminal',
      'test:agent2a:phone-suppression-propagation',
      'test:agent2a:phone-privacy-race-gates',
    ]) {
      assert.ok(
        workflow.includes(`npm run ${script}`),
        `${script} debe seguir en el check`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Guardas de ALCANCE
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — alcance: E4 no amplía nada más', () => {
  it('E4 no aportó ninguna migración (su fix es de código)', () => {
    // El techo lo movió AGENT2A-PHONE-REVEAL-4O-H1 con la 114 —el esquema OFICIAL de
    // múltiples teléfonos, creado INERTE y con su propia guarda estática— y después
    // AGENT2A-PHONE-REVEAL-4O-H2 con la 115 —la PRIVACIDAD de ese esquema: dos contadores
    // de auditoría y `suppress_official_contact_phone_sources`, también con su propia
    // guarda estática—. Lo que esta guarda protege es que E4 se resolvió en TypeScript, no
    // cuál es el número más alto; por eso la lista sigue siendo EXACTA y enumerada.
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /^11[4-9]|^1[2-9]\d/.test(f))
      .sort();
    assert.deepEqual(
      migrations,
      [
        '114_official_contact_phones.sql',
        '115_official_contact_phone_privacy.sql',
        // 4O-H3: la aprobación ATÓMICA. Tampoco es DDL de 4O-E4: sólo una función.
        '116_approve_candidate_with_official_phones.sql',
        // 4O-H3-B: el merge del candidato duplicado sobre un contacto existente. Tampoco es
        // DDL de 4O-E4 — otra función transaccional— y tampoco toca la allowlist del escalar
        // que E4 fijó. Su propio COMMENT ON FUNCTION documenta que NUNCA toca mobile_phone
        // (4O-E4.1 sigue abierto).
        '117_merge_candidate_into_existing_contact.sql',
        // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1: catálogo de Macro Industrias.
        // Ninguna es DDL de teléfono.
        '118_macro_industry_catalog_v2_draft.sql',
        '119_publish_macro_industry_catalog_v2_cutover.sql',
      // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) mueve el techo a la 120:
      // `provider_suppressions` + `provider_suppression_audit` — supresión de teléfono por
      // identidad NATIVA del proveedor y SIN cuenta, backfill idempotente del tombstone
      // legado y `CREATE OR REPLACE` del helper transaccional. Es ADITIVA: no borra
      // columna, no suelta constraint y no reescribe ninguna migración anterior.
      '120_provider_native_phone_suppression.sql',
      // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 mueve el techo a la 121: la liquidación
      // TRUTHFUL del sobrepaso de presupuesto (Agente 1, contabilidad). Tampoco es DDL de
      // teléfono — reemplaza una constraint de `wizard_budget_reservations` y el cuerpo de
      // `confirm_wizard_credits`— y no toca la allowlist del escalar que E4 fijó.
      '121_wizard_budget_overage_reconciliation.sql',
      // AGENT2A-SEARCH-MORE-PHONES-1 mueve el techo a la 122: «Buscar más números»
      // (Agente 2A). Es de teléfono, pero no de este hito: añade la modalidad `search_more`
      // y una función que AÑADE teléfonos al CANDIDATO, y no toca lo que esta guarda vigila.
      '122_phone_reveal_search_more.sql',
      // AGENT1-PROVIDER-SEEN-MEMORY-2 mueve el techo a la 123: la memoria de qué empresa ya
      // nos mostró un proveedor de PAGO (Agente 1, economía de descubrimiento). NO es de
      // teléfono en absoluto: crea `provider_seen_entities`, que sólo guarda identidad de
      // EMPRESA —id nativo del proveedor y dominio normalizado— y no nombra ninguna tabla,
      // columna ni función de teléfono. Se declara NO aplicada en Producción.
      '123_provider_seen_entities.sql',
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: identidad provider-native
      // (`contact_provider_identities`), grano de reserva por OPERACIÓN y claim propio de
      // la búsqueda de identidad. Trae su propia guarda estática y NO edita ninguna
      // migración anterior — que es lo que esta lista exacta vigila. NO aplicada en Prod.
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: identidad provider-native
      // (`contact_provider_identities`), grano de reserva por OPERACIÓN y claim propio de
      // la búsqueda de identidad. Trae su propia guarda estática y NO edita ninguna
      // migración anterior — que es lo que esta lista exacta vigila. NO aplicada en Prod.
      '124_cross_provider_phone_identity.sql',
      // BR-SOURCE CUT A.1: unicidad GENÉRICA de `record_identity_key` sobre
      // `source_company_snapshots` para fuentes NO brasileñas. NO es de teléfono y NO edita
      // ninguna migración anterior — que es lo que esta lista exacta vigila. AUTORADA y NO
      // APLICADA.
      '125_reconcile_source_snapshot_record_identity.sql',
      // BR-SOURCE-FUNCTIONAL-CUT-A: la identidad MENSUAL del snapshot de Receita
      // (`source_period` + unicidad period-aware en `source_company_snapshots`, estado de
      // publicación en `source_snapshot_runs`). NO es de teléfono y NO edita ninguna migración
      // anterior — que es lo que esta lista exacta vigila. AUTORADA y NO APLICADA.
      // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY mueve el techo a la 126: el vallado
      // optimista de la admisión por identidad de LOTE (Agente 1). Añade
      // `prospect_batches.identity_epoch` y dos funciones sobre `prospect_batches` y
      // `prospect_candidates`; NO es de teléfono en absoluto y no nombra ninguna tabla,
      // columna ni función de teléfono, que es lo que esta guarda vigila. Trae su propia
      // guarda estática y NO edita ninguna migración anterior. NO aplicada en Producción.
      '126_agent1_batch_identity_atomicity.sql',
      // RENUMERADA de 125 a 127 (con una escala en 126) por CUT A.1: el primer salto dejó
      // sitio a la reconciliación genérica arriba; el segundo lo forzó AGENT1-CUT3B4 al
      // reclamar el 126 de forma independiente.
      '127_br_receita_monthly_snapshot_identity.sql',
      // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128: la
      // proyección candidato→contacto tras la aprobación. NO es autoría de 4O-E4 y no toca la
      // erasure: no hay un solo `DELETE` ni un `suppressed_at = NULL` en el archivo, y la función
      // es SECURITY INVOKER bajo el techo de privilegios de la 114. AUTORADA y NO APLICADA.
      '128_project_approved_candidate_phones_onto_contact.sql',
      // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132 al canonicalizar la
      // cadena de sincronización con HubSpot de Agente 2 —129 la COMPLETITUD del estado durable
      // `stale`, 130 su PROCEDENCIA, 131 la 128 re-emitida para PRODUCIR el pendiente con
      // procedencia `reveal`, 132 la LÍNEA BASE de los contactos ya vinculados—. Las cuatro
      // nacieron sin número a propósito y lo reciben ahora que la disputa 125/126/127 está
      // cerrada; ninguna es autoría de este hito. AUTORADAS y NO APLICADAS.
      '129_agent2_contact_hubspot_stale_completeness.sql',
      '130_agent2_contact_hubspot_stale_source.sql',
      '131_agent2_post_approval_reveal_stale_producer.sql',
      '132_agent2_hubspot_legacy_sync_state_backfill.sql',
      // BR-PRODUCTION-RELEASE añade la 133: la promoción VALLADA de la identidad fiscal resuelta
      // de una candidata brasileña (BR-SOURCE CUT D), numerada al volver ese trabajo a GitHub.
      // NO es de teléfono en absoluto: crea UNA función
      // (`promote_candidate_fiscal_identity_fenced`) sobre `prospect_candidates` y
      // `prospect_batches` más sus permisos, sin tabla, sin columna, sin índice, sin constraint y
      // sin backfill. La lista sigue siendo EXACTA, no un rango abierto: una migración nueva que
      // no se declare aquí rompe la guarda. AUTORADA y NO APLICADA.
      // Tampoco toca la erasure que esta suite protege: no contiene un solo `DELETE`, no nombra
      // `mobile_phone` y no reabre la allowlist del escalar que E4 fijó.
      '133_br_candidate_identity_promotion.sql',
      // BR-COMPACT-SNAPSHOT-PRODUCTIZATION añade la 134: la tabla dedicada y particionada del
      // snapshot nacional de Brasil. NO es de teléfono en absoluto — crea `br_receita_snapshots`
      // y sus funciones de ciclo de vida de partición, reutiliza `source_snapshot_runs` sin
      // alterarla, y no nombra ninguna tabla, columna ni función de teléfono. La lista sigue
      // siendo EXACTA: una migración nueva que no se declare aquí rompe la guarda.
      // AUTORADA y NO APLICADA.
      // Tampoco toca la erasure que esta suite protege: no contiene un solo `DELETE`, no nombra
      // `mobile_phone` y no reabre la allowlist del escalar que E4 fijó.
      '134_br_receita_compact_snapshot.sql',
      // AGENT1-LUSHA-CUT-L3 añade la 135 (renumerada desde la 134 al integrarse en serie después
      // de que BR-COMPACT-SNAPSHOT-PRODUCTIZATION llegara primero a main con ese número): la
      // valla DURABLE de una petición de Lusha Prospecting. Es de Agente 1 y de seguridad de
      // gasto; no contiene un solo `DELETE` y no toca la erasure que esta suite protege.
      // AUTORADA y NO APLICADA.
      '135_agent1_lusha_prospecting_request_fence.sql',
      // AGENT1-LUSHA-CUT-L4 anade la 136: el historial DURABLE de INTENTOS de una peticion de
      // Lusha Prospecting y el reclamo atomico de UN reintento seguro (solo tras un 429 o un
      // 5xx, que el contrato HUMANO del proveedor declara a 0 creditos). Es de Agente 1 y de
      // seguridad de gasto. AUTORADA y NO APLICADA.
      '136_agent1_lusha_prospecting_safe_retry_attempts.sql',
      // AGENT1-WIZARD-BUDGET-ADMIN-F1B añade la 137: la superficie ADMINISTRATIVA del
      // presupuesto del Wizard —`wizard_monthly_budget_periods.updated_by`, la bitácora
      // append-only `wizard_budget_period_changes` y dos funciones que escriben valor y
      // bitácora en una misma transacción—. Es de Agente 1 y de CONFIGURACIÓN de gasto:
      // no es de teléfono, no es del catálogo y no nombra ninguna tabla, columna
      // ni función de las cadenas que esta guarda vigila. AUTORADA y NO APLICADA.
      '137_wizard_budget_period_admin_audit.sql',
      ],
      'E4 no necesita DDL: la allowlist y el writer se corrigen en TypeScript',
    );
  });

  it('la migración 132 (AGENT2-FINAL-INTEGRATION) es la última del repo', () => {
    // 4O-H2 mueve el techo de la 114 a la 115. Se sigue fijando un número EXACTO: una
    // migración por encima del último hito conocido tiene que romper esta guarda.
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_/.test(f) && f.endsWith('.sql'))
      .map((f) => Number.parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
    // AGENT1-MACRO-INDUSTRY-CATALOG-DISCOVERY-1 mueve el techo a la 119: catálogo de
    // Macro Industrias, sin relación con teléfono. La 117 (4O-H3-B) queda por debajo.
    // AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4 (Fase 1) lo mueve a la 120, y
    // AGENT1-LUSHA-BUDGET-OVERSPEND-FIX-1 a la 121 (contabilidad de presupuesto, sin
    // relación con teléfono). El número sigue siendo EXACTO: una migración no declarada
    // por encima del último hito conocido rompe esta guarda.
    // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1 lo mueve a la 124: identidad
    // provider-native, grano de reserva por operación y claim propio de la búsqueda. No
    // borra teléfonos ni toca la erasure que esta suite protege. NO aplicada en Prod.
    // BR-SOURCE CUT A.1 renumeró la migración BR-SOURCE-FUNCTIONAL-CUT-A dos veces: 125 → 126 →
    // 127. El primer salto dejó sitio a una migración 125 genérica y nueva (reconciliación de
    // `record_identity_key` sobre `source_company_snapshots`, no brasileña). El segundo lo forzó
    // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY, que reclamó el 126 de forma independiente: el
    // vallado optimista de la admisión por identidad de LOTE (Agente 1), que añade
    // `prospect_batches.identity_epoch` y dos funciones sobre `prospect_batches` y
    // `prospect_candidates`. Ninguna de las tres es de teléfono. Todas AUTORADAS y NO APLICADAS.
    // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 mueve el techo a la 128:
    // `project_approved_candidate_phones_onto_contact`, la proyección de la colección de un
    // candidato YA APROBADO sobre el contacto que su propia aprobación creó. Sin tablas,
    // columnas, índices, triggers ni policies nuevas; M128 únicamente crea/reemplaza una
    // función y sus permisos. Sin backfill: no crea contactos, no re-terminaliza
    // candidatos y no re-declara ninguna función anterior. AUTORADA y NO APLICADA.
    // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1 mueve el techo a la 132: el tramo 129–132 de
    // la cadena de HubSpot de Agente 2. SÍ es de teléfono, pero no toca la erasure que esta
    // suite protege: ninguna de las cuatro contiene un `DELETE`, y la lista exacta de arriba —que
    // las nombra una por una— es la que impide que una migración nueva entre sin declararse.
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
    // AGENT1-WIZARD-BUDGET-ADMIN-F1B mueve el techo a la 137: la superficie ADMINISTRATIVA del
    // presupuesto del Wizard —`wizard_monthly_budget_periods.updated_by`, la bitácora
    // append-only `wizard_budget_period_changes` y dos funciones que escriben valor y
    // bitácora en una misma transacción—. Es de Agente 1 y de CONFIGURACIÓN de gasto:
    // no es de teléfono, no es del catálogo y no nombra ninguna tabla,
    // columna ni función de las cadenas que esta guarda vigila. AUTORADA y NO APLICADA.
    assert.equal(numbered[numbered.length - 1], 137);
  });

  it('sólo 4O-H1 crea la tabla contact_phones', () => {
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

  it('E4 no toca la colección de candidatos ni sus RPC', () => {
    const core = read(...CORE);
    for (const forbidden of [
      'contact_enrichment_candidate_phones',
      'contact_enrichment_candidate_phone_sources',
    ]) {
      assert.equal(
        new RegExp(`from\\('${forbidden}'\\)`).test(core),
        false,
        `E4 no escribe en ${forbidden}`,
      );
    }
  });

  it('la propagación transaccional a la colección (E2) sigue en pie', () => {
    const actions = read(...ACTIONS);
    assert.match(actions, /suppressCandidatePhoneCollection\(/);
    assert.match(actions, /mapSuppressionReasonToCandidatePhoneReason\(/);
  });

  it('E4 no activa ni menciona como activable el flag del waterfall', () => {
    for (const rel of [CORE, ACTIONS]) {
      const src = read(...rel);
      assert.equal(
        /ENABLE_PHONE_REVEAL_WATERFALL\s*=\s*true/.test(src),
        false,
        'E4 no activa ningún flag',
      );
    }
  });

  it('la pata manual de Lusha no fue modificada por este hito', () => {
    const manual = read(
      'src',
      'modules',
      'contact-enrichment',
      'lusha-phone-fallback-actions.ts',
    );
    assert.equal(
      /4O-E4/.test(manual),
      false,
      'MANUAL_LUSHA_MULTI_PHONE_PENDING sigue diferido',
    );
  });

  it('E4 no LLAMA a HubSpot', () => {
    // ⚠️ AFINADO POR CUT-3A, igual que sus dos hermanas y por la misma razón: prohibir la
    // SUBCADENA impedía escribir la marca LOCAL que evita dejar un `synced` falso cuando la
    // erasure borra el teléfono. Lo prohibido es LLAMAR: cliente, endpoint o `fetch`.
    for (const rel of [CORE, ACTIONS]) {
      const code = stripComments(read(...rel));
      for (const forbidden of [
        'api.hubapi.com',
        'hubspot-contact-sync',
        'integrations/hubspot',
        'updateHubSpotContact',
        'createHubSpotContact',
        'findHubSpotContactByEmail',
        'fetch(',
      ]) {
        assert.equal(code.includes(forbidden), false, `E4 no puede contener ${forbidden}`);
      }
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
      assert.equal(
        core.includes(forbidden),
        false,
        `el core no debe contener ${forbidden}`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Deudas que siguen abiertas, declaradas en el código
// ═══════════════════════════════════════════════════════════════

describe('4O-E4 estático — las deudas siguen declaradas', () => {
  it('el core documenta por qué mobile_phone no se borra en el camino Lusha', () => {
    const core = read(...CORE);
    assert.match(core, /MOBILE_PHONE_PROVENANCE_PENDING/);
    assert.match(
      core,
      /mobile_phone/,
      'el límite debe estar escrito donde vive la decisión',
    );
  });

  it('el core no introduce un modelo multi-phone para el contacto oficial', () => {
    const core = read(...CORE);
    // AGENT2A-PHONE-REVEAL-4O-H2 — esta guarda se ESTRECHA, no se borra.
    //
    // En 4O-E4 afirmaba que el core no había colado el modelo oficial multi-teléfono, y
    // era cierto: no existía. Ahora existe, y llegó por decisión declarada en DOS hitos
    // separados y fijados cada uno por su propia guarda: la FORMA en 4O-H1 (migración 114,
    // `contact_phones` + `contact_phone_sources`, INERTE) y su PRIVACIDAD en 4O-H2
    // (migración 115). Lo que 4O-E4 tiene que seguir impidiendo es que su propio core
    // crezca un modelo multi-teléfono POR SU CUENTA, y eso se sigue midiendo:
    //
    //   1. el conjunto de tablas oficiales que el core nombra es EXACTO —las dos de la
    //      114 y ninguna más—, así que una tercera tabla de teléfonos rompe la guarda;
    //   2. en CÓDIGO (sin comentarios) el core no nombra ninguna: la colección oficial se
    //      toca únicamente por la transacción de la 115 detrás de la RPC, nunca desde
    //      aquí, así que el core sigue siendo puro y sin acceso directo;
    //   3. el patch del contacto oficial sigue siendo UNA tupla escalar.
    const OFFICIAL_TABLES_ALLOWLIST = ['contact_phone_sources', 'contact_phones'];
    const named = [
      ...new Set([...core.matchAll(/\bcontact_phone[a-z_]*\b/g)].map((m) => m[0])),
    ].sort();
    assert.deepEqual(
      named,
      OFFICIAL_TABLES_ALLOWLIST,
      'el core sólo puede nombrar las DOS tablas oficiales de la 114, y sólo para documentar 4O-H2',
    );
    assert.equal(
      /\bcontact_phone[a-z_]*\b/.test(stripComments(core)),
      false,
      'el core no accede a la colección oficial en código: eso vive en la transacción de la 115',
    );
    const iface = core.match(
      /interface ContactPhoneSuppressionPatch \{([\s\S]*?)\n\}/,
    );
    assert.ok(iface);
    assert.equal(
      /\[\]|Array</.test(iface[1]),
      false,
      'el patch del contacto oficial sigue siendo escalar',
    );
  });
});
