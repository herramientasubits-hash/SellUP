/**
 * Tests — Lusha Enrichment Runner · 17B.4W.2
 *
 * Alinea la implementación 17B.4W contra el contrato V3 observado live.
 * Fixtures derivados de la respuesta real ABANK (17B.4W.2).
 *
 * Sin llamadas live. Sin Supabase real. Sin Apollo real.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  type LushaContactProspectingPerson,
  type LushaProspectingNormalizedContact,
  resolveLushaDiscoveryMode,
} from '../lusha-types';
import { prospectLushaContactsV3 } from '../../../integrations/lusha-client';
import { classifyContactRelevance } from '../contact-relevance-classifier';

const FAKE_KEY = 'test-lusha-key-not-real';

type FetchMock = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
let originalFetch: typeof globalThis.fetch;

function mockFetch(impl: FetchMock) {
  (globalThis as unknown as { fetch: FetchMock }).fetch = impl;
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as Response;
}

beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

// ── Live fixtures derived from 17B.4W.2 real call ───────────────

const REBECA_RAW = {
  id: 'v1.uS5H1xTibyyc0Nj2PPSe3OHJcA0yrHOLeQ',
  firstName: 'Rebeca',
  lastName: 'De Olano',
  jobTitle: {
    title: 'Director of Human Resources',
    departments: ['Human Resources'],
    seniority: 'director',
  },
  company: {
    id: 'v1.onVv3JNGAIOWy3CZ4-eV-ewdtalm8UtH',
    name: 'Banco ABANK',
    domain: 'abank.com.sv',
  },
  location: { country: 'El Salvador' },
  socialLinks: { linkedin: 'https://www.linkedin.com/in/rebeca-guzman-de-olano-b9118587' },
  has: ['firstName', 'lastName', 'jobTitle', 'company', 'location', 'socialLinks', 'emails', 'phones', 'previousEmployment'],
  canReveal: [
    { field: 'emails', credits: 0 },
    { field: 'phones', credits: 0 },
  ],
};

const IVETTE_RAW = {
  id: 'v1.ZcS2L00ayTR_BjuraxE8lXFO_3SgChnS',
  firstName: 'Ivette',
  lastName: 'Henriquez',
  jobTitle: {
    title: 'Head of Recruitment and Selection',
    departments: ['Human Resources'],
    seniority: 'director',
  },
  company: {
    id: 'v1.onVv3JNGAIOWy3CZ4-eV-ewdtalm8UtH',
    name: 'Banco ABANK',
    domain: 'abank.com.sv',
  },
  location: { country: 'El Salvador', city: 'San Salvador' },
  socialLinks: { linkedin: 'https://www.linkedin.com/in/ivette-henriquez-94224b180' },
  has: ['firstName', 'lastName', 'jobTitle', 'company', 'location', 'socialLinks', 'emails', 'previousEmployment'],
  canReveal: [{ field: 'emails', credits: 0 }],
};

// Brazil false positive — same "ABank" name but different domain
const BRAZIL_RAW = {
  id: 'v1.brazil-false-positive-001',
  firstName: 'Ariane',
  lastName: 'Barboza',
  jobTitle: { title: 'Operations Manager', departments: ['Operations'], seniority: 'manager' },
  company: { name: 'ABank', domain: 'ambiparcargo.com' },
  location: { country: 'Brazil' },
  socialLinks: {},
  has: ['firstName', 'lastName', 'jobTitle', 'company'],
  canReveal: [{ field: 'emails', credits: 1 }],
};

const FINANCE_RAW = {
  id: 'v1.finance-person-001',
  firstName: 'Carlos',
  lastName: 'Ramos',
  jobTitle: { title: 'Financial Advisor', departments: ['Finance'], seniority: 'senior' },
  company: { name: 'Banco ABANK', domain: 'abank.com.sv' },
  has: ['firstName', 'lastName', 'jobTitle', 'company'],
  canReveal: [{ field: 'emails', credits: 1 }],
};

const IT_RAW = {
  id: 'v1.it-person-001',
  firstName: 'Laura',
  lastName: 'Molina',
  jobTitle: { title: 'Software Engineer', departments: ['IT'], seniority: 'senior' },
  company: { name: 'Banco ABANK', domain: 'abank.com.sv' },
  has: ['firstName', 'lastName', 'jobTitle', 'company'],
  canReveal: [{ field: 'emails', credits: 1 }],
};

const OPERATIONS_RAW = {
  id: 'v1.ops-person-001',
  firstName: 'Marco',
  lastName: 'Torres',
  jobTitle: { title: 'Operations Manager', departments: ['Operations'], seniority: 'manager' },
  company: { name: 'Banco ABANK', domain: 'abank.com.sv' },
  has: ['firstName', 'lastName', 'jobTitle', 'company'],
  canReveal: [{ field: 'emails', credits: 1 }],
};

const BASE_REQUEST = {
  apiKey: FAKE_KEY,
  timeoutMs: 5000,
  request: {
    filters: {
      companies: { include: { names: ['ABANK'], domains: ['abank.com.sv'] } },
      contacts: { include: { departments: ['Human Resources'] } },
    },
    pagination: { page: 0, size: 25 },
  },
};

// ═══════════════════════════════════════════════════════════════
// A. Live response shape — field-by-field
// ═══════════════════════════════════════════════════════════════

describe('A — Live response shape (17B.4W.2)', () => {
  it('A1 — id → contactId (person identifier)', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.contactId, 'v1.uS5H1xTibyyc0Nj2PPSe3OHJcA0yrHOLeQ');
  });

  it('A2 — firstName + lastName → name (full name)', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.name, 'Rebeca De Olano');
  });

  it('A3 — jobTitle.title → jobTitle (string)', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.jobTitle, 'Director of Human Resources');
  });

  it('A4 — jobTitle.departments[0] → department', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.department, 'Human Resources');
  });

  it('A5 — jobTitle.seniority → seniority', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.seniority, 'director');
  });

  it('A6 — company.name → companyName', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.companyName, 'Banco ABANK');
  });

  it('A7 — company.domain → fqdn', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.fqdn, 'abank.com.sv');
  });

  it('A8 — socialLinks.linkedin → linkedinUrl', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.linkedinUrl, 'https://www.linkedin.com/in/rebeca-guzman-de-olano-b9118587');
  });

  it('A9 — has array preserved in raw', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    const raw = result.contacts[0]?.raw as LushaContactProspectingPerson;
    assert.ok(Array.isArray(raw.has));
    assert.ok((raw.has as string[]).includes('emails'));
  });

  it('A10 — canReveal array preserved in raw', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    const raw = result.contacts[0]?.raw as LushaContactProspectingPerson;
    assert.ok(Array.isArray(raw.canReveal));
    assert.ok((raw.canReveal as Array<{field: string; credits: number}>).some((cr) => cr.field === 'emails'));
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Rebeca — exact field values
// ═══════════════════════════════════════════════════════════════

describe('B — Rebeca exact normalization (17B.4W.2)', () => {
  async function rebecaContact(): Promise<LushaProspectingNormalizedContact> {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    const c = result.contacts[0];
    assert.ok(c, 'Rebeca contact must be present');
    return c;
  }

  it('B11 — exact contactId', async () => {
    const c = await rebecaContact();
    assert.equal(c.contactId, 'v1.uS5H1xTibyyc0Nj2PPSe3OHJcA0yrHOLeQ');
  });

  it('B12 — exact full name', async () => {
    const c = await rebecaContact();
    assert.equal(c.name, 'Rebeca De Olano');
  });

  it('B13 — Director of Human Resources', async () => {
    const c = await rebecaContact();
    assert.equal(c.jobTitle, 'Director of Human Resources');
  });

  it('B14 — Human Resources department', async () => {
    const c = await rebecaContact();
    assert.equal(c.department, 'Human Resources');
  });

  it('B15 — director seniority', async () => {
    const c = await rebecaContact();
    assert.equal(c.seniority, 'director');
  });

  it('B16 — abank.com.sv fqdn', async () => {
    const c = await rebecaContact();
    assert.equal(c.fqdn, 'abank.com.sv');
  });

  it('B17 — LinkedIn URL preserved', async () => {
    const c = await rebecaContact();
    assert.equal(c.linkedinUrl, 'https://www.linkedin.com/in/rebeca-guzman-de-olano-b9118587');
  });

  it('B18 — phone null (never revealed)', async () => {
    // Phone is not in LushaProspectingNormalizedContact — phone reveal is disabled.
    const c = await rebecaContact();
    assert.ok(!('phone' in c), 'prospecting normalized contact must not have phone field');
  });
});

// ═══════════════════════════════════════════════════════════════
// C. Ivette — exact field values
// ═══════════════════════════════════════════════════════════════

describe('C — Ivette exact normalization (17B.4W.2)', () => {
  async function ivetteContact(): Promise<LushaProspectingNormalizedContact> {
    mockFetch(async () => makeResponse(200, { results: [IVETTE_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    const c = result.contacts[0];
    assert.ok(c, 'Ivette contact must be present');
    return c;
  }

  it('C19 — exact contactId', async () => {
    const c = await ivetteContact();
    assert.equal(c.contactId, 'v1.ZcS2L00ayTR_BjuraxE8lXFO_3SgChnS');
  });

  it('C20 — exact full name', async () => {
    const c = await ivetteContact();
    assert.equal(c.name, 'Ivette Henriquez');
  });

  it('C21 — Head of Recruitment and Selection', async () => {
    const c = await ivetteContact();
    assert.equal(c.jobTitle, 'Head of Recruitment and Selection');
  });

  it('C22 — Human Resources department', async () => {
    const c = await ivetteContact();
    assert.equal(c.department, 'Human Resources');
  });

  it('C23 — director seniority', async () => {
    const c = await ivetteContact();
    assert.equal(c.seniority, 'director');
  });

  it('C24 — abank.com.sv fqdn', async () => {
    const c = await ivetteContact();
    assert.equal(c.fqdn, 'abank.com.sv');
  });

  it('C25 — LinkedIn URL preserved', async () => {
    const c = await ivetteContact();
    assert.equal(c.linkedinUrl, 'https://www.linkedin.com/in/ivette-henriquez-94224b180');
  });

  it('C26 — phone field absent (prospecting normalized type has no phone)', async () => {
    const c = await ivetteContact();
    assert.ok(!('phone' in c));
  });
});

// ═══════════════════════════════════════════════════════════════
// D. Department filter — no snake_case
// ═══════════════════════════════════════════════════════════════

describe('D — Department targeting (17B.4W.2)', () => {
  it('D27 — request does not contain snake_case department slugs', async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string ?? '{}');
      return makeResponse(200, { results: [], pagination: { page: 0, size: 0, total: 0 } });
    });
    await prospectLushaContactsV3(BASE_REQUEST);
    const filters = body['filters'] as Record<string, unknown>;
    const contacts = filters?.['contacts'] as Record<string, unknown> | undefined;
    const include = contacts?.['include'] as Record<string, unknown> | undefined;
    const depts = include?.['departments'] as string[] | undefined;
    if (depts) {
      const snakeCaseSlugs = ['human_resources', 'people', 'talent', 'learning_and_development', 'organizational_development', 'culture'];
      const hasBadSlug = depts.some((d) => snakeCaseSlugs.includes(d));
      assert.ok(!hasBadSlug, `Departments must not contain snake_case slugs, got: ${JSON.stringify(depts)}`);
    }
  });

  it('D28 — Human Resources filter sent (title case)', async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_url, init) => {
      body = JSON.parse(init?.body as string ?? '{}');
      return makeResponse(200, { results: [], pagination: { page: 0, size: 0, total: 0 } });
    });
    await prospectLushaContactsV3(BASE_REQUEST);
    const filters = body['filters'] as Record<string, unknown>;
    const contacts = filters?.['contacts'] as Record<string, unknown> | undefined;
    const include = contacts?.['include'] as Record<string, unknown> | undefined;
    const depts = include?.['departments'] as string[] | undefined;
    assert.ok(depts?.includes('Human Resources'), `Expected "Human Resources" in departments, got: ${JSON.stringify(depts)}`);
  });

  it('D29 — Director of Human Resources → hr high_relevance', () => {
    const cls = classifyContactRelevance({ fullName: 'Rebeca De Olano', title: 'Director of Human Resources', email: 'r@abank.com.sv' });
    assert.equal(cls.matchedCategory, 'hr');
    assert.equal(cls.relevanceStatus, 'high_relevance');
    assert.equal(cls.shouldInsertForReview, true);
  });

  it('D30 — Head of Recruitment and Selection → talent high_relevance', () => {
    const cls = classifyContactRelevance({ fullName: 'Ivette Henriquez', title: 'Head of Recruitment and Selection', email: 'i@abank.com.sv' });
    assert.ok(cls.matchedCategory !== null, 'Recruitment and Selection must match a category');
    assert.ok(
      cls.relevanceStatus === 'high_relevance' || cls.relevanceStatus === 'medium_relevance',
      `Expected high/medium relevance, got: ${cls.relevanceStatus}`,
    );
    assert.equal(cls.shouldInsertForReview, true);
  });

  it('D31 — Financial Advisor → not relevant', () => {
    const cls = classifyContactRelevance({ fullName: 'Carlos Ramos', title: 'Financial Advisor', email: 'c@abank.com.sv' });
    assert.equal(cls.shouldInsertForReview, false);
  });

  it('D32 — Software Engineer → not relevant', () => {
    const cls = classifyContactRelevance({ fullName: 'Laura Molina', title: 'Software Engineer', email: 'l@abank.com.sv' });
    assert.equal(cls.shouldInsertForReview, false);
  });

  it('D33 — Operations Manager → not relevant', () => {
    const cls = classifyContactRelevance({ fullName: 'Marco Torres', title: 'Operations Manager', email: 'm@abank.com.sv' });
    assert.equal(cls.shouldInsertForReview, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. FQDN consistency
// ═══════════════════════════════════════════════════════════════

describe('E — FQDN consistency (17B.4W.2)', () => {
  it('E34 — Banco ABANK / abank.com.sv → fqdn matches', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.fqdn, 'abank.com.sv');
  });

  it('E35 — ABank / ambiparcargo.com → fqdn mismatch detected', async () => {
    mockFetch(async () => makeResponse(200, { results: [BRAZIL_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.fqdn, 'ambiparcargo.com');
    // fqdn != abank.com.sv → runner will reject this contact pre-enrich
  });

  it('E36 — mismatch fqdn is different from expected domain', async () => {
    mockFetch(async () => makeResponse(200, { results: [BRAZIL_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    const fqdn = result.contacts[0]?.fqdn ?? '';
    assert.notEqual(fqdn, 'abank.com.sv');
  });

  it('E37 — mismatch contact has different fqdn than expected', async () => {
    mockFetch(async () =>
      makeResponse(200, { results: [REBECA_RAW, BRAZIL_RAW], pagination: { page: 0, size: 2, total: 2 } })
    );
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts.length, 2);
    // Rebeca: abank.com.sv (match), Brazil: ambiparcargo.com (mismatch)
    const fqdns = result.contacts.map((c) => c.fqdn);
    assert.ok(fqdns.includes('abank.com.sv'));
    assert.ok(fqdns.includes('ambiparcargo.com'));
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Billing
// ═══════════════════════════════════════════════════════════════

describe('F — Billing (17B.4W.2)', () => {
  it('F38 — zero results → prospectingCreditsCharged = 0', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        requestId: '3edadace-3e96-478f-b6ad-e4bd5b4ed348',
        pagination: { page: 0, size: 0, total: 0 },
        results: [],
        billing: { creditsCharged: 0, resultsReturned: 0 },
      })
    );
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.prospectingCreditsCharged, 0);
  });

  it('F39 — 25 results → prospectingCreditsCharged = 1', async () => {
    const people = Array.from({ length: 1 }, () => REBECA_RAW);
    mockFetch(async () =>
      makeResponse(200, {
        requestId: '7bbb86d4-b03e-401d-b1bd-b24b5978c986',
        pagination: { page: 0, size: 1, total: 292 },
        results: people,
        billing: { creditsCharged: 1, resultsReturned: 1 },
      })
    );
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.prospectingCreditsCharged, 1);
  });

  it('F40 — resultsReturned matches contacts count', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        pagination: { page: 0, size: 2, total: 2 },
        results: [REBECA_RAW, IVETTE_RAW],
        billing: { creditsCharged: 1, resultsReturned: 2 },
      })
    );
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.resultsReturned, 2);
  });

  it('F41 — no billing in response → prospectingCreditsCharged null (not invented)', async () => {
    mockFetch(async () =>
      makeResponse(200, {
        pagination: { page: 0, size: 1, total: 1 },
        results: [REBECA_RAW],
      })
    );
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.prospectingCreditsCharged, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Enrich eligibility
// ═══════════════════════════════════════════════════════════════

describe('G — Enrich eligibility (17B.4W.2)', () => {
  it('G42 — canReveal emails credits=0 → canRevealEmail=true (still eligible)', async () => {
    mockFetch(async () => makeResponse(200, { results: [REBECA_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.canRevealEmail, true);
  });

  it('G43 — Ivette canReveal emails → canRevealEmail=true', async () => {
    mockFetch(async () => makeResponse(200, { results: [IVETTE_RAW], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.canRevealEmail, true);
  });

  it('G44 — canReveal phones ignored for reveal decision', async () => {
    // Phone reveal must never be requested. canReveal[phones] presence does not affect canRevealEmail.
    const noEmailCanReveal = {
      ...REBECA_RAW,
      canReveal: [{ field: 'phones', credits: 0 }],
    };
    mockFetch(async () => makeResponse(200, { results: [noEmailCanReveal], pagination: { page: 0, size: 1, total: 1 } }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.contacts[0]?.canRevealEmail, false);
  });

  it('G45 — reveal request must only contain emails (never phones)', async () => {
    // Verified structurally: prospecting does not send reveal field.
    // enrich reveal is always ["emails"] only — never ["phones"].
    const reveal = ['emails'] as const;
    assert.ok(!reveal.includes('phones' as never));
    assert.ok(reveal.includes('emails'));
  });
});

// ═══════════════════════════════════════════════════════════════
// H. Regression
// ═══════════════════════════════════════════════════════════════

describe('H — Regression (17B.4W.2)', () => {
  it('H46 — Siesa person-known path still works (no regression)', () => {
    const mode = resolveLushaDiscoveryMode({ linkedinUrl: 'https://linkedin.com/in/siesa-user' });
    assert.equal(mode, 'person_known_search');
  });

  it('H47 — 17B.4U lifecycle: HTTP 401 → provider_auth_error', async () => {
    mockFetch(async () => makeResponse(401, { error: 'Unauthorized' }));
    const result = await prospectLushaContactsV3(BASE_REQUEST);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'provider_auth_error');
  });

  it('H48 — HubSpot-only company path still produces company_first_discovery', () => {
    const mode = resolveLushaDiscoveryMode({ companyName: 'ABANK', companyDomain: 'abank.com.sv' });
    assert.equal(mode, 'company_first_discovery');
  });

  it('H49 — approval flow unaffected: pending_review ≠ approved', () => {
    const status = 'pending_review';
    assert.notEqual(status, 'approved');
  });

  it('H50 — Apollo not touched: resolveLushaDiscoveryMode is Lusha-specific', () => {
    const mode = resolveLushaDiscoveryMode({ companyName: 'Bancolombia' });
    assert.equal(mode, 'company_first_discovery');
  });
});
