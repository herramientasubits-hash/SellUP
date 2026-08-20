/**
 * Tests — Lusha × Pre-Paid Provider-Native Novelty Gate
 * AGENT2A-PROVIDER-NOVELTY-AND-REUSE-GATE-1
 *
 * CERO red real: `globalThis.fetch` se sustituye por un router en memoria que
 * atiende api.lusha.com y un host Supabase de marcador, cuenta cada llamada a
 * `/v3/contacts/enrich` y FALLA el test si aparece cualquier otro host (en
 * particular el proyecto de Producción). 0 créditos, 0 escrituras reales.
 *
 * ALCANCE EXPLÍCITO — lo que estas pruebas NO afirman:
 *   El costo de Prospecting/Search NO se resuelve en este hito. Lusha no expone
 *   ningún parámetro para excluir contactIds conocidos, así que la llamada de
 *   descubrimiento ya ocurrió (y pudo cobrarse) antes de que el gate actúe. Lo
 *   que aquí se prueba es que un contactId ya conocido para la misma empresa no
 *   vuelve a pasar por `/v3/contacts/enrich`.
 *
 * Matriz del hito cubierta aquí: 13, 14, 15, 16, 17, 18, 19, 24, 25, 28.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { executeContactEnrichmentLushaRun } from '../lusha-enrichment-runner';
import type { ClaimableRunRow } from '../contact-enrichment-execution-claim';
import type { ProviderIdentityCandidateRowV1 } from '../provider-native-novelty-gate';

const SUPABASE_HOST = 'https://example.supabase.co';
const ACCOUNT_A = '11111111-1111-1111-1111-111111111111';
const ACCOUNT_B = '22222222-2222-2222-2222-222222222222';
const RUN_ID = 'run-now';

type FetchImpl = typeof globalThis.fetch;
let originalFetch: FetchImpl;
let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  envSnapshot = {
    ENABLE_LUSHA_CONTACT_ENRICHMENT: process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'],
    LUSHA_API_KEY: process.env['LUSHA_API_KEY'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    SUPABASE_SERVICE_ROLE_KEY: process.env['SUPABASE_SERVICE_ROLE_KEY'],
    LUSHA_MAX_CANDIDATES_PER_RUN: process.env['LUSHA_MAX_CANDIDATES_PER_RUN'],
  };
  process.env['ENABLE_LUSHA_CONTACT_ENRICHMENT'] = 'true';
  process.env['LUSHA_API_KEY'] = 'test-lusha-key-not-real';
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = SUPABASE_HOST;
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-placeholder';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** Contacto de Prospecting con forma V3 real (17B.4W.2), rol HR y email revelable. */
function prospectingPerson(contactId: string, first: string) {
  return {
    id: contactId,
    firstName: first,
    lastName: 'Apellido',
    jobTitle: {
      title: 'Director of Human Resources',
      departments: ['Human Resources'],
      seniority: 'director',
    },
    company: { id: 'co-1', name: 'Corp', domain: 'corp.com' },
    socialLinks: { linkedin: `https://www.linkedin.com/in/${contactId}` },
    has: ['firstName', 'lastName', 'jobTitle', 'company', 'emails'],
    canReveal: [{ field: 'emails', credits: 0 }],
  };
}

/**
 * Contacto de Prospecting SIN campo de email revelable: `has` no incluye
 * "emails", `canReveal` no ofrece el campo "emails" y no hay `hasWorkEmail`.
 * Con esta forma, `canRevealEmail=false` y `hasWorkEmail=false` en el
 * contacto normalizado (ver lusha-client.ts), así que el runner lo salta
 * ANTES de llamar a /v3/contacts/enrich — sea el contactId novedoso o ya
 * conocido por el novelty gate.
 */
function prospectingPersonNoEmail(contactId: string, first: string) {
  return {
    id: contactId,
    firstName: first,
    lastName: 'Apellido',
    jobTitle: {
      title: 'Director of Human Resources',
      departments: ['Human Resources'],
      seniority: 'director',
    },
    company: { id: 'co-1', name: 'Corp', domain: 'corp.com' },
    socialLinks: { linkedin: `https://www.linkedin.com/in/${contactId}` },
    has: ['firstName', 'lastName', 'jobTitle', 'company'],
    canReveal: [] as Array<{ field: string; credits: number }>,
  };
}

