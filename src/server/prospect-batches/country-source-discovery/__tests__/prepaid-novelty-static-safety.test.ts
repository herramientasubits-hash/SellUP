/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 15, 25, 27, 28 — garantías
 * ESTÁTICAS sobre el orden y sobre lo que la capa gratuita no puede hacer.
 *
 * 🔴 Todo lo que se busca se busca sobre el código con los COMENTARIOS FUERA. Una
 * guarda que lea el cuerpo crudo convierte «citar el nombre de un módulo en la
 * prosa» en «importarlo», y ya produjo un falso positivo en este repo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Quita comentarios de bloque y de línea: la prosa no es código. */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const PREPAID_DIR = 'src/server/prospect-batches/country-source-discovery';
const PURE_DIR = 'src/modules/prospect-batches/prepaid-novelty';
const LUSHA_ACTION = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const WIZARD_ACTION = 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';

function listSources(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${dir}/${f}`);
}

test('§ 27/§ 28 — la capa gratuita no puede llamar a ningún proveedor de pago', () => {
  const forbidden = [
    'lusha-client',
    'searchLushaCompaniesV3',
    'getLushaApiKey',
    'apollo-client',
    'runIncrementalProspectingSearch',
    'tavily',
  ];
  for (const rel of [...listSources(PREPAID_DIR), ...listSources(PURE_DIR)]) {
    const code = stripTsComments(read(rel));
    for (const needle of forbidden) {
      assert.ok(
        !code.includes(needle),
        `${rel} no debe poder alcanzar al proveedor (${needle})`,
      );
    }
  }
});

test('§ 15 — la capa gratuita no puede reservar, confirmar ni liberar créditos', () => {
  const forbidden = [
    'reserveWizardPilotCredits',
    'confirmWizardPilotCredits',
    'releaseWizardPilotCredits',
    'estimateLushaRunCredits',
    'estimateCreditsForProvider',
  ];
  for (const rel of [...listSources(PREPAID_DIR), ...listSources(PURE_DIR)]) {
    const code = stripTsComments(read(rel));
    for (const needle of forbidden) {
      assert.ok(!code.includes(needle), `${rel} no debe poder gastar (${needle})`);
    }
  }
});

test('§ 27 — la fuente de Colombia NO hace llamadas externas en vivo', () => {
  // El snapshot es local a Supabase. Ni `fetch`, ni datos.gov.co, ni Socrata.
  for (const rel of listSources(PREPAID_DIR)) {
    const code = stripTsComments(read(rel));
    assert.ok(!code.includes('datos.gov.co'), `${rel} no debe llamar a datos.gov.co`);
    assert.ok(!/\bfetch\s*\(/.test(code), `${rel} no debe hacer fetch`);
    assert.ok(
      !code.includes('runSocrataCandidateDryRun'),
      `${rel} no debe ejecutar el dry-run de Socrata`,
    );
  }
});

test('§ 28 — la capa gratuita no escribe en HubSpot', () => {
  for (const rel of [...listSources(PREPAID_DIR), ...listSources(PURE_DIR)]) {
    const code = stripTsComments(read(rel));
    for (const needle of ['hubspot-company-writer', 'createHubSpotCompany', 'updateHubSpotCompany']) {
      assert.ok(!code.includes(needle), `${rel} no debe escribir en HubSpot (${needle})`);
    }
  }
});

test('§ 15 — en la ruta Lusha, la capa gratuita corre ANTES de estimar y de reservar', () => {
  const code = stripTsComments(read(LUSHA_ACTION));
  const gateAt = code.indexOf('runPrePaidNoveltyDiscovery(');
  const estimateAt = code.indexOf('estimateLushaRunCredits(');
  const reserveAt = code.indexOf('guardLushaRunBudget(');

  assert.ok(gateAt > 0, 'la capa gratuita debe estar cableada');
  assert.ok(estimateAt > 0 && reserveAt > 0);
  assert.ok(gateAt < estimateAt, 'la capa gratuita va antes de la estimación');
  assert.ok(gateAt < reserveAt, 'la capa gratuita va antes de la reserva');
});

test('§ 15 — en la ruta Apollo/Tavily, la capa gratuita corre ANTES de estimar y de reservar', () => {
  const code = stripTsComments(read(WIZARD_ACTION));
  const gateAt = code.indexOf('deps.runPrePaidNoveltyDiscovery');
  const estimateAt = code.indexOf('estimateCreditsForProvider(discoveryProvider)');
  const reserveAt = code.indexOf('deps.reserveBudget(');

  assert.ok(gateAt > 0, 'la capa gratuita debe estar cableada');
  assert.ok(estimateAt > 0 && reserveAt > 0);
  assert.ok(gateAt < estimateAt, 'la capa gratuita va antes de la estimación');
  assert.ok(gateAt < reserveAt, 'la capa gratuita va antes de la reserva');
});

test('§ 25 — LAS DOS rutas consumen EL MISMO runner previo al pago', () => {
  const lusha = stripTsComments(read(LUSHA_ACTION));
  const wizard = stripTsComments(read(WIZARD_ACTION));
  const sharedRunnerModule = 'country-source-discovery/run-prepaid-novelty-discovery.server';

  assert.ok(lusha.includes(sharedRunnerModule), 'la ruta Lusha importa el runner compartido');
  assert.ok(wizard.includes(sharedRunnerModule), 'la ruta Apollo/Tavily importa el runner compartido');
});

test('🔴 § 5 — no existe una segunda taxonomía: la evidencia sale del catálogo canónico', () => {
  const files = listSources(PREPAID_DIR);
  const precision = files.find((f) => f.endsWith('country-source-macro-precision.ts'));
  const index = files.find((f) => f.endsWith('macro-ciiu-index.ts'));
  assert.ok(precision && index);

  for (const rel of [precision, index]) {
    const code = stripTsComments(read(rel));
    assert.ok(
      code.includes('assessDeclaredMacroIndustryEvidence'),
      `${rel} debe usar el evaluador canónico`,
    );
  }

  // Y ningún módulo de la capa declara términos macro propios.
  for (const rel of files) {
    const code = stripTsComments(read(rel));
    assert.ok(
      !code.includes('confirming:') && !code.includes('parentIndustries:'),
      `${rel} no debe declarar términos de evidencia propios`,
    );
  }
});

/**
 * 🔴 RATCHET INVERTIDO, NO BORRADO (AGENT1-PROVIDER-SEEN-MEMORY-2).
 *
 * La versión anterior medía el MÁXIMO GLOBAL de `supabase/migrations` y exigía que no
 * pasara de 122. Esa forma tenía dos problemas, y el repo ya los había diagnosticado en
 * `identity-key-repair-migration-static.test.ts`: un máximo global no dice nada sobre
 * ESTE hito —cualquier trabajo ajeno lo mueve— y, del otro lado, subir el número a 123
 * habría dejado pasar CUALQUIER migración nueva sin mirar qué hace.
 *
 * Lo que la capa gratuita prometió, y sigue cumpliendo, es que NO NECESITA ESQUEMA: lee
 * tablas que ya existían y no crea ninguna. Eso es lo que se mide ahora, más el hecho de
 * que la única migración por encima de la línea base es la de la memoria provider-seen,
 * que es un ADDENDUM distinto y que se declara NO aplicada.
 */
test('§ 28 — la capa gratuita no necesita esquema, y lo único por encima de 122 es la memoria provider-seen', () => {
  const MIGRATION_BASELINE = 122;
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
    f.endsWith('.sql'),
  );

  const above = migrations
    .filter((f) => Number.parseInt(f.slice(0, 3), 10) > MIGRATION_BASELINE)
    .sort();
  assert.deepEqual(
    above,
    [
      '123_provider_seen_entities.sql',
      // AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1: identidad provider-native del
      // reveal de TELÉFONO (Agente 2A). No tiene nada que ver con la capa gratuita de
      // descubrimiento que esta guarda protege — no nombra `prospect_candidates`,
      // `provider_seen_entities` ni ninguna tabla de wizard— y trae su propia guarda
      // estática. Se declara NO aplicada en Producción.
      '124_cross_provider_phone_identity.sql',
      // BR-SOURCE CUT A.1: unicidad GENÉRICA de `record_identity_key` sobre
      // `source_company_snapshots` para fuentes NO brasileñas. Nada que ver con la capa gratuita
      // que esta guarda protege — no nombra `prospect_candidates` ni ninguna tabla de wizard — y
      // trae su propia guarda estática. Está AUTORADA y NO APLICADA.
      '125_reconcile_source_snapshot_record_identity.sql',
      // BR-SOURCE-FUNCTIONAL-CUT-A: identidad MENSUAL del snapshot de Receita (`source_period`
      // + unicidad period-aware sobre `source_company_snapshots`, estado de publicación en
      // `source_snapshot_runs`). Nada que ver con la capa gratuita que esta guarda protege — no
      // nombra `prospect_candidates` ni ninguna tabla de wizard — y trae su propia guarda
      // estática. Está AUTORADA y NO APLICADA.
      // AGENT1-CUT3B4-BATCH-IDENTITY-ATOMICITY reclamó el 126 de forma independiente mientras
      // esta reconciliación seguía en revisión: el vallado optimista de la admisión por
      // identidad de LOTE (Agente 1). Añade `prospect_batches.identity_epoch` y dos funciones
      // sobre `prospect_batches` y `prospect_candidates` — SÍ nombra `prospect_candidates`, pero
      // es su PROPIO esquema (el vallado), no una migración de la capa gratuita que este archivo
      // protege; lo que esta guarda vigila (líneas 230-235) es el código TypeScript de la capa,
      // no el contenido SQL de migraciones ajenas declaradas aquí por autoría. Trae su propia
      // guarda estática y NO edita ninguna migración anterior. NO aplicada en Producción.
      '126_agent1_batch_identity_atomicity.sql',
      // RENUMERADA de 125 a 127 (con una escala en 126) por BR-SOURCE CUT A.1: el primer salto
      // dejó sitio a la reconciliación genérica arriba; el segundo lo forzó AGENT1-CUT3B4 al
      // reclamar el 126 de forma independiente.
      '127_br_receita_monthly_snapshot_identity.sql',
      // AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1: la proyección de la colección de
      // teléfonos de un candidato ya APROBADO al contacto que su aprobación creó (Agente 2A).
      // Nada que ver con la capa gratuita de descubrimiento que esta guarda protege — no nombra
      // `prospect_candidates`, `provider_seen_entities` ni ninguna tabla de wizard — y trae su
      // propia guarda estática. Está AUTORADA y NO APLICADA.
      '128_project_approved_candidate_phones_onto_contact.sql',
      // AGENT2-FINAL-INTEGRATION-PREPARATION-LOCAL-1: el tramo 129–132 de la cadena de
      // sincronización con HubSpot de Agente 2, canonicalizado desde cuatro archivos que nacieron
      // sin número. Nada que ver con la capa gratuita de descubrimiento que esta guarda protege
      // —ninguna nombra `prospect_candidates`, `provider_seen_entities` ni una tabla de wizard— y
      // cada una trae su propia guarda estática. AUTORADAS y NO APLICADAS.
      '129_agent2_contact_hubspot_stale_completeness.sql',
      '130_agent2_contact_hubspot_stale_source.sql',
      '131_agent2_post_approval_reveal_stale_producer.sql',
      '132_agent2_hubspot_legacy_sync_state_backfill.sql',
      // BR-PRODUCTION-RELEASE: la promoción VALLADA de la identidad fiscal resuelta de una
      // candidata brasileña (BR-SOURCE CUT D). Toca `prospect_candidates` y `prospect_batches`,
      // pero NO es de la capa GRATUITA de descubrimiento que esta guarda protege: no crea ni
      // altera ninguna tabla, no nombra `provider_seen_entities` ni ninguna tabla de wizard, y
      // sólo declara UNA función más sus permisos. La capa gratuita sigue sin necesitar esquema,
      // que es lo único que esta guarda afirma. AUTORADA y NO APLICADA.
      '133_br_candidate_identity_promotion.sql',
      // 🔴 AGENT1-LUSHA-CUT-L3: la valla DURABLE de una petición de Lusha Prospecting. Es de
      // Agente 1, pero NO de la capa gratuita: se escribe antes de una petición PAGADA y no
      // toca ninguna de las tablas que la capa gratuita lee. AUTORADA y NO APLICADA.
      '134_agent1_lusha_prospecting_request_fence.sql',
    ],
    'ninguna migración nueva salvo la memoria provider-seen, la identidad cross-provider, la promoción vallada de BR CUT D y la valla de petición de Lusha',
  );

  // 🔴 Ratchet invertido en AGENT1-PROVIDER-SEEN-MEMORY-3: la 123 YA está aplicada
  // en Producción (`20260820153919`). Lo que esta prueba defiende no cambia —que el
  // archivo diga la verdad sobre Producción— pero la verdad sí.
  const sql = read('supabase/migrations/123_provider_seen_entities.sql');
  assert.ok(!sql.includes('APPLIED IN PRODUCTION: NO'));
  assert.ok(sql.includes('✅ APPLIED IN PRODUCTION'));
  assert.ok(sql.includes('20260820153919'));

  // 🔴 La promesa REAL de esta capa: ninguno de sus módulos crea, altera o borra una
  // tabla, ni depende de una que este trabajo haya tenido que inventar.
  for (const rel of [...listSources(PREPAID_DIR), ...listSources(PURE_DIR)]) {
    const code = stripTsComments(read(rel));
    for (const needle of ['CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'provider_seen_entities']) {
      assert.ok(!code.includes(needle), `${rel} no debe necesitar esquema propio (${needle})`);
    }
  }
});
