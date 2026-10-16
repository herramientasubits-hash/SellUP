/**
 * Agente 1 · «Competidores de una empresa» — hallazgos de la auditoría 16-10.
 *
 *   7 · filtro previo al juez: etiqueta del dominio, número fiscal y grupo (árbol, 148);
 *   I · competidores de UBITS fuera de la capa gratuita, el banco/HubSpot y Apollo;
 *   J · el ID de la referencia también se lee de `accounts[]` (transporte falso);
 *   K · `competitor_selection.judged` = lo que el juez juzgó de verdad;
 *   L · página de Apollo con tope de espera: cobro DESCONOCIDO, sin repetir ni seguir.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { CompetitorReference } from '@/modules/prospect-batches/competitor-search/competitor-reference';
import type { CompetitorJudgeInput, CompetitorJudgeOutcome } from '@/server/agents/prospecting-toolkit/claude-classifier/competitor-judge';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import type { ApolloOrganizationsPageResponse } from '@/server/integrations/apollo-client';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import {
  buildCompetitorReferenceExclusion,
  competitorPrefilterReason,
  EMPTY_COMPETITOR_REFERENCE_EXCLUSION,
  isReferenceItself,
  isUbitsCompetitorCompany,
  loadCompetitorReferenceExclusion,
  selectCompetitorBankCandidates,
  selectCompetitorCompanies,
  tallyCompetitorJudge,
  withRealCompetitorJudgedCount,
  type CompetitorJudgeTally,
  type CompetitorPrefilterReason,
  type CompetitorReferenceExclusionReader,
  type CompetitorReferenceRelationshipRow,
} from '../competitor-free-sources';
import {
  runCompetitorApolloStep,
  toCompetitorApolloJudgeItems,
  type CompetitorApolloPage,
  type CompetitorApolloStepDeps,
} from '../competitor-apollo';
import {
  readCompetitorApolloPage,
  searchCompetitorApolloPageWithTimeout,
  toCompetitorApolloPage,
} from '../competitor-apollo.server';

const REFERENCE: CompetitorReference = {
  name: 'Alpina',
  domain: 'alpina.com',
  description: 'Lácteos',
  accountId: '11111111-2222-4333-8444-555555555555',
  keywords: ['dairy products'],
  homeCountryCode: 'CO',
};

const CONTEXT = { reference: REFERENCE, countryName: 'Colombia', industryName: 'Consumo masivo' };

function company(n: number, extra: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: `r${n}`,
    legalName: `Empresa ${n}`,
    normalizedLegalName: null,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'CO',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Lácteos',
    industryCode: null,
    ...extra,
  } as CountrySourceCompany;
}

function recordingJudge(judgedOverride?: number) {
  const seen: CompetitorJudgeInput[] = [];
  const judge = async (input: CompetitorJudgeInput): Promise<CompetitorJudgeOutcome | null> => {
    seen.push(input);
    return {
      competitors: input.items.map((item) => ({ key: item.key, reason: 'lácteos' })),
      judged: judgedOverride ?? input.items.length,
      usage: null,
      errorCode: null,
    };
  };
  return { judge, seen };
}

function counter() {
  const counts: Partial<Record<CompetitorPrefilterReason, number>> = {};
  return {
    counts,
    onPrefiltered: (reason: CompetitorPrefilterReason) => {
      counts[reason] = (counts[reason] ?? 0) + 1;
    },
  };
}

// ── 7 — filtro previo ─────────────────────────────────────────────────────────

describe('7 — la referencia y su grupo no llegan al juez', () => {
  it('7a: un dominio que ES el nombre de la referencia (regla de company-search), y sus subdominios', () => {
    const ecopetrol = { name: 'Ecopetrol S.A.', domain: null };
    assert.equal(isReferenceItself(ecopetrol, { name: 'Otra razón social', domain: 'ecopetrol.com.co' }), true);
    assert.equal(isReferenceItself(REFERENCE, { name: 'Otra', domain: 'portal.alpina.com' }), true);
    assert.equal(isReferenceItself({ name: 'Grupo Éxito', domain: null }, { name: 'X', domain: 'grupoexito.com.co' }), true);
    assert.equal(isReferenceItself({ name: 'Grupo Éxito', domain: null }, { name: 'X', domain: 'www.exito.com' }), true);
    // Ni parecidos ni alojamientos compartidos.
    assert.equal(isReferenceItself(REFERENCE, { name: 'Alumina', domain: 'alumina.com' }), false);
    assert.equal(isReferenceItself({ name: 'Mi Tienda', domain: 'mitienda.blogspot.com' }, { name: 'Otra', domain: 'blogspot.com' }), false);
  });

  it('7b: mismo número fiscal (normalizado, mismo país) ⇒ fuera; otro país ⇒ no compara', () => {
    const exclusion = buildCompetitorReferenceExclusion({
      reference: REFERENCE,
      taxIds: [{ taxId: 'NIT 860.025.900-2', countryCode: 'CO' }],
      relationships: [],
    });
    assert.equal(
      competitorPrefilterReason(REFERENCE, { name: 'Productos Alimenticios del Valle', domain: null, taxId: '860025900', countryCode: 'CO' }, exclusion),
      'reference_tax_id',
    );
    assert.equal(
      competitorPrefilterReason(REFERENCE, { name: 'Otra', domain: null, taxId: '860025900', countryCode: 'MX' }, exclusion),
      null,
    );
    assert.equal(competitorPrefilterReason(REFERENCE, { name: 'Otra', domain: null, taxId: null, countryCode: 'CO' }, exclusion), null);
  });

  it('7c: el árbol (148) — filiales de la referencia, su matriz y las hermanas salen; la referencia no se repite', () => {
    const rows: CompetitorReferenceRelationshipRow[] = [
      { root_name: 'Alpina', root_domain: 'alpina.com', root_account_id: null, related_name: 'Alpina Ecuador', related_domain: 'alpina.com.ec' },
      { root_name: 'Grupo Lácteo Andino', root_domain: 'grupolacteo.com', root_account_id: null, related_name: 'Alpina', related_domain: 'alpina.com' },
      { root_name: 'Grupo Lácteo Andino', root_domain: 'grupolacteo.com', root_account_id: null, related_name: 'Quesos del Norte', related_domain: 'quesosnorte.co' },
      { root_name: 'Nada que ver', root_domain: 'otra.com', root_account_id: null, related_name: 'Filial ajena', related_domain: 'ajena.com' },
    ];
    const exclusion = buildCompetitorReferenceExclusion({ reference: REFERENCE, taxIds: [], relationships: rows });
    assert.deepEqual([...exclusion.relatedDomains].sort(), ['alpina.com.ec', 'grupolacteo.com', 'quesosnorte.co']);
    assert.equal(exclusion.relatedNames.has('alpina'), false);
    assert.equal(competitorPrefilterReason(REFERENCE, { name: 'QDN', domain: 'www.quesosnorte.co' }, exclusion), 'reference_group');
    assert.equal(competitorPrefilterReason(REFERENCE, { name: 'Quesos del Norte S.A.S.', domain: null }, exclusion), 'reference_group');
    assert.equal(competitorPrefilterReason(REFERENCE, { name: 'Filial ajena', domain: 'ajena.com' }, exclusion), null);
  });

  it('7d: la carga lee cuenta y árbol UNA vez; si el árbol falla, sólo se apaga esa regla', async () => {
    const calls: string[] = [];
    const reader: CompetitorReferenceExclusionReader = {
      readAccountTaxId: async (id) => {
        calls.push(`account:${id}`);
        return { taxId: '860025900-2', countryCode: 'CO' };
      },
      readRelationships: async () => {
        calls.push('relationships');
        throw new Error('relation "agent1_company_relationships" does not exist');
      },
      readRelationshipsByRootDomains: async () => {
        calls.push('roots');
        return [];
      },
    };
    const loaded = await loadCompetitorReferenceExclusion(REFERENCE, reader, { withAccountTaxId: true });
    assert.deepEqual(calls, [`account:${REFERENCE.accountId}`, 'relationships']);
    assert.equal(loaded.telemetry.relationships, 'read_failed');
    assert.equal(loaded.telemetry.account_tax_id, 'found');
    assert.deepEqual([...loaded.exclusion.taxKeys], ['CO:860025900']);
    assert.equal(loaded.exclusion.relatedDomains.size, 0);
  });

  it('7e: una cuenta que no es UUID no viaja a la consulta; sin dominio ni cuenta no se lee el árbol', async () => {
    const filters: Array<{ domain: string | null; accountId: string | null }> = [];
    const reader: CompetitorReferenceExclusionReader = {
      readAccountTaxId: async () => {
        throw new Error('no debería leerse');
      },
      readRelationships: async (filter) => {
        filters.push(filter);
        return [];
      },
      readRelationshipsByRootDomains: async () => [],
    };
    await loadCompetitorReferenceExclusion({ ...REFERENCE, accountId: "x'),or(1.eq.1" }, reader, { withAccountTaxId: true });
    assert.deepEqual(filters, [{ domain: 'alpina.com', accountId: null }]);
    const none = await loadCompetitorReferenceExclusion({ name: 'Alpina', domain: null, accountId: null }, reader);
    assert.equal(none.telemetry.relationships, 'no_reference_key');
  });

  it('7f: catálogo — la referencia con otro nombre (mismo NIT) y su filial no se ofrecen', async () => {
    const exclusion = buildCompetitorReferenceExclusion({
      reference: REFERENCE,
      taxIds: [{ taxId: '860025900', countryCode: 'CO' }],
      relationships: [
        { root_name: 'Alpina', root_domain: 'alpina.com', root_account_id: null, related_name: 'Alpina Venezuela', related_domain: null },
      ],
    });
    const { judge, seen } = recordingJudge();
    const count = counter();
    const picked = await selectCompetitorCompanies(
      [
        company(1, { legalName: 'Productos Alimenticios Alpina S.A. BIC', taxId: '860.025.900-2' }),
        company(2, { legalName: 'Alpina Venezuela S.A.' }),
        company(3, { legalName: 'Colanta' }),
      ],
      CONTEXT,
      judge,
      { exclusion, onPrefiltered: count.onPrefiltered },
    );
    assert.deepEqual(seen[0].items.map((i) => i.name), ['Colanta']);
    assert.deepEqual(picked?.map((c) => c.legalName), ['Colanta']);
    assert.deepEqual(count.counts, { reference_tax_id: 1, reference_group: 1 });
  });
});

// ── I — competidores de UBITS ─────────────────────────────────────────────────

describe('I — los competidores de UBITS nunca llegan al juez', () => {
  it('I1: por dominio o por nombre exacto; palabras sueltas no', () => {
    assert.equal(isUbitsCompetitorCompany({ name: 'Lo que sea', domain: 'crehana.com' }), true);
    assert.equal(isUbitsCompetitorCompany({ name: 'Platzi S.A.S.', domain: null }), true);
    assert.equal(isUbitsCompetitorCompany({ name: 'Cornerstone OnDemand', domain: null }), true);
    assert.equal(isUbitsCompetitorCompany({ name: 'Academia de Idiomas', domain: 'academia.edu.co' }), false);
    assert.equal(isUbitsCompetitorCompany({ name: 'Universidad de los Andes', domain: 'uniandes.edu.co' }), false);
  });

  it('I2: capa gratuita, banco/HubSpot y Apollo los sacan (con su motivo)', async () => {
    const free = recordingJudge();
    const freeCount = counter();
    await selectCompetitorCompanies(
      [company(1, { legalName: 'Platzi S.A.S.' }), company(2, { legalName: 'Colanta', domain: 'colanta.com.co' })],
      CONTEXT,
      free.judge,
      { onPrefiltered: freeCount.onPrefiltered },
    );
    assert.deepEqual(free.seen[0].items.map((i) => i.name), ['Colanta']);
    assert.deepEqual(freeCount.counts, { ubits_competitor: 1 });

    const bank = recordingJudge();
    const candidates = [
      { name: 'Coursera', domain: 'coursera.org', countryCode: 'CO', sourceSnippet: 'cursos' },
      { name: 'Alquería', domain: 'alqueria.com.co', countryCode: 'CO', sourceSnippet: 'lácteos' },
    ] as unknown as ProspectingPipelineCandidate[];
    const picked = await selectCompetitorBankCandidates(candidates, CONTEXT, bank.judge);
    assert.deepEqual(bank.seen[0].items.map((i) => i.name), ['Alquería']);
    assert.deepEqual(picked?.map((p) => p.index), [1]);

    const apollo = toCompetitorApolloJudgeItems(
      [
        { id: 'o1', name: 'Udemy', primary_domain: 'udemy.com' },
        { id: 'o2', name: 'Colanta', primary_domain: 'colanta.com.co' },
      ],
      REFERENCE,
      [],
    );
    assert.deepEqual(apollo.items.map((i) => i.name), ['Colanta']);
  });

  it('I3: aunque la referencia sea un competidor de UBITS (Crehana), sus parecidas de la lista siguen fuera', () => {
    const crehana = { name: 'Crehana', domain: 'crehana.com' };
    const { items } = toCompetitorApolloJudgeItems(
      [
        { id: 'o1', name: 'Platzi', primary_domain: 'platzi.com' },
        { id: 'o2', name: 'Escuela Nueva Online', primary_domain: 'escuelanueva.co' },
      ],
      crehana,
      [],
    );
    assert.deepEqual(items.map((i) => i.name), ['Escuela Nueva Online']);
  });
});

// ── J — el ID de la referencia desde accounts[] ──────────────────────────────

/** Transporte falso de Apollo (en lugar de `fetch`): devuelve la respuesta tal cual. */
function fakeTransport(payloadByPurpose: Record<'resolve' | 'lookalikes' | 'keywords', unknown>) {
  const bodies: Record<string, unknown>[] = [];
  const search = async (body: Record<string, unknown>): Promise<ApolloOrganizationsPageResponse> => {
    bodies.push(body);
    const purpose = 'q_organization_domains_list' in body ? 'resolve' : 'lookalike_organization_ids' in body ? 'lookalikes' : 'keywords';
    return {
      ok: true,
      status: 200,
      requestSent: true,
      malformedBody: false,
      timedOut: false,
      payload: payloadByPurpose[purpose],
      headers: null,
    };
  };
  return { search, bodies };
}