interface FetchRouter {
  install: () => void;
  enrichCalls: () => Array<{ ids: string[] }>;
  prospectingCalls: () => number;
  usageLogRows: () => Array<Record<string, unknown>>;
  candidateInsertRows: () => Array<Record<string, unknown>>;
  foreignHosts: () => string[];
}

function makeFetchRouter(prospectingContacts: ReturnType<typeof prospectingPerson>[]): FetchRouter {
  const enrichCalls: Array<{ ids: string[] }> = [];
  const usageLogRows: Array<Record<string, unknown>> = [];
  const candidateInsertRows: Array<Record<string, unknown>> = [];
  const foreignHosts: string[] = [];
  let prospectingCalls = 0;

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? init.body : null;

    if (url.startsWith('https://api.lusha.com/v3/contacts/prospecting')) {
      prospectingCalls += 1;
      return jsonResponse(200, {
        requestId: 'req-1',
        pagination: { total: prospectingContacts.length },
        billing: { creditsCharged: 1 },
        results: prospectingContacts,
      });
    }

    if (url.startsWith('https://api.lusha.com/v3/contacts/enrich')) {
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      // Contrato real de /v3/contacts/enrich: `ids` es un array de strings.
      const ids = Array.isArray(parsed['ids']) ? (parsed['ids'] as string[]) : [];
      enrichCalls.push({ ids });
      const id = ids[0] ?? 'unknown';
      return jsonResponse(200, {
        requestId: 'req-enrich',
        billing: { creditsCharged: 1 },
        results: [
          {
            id,
            firstName: 'Nombre',
            lastName: 'Apellido',
            jobTitle: 'Director of Human Resources',
            company: { name: 'Corp', domain: 'corp.com' },
            emails: [{ email: `${id}@corp.com`, type: 'work' }],
          },
        ],
      });
    }

    if (url.startsWith(SUPABASE_HOST)) {
      if (url.includes('/rest/v1/provider_usage_logs') && body) {
        const parsed = JSON.parse(body);
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) usageLogRows.push(row);
      }
      if (url.includes('/rest/v1/contact_enrichment_candidates') && body) {
        const parsed = JSON.parse(body);
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) candidateInsertRows.push(row);
      }
      // Toda lectura devuelve vacío; toda escritura se acepta sin efecto real.
      return jsonResponse(200, []);
    }

    foreignHosts.push(url);
    throw new Error(`Host no permitido en tests: ${url}`);
  }) as FetchImpl;

  return {
    install: () => {
      globalThis.fetch = impl;
    },
    enrichCalls: () => enrichCalls,
    prospectingCalls: () => prospectingCalls,
    usageLogRows: () => usageLogRows,
    candidateInsertRows: () => candidateInsertRows,
    foreignHosts: () => foreignHosts,
  };
}

function claimedRow(overrides: Partial<ClaimableRunRow> = {}): ClaimableRunRow {
  return {
    id: RUN_ID,
    agent_run_id: null,
    account_id: ACCOUNT_A,
    company_name: 'Corp',
    company_domain: 'corp.com',
    company_country_code: 'CO',
    hubspot_company_id: null,
    status: 'enriching',
    summary: { company_resolution_source: 'sellup' },
    attempt_order: 1,
    ...overrides,
  };
}

function knownRow(
  nativeId: string,
  provider: 'apollo' | 'lusha',
  company: { accountId?: string; hubspotCompanyId?: string; companyDomain?: string },
): ProviderIdentityCandidateRowV1 {
  return {
    nativeId,
    provider,
    company: {
      accountId: company.accountId ?? null,
      hubspotCompanyId: company.hubspotCompanyId ?? null,
      companyDomain: company.companyDomain ?? null,
    },
  };
}

interface RunOptions {
  contacts: ReturnType<typeof prospectingPerson>[];
  known?: ProviderIdentityCandidateRowV1[];
  row?: Partial<ClaimableRunRow>;
  lookupError?: string;
}

