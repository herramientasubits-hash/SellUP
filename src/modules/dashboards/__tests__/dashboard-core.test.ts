// TABLEROS-1 — El cálculo de los tableros. Reglas del dueño (25-11):
//   - sólo lo aprobado/revisado es «enriquecido»; lo buscado y lo pendiente es uso;
//   - el resultado se acredita a quien APROBÓ; el uso, a quien BUSCÓ;
//   - todas las fuentes cuentan y se filtran una a una o agrupadas;
//   - nada de antes del lanzamiento (11-11-2026).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDashboard,
  rate,
  type CompanyCandidateRow,
  type ContactCandidateRow,
  type DashboardInput,
  type DashboardPerson,
} from '../dashboard-core';
import { DEFAULT_DASHBOARD_FILTERS, resolveDashboardRange } from '../dashboard-filters';

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARLA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEAM_CO = 'team-co';

const NOW = '2026-11-25T17:00:00.000Z';
const RANGE = resolveDashboardRange(DEFAULT_DASHBOARD_FILTERS, '2026-11-25');

/** Un instante del día de Bogotá indicado (al mediodía de Bogotá). */
const at = (day: string) => `${day}T17:00:00.000Z`;

const PEOPLE: DashboardPerson[] = [
  { id: ANA, name: 'Ana', email: 'ana@ubits.co', groupId: TEAM_CO, groupName: 'Colombia' },
  { id: BETO, name: 'Beto', email: 'beto@ubits.co', groupId: TEAM_CO, groupName: 'Colombia' },
  { id: CARLA, name: 'Carla', email: null, groupId: null, groupName: null },
];

function contact(overrides: Partial<ContactCandidateRow>): ContactCandidateRow {
  return {
    id: 'c',
    runId: 'run-1',
    status: 'pending_review',
    source: 'apollo',
    createdAt: at('2026-11-12'),
    reviewedBy: null,
    reviewedAt: null,
    hasEmail: true,
    hasPhone: false,
    hasLinkedin: true,
    seniority: 'manager',
    matchedHubspotContactId: null,
    countryCode: 'CO',
    searchedBy: ANA,
    ...overrides,
  };
}

function company(overrides: Partial<CompanyCandidateRow>): CompanyCandidateRow {
  return {
    id: 'e',
    batchId: 'batch-1',
    status: 'needs_review',
    source: 'apollo',
    createdAt: at('2026-11-12'),
    reviewedBy: null,
    reviewedAt: null,
    countryCode: 'CO',
    industry: 'Tecnología',
    sizeBand: '51-200 empleados',
    searchedBy: ANA,
    ...overrides,
  };
}