function stepDeps(searchPage: CompetitorApolloStepDeps['searchPage'], overrides: Partial<CompetitorApolloStepDeps> = {}) {
  const logged: CompetitorApolloPage[] = [];
  const deps: CompetitorApolloStepDeps = {
    isEnabled: () => true,
    checkQuota: async () => ({ allowed: true }),
    resolveLocation: () => 'Colombia',
    loadExcludedDomains: async () => [],
    searchPage,
    logUsage: async ({ page }) => {
      logged.push(page);
    },
    judge: async (input) => ({
      competitors: input.items.map((i) => ({ key: i.key, reason: 'lácteos' })),
      judged: input.items.length,
      usage: null,
      errorCode: null,
    }),
    writeCandidates: async (picks) => ({ persistedCount: picks.length, completeValidCandidates: picks.length, errors: [] }),
    nowMs: () => 0,
    ...overrides,
  };
  return { deps, logged };
}

const STEP_INPUT = { reference: REFERENCE, countryCode: 'CO', countryName: 'Colombia', industryName: 'Consumo masivo' };

describe('J — la referencia guardada en el workspace (sólo en accounts[])', () => {
  it('J1: se lee su `organization_id` (nunca `accounts[*].id`) y no entra a lo que ve el juez', () => {
    const page = readCompetitorApolloPage({
      organizations: [],
      accounts: [
        { id: 'acct-1', organization_id: 'org-alpina', name: 'Alpina', primary_domain: 'alpina.com' },
        { id: 'acct-2', name: 'Sin organización', primary_domain: 'sinorg.com' },
      ],
    });
    assert.deepEqual(page.organizations, []);
    assert.deepEqual(page.accountOrganizations?.map((o) => [o.id, o.primary_domain]), [['org-alpina', 'alpina.com']]);
    assert.equal(page.rawCount, 2);
  });

  it('J2: con el ID de accounts[] se piden las parecidas; no se paga la consulta por palabras clave', async () => {
    const transport = fakeTransport({
      resolve: { organizations: [], accounts: [{ id: 'acct-1', organization_id: 'org-alpina', name: 'Alpina', primary_domain: 'alpina.com' }] },
      lookalikes: { organizations: [{ id: 'o9', name: 'Colanta', primary_domain: 'colanta.com.co' }] },
      keywords: { organizations: [{ id: 'k1', name: 'Por palabras', primary_domain: 'palabras.co' }] },
    });
    const { deps } = stepDeps(async (body) =>
      toCompetitorApolloPage(await searchCompetitorApolloPageWithTimeout(body, transport.search, 1_000)),
    );
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'written');
    assert.equal(outcome.telemetry.reference_apollo_id, 'org-alpina');
    assert.equal(outcome.telemetry.reference_apollo_id_source, 'accounts');
    assert.equal(outcome.telemetry.strategy, 'lookalikes');
    assert.deepEqual(transport.bodies[1].lookalike_organization_ids, ['org-alpina']);
    assert.equal(transport.bodies.length, 2, 'sin tercera página (palabras clave)');
  });
});