async function runLusha(options: RunOptions) {
  const router = makeFetchRouter(options.contacts);
  router.install();
  let lookupCalls = 0;
  let lookupIds: readonly string[] = [];

  const result = await executeContactEnrichmentLushaRun(RUN_ID, 'user-1', {
    claimRunForExecution: async () => ({ status: 'claimed', row: claimedRow(options.row) }),
    loadKnownProviderIdentities: async ({ provider, nativeIds }) => {
      lookupCalls += 1;
      lookupIds = nativeIds;
      if (options.lookupError) return { rows: [], lookupError: options.lookupError };
      return {
        rows: (options.known ?? []).filter((r) => r.provider === provider),
        lookupError: null,
      };
    },
  });

  return { result, router, lookupCalls: () => lookupCalls, lookupIds: () => lookupIds };
}

/** contactIds efectivamente enviados a /v3/contacts/enrich. */
function enrichedIds(router: FetchRouter): string[] {
  return router.enrichCalls().flatMap((call) => call.ids);
}

// ── Novel vs known ──────────────────────────────────────────────

describe('Lusha novelty gate — contactId novedoso vs conocido', () => {
  it('TEST 13 — contactId novedoso: /v3/contacts/enrich SÍ se llama', async () => {
    const { router } = await runLusha({ contacts: [prospectingPerson('v1.novel', 'Ana')] });

    assert.deepEqual(enrichedIds(router), ['v1.novel']);
    assert.deepEqual(router.foreignHosts(), []);
  });

  it('TEST 14 — contactId ya visto para la MISMA empresa: /v3/contacts/enrich NO se llama', async () => {
    const { router, result } = await runLusha({
      contacts: [prospectingPerson('v1.known', 'Ana')],
      known: [knownRow('v1.known', 'lusha', { accountId: ACCOUNT_A })],
    });

    assert.deepEqual(router.enrichCalls(), [], 'ninguna llamada pagada de enrich');
    assert.equal(router.candidateInsertRows().length, 0, 'ningún candidato duplicado');
    assert.equal(result.candidatesCreated, 0);
  });

  it('TEST 15 — mismo contactId en OTRA empresa determinista: sigue elegible al enrich', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.moved', 'Ana')],
      known: [knownRow('v1.moved', 'lusha', { accountId: ACCOUNT_B, companyDomain: 'corp.com' })],
    });

    assert.deepEqual(enrichedIds(router), ['v1.moved']);
  });

  it('TEST 16 — un candidato histórico descartado sigue contando como conocido', async () => {
    // El gate no filtra por status: la fila de evidencia es la misma para un
    // candidato rechazado/descartado que para uno aprobado.
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.discarded', 'Ana')],
      known: [knownRow('v1.discarded', 'lusha', { accountId: ACCOUNT_A })],
    });

    assert.deepEqual(router.enrichCalls(), []);
  });

  it('TEST 17 — un person_id de Apollo conocido NO suprime el enrich de Lusha', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('shared-id', 'Ana')],
      known: [knownRow('shared-id', 'apollo', { accountId: ACCOUNT_A })],
    });

    assert.deepEqual(enrichedIds(router), ['shared-id']);
  });

  it('TEST 18 — conjunto mixto: solo los contactId novedosos llegan al enrich', async () => {
    const { router, result, lookupCalls, lookupIds } = await runLusha({
      contacts: [
        prospectingPerson('v1.k1', 'Ana'),
        prospectingPerson('v1.n1', 'Beto'),
        prospectingPerson('v1.k2', 'Caro'),
        prospectingPerson('v1.n2', 'Dani'),
      ],
      known: [
        knownRow('v1.k1', 'lusha', { accountId: ACCOUNT_A }),
        knownRow('v1.k2', 'lusha', { accountId: ACCOUNT_A }),
      ],
    });

    assert.deepEqual(enrichedIds(router).sort(), ['v1.n1', 'v1.n2']);
    assert.equal(result.candidatesCreated, 2);
    // Una sola lectura batch con los cuatro contactId — nunca una por contacto.
    assert.equal(lookupCalls(), 1);
    assert.equal(lookupIds().length, 4);
  });

  it('sin clave determinista de empresa el gate no suprime (falla ABIERTO)', async () => {
    const { router, lookupCalls } = await runLusha({
      contacts: [prospectingPerson('v1.known', 'Ana')],
      known: [knownRow('v1.known', 'lusha', { accountId: ACCOUNT_A })],
      row: { account_id: null, hubspot_company_id: null, company_domain: null },
    });

    // Sin dominio ni cuenta el modo de descubrimiento pasa a depender solo del
    // nombre de empresa: la búsqueda sigue ocurriendo y el gate no consulta nada.
    assert.equal(lookupCalls(), 0);
    assert.deepEqual(enrichedIds(router), ['v1.known']);
  });

  it('un error de lectura no suprime ningún enrich', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.known', 'Ana')],
      known: [knownRow('v1.known', 'lusha', { accountId: ACCOUNT_A })],
      lookupError: 'timeout',
    });

    assert.deepEqual(enrichedIds(router), ['v1.known']);
  });
});

