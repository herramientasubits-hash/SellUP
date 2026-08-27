/**
 * AGENT2-CONTACT-HUBSPOT-SYNC-STATE-CUT1 — el estado durable de sincronización HubSpot
 * ESCRITO AL APROBAR.
 *
 * Lo que se demuestra aquí es que aprobar deja escrito POR QUÉ un contacto todavía no está en
 * HubSpot, y que lo deja sin llamar a HubSpot ni una sola vez. Las tres reglas —email primero,
 * empresa después, y `never_attempted` sólo cuando ambos requisitos se cumplen— se comprueban
 * sobre el payload REAL que viaja a la transacción de aprobación, no sobre un builder aparte.
 *
 * Sin red, sin DB, sin auth: todas las dependencias se inyectan. `fetch` global queda
 * envenenado para que cualquier salida a la red rompa la prueba en vez de pasar inadvertida.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  runApproveCandidate,
  type ApproveDeps,
  type CandidateRecord,
  type ContactInsertPayload,
} from '../candidate-review-core';
import {
  readHubSpotSyncState,
  type HubSpotSyncStatus,
} from '@/modules/contacts/contact-hubspot-sync-state';

// ── Prueba 11 — ninguna red real ────────────────────────────────

const originalFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async () => {
    throw new Error('NETWORK_FORBIDDEN_IN_TEST');
  }) as typeof globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures ────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRecord> = {}): CandidateRecord {
  return {
    id: 'cand-1',
    status: 'pending_review',
    full_name: 'Ana López',
    first_name: 'Ana',
    last_name: 'López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    email: 'ana@corp.com',
    phone: '+57 300 000 0000',
    linkedin_url: 'https://linkedin.com/in/analopez',
    source: 'apollo',
    enrichment_metadata: {},
    enrichment_run_id: 'run-1',
    account_id: 'acc-1',
    hubspot_company_id: null,
    company_name: null,
    company_domain: null,
    country_code: null,
    ...overrides,
  };
}

function makeDeps(args: {
  candidate?: CandidateRecord;
  hubspotCompanyId?: string | null;
  omitAccountReader?: boolean;
  accountReaderThrows?: boolean;
  alreadyApproved?: boolean;
  overrides?: Partial<ApproveDeps>;
} = {}): {
  deps: ApproveDeps;
  calls: { inserted: ContactInsertPayload[]; accountReads: string[] };
} {
  const calls = { inserted: [] as ContactInsertPayload[], accountReads: [] as string[] };
  const deps: ApproveDeps = {
    actorId: 'user-1',
    nowIso: '2026-08-25T12:00:00.000Z',
    loadCandidate: async () => args.candidate ?? makeCandidate(),
    loadExistingContacts: async () => [],
    approveTransactionally: async ({ contactPayload }) => {
      // La RPC 116 con un candidato ya `approved` devuelve `already_approved` SIN escribir:
      // el payload no llega a aplicarse. El adaptador reproduce esa asimetría.
      if (args.alreadyApproved) {
        return { ok: true, contactId: 'contact-new', alreadyApproved: true };
      }
      calls.inserted.push(contactPayload);
      return { ok: true, contactId: 'contact-new', alreadyApproved: false };
    },
    updateCandidate: async () => ({}),
    ...(args.omitAccountReader
      ? {}
      : {
          loadAccountHubSpotCompanyId: async (accountId: string) => {
            calls.accountReads.push(accountId);
            if (args.accountReaderThrows) throw new Error('accounts read failed');
            return args.hubspotCompanyId === undefined ? 'hs-company-1' : args.hubspotCompanyId;
          },
        }),
    ...(args.overrides ?? {}),
  };
  return { deps, calls };
}

function statusOf(payload: ContactInsertPayload): HubSpotSyncStatus | undefined {
  return readHubSpotSyncState(payload.metadata)?.status;
}

// ── 1-3. Estado inicial al aprobar ──────────────────────────────

describe('estado inicial escrito al aprobar', () => {
  it('1. con email y con empresa HubSpot ⇒ never_attempted', async () => {
    const { deps, calls } = makeDeps({ hubspotCompanyId: 'hs-company-1' });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(calls.inserted.length, 1);
    assert.equal(statusOf(calls.inserted[0]), 'never_attempted');
    // Lee la CUENTA resuelta, que es la misma fila que consulta la sincronización manual.
    assert.deepEqual(calls.accountReads, ['acc-1']);
  });

  it('2. sin email ⇒ blocked_no_email, aunque la cuenta sí esté en HubSpot', async () => {
    const { deps, calls } = makeDeps({
      candidate: makeCandidate({ email: null }),
      hubspotCompanyId: 'hs-company-1',
    });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(statusOf(calls.inserted[0]), 'blocked_no_email');
  });

  it('2b. un email que no normaliza cuenta como ausencia de email', async () => {
    // El estado usa EL MISMO normalizador que escribe `contacts.email`. Si divergieran, este
    // contacto quedaría `never_attempted` y la sincronización lo rechazaría por MISSING_EMAIL.
    const { deps, calls } = makeDeps({
      candidate: makeCandidate({ email: 'no-es-un-email' }),
      hubspotCompanyId: 'hs-company-1',
    });
    await runApproveCandidate('cand-1', deps);

    assert.equal(calls.inserted[0].email, null);
    assert.equal(statusOf(calls.inserted[0]), 'blocked_no_email');
  });

  it('3. con email pero sin empresa HubSpot ⇒ blocked_no_hubspot_company', async () => {
    const { deps, calls } = makeDeps({ hubspotCompanyId: null });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(statusOf(calls.inserted[0]), 'blocked_no_hubspot_company');
  });

  it('el estado inicial NO afirma ningún intento', async () => {
    const { deps, calls } = makeDeps({ hubspotCompanyId: 'hs-company-1' });
    await runApproveCandidate('cand-1', deps);

    const state = readHubSpotSyncState(calls.inserted[0].metadata);
    assert.deepEqual(state, {
      status: 'never_attempted',
      method: null,
      attempted_at: null,
      last_error: null,
      hubspot_contact_id: null,
      // CUT-2: un contacto recién aprobado tampoco puede tener nada PENDIENTE de enviar —
      // nunca se envió nada.
      stale_since: null,
      stale_reason: null,
      // CUT-3C — el bloque gana un tercer marcador; sin pendiente, no hay causante.
      stale_source: null,
    });
  });
});

// ── 12. La metadata preexistente sobrevive ──────────────────────

describe('12. metadata preexistente preservada', () => {
  it('la trazabilidad de origen y la normalización siguen intactas', async () => {
    const { deps, calls } = makeDeps({
      candidate: makeCandidate({
        enrichment_metadata: {
          relevance: { status: 'high_relevance', score: 0.9 },
          apollo_title_normalization: { normalized: 'hr manager' },
        },
      }),
      hubspotCompanyId: 'hs-company-1',
    });
    await runApproveCandidate('cand-1', deps);

    const metadata = calls.inserted[0].metadata;
    assert.equal(metadata.source, 'contact_enrichment_candidate');
    assert.equal(metadata.source_candidate_id, 'cand-1');
    assert.deepEqual(metadata.relevance, { status: 'high_relevance', score: 0.9 });
    assert.deepEqual(metadata.normalization, {
      status: 'normalized',
      fields: ['full_name', 'first_name', 'last_name', 'email', 'linkedin_url', 'phone'],
    });
    assert.deepEqual(metadata.apollo_title_normalization, { normalized: 'hr manager' });
    assert.equal(statusOf(calls.inserted[0]), 'never_attempted');
  });
});

// ── 4. Doble clic ───────────────────────────────────────────────

describe('4. aprobación repetida', () => {
  it('no crea un segundo contacto ni reescribe el estado', async () => {
    const { deps, calls } = makeDeps({ alreadyApproved: true, hubspotCompanyId: 'hs-company-1' });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(res.ok === true && res.contactId, 'contact-new');
    // La transacción devolvió el contacto que ya existía sin aplicar el payload: no hay un
    // segundo contacto y no hay una segunda escritura que pudiera pisar un `synced` previo.
    assert.equal(calls.inserted.length, 0);
  });

  it('un candidato ya terminal ni siquiera llega a construir un estado', async () => {
    const { deps, calls } = makeDeps({
      candidate: makeCandidate({ status: 'approved' }),
      hubspotCompanyId: 'hs-company-1',
    });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, false);
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.accountReads.length, 0);
  });
});

// ── Ausencia = desconocido, nunca un estado inventado ───────────

describe('estado desconocido', () => {
  it('sin lector de cuenta no se escribe bloque alguno', async () => {
    const { deps, calls } = makeDeps({ omitAccountReader: true });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(readHubSpotSyncState(calls.inserted[0].metadata), null);
    assert.equal(calls.inserted[0].metadata.source, 'contact_enrichment_candidate');
  });

  it('si la lectura de la cuenta falla, la aprobación NO se rompe y el estado queda ausente', async () => {
    const { deps, calls } = makeDeps({ accountReaderThrows: true });
    const res = await runApproveCandidate('cand-1', deps);

    assert.equal(res.ok, true);
    assert.equal(res.ok === true && res.contactId, 'contact-new');
    assert.equal(readHubSpotSyncState(calls.inserted[0].metadata), null);
  });
});

// ── 13. Aprobar NO llama a HubSpot ──────────────────────────────

/**
 * Quita comentarios de línea y de bloque. Sin esto, un guard que grepea el fuente crudo
 * confunde NOMBRAR una integración en una explicación con INVOCARLA, y basta un comentario
 * para volverlo rojo o —peor— para que un import real se esconda tras una mención esperada.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const FORBIDDEN_IMPORT = /from\s+'[^']*(?:integrations\/hubspot|hubspot-contact-sync|hubspot-company)/;

describe('13. la aprobación no añade ninguna llamada a HubSpot', () => {
  const coreSource = readFileSync(
    path.join(process.cwd(), 'src/modules/contact-enrichment/candidate-review-core.ts'),
    'utf8',
  );

  it('el core de revisión no importa ninguna integración HubSpot', () => {
    assert.equal(FORBIDDEN_IMPORT.test(stripComments(coreSource)), false);
  });

  it('la guarda detecta el import prohibido (prueba en negativo)', () => {
    const violation = "import { createHubSpotContact } from '@/server/integrations/hubspot-contact-sync';";
    assert.equal(FORBIDDEN_IMPORT.test(stripComments(violation)), true);
    // Y un comentario que sólo lo MENCIONA no puede volver roja la guarda.
    assert.equal(
      FORBIDDEN_IMPORT.test(stripComments("// no usamos '@/server/integrations/hubspot-contact-sync'")),
      false,
    );
  });

  it('las dependencias de aprobación no exponen ningún escritor de HubSpot', async () => {
    const { deps } = makeDeps({ hubspotCompanyId: 'hs-company-1' });
    const depNames = Object.keys(deps).map((k) => k.toLowerCase());
    for (const name of depNames) {
      assert.equal(
        /hubspot/.test(name) && !name.includes('loadaccounthubspotcompanyid'),
        false,
        `dependencia inesperada relacionada con HubSpot: ${name}`,
      );
    }
    // Y la única que nombra HubSpot lee una COLUMNA de `accounts`, no la red del proveedor:
    // la prueba corre con `fetch` envenenado y la aprobación completa igualmente.
    const res = await runApproveCandidate('cand-1', deps);
    assert.equal(res.ok, true);
  });
});
