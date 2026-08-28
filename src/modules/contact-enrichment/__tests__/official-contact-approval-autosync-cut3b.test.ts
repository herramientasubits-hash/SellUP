/**
 * AGENT2-CONTACT-HUBSPOT-AUTOSYNC-CUT3B — la SEGUNDA FASE de la aprobación.
 *
 * Lo que se demuestra aquí es lo que la suite hermana (`contact-hubspot-autosync-cut3b`) no
 * puede demostrar sola: que la fase automática está COLGADA en el sitio correcto.
 *
 *  - la transacción de aprobación no cambió y no aprendió a hablar con HubSpot;
 *  - el autosync corre DESPUÉS de que esa transacción confirme, y su fallo no puede volverse un
 *    fallo de aprobación por ninguna vía —ni por `ok`, ni por una excepción que suba;
 *  - la bandera se lee en UN solo sitio y falla cerrada;
 *  - el camino de REVEAL sigue sin tocar HubSpot, y el de CUT-2/CUT-3A sigue marcando sin enviar.
 *
 * Estática y pura: se lee el código fuente y se ejecuta el núcleo con dependencias inyectadas.
 * Sin red, sin DB, sin auth.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import { runApproveCandidate, type ApproveDeps } from '../candidate-review-core';
import { runContactHubSpotAutoSync } from '@/modules/contacts/contact-hubspot-autosync-core';
import { isHubSpotContactAutoSyncEnabled } from '@/lib/feature-flags.server';

const originalFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

const ROOT = process.cwd();

/** Quita comentarios: «nombrarlo» en una explicación no es «citarlo» en el código. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8');
}

const ENRICHMENT_ACTIONS = read('src/modules/contact-enrichment/actions.ts');
const ENRICHMENT_ACTIONS_CODE = stripComments(ENRICHMENT_ACTIONS);
const REVIEW_CORE_CODE = stripComments(read('src/modules/contact-enrichment/candidate-review-core.ts'));

/** El cuerpo EXACTO de `approveContactCandidate`, sin comentarios. */
function approveBlock(): string {
  const at = ENRICHMENT_ACTIONS_CODE.indexOf('export async function approveContactCandidate(');
  assert.ok(at > 0, 'falta approveContactCandidate');
  const end = ENRICHMENT_ACTIONS_CODE.indexOf('\nexport ', at + 1);
  return ENRICHMENT_ACTIONS_CODE.slice(at, end === -1 ? undefined : end);
}

// ════════════════════════════════════════════════════════════════
// 24 · La transacción de aprobación no se movió
// ════════════════════════════════════════════════════════════════

describe('24. la transacción SQL de la aprobación no cambió y HubSpot vive FUERA de ella', () => {
  it('la RPC 116 sigue sin nombrar HubSpot ni ninguna red', () => {
    const sql = read('supabase/migrations/116_approve_candidate_with_official_phones.sql');
    // El cuerpo ejecutable, sin los comentarios `--` ni el COMMENT ON descriptivo.
    const body = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
      .replace(/COMMENT ON[\s\S]*?;\s*$/m, '');
    for (const forbidden of ['hubspot_contact_id', 'hubspot_sync', 'http', 'net.']) {
      assert.equal(
        new RegExp(forbidden, 'i').test(body),
        false,
        `la transacción de aprobación no puede nombrar ${forbidden}`,
      );
    }
  });

  it('`runApproveCandidate` sigue sin conocer el motor de sincronización', () => {
    for (const forbidden of [
      'runSyncContactToHubSpot',
      'runContactHubSpotAutoSync',
      'createHubSpotContact',
      'findHubSpotContactByEmail',
      'fetch(',
    ]) {
      assert.equal(
        REVIEW_CORE_CODE.includes(forbidden),
        false,
        `${forbidden} pertenece a la segunda fase, no al núcleo de aprobación`,
      );
    }
  });

  it('el núcleo de aprobación sigue devolviendo el mismo contrato que en CUT-3A', async () => {
    // Se ejecuta el núcleo REAL: si la aprobación hubiera aprendido a llamar a HubSpot, el
    // `fetch` envenenado o una dependencia ausente lo delataría aquí.
    const deps = makeApproveDeps();
    const result = await runApproveCandidate('cand-1', deps);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.contactId === 'contact-nuevo');
    // Ni un solo campo de HubSpot en el resultado del núcleo.
    assert.deepEqual(Object.keys(result).sort(), ['contactId', 'message', 'ok']);
  });
});