// ── Prospecting/Search unchanged + observability ─────────────────

describe('Lusha novelty gate — Prospecting/Search y observabilidad', () => {
  it('TEST 19 — Prospecting/Search se ejecuta igual: el gate NO resuelve su costo', async () => {
    const { router, result } = await runLusha({
      contacts: [prospectingPerson('v1.k1', 'Ana'), prospectingPerson('v1.k2', 'Beto')],
      known: [
        knownRow('v1.k1', 'lusha', { accountId: ACCOUNT_A }),
        knownRow('v1.k2', 'lusha', { accountId: ACCOUNT_A }),
      ],
    });

    // La llamada de descubrimiento ocurrió UNA vez, con TODOS sus resultados, y
    // sus créditos siguen contabilizados: el gate no la evita ni la abarata.
    assert.equal(router.prospectingCalls(), 1);
    assert.equal(result.rawResultsCount, 2);
    assert.equal(result.creditsUsed, 1, 'el crédito de prospecting sigue cobrado');
    // Pero ninguna llamada PAGADA de enrich se hizo.
    assert.deepEqual(router.enrichCalls(), []);
  });

  it('TEST 24 — el skip queda contado en la metadata de uso y en el summary del run', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.k1', 'Ana'), prospectingPerson('v1.n1', 'Beto')],
      known: [knownRow('v1.k1', 'lusha', { accountId: ACCOUNT_A })],
    });

    const usageRow = router
      .usageLogRows()
      .find((row) => row['operation_key'] === 'lusha_contact_prospecting');
    assert.ok(usageRow, 'la fila de uso del prospecting REAL debe existir');
    const metadata = usageRow['metadata'] as Record<string, unknown>;
    const novelty = metadata['provider_identity_novelty'] as Record<string, unknown>;
    assert.equal(novelty['provider'], 'lusha');
    assert.equal(novelty['gate_applied'], true);
    assert.equal(novelty['company_scope_kind'], 'account_id');
    assert.equal(novelty['known_provider_identity_ids_count'], 1);
    assert.equal(novelty['skipped_known_provider_identity_count'], 1);
    assert.equal(novelty['novel_provider_identity_count'], 1);
    // PR #315 — no se reintroduce la métrica de ahorro no demostrada.
    assert.equal('avoided_paid_provider_calls_count' in novelty, false);
  });

  it('TEST 25/28 — el skip no produce llamada de enrich ni una fila de uso falsa', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.k1', 'Ana')],
      known: [knownRow('v1.k1', 'lusha', { accountId: ACCOUNT_A })],
    });

    assert.deepEqual(router.enrichCalls(), [], '0 llamadas de enrich');

    const rows = router.usageLogRows();
    // Exactamente una fila de uso: la del prospecting REAL. Ninguna fila
    // inventada para la llamada de enrich que nunca ocurrió.
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['operation_key'], 'lusha_contact_prospecting');
    assert.equal(
      rows.some((row) => row['operation_key'] === 'lusha_contact_enrich'),
      false,
    );
  });

  it('ninguna prueba de esta suite alcanza un host distinto de Lusha/Supabase de prueba', async () => {
    const { router } = await runLusha({
      contacts: [prospectingPerson('v1.n1', 'Ana')],
    });
    assert.deepEqual(router.foreignHosts(), []);
  });
});