function baseInput(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    range: RANGE,
    granularity: 'week',
    now: NOW,
    filters: { sources: [], countries: [], sourceView: 'split', people: [] },
    people: PEOPLE,
    contactRuns: [
      // Una solicitud con dos intentos (Apollo → Lusha): cuenta UNA vez.
      { id: 'run-1', requestId: 'req-1', status: 'superseded', triggeredBy: ANA, createdAt: at('2026-11-12'), countryCode: 'CO' },
      { id: 'run-2', requestId: 'req-1', status: 'completed', triggeredBy: ANA, createdAt: at('2026-11-12'), countryCode: 'CO' },
      // Otra sin resultados.
      { id: 'run-3', requestId: 'req-2', status: 'completed', triggeredBy: BETO, createdAt: at('2026-11-18'), countryCode: 'MX' },
      // De antes del lanzamiento: no cuenta.
      { id: 'run-old', requestId: 'req-old', status: 'completed', triggeredBy: ANA, createdAt: at('2026-11-05'), countryCode: 'CO' },
    ],
    foundContacts: [
      contact({ id: 'c1', runId: 'run-2', status: 'approved', reviewedBy: BETO, reviewedAt: at('2026-11-13') }),
      contact({ id: 'c2', runId: 'run-2', status: 'pending_review', createdAt: at('2026-11-12') }),
      contact({ id: 'c3', runId: 'run-2', status: 'discarded', source: 'lusha', reviewedBy: ANA, reviewedAt: at('2026-11-13') }),
    ],
    reviewedContacts: [
      // Lo aprobó Beto aunque lo buscó Ana: el resultado es de Beto.
      contact({ id: 'c1', runId: 'run-2', status: 'approved', reviewedBy: BETO, reviewedAt: at('2026-11-13') }),
      contact({ id: 'c3', runId: 'run-2', status: 'discarded', source: 'lusha', reviewedBy: ANA, reviewedAt: at('2026-11-13') }),
      // Ya estaba en HubSpot; lo aprobó Ana.
      contact({
        id: 'c4',
        runId: 'run-x',
        status: 'approved',
        source: 'hubspot',
        reviewedBy: ANA,
        reviewedAt: at('2026-11-20'),
        hasPhone: false,
        seniority: null,
      }),
    ],
    linkedContacts: [
      // El teléfono de c1 se reveló después de aprobar: el contacto queda completo.
      { candidateId: 'c1', hasEmail: true, hasPhone: true, hasLinkedin: true, filledHubspotProperties: [] },
      { candidateId: 'c4', hasEmail: true, hasPhone: false, hasLinkedin: true, filledHubspotProperties: ['jobtitle', 'hs_linkedin_url'] },
    ],
    companyBatches: [
      { id: 'batch-1', createdBy: ANA, createdAt: at('2026-11-12'), countryCode: 'CO' },
      { id: 'batch-old', createdBy: ANA, createdAt: at('2026-11-01'), countryCode: 'CO' },
    ],
    foundCompanies: [
      company({ id: 'e1', status: 'approved', reviewedBy: CARLA, reviewedAt: at('2026-11-14') }),
      company({ id: 'e2', status: 'needs_review', createdAt: at('2026-11-12') }),
      company({ id: 'e3', status: 'generated', source: 'mock' }),
    ],
    reviewedCompanies: [
      company({ id: 'e1', status: 'approved', reviewedBy: CARLA, reviewedAt: at('2026-11-14') }),
      company({ id: 'e5', status: 'discarded', reviewedBy: CARLA, reviewedAt: at('2026-11-14'), source: 'socrata_colombia' }),
    ],
    hubspotEnrichments: [
      {
        accountId: 'acc-1',
        requestedBy: BETO,
        completedAt: at('2026-11-19'),
        status: 'partial',
        filled: ['tax_identifier', 'company_size'],
        countryCode: 'CO',
        industry: 'Banca',
        sizeBand: '201-500 empleados',
      },
      {
        accountId: 'acc-2',
        requestedBy: BETO,
        completedAt: at('2026-11-19'),
        status: 'nothing_found',
        filled: [],
        countryCode: 'CO',
        industry: null,
        sizeBand: 'Sin dato',
      },
      { accountId: 'acc-3', requestedBy: BETO, completedAt: at('2026-11-19'), status: 'running', filled: [], countryCode: 'CO', industry: null, sizeBand: 'Sin dato' },
    ],
    countryLabel: (code) => ({ CO: 'Colombia', MX: 'México' })[code] ?? code,
    ...overrides,
  };
}