// ── K — judged real ───────────────────────────────────────────────────────────

describe('K — telemetría: lo que el juez juzgó de verdad', () => {
  it('K1: `judged` sale del juez (tope de lotes, sin filtradas); lo aceptado por la puerta queda aparte', async () => {
    const tally: CompetitorJudgeTally = {};
    const inner = recordingJudge(80);
    const judge = tallyCompetitorJudge(tally, 'free_layer', inner.judge);
    const companies = [company(0, { legalName: 'Alpina S.A.' }), ...Array.from({ length: 100 }, (_, i) => company(i + 1))];
    await selectCompetitorCompanies(companies, CONTEXT, judge);
    assert.deepEqual(tally.free_layer, { calls: 1, offered: 100, judged: 80, selected: 100, unanswered: 0 });
    const fixed = withRealCompetitorJudgedCount(
      { competitor_selection: { judged: 101, selected: 100 }, other: 1 },
      tally,
    );
    assert.deepEqual(fixed, { competitor_selection: { judged: 80, selected: 100, accepted_by_gate: 101, offered: 100 }, other: 1 });
  });

  it('K2: juez sin respuesta ⇒ judged 0 y la llamada cuenta como sin respuesta; sin bloque no se toca nada', async () => {
    const tally: CompetitorJudgeTally = {};
    const judge = tallyCompetitorJudge(tally, 'free_layer', async () => null);
    assert.equal(await selectCompetitorCompanies([company(1)], CONTEXT, judge), null);
    assert.deepEqual(tally.free_layer, { calls: 1, offered: 1, judged: 0, selected: 0, unanswered: 1 });
    const untouched = { status: 'x' };
    assert.equal(withRealCompetitorJudgedCount(untouched, tally), untouched);
  });
});

