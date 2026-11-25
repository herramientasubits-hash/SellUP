/**
 * Tests — Cargo y empresa ACTUALES del contacto (CONTACT-CURRENT-EMPLOYMENT-1).
 *
 * Caso real (17-11-2026): candidatos con «Human Resources Manager» o «General Manager» que en
 * LinkedIn eran analistas o ya no estaban en la empresa. El cargo venía de la búsqueda de Apollo o
 * de HubSpot sin comprobar; people/match ya traía el historial laboral y no se leía.
 *
 * Funciones puras y dobles en memoria. Sin red, sin DB, sin créditos. Datos ficticios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  CURRENT_EMPLOYMENT_SNAPSHOT_KEY,
  assessCurrentEmployment,
  companyMatchesDomainBrand,
  companyNamesMatch,
  extractCurrentEmployment,
  normalizeCompanyNameForMatch,
  readCurrentEmploymentCheck,
  titleAfterEmploymentCheck,
  titlesMatch,
  type CurrentEmploymentSnapshot,
} from '../current-employment-check';
import {
  runCandidateIdentityCompletion,
  type IdentityCompletionCandidate,
  type IdentityCompletionPatch,
} from '../candidate-identity-completion-core';
import { normalizeApolloPerson } from '@/server/agents/contact-enrichment-toolkit/contact-normalizer';
import { mergeCompletedContactData } from '@/server/agents/contact-enrichment-toolkit/contact-completion-adapter';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import { resolveTitleProvenance } from '@/components/contact-enrichment/contact-candidate-title-provenance';

const NOW = '2026-11-17T12:00:00.000Z';

function snapshot(overrides: Partial<CurrentEmploymentSnapshot> = {}): CurrentEmploymentSnapshot {
  return {
    has_history: true,
    roles: [{ organization_id: 'org-1', organization_name: 'Cygnus S.A.', title: 'HR Analyst', start_date: '2023-04-01' }],
    organization: { id: 'org-1', name: 'Cygnus', domain: 'cygnus.cl' },
    ...overrides,
  };
}

const assess = (snap: CurrentEmploymentSnapshot | null, shownTitle: string | null = 'Human Resources Manager') =>
  assessCurrentEmployment({ snapshot: snap, shownTitle, companyName: 'Cygnus', companyDomain: 'cygnus.cl', checkedAt: NOW });

describe('nombres de empresa y cargos', () => {
  it('ignora tildes, signos y sufijos societarios', () => {
    assert.equal(normalizeCompanyNameForMatch('Cygnus S.A.'), 'cygnus');
    assert.equal(normalizeCompanyNameForMatch('Iluminación Andina S.A.S.'), 'iluminacion andina');
    assert.equal(normalizeCompanyNameForMatch('Grupo Ficticio S.A. de C.V.'), 'grupo ficticio');
    assert.equal(normalizeCompanyNameForMatch('Cygnus SpA'), 'cygnus');
  });

  it('una empresa contiene a la otra sólo por palabra completa', () => {
    assert.equal(companyNamesMatch('EGLO', 'EGLO ILUMINACION CHILE'), true);
    assert.equal(companyNamesMatch('Cygnus S.A.', 'cygnus'), true);
    assert.equal(companyNamesMatch('Vegas Corp', 'Gas'), false);
    assert.equal(companyNamesMatch('Otra Empresa', 'Cygnus'), false);
    assert.equal(companyNamesMatch(null, 'Cygnus'), false);
  });

  it('el mismo nombre escrito junto o separado (Colineal 25-11)', () => {
    assert.equal(companyNamesMatch('ColinealCorp', 'Colineal Corp'), true);
    assert.equal(companyNamesMatch('Empresas Dragón', 'empresasdragon.com'), true);
    assert.equal(companyNamesMatch('GO CORP', 'Colineal Corp'), false);
    assert.equal(companyNamesMatch('Automotores Toyota Colombia', 'TOYOTA CH'), false);
    // Muy corto para comparar pegado: no se arriesga.
    assert.equal(companyNamesMatch('LAE', 'L.A.E. Corp'), true);
    assert.equal(companyNamesMatch('Lae', 'La E'), false);
  });

  it('la marca del dominio de la ficha también identifica a la empresa', () => {
    assert.equal(companyMatchesDomainBrand('ColinealCorp', 'colinealcorp.com'), true);
    assert.equal(companyMatchesDomainBrand('Colineal Corp', 'https://www.colinealcorp.com/'), true);
    assert.equal(companyMatchesDomainBrand('GO CORP', 'colinealcorp.com'), false);
    assert.equal(companyMatchesDomainBrand('Abc', 'abc.com'), false);
    assert.equal(companyMatchesDomainBrand('ColinealCorp', null), false);
  });

  it('cargos iguales salvo mayúsculas, tildes o un agregado', () => {
    assert.equal(titlesMatch('Gerente de Recursos Humanos', 'gerente de recursos humanos'), true);
    assert.equal(titlesMatch('HR Manager', 'HR Manager Chile'), true);
    assert.equal(titlesMatch('HR Analyst', 'Human Resources Manager'), false);
  });
});

describe('extractCurrentEmployment (respuesta de people/match)', () => {
  it('se queda sólo con los trabajos actuales sin fecha de término', () => {
    const snap = extractCurrentEmployment(
      [
        { organization_name: 'Cygnus', title: 'HR Analyst', current: true, start_date: '2023-04-01', end_date: null },
        { organization_name: 'Cygnus', title: 'Human Resources Manager', current: false, end_date: '2023-03-31' },
        { organization_name: 'Vieja', title: 'Jefa', current: true, end_date: '2020-01-01' },
      ],
      { id: 'org-1', name: 'Cygnus', website_url: 'https://www.cygnus.cl' },
    );
    assert.ok(snap);
    assert.equal(snap.has_history, true);
    assert.deepEqual(snap.roles.map((r) => r.title), ['HR Analyst']);
    assert.deepEqual(snap.organization, { id: 'org-1', name: 'Cygnus', domain: 'cygnus.cl' });
  });

  it('sin historial ni organización (búsqueda gratuita) no hay nada que comprobar', () => {
    assert.equal(extractCurrentEmployment(undefined, null), null);
    assert.equal(extractCurrentEmployment([], undefined), null);
  });
});

describe('assessCurrentEmployment', () => {
  it('mismo cargo en la empresa ⇒ confirmado', () => {
    const check = assess(snapshot({ roles: [{ organization_id: 'org-1', organization_name: 'Cygnus', title: 'Human Resources Manager', start_date: '2021-01-01' }] }));
    assert.equal(check.status, 'confirmed');
    assert.equal(check.current_since, '2021-01-01');
  });

  it('otro cargo en la misma empresa ⇒ se muestra el actual (el caso «Manager» que es analista)', () => {
    const check = assess(snapshot());
    assert.equal(check.status, 'title_changed');
    assert.equal(check.current_title, 'HR Analyst');
    assert.equal(check.previous_title, 'Human Resources Manager');
    assert.equal(titleAfterEmploymentCheck(check, 'Human Resources Manager'), 'HR Analyst');
  });

  it('Apollo escribe la empresa pegada y con otro dominio ⇒ sigue en la empresa (Colineal 25-11)', () => {
    const check = assessCurrentEmployment({
      snapshot: snapshot({
        roles: [{ organization_id: 'org-c', organization_name: 'ColinealCorp', title: 'Head of Human Resources', start_date: '2023-03-01' }],
        organization: { id: 'org-c', name: 'ColinealCorp', domain: 'colineal.com' },
      }),
      shownTitle: 'Head of Human Resources',
      companyName: 'Colineal Corp',
      companyDomain: 'colinealcorp.com',
      checkedAt: NOW,
    });
    assert.equal(check.status, 'confirmed');
  });

  it('trabajo actual en otra empresa ⇒ posiblemente ya no está y el cargo NO se cambia', () => {
    const check = assess(
      snapshot({
        roles: [{ organization_id: 'org-9', organization_name: 'Otra Empresa', title: 'HR Director', start_date: '2025-02-01' }],
        organization: { id: 'org-9', name: 'Otra Empresa', domain: 'otra.test' },
      }),
    );
    assert.equal(check.status, 'other_company');
    assert.equal(check.current_company, 'Otra Empresa');
    assert.equal(titleAfterEmploymentCheck(check, 'Human Resources Manager'), 'Human Resources Manager');
  });

  it('historial sin trabajo actual ⇒ no_current_role', () => {
    assert.equal(assess(snapshot({ roles: [] })).status, 'no_current_role');
  });

  it('sin historial ⇒ unknown (no se afirma nada)', () => {
    assert.equal(assess(null).status, 'unknown');
    assert.equal(assess(snapshot({ has_history: false, roles: [] })).status, 'unknown');
  });

  it('la organización actual coincide por dominio aunque el historial use otro nombre', () => {
    const check = assess(
      snapshot({
        roles: [{ organization_id: 'org-1', organization_name: 'Inversiones Cyg Ltda', title: 'Human Resources Manager', start_date: null }],
        organization: { id: 'org-1', name: 'Inversiones Cyg', domain: 'cygnus.cl' },
      }),
    );
    assert.equal(check.status, 'confirmed');
  });

  it('se lee de vuelta desde metadata y descarta basura', () => {
    const check = assess(snapshot());
    assert.deepEqual(readCurrentEmploymentCheck(JSON.parse(JSON.stringify(check))), check);
    assert.equal(readCurrentEmploymentCheck({ status: 'inventado' }), null);
    assert.equal(readCurrentEmploymentCheck(null), null);
  });
});

describe('camino Apollo: normalizador y mezcla tras people/match', () => {
  const matched: ApolloPerson = {
    id: 'p-1',
    first_name: 'Paola',
    last_name: 'Ficticia',
    title: 'HR Analyst',
    email: null,
    linkedin_url: 'https://www.linkedin.com/in/paola-ficticia',
    phone_numbers: [],
    organization: { id: 'org-1', name: 'Cygnus', website_url: 'https://cygnus.cl' },
    employment_history: [{ organization_id: 'org-1', organization_name: 'Cygnus', title: 'HR Analyst', current: true, start_date: '2023-04-01' }],
  };

  it('el normalizador guarda el trabajo actual sólo cuando Apollo manda historial', () => {
    const withHistory = normalizeApolloPerson(matched);
    assert.ok(withHistory?.enrichmentMetadata[CURRENT_EMPLOYMENT_SNAPSHOT_KEY]);
    const searchOnly = normalizeApolloPerson({ ...matched, employment_history: undefined });
    assert.equal(searchOnly?.enrichmentMetadata[CURRENT_EMPLOYMENT_SNAPSHOT_KEY], undefined);
  });

  it('la mezcla conserva el cargo de la búsqueda pero lleva el trabajo actual del match', () => {
    const base = normalizeApolloPerson({ ...matched, title: 'Human Resources Manager', linkedin_url: null, employment_history: undefined });
    const completed = normalizeApolloPerson(matched);
    assert.ok(base && completed);
    const merged = mergeCompletedContactData(base, completed);
    assert.equal(merged.title, 'Human Resources Manager');
    assert.ok(merged.enrichmentMetadata[CURRENT_EMPLOYMENT_SNAPSHOT_KEY]);
  });
});

describe('camino HubSpot: completación de identidad con Apollo', () => {
  function candidate(): IdentityCompletionCandidate {
    return {
      id: 'cand-1',
      status: 'pending_review',
      source: 'hubspot',
      sourceContactId: '123',
      apolloPersonId: null,
      email: 'ale@eglo.test',
      linkedinUrl: null,
      firstName: 'Alejandra',
      lastName: 'Ficticia',
      fullName: 'Alejandra Ficticia',
      companyName: 'EGLO ILUMINACION CHILE',
      companyDomain: 'eglo.test',
      title: 'General Manager',
      enrichmentMetadata: { hubspot_first: true },
    };
  }

  async function run(currentEmployment: CurrentEmploymentSnapshot | null) {
    const persisted: IdentityCompletionPatch[] = [];
    await runCandidateIdentityCompletion(
      { candidateId: 'cand-1', purpose: 'linkedin' },
      {
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        nowIso: NOW,
        loadCandidate: async () => candidate(),
        lookupApollo: async () => ({
          kind: 'found',
          person: {
            id: '0123456789abcdef01234567',
            firstName: 'Alejandra',
            lastName: 'Ficticia',
            linkedinUrl: 'https://www.linkedin.com/in/ale-ficticia',
            email: null,
            currentEmployment,
          },
          usage: [{ provider_key: 'apollo', operation_key: 'person_match', credits_used: 1, status: 'success', results_returned: 1 }],
        }),
        persist: async (_id, patch) => {
          persisted.push(patch);
        },
        logUsage: async () => {},
      },
    );
    return persisted[0];
  }

  it('si hoy trabaja en otra empresa queda el aviso y el cargo de HubSpot no se toca', async () => {
    const patch = await run(
      snapshot({
        roles: [{ organization_id: 'o-2', organization_name: 'Otra Luz', title: 'CEO', start_date: '2024-01-01' }],
        organization: { id: 'o-2', name: 'Otra Luz', domain: 'otraluz.test' },
      }),
    );
    const check = readCurrentEmploymentCheck(patch.enrichment_metadata[CURRENT_EMPLOYMENT_METADATA_KEY]);
    assert.equal(check?.status, 'other_company');
    assert.equal(patch.title, undefined);
    assert.equal(patch.linkedin_url, 'https://www.linkedin.com/in/ale-ficticia');
  });

  it('si sigue en la empresa con otro cargo se guarda el cargo actual', async () => {
    const patch = await run(
      snapshot({
        roles: [{ organization_id: 'o-1', organization_name: 'EGLO', title: 'Jefa de Personas', start_date: '2022-05-01' }],
        organization: { id: 'o-1', name: 'EGLO', domain: 'eglo.test' },
      }),
    );
    assert.equal(patch.title, 'Jefa de Personas');
  });

  it('sin historial de Apollo no se anota comprobación', async () => {
    const patch = await run(null);
    assert.equal(patch.enrichment_metadata[CURRENT_EMPLOYMENT_METADATA_KEY], undefined);
    assert.equal(patch.title, undefined);
  });
});

describe('ficha: de dónde viene el cargo', () => {
  it('sin comprobación dice la fuente y pide confirmarlo', () => {
    const p = resolveTitleProvenance({ source: 'hubspot', enrichment_metadata: {} });
    assert.equal(p.tone, 'unverified');
    assert.match(p.caption, /Según HubSpot · sin verificar/);
    assert.equal(p.leftNotice, null);
  });

  it('en otra empresa muestra el aviso con dónde trabaja hoy', () => {
    const check = assess(
      snapshot({
        roles: [{ organization_id: 'o-9', organization_name: 'Otra Empresa', title: 'HR Director', start_date: '2025-02-01' }],
        organization: { id: 'o-9', name: 'Otra Empresa', domain: 'otra.test' },
      }),
    );
    const p = resolveTitleProvenance({ source: 'apollo', enrichment_metadata: { current_employment: check } });
    assert.equal(p.tone, 'left');
    assert.equal(p.leftNotice?.title, 'Posiblemente ya no está en la empresa');
    assert.match(p.leftNotice?.description ?? '', /Otra Empresa como HR Director \(desde 2025\)/);
  });

  it('cargo actualizado dice lo que figuraba antes', () => {
    const p = resolveTitleProvenance({ source: 'apollo', enrichment_metadata: { current_employment: assess(snapshot()) } });
    assert.equal(p.tone, 'updated');
    assert.match(p.caption, /antes figuraba «Human Resources Manager»/);
  });
});