describe('computeDashboard — uso frente a resultado', () => {
  const data = computeDashboard(baseInput());

  it('uso: búsquedas, solicitudes (una por solicitud, no por intento) y lo encontrado, sin nada de antes del lanzamiento', () => {
    assert.equal(data.usage.companySearches, 1);
    assert.equal(data.usage.contactRequests, 2);
    assert.equal(data.usage.contactsFound, 3);
    assert.equal(data.usage.companiesFound, 2, 'la fuente de prueba (mock) no cuenta');
    assert.equal(data.usage.pendingContacts, 1);
    assert.equal(data.usage.pendingCompanies, 1);
  });

  it('resultado: sólo lo aprobado; las empresas suman las de HubSpot completadas', () => {
    assert.equal(data.results.contactsEnriched, 2);
    assert.equal(data.results.contactsRejected, 1);
    assert.equal(data.results.companiesApproved, 1);
    assert.equal(data.results.hubspotCompaniesEnriched, 1, '«partial» completó algo');
    assert.equal(data.results.hubspotNothingFound, 1, '«nothing_found» no es resultado');
    assert.equal(data.results.companiesEnriched, 2);
    assert.equal(data.results.companiesRejected, 1);
  });

  it('procedencia: uno ya estaba en HubSpot y otro es nuevo', () => {
    assert.equal(data.results.contactsFromHubspot, 1);
    assert.equal(data.results.contactsNew, 1);
  });

  it('completitud: lo que quedó en el contacto de SellUp también cuenta', () => {
    assert.equal(data.results.contactsFull, 1, 'c1 tiene el teléfono revelado después de aprobar');
    assert.equal(data.results.contactsFullRate, 50);
    const missingPhone = data.contacts.completeness.find((item) => item.key === 'missing_phone');
    assert.equal(missingPhone?.value, 1);
  });

  it('tasa de aprobación: aprobado ÷ revisado (empresas y contactos)', () => {
    // Aprobado: 2 contactos + 2 empresas. Revisado: eso + 1 contacto + 1 empresa descartados.
    assert.equal(data.results.approvalRate, rate(4, 6));
  });

  it('qué datos completó SellUp: en empresas de HubSpot y en contactos de HubSpot', () => {
    assert.deepEqual(
      data.companies.filledFields.map((item) => item.label).sort(),
      ['Número fiscal', 'Tamaño'],
    );
    assert.deepEqual(data.contacts.hubspotFilled.map((item) => item.label).sort(), ['Cargo', 'LinkedIn']);
  });

  it('cortes de empresas enriquecidas: país con nombre, tamaño en orden', () => {
    assert.deepEqual(data.companies.byCountry, [{ key: 'CO', label: 'Colombia', value: 2 }]);
    assert.deepEqual(
      data.companies.bySize.map((item) => item.key),
      ['51-200 empleados', '201-500 empleados'],
    );
  });
});

describe('computeDashboard — crédito por persona', () => {
  const data = computeDashboard(baseInput());
  const row = (id: string) => data.people.find((person) => person.id === id)!;

  it('el uso es de quien buscó y el resultado de quien aprobó', () => {
    assert.equal(row(ANA).contactsFound, 3, 'Ana buscó los tres contactos');
    assert.equal(row(ANA).contactsEnriched, 1, 'Ana aprobó c4');
    assert.equal(row(BETO).contactsEnriched, 1, 'Beto aprobó c1 aunque lo buscó Ana');
    assert.equal(row(CARLA).companiesEnriched, 1);
    assert.equal(row(BETO).companiesEnriched, 1, 'el pedido de HubSpot es de quien lo pidió');
  });

  it('quien no hizo nada aparece en cero y los equipos suman a su gente', () => {
    const data2 = computeDashboard(baseInput({ reviewedCompanies: [], foundCompanies: [], hubspotEnrichments: [] }));
    const carla = data2.people.find((person) => person.id === CARLA)!;
    assert.equal(carla.companiesEnriched, 0);
    assert.equal(carla.approvalRate, null);
    const colombia = data.teams.find((team) => team.key === TEAM_CO)!;
    assert.equal(colombia.people, 2);
    assert.equal(colombia.enriched, 3, 'Ana 1 + Beto 2');
    assert.equal(data.teams.find((team) => team.key === 'none')!.name, 'Sin equipo');
  });

  it('personas activas y días con actividad', () => {
    assert.equal(data.usage.activePeople, 3);
    assert.ok(data.usage.activeDays >= 5);
  });
});