// ── PR #315 correction: skip count is not a paid-call-avoidance claim ──
//
// The gate runs BEFORE `novelForEnrich.slice(0, maxCandidates)` and BEFORE
// the canRevealEmail/hasWorkEmail check. A known contactId can be skipped by
// the gate even though it would never have reached /v3/contacts/enrich
// anyway — because it fell outside maxCandidates, or because the provider
// never offered a revealable email. These tests prove the observability no
// longer equates "skipped known" with "avoided paid enrich call".

describe('PR #315 — el skip NO afirma una llamada de enrich evitada (Lusha)', () => {
  it('COUNTERFACTUAL 3 — 10 conocidos con maxCandidates=3: el skip NO puede reclamar 10 llamadas evitadas', async () => {
    process.env['LUSHA_MAX_CANDIDATES_PER_RUN'] = '3';

    const contacts = Array.from({ length: 10 }, (_, i) => prospectingPerson(`v1.k${i}`, `Persona${i}`));
    const known = contacts.map((c) => knownRow(c.id, 'lusha', { accountId: ACCOUNT_A }));

    const { router } = await runLusha({ contacts, known });

    // Los 10 quedan contados como conocidos (veraz)...
    const usageRow = router
      .usageLogRows()
      .find((row) => row['operation_key'] === 'lusha_contact_prospecting');
    const metadata = usageRow?.['metadata'] as Record<string, unknown> | undefined;
    const novelty = metadata?.['provider_identity_novelty'] as Record<string, unknown> | undefined;
    assert.equal(novelty?.['skipped_known_provider_identity_count'], 10);
    assert.equal(novelty && 'avoided_paid_provider_calls_count' in novelty, false);

    // ...pero ni una sola llamada real de enrich ocurrió (trivialmente cierto:
    // los 10 eran conocidos).
    assert.deepEqual(router.enrichCalls(), []);

    // La prueba del contrafactual: con el MISMO conjunto tratado como NOVEDOSO
    // (sin gate), el tope maxCandidates=3 por sí solo limita el enrich pagado a
    // 3 — nunca a 10. Afirmar "10 llamadas evitadas" habría sobreestimado el
    // ahorro real por 7.
    const { router: novelRouter } = await runLusha({ contacts, known: [] });
    assert.equal(
      enrichedIds(novelRouter).length,
      3,
      'maxCandidates por sí solo acota el enrich pagado a 3, independientemente del gate',
    );
  });

  it('COUNTERFACTUAL 4 — contactId conocido sin email revelable: nunca habría llegado a enrich, con o sin gate', async () => {
    const nonRevealableKnown = prospectingPersonNoEmail('v1.norev-known', 'Ana');
    const nonRevealableNovel = prospectingPersonNoEmail('v1.norev-novel', 'Beto');

    // Contrafactual primero: el MISMO perfil, NOVEDOSO (no conocido), tampoco
    // llega a /v3/contacts/enrich — el runner lo salta por falta de email
    // revelable antes de llamar al proveedor.
    const { router: novelRouter } = await runLusha({ contacts: [nonRevealableNovel] });
    assert.deepEqual(
      enrichedIds(novelRouter),
      [],
      'sin campo de email revelable, ni un contacto NOVEDOSO llega al enrich',
    );

    const { router, result } = await runLusha({
      contacts: [nonRevealableKnown],
      known: [knownRow('v1.norev-known', 'lusha', { accountId: ACCOUNT_A })],
    });

    assert.deepEqual(router.enrichCalls(), []);
    assert.equal(result.candidatesCreated, 0);

    const usageRow = router
      .usageLogRows()
      .find((row) => row['operation_key'] === 'lusha_contact_prospecting');
    const metadata = usageRow?.['metadata'] as Record<string, unknown> | undefined;
    const novelty = metadata?.['provider_identity_novelty'] as Record<string, unknown> | undefined;
    assert.equal(novelty?.['skipped_known_provider_identity_count'], 1);
    assert.equal(
      novelty && 'avoided_paid_provider_calls_count' in novelty,
      false,
      'un contacto que nunca habría sido revelable no puede contarse como llamada evitada',
    );
  });
});