// ════════════════════════════════════════════════════════════════
// La segunda fase: dónde está colgada
// ════════════════════════════════════════════════════════════════

describe('la segunda fase corre DESPUÉS de la aprobación confirmada', () => {
  const block = approveBlock();

  it('el autosync se invoca después de `runApproveCandidate`, no antes ni dentro', () => {
    const approveAt = block.indexOf('await runApproveCandidate(');
    const autoAt = block.indexOf('await triggerContactHubSpotSync(');
    assert.ok(approveAt > 0, 'falta la llamada al núcleo de aprobación');
    assert.ok(autoAt > approveAt, 'el autosync no puede preceder a la aprobación');
  });

  it('una aprobación que NO produjo contacto sale antes de tocar HubSpot', () => {
    const autoAt = block.indexOf('await triggerContactHubSpotSync(');
    const guardAt = block.indexOf('if (!result.ok) return result;');
    assert.ok(guardAt > 0, 'falta la salida temprana para la aprobación fallida');
    assert.ok(guardAt < autoAt, 'la guarda debe preceder al autosync');
  });

  it('la fase de HubSpot nunca modifica el resultado de la aprobación', () => {
    // Ya no hay un informe que adjuntar: `approveContactCandidate` devuelve `result` tal cual,
    // sin envolverlo ni mezclarlo con nada que dependa del desenlace de HubSpot.
    assert.match(block, /return result;\s*$/m);
    assert.equal(block.includes('hubspotAutoSync'), false);
  });

  it('la aprobación delega en triggerContactHubSpotSync y no reimplementa nada de HubSpot', () => {
    assert.match(block, /triggerContactHubSpotSync\(/);
    for (const forbidden of [
      'buildContactHubSpotSyncDeps(',
      'findHubSpotContactByEmail(',
      'createHubSpotContact(',
      'runSyncContactToHubSpot(',
      'fetch(',
    ]) {
      assert.equal(
        block.includes(forbidden),
        false,
        `${forbidden} sería una segunda implementación de HubSpot, delegar es el punto`,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Aislamiento del fallo
// ════════════════════════════════════════════════════════════════

describe('un fallo de HubSpot NUNCA se convierte en un fallo de aprobación', () => {
  it('el motor devuelve informe incluso cuando TODAS sus dependencias explotan', async () => {
    const report = await runContactHubSpotAutoSync('contact-nuevo', {
      enabled: true,
      nowIso: '2026-08-25T18:00:00.000Z',
      loadSubject: async () => {
        throw new Error('HubSpot 500');
      },
      runSync: async () => {
        throw new Error('HubSpot 500');
      },
      persistAnnex: async () => {
        throw new Error('HubSpot 500');
      },
    });
    // No lanzó: si lo hubiera hecho, el `catch` de la server action habría devuelto
    // `{ ok: false }` sobre una aprobación que SÍ ocurrió.
    assert.equal(report.outcome, 'attempted_failed');
  });

  it('el envelope ya no carga un informe de HubSpot: nadie lo consumía', () => {
    const iface = ENRICHMENT_ACTIONS.slice(
      ENRICHMENT_ACTIONS.indexOf('export interface ApproveCandidateActionResult'),
    ).slice(0, 2000);
    assert.equal(iface.includes('hubspotAutoSync'), false);
    // `ok` sigue siendo lo primero y sigue siendo un booleano plano.
    assert.match(iface, /\n {2}ok: boolean;/);
  });

  it('un rechazo de `triggerContactHubSpotSync` (no sólo un informe de fallo) no puede tocar el resultado de la aprobación', () => {
    const block = approveBlock();
    const callAt = block.indexOf('await triggerContactHubSpotSync(');
    assert.ok(callAt > 0, 'falta la llamada a triggerContactHubSpotSync');
    // El `try {` MÁS CERCANO antes de la llamada, no el try exterior de toda la función: si la
    // llamada estuviera fuera de un try local, un rechazo subiría hasta el try exterior y ahí
    // SÍ convertiría el resultado en `{ ok: false }`, exactamente lo que este corte prohíbe.
    const tryAt = block.lastIndexOf('try {', callAt);
    const catchAt = block.indexOf('} catch', callAt);
    assert.ok(tryAt >= 0 && tryAt < callAt, 'triggerContactHubSpotSync debe estar dentro de un try local');
    assert.ok(catchAt > callAt, 'triggerContactHubSpotSync debe estar seguida de un catch');
    // Después de ese catch, la función sigue devolviendo `result` sin condicionarlo al desenlace de HubSpot.
    const afterCatch = block.slice(catchAt);
    assert.match(afterCatch, /return result;/);
  });
});

// ════════════════════════════════════════════════════════════════
// La bandera
// ════════════════════════════════════════════════════════════════

describe('la bandera se lee en UN solo sitio y falla cerrada', () => {
  const flags = stripComments(read('src/lib/feature-flags.server.ts'));

  it('el nombre de la variable se escribe una sola vez, en el módulo de banderas', () => {
    const occurrences = (
      ENRICHMENT_ACTIONS_CODE.match(/HUBSPOT_CONTACT_AUTO_SYNC_ENABLED/g) ?? []
    ).length;
    assert.equal(occurrences, 0, 'la server action no puede nombrar la variable de entorno');
    assert.match(flags, /HUBSPOT_CONTACT_AUTO_SYNC_FLAG = 'HUBSPOT_CONTACT_AUTO_SYNC_ENABLED'/);
  });

  it('el hook de aprobación ya NO depende de isHubSpotContactAutoSyncEnabled: siempre activo', () => {
    assert.equal(
      ENRICHMENT_ACTIONS_CODE.includes('isHubSpotContactAutoSyncEnabled'),
      false,
      'el hook de aprobación no puede depender del flag: la decisión es "siempre activo"',
    );
  });

  it('usa el parser canónico, no una comparación cruda', () => {
    const fn = flags.slice(flags.indexOf('export function isHubSpotContactAutoSyncEnabled'));
    assert.match(fn, /isEnvFlagEnabled\(process\.env\[HUBSPOT_CONTACT_AUTO_SYNC_FLAG\]\)/);
  });

  it('por defecto está APAGADA en local: la variable no existe en el entorno', () => {
    assert.equal(process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED, undefined);
    assert.equal(isHubSpotContactAutoSyncEnabled(), false);
  });

  it('sólo el token exacto `true` la enciende', () => {
    const cases: [string | undefined, boolean][] = [
      ['true', true],
      [' TRUE ', true],
      ['false', false],
      ['1', false],
      ['yes', false],
      ['', false],
      [undefined, false],
    ];
    const original = process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED;
    try {
      for (const [raw, expected] of cases) {
        if (raw === undefined) delete process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED;
        else process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED = raw;
        assert.equal(isHubSpotContactAutoSyncEnabled(), expected, `raw=${JSON.stringify(raw)}`);
      }
    } finally {
      if (original === undefined) delete process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED;
      else process.env.HUBSPOT_CONTACT_AUTO_SYNC_ENABLED = original;
    }
  });

  it('el motor recibe el booleano ya resuelto: no hay una segunda forma de encenderlo', () => {
    const core = stripComments(read('src/modules/contacts/contact-hubspot-autosync-core.ts'));
    assert.equal(core.includes('process.env'), false);
    assert.equal(core.includes('isHubSpotContactAutoSyncEnabled'), false);
  });
});

// ════════════════════════════════════════════════════════════════
// 16 · El reveal posterior
// ════════════════════════════════════════════════════════════════

describe('16. un reveal POSTERIOR marca pendiente y no llama a HubSpot', () => {
  const writers = [
    'src/modules/contact-enrichment/phone-cache-suppression-core.ts',
    'src/modules/contact-enrichment/phone-cache-suppression-actions.ts',
    'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
    'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
  ];

  it('ningún camino de reveal alcanza el motor de sincronización', () => {
    for (const rel of writers) {
      const code = stripComments(read(rel));
      for (const forbidden of [
        'runSyncContactToHubSpot',
        'runContactHubSpotAutoSync',
        'syncContactToHubSpot',
        'createHubSpotContact',
        'updateHubSpotContact',
      ]) {
        assert.equal(code.includes(forbidden), false, `${rel} no puede exportar a HubSpot`);
      }
    }
  });

  it('CUT-3B no añadió autosync al camino de reveal: sólo la aprobación lo dispara', () => {
    const callers: string[] = [];
    const walk = (rel: string) => {
      let entries: Dirent[];
      try {
        entries = readdirSync(join(ROOT, rel), { withFileTypes: true, encoding: 'utf8' });
      } catch {
        return;
      }
      for (const entry of entries) {
        const name = String(entry.name);
        const child = `${rel}/${name}`;
        if (entry.isDirectory()) {
          if (name === '__tests__' || name === 'node_modules') continue;
          walk(child);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        if (stripComments(read(child)).includes('runContactHubSpotAutoSync(')) callers.push(child);
      }
    };
    walk('src');
    assert.deepEqual(callers.sort(), [
      'src/modules/contact-enrichment/hubspot-contact-approval-sync.ts',
      'src/modules/contacts/contact-hubspot-autosync-core.ts',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════
// 22-23 · Lo que CUT-2 y CUT-3A dejaron dicho sigue en pie
// ════════════════════════════════════════════════════════════════

describe('22-23. marcar pendiente sigue sin enviar nada, en los dos escritores', () => {
  it('CUT-2 — `updateContact` marca dentro de su propio UPDATE y no llama a HubSpot', () => {
    const actions = stripComments(read('src/modules/contacts/actions.ts'));
    const at = actions.indexOf('export async function updateContact');
    const fn = actions.slice(at, actions.indexOf('\nexport ', at + 1));
    assert.match(fn, /markContactHubSpotSyncStaleForPhoneChange\(/);
    for (const forbidden of [
      'syncContactToHubSpot',
      'runContactHubSpotSyncWired',
      'runContactHubSpotAutoSync',
      'updateHubSpotContact',
    ]) {
      assert.equal(fn.includes(forbidden), false, `${forbidden} sería autosync desde la edición`);
    }
  });

  it('CUT-3A — la supresión de privacidad marca y no exporta', () => {
    const code = stripComments(read('src/modules/contact-enrichment/phone-cache-suppression-core.ts'));
    assert.match(code, /markContactHubSpotSyncStaleForPhoneChange\(/);
    for (const forbidden of ['fetch(', 'hubapi', 'runSyncContactToHubSpot']) {
      assert.equal(code.includes(forbidden), false, `${forbidden} no pertenece a la erasure`);
    }
  });
});

// ── Fixtures del núcleo de aprobación ───────────────────────────

function makeApproveDeps(): ApproveDeps {
  return {
    actorId: 'user-1',
    nowIso: '2026-08-25T18:00:00.000Z',
    loadCandidate: async () => ({
      id: 'cand-1',
      status: 'pending_review',
      full_name: 'Ana López',
      first_name: 'Ana',
      last_name: 'López',
      email: 'ana@empresa.com',
      phone: '+57 300 111 2222',
      job_title: 'Gerente',
      linkedin_url: null,
      seniority: null,
      department: null,
      country_code: 'CO',
      company_name: 'Empresa SA',
      company_domain: 'empresa.com',
      hubspot_company_id: null,
      account_id: 'account-1',
      run_id: 'run-1',
      confidence_score: null,
      source: 'apollo',
      duplicate_status: null,
      matched_contacts_id: null,
      enrichment_metadata: {},
    } as unknown as Awaited<ReturnType<ApproveDeps['loadCandidate']>>),
    loadExistingContacts: async () => [],
    approveTransactionally: async () => ({
      ok: true,
      contactId: 'contact-nuevo',
      alreadyApproved: false,
    }),
    updateCandidate: async () => ({}),
    loadAccountHubSpotCompanyId: async () => 'hs-company-1',
  };
}
