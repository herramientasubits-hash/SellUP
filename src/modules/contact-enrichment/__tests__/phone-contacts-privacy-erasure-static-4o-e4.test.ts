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

  it('el patch se construye por una sola fábrica, independiente de la procedencia', () => {
    const core = read(...CORE);
    assert.match(
      core,
      /export function buildContactPhoneSuppressionPatch\(\): ContactPhoneSuppressionPatch \{/,
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
      /observedPhoneSource,\n\s*patch: buildContactPhoneSuppressionPatch\(\),/,
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
  it('NO se creó ninguna migración nueva (el fix es de código)', () => {
    const migrations = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => /^11[4-9]|^1[2-9]\d/.test(f));
    assert.deepEqual(
      migrations,
      [],
      'E4 no necesita DDL: la allowlist y el writer se corrigen en TypeScript',
    );
  });

  it('la migración 113 (E3) es la última del repo', () => {
    const numbered = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3}_/.test(f) && f.endsWith('.sql'))
      .map((f) => Number.parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
    assert.equal(numbered[numbered.length - 1], 113);
  });

  it('no se crea ninguna tabla contact_phones', () => {
    for (const file of readdirSync(MIGRATIONS_DIR)) {
      if (!file.endsWith('.sql')) continue;
      assert.equal(
        /CREATE TABLE[^;]*\bpublic\.contact_phones\b/i.test(
          readFileSync(join(MIGRATIONS_DIR, file), 'utf8'),
        ),
        false,
        `${file} no debe crear contact_phones`,
      );
    }
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

  it('E4 no toca HubSpot', () => {
    // Prosa aparte: el header explica que el contacto oficial es la fila que se
    // sincroniza a HubSpot, y eso es contexto, no una escritura.
    for (const rel of [CORE, ACTIONS]) {
      const code = stripComments(read(...rel));
      assert.equal(
        /hubspot/i.test(code),
        false,
        'E4 no escribe ni lee HubSpot en código',
      );
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
    // El patch sigue siendo de UNA tupla escalar. Si apareciera un array de
    // teléfonos aquí, `OFFICIAL_MULTI_PHONE_MODEL_PENDING` habría dejado de ser
    // cierto sin que nadie lo decidiera.
    assert.equal(/contact_phones\b/.test(core), false);
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
