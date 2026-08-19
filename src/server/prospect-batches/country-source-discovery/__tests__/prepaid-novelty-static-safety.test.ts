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

test('§ 28 — este hito NO añade migraciones', () => {
  const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
    f.endsWith('.sql'),
  );
  const highest = migrations
    .map((f) => Number.parseInt(f.slice(0, 3), 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  // 122 es la última migración que existía al abrir este trabajo. Si sube, alguien
  // añadió una y este hito declaró que no habría ninguna.
  assert.ok(highest <= 122, `la migración más alta es ${highest}; el hito no añade ninguna`);
});