describe('computeDashboard — filtros de fuente y país', () => {
  it('sólo HubSpot: cuentan el contacto de HubSpot y la empresa de HubSpot', () => {
    const data = computeDashboard(baseInput({ filters: { sources: ['hubspot'], countries: [], sourceView: 'split', people: [] } }));
    assert.equal(data.results.contactsEnriched, 1);
    assert.equal(data.results.companiesEnriched, 1);
    assert.deepEqual(data.contacts.results.series.map((series) => series.key), ['hubspot']);
  });

  it('una a una: una serie por fuente; agrupadas: una sola serie con el total', () => {
    const split = computeDashboard(baseInput());
    assert.deepEqual(split.companies.results.series.map((series) => series.key), ['hubspot', 'apollo']);
    const grouped = computeDashboard(baseInput({ filters: { sources: [], countries: [], sourceView: 'grouped', people: [] } }));
    assert.equal(grouped.companies.results.series.length, 1);
    assert.equal(grouped.companies.results.series[0].label, 'Fuentes elegidas');
    const total = grouped.companies.results.series[0].values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    assert.equal(total, 2);
  });

  it('por país: México sólo tiene la solicitud sin resultados', () => {
    const data = computeDashboard(baseInput({ filters: { sources: [], countries: ['MX'], sourceView: 'split', people: [] } }));
    assert.equal(data.usage.contactRequests, 1);
    assert.equal(data.usage.contactsFound, 0);
    assert.equal(data.results.contactsEnriched, 0);
    assert.equal(data.results.companiesEnriched, 0);
  });
});

describe('computeDashboard — series en el tiempo', () => {
  const data = computeDashboard(baseInput());

  it('una cubeta por semana desde el lanzamiento', () => {
    assert.deepEqual(data.buckets.map((bucket) => bucket.key), ['2026-11-09', '2026-11-16', '2026-11-23']);
  });

  it('estado de las solicitudes y tasa de enriquecimiento por semana', () => {
    const enriched = data.contacts.requestStates.series.find((series) => series.key === 'enriched')!;
    const noResults = data.contacts.requestStates.series.find((series) => series.key === 'no_results')!;
    assert.deepEqual(enriched.values, [1, 0, 0]);
    assert.deepEqual(noResults.values, [0, 1, 0]);
    assert.deepEqual(data.contacts.enrichmentRate.series[0].values, [100, 0, null]);
  });

  it('uso frente a resultado por semana (empresas y contactos juntos)', () => {
    const found = data.overview.series.find((series) => series.key === 'found')!;
    const enriched = data.overview.series.find((series) => series.key === 'enriched')!;
    assert.deepEqual(found.values, [5, 0, 0]);
    assert.deepEqual(enriched.values, [2, 2, 0]);
  });

  it('la tasa de aprobación de empresas es `null` (hueco) en una semana sin revisiones', () => {
    assert.deepEqual(data.companies.approvalRate.series[0].values, [50, null, null]);
  });
});

describe('computeDashboard — pendientes y comparativa', () => {
  it('lo pendiente se agrupa por antigüedad', () => {
    const data = computeDashboard(baseInput());
    const old = data.pendingAging.find((row) => row.key === '8_plus')!;
    assert.equal(old.contacts, 1, 'c2 lleva 13 días sin revisar');
    assert.equal(old.companies, 1);
  });

  it('la comparativa sale sólo con 2 a 8 personas elegidas', () => {
    assert.equal(computeDashboard(baseInput()).comparison, null);
    const one = computeDashboard(baseInput({ filters: { sources: [], countries: [], sourceView: 'split', people: [ANA] } }));
    assert.equal(one.comparison, null);
    const two = computeDashboard(baseInput({ filters: { sources: [], countries: [], sourceView: 'split', people: [ANA, BETO] } }));
    assert.deepEqual(two.comparison?.series.map((series) => series.label), ['Ana', 'Beto']);
    assert.deepEqual(two.comparison?.series[1].values, [1, 1, 0], 'Beto: c1 y la empresa de HubSpot');
  });
});

describe('rate', () => {
  it('un decimal y `null` sin base', () => {
    assert.equal(rate(1, 3), 33.3);
    assert.equal(rate(0, 0), null);
  });
});