// ── L — tope de espera y cobro desconocido ────────────────────────────────────

describe('L — Apollo con tope de espera: cobro desconocido, sin repetir', () => {
  it('L1: la página que no vuelve a tiempo ⇒ timedOut + requestSent ⇒ cobro desconocido', async () => {
    const never = () => new Promise<ApolloOrganizationsPageResponse>(() => undefined);
    const result = await searchCompetitorApolloPageWithTimeout({ page: 1 }, never, 5);
    assert.equal(result.timedOut, true);
    assert.equal(result.requestSent, true);
    const page = toCompetitorApolloPage(result);
    assert.equal(page.ok, false);
    assert.equal(page.billingUnknown, true);
  });

  it('L2: un transporte que lanza y un 2xx ilegible también son cobro desconocido; un 422 no', async () => {
    const thrown = await searchCompetitorApolloPageWithTimeout({}, async () => {
      throw new Error('socket hang up');
    });
    assert.equal(toCompetitorApolloPage(thrown).billingUnknown, true);
    const malformed: ApolloOrganizationsPageResponse = {
      ok: true, status: 200, requestSent: true, malformedBody: true, timedOut: false, payload: undefined, headers: null,
    };
    assert.equal(toCompetitorApolloPage(malformed).billingUnknown, true);
    const invalid: ApolloOrganizationsPageResponse = {
      ok: false, status: 422, requestSent: true, malformedBody: false, timedOut: false, payload: undefined, headers: null, errorBody: 'bad',
    };
    const page = toCompetitorApolloPage(invalid);
    assert.equal(page.billingUnknown, undefined);
    assert.equal(page.error, 'bad');
  });

  it('L3: el paso se detiene al primer cobro desconocido: ni palabras clave ni juez, y no afirma 0 créditos', async () => {
    let judged = 0;
    const requested: Record<string, unknown>[] = [];
    const { deps, logged } = stepDeps(
      async (body) => {
        requested.push(body);
        return toCompetitorApolloPage(
          await searchCompetitorApolloPageWithTimeout(body, () => new Promise(() => undefined), 5),
        );
      },
      {
        judge: async () => {
          judged += 1;
          return null;
        },
      },
    );
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'apollo_billing_indeterminate');
    assert.equal(requested.length, 1, 'no se repite ni se cae a palabras clave');
    assert.equal(judged, 0);
    assert.equal(logged.length, 1, 'la página queda registrada');
    assert.equal(outcome.telemetry.credits_charged, null);
    assert.equal(outcome.telemetry.credits_unknown_pages, 1);
    assert.equal(outcome.telemetry.credits_charged_known, 0);
  });

  it('L4: el grupo de la referencia sale de la consulta y del juez; si la carga falla, el paso sigue', async () => {
    const requested: Record<string, unknown>[] = [];
    const page: CompetitorApolloPage = {
      ok: true,
      organizations: [
        { id: 'o1', name: 'Alpina Ecuador', primary_domain: 'alpina.com.ec' },
        { id: 'o2', name: 'Colanta', primary_domain: 'colanta.com.co' },
      ],
      rawCount: 2,
      error: null,
    };
    const { deps } = stepDeps(
      async (body) => {
        requested.push(body);
        return 'q_organization_domains_list' in body ? { ...page, organizations: [], rawCount: 0 } : page;
      },
      {
        loadReferenceExclusion: async () => ({
          exclusion: { ...EMPTY_COMPETITOR_REFERENCE_EXCLUSION, relatedDomains: new Set(['alpina.com.ec']) },
          telemetry: { relationships: 'found' },
        }),
      },
    );
    const outcome = await runCompetitorApolloStep(STEP_INPUT, deps);
    assert.ok((requested[1].not_organization_websites_list as string[]).includes('alpina.com.ec'));
    // Si Apollo igual la devuelve, sale antes del juez (como una ya vista).
    assert.equal(outcome.telemetry.offered_to_judge, 1);
    assert.equal(outcome.telemetry.selected, 1);
    // Por nombre (sin dominio), la regla del grupo del filtro previo.
    const byName = toCompetitorApolloJudgeItems(
      [{ id: 'o3', name: 'Alpina Ecuador', primary_domain: null }],
      REFERENCE,
      [],
      {
        exclusion: { ...EMPTY_COMPETITOR_REFERENCE_EXCLUSION, relatedNames: new Set(['alpina ecuador']) },
      },
    );
    assert.equal(byName.items.length, 0);

    const failing = stepDeps(async () => page, {
      loadReferenceExclusion: async () => {
        throw new Error('db down');
      },
    });
    const still = await runCompetitorApolloStep(STEP_INPUT, failing.deps);
    assert.deepEqual(still.telemetry.reference_exclusion, { status: 'load_failed' });
    assert.notEqual(still.status, 'failed');
  });

  it('L5: guardas — el registro de uso deja NULL (no 0) con cobro desconocido y la espera tiene nombre', () => {
    const live = readFileSync(new URL('../competitor-apollo.server.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.match(live, /const credits = page\.billingUnknown \? undefined :/);
    assert.match(live, /estimated_cost_usd: credits === undefined \? null :/);
    assert.match(live, /APOLLO_OPERATION_INDETERMINATE_ERROR_CODE/);
    assert.match(live, /export const COMPETITOR_APOLLO_PAGE_TIMEOUT_MS = \d/);
    assert.match(live, /searchPage: async \(body\) => toCompetitorApolloPage\(await searchCompetitorApolloPageWithTimeout\(body\)\)/);
  });
});
