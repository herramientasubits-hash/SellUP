import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  candidateRunEmbed,
  isCandidateRunInScope,
  isContactRunInScope,
  resolveCandidateCountry,
} from '../candidate-scope';
import { mergeCandidateAccountContext } from '../candidate-account-context';
import type { PendingContactCandidate } from '../types';

describe('candidate-scope — cada quien ve los candidatos de sus búsquedas', () => {
  it('sin alcance (bandera apagada o admin) entra todo', () => {
    assert.equal(isCandidateRunInScope('u-otro', null), true);
    assert.equal(isCandidateRunInScope(null, null), true);
  });

  it('con alcance sólo entran las búsquedas de los usuarios del alcance', () => {
    const carlaYSuEquipo = ['u-carla', 'u-reporte'];
    assert.equal(isCandidateRunInScope('u-carla', carlaYSuEquipo), true);
    assert.equal(isCandidateRunInScope('u-reporte', carlaYSuEquipo), true);
    assert.equal(isCandidateRunInScope('u-otro', carlaYSuEquipo), false);
  });

  it('una búsqueda sin autor no se muestra a nadie con alcance', () => {
    assert.equal(isCandidateRunInScope(null, ['u-carla']), false);
    assert.equal(isCandidateRunInScope('u-carla', []), false);
  });

  it('con alcance el run se embebe con !inner y trae triggered_by (si no, el filtro no saca filas)', () => {
    assert.match(candidateRunEmbed(true), /contact_enrichment_runs!inner/);
    assert.match(candidateRunEmbed(true), /triggered_by/);
    assert.doesNotMatch(candidateRunEmbed(false), /!inner|triggered_by/);
  });
});

describe('candidate-scope — país del contacto', () => {
  it('manda el país del contacto', () => {
    assert.deepEqual(
      resolveCandidateCountry({ contact_country: 'Mexico', account_country: 'Chile' }),
      { country: 'Mexico', fromCompany: false },
    );
  });

  it('sin país del contacto (HubSpot) usa el de la empresa y lo marca', () => {
    assert.deepEqual(
      resolveCandidateCountry({ contact_country: '  ', account_country: 'Colombia' }),
      { country: 'Colombia', fromCompany: true },
    );
  });

  it('sin ninguno, vacío', () => {
    assert.deepEqual(resolveCandidateCountry({}), { country: null, fromCompany: false });
  });

  it('el contexto de empresa trae el país de la cuenta', () => {
    const [merged] = mergeCandidateAccountContext(
      [{ id: 'c1', account_id: 'acc-1', company_website: null } as PendingContactCandidate],
      [{ id: 'acc-1', website: null, domain: null, hubspot_company_id: null, country: 'Colombia' }],
    );
    assert.equal(merged.account_country, 'Colombia');
  });
});

describe('actions.ts — las lecturas de las colas aplican el alcance', () => {
  const source = readFileSync(join(__dirname, '..', 'actions.ts'), 'utf8');
  const readers = [
    'getPendingContactCandidates',
    'getPendingContactCandidatesCount',
    'getDuplicateContactCandidates',
    'getDuplicateContactCandidatesCount',
    'getRejectedContactCandidates',
  ];

  for (const name of readers) {
    it(`${name} resuelve el alcance y lee con el filtro`, () => {
      const start = source.indexOf(`export async function ${name}(`);
      assert.ok(start >= 0, `${name} no encontrada`);
      const next = source.indexOf('\nexport ', start + 1);
      const body = source.slice(start, next === -1 ? undefined : next);
      assert.match(body, /resolveCandidateScopeIds\(\)/);
      assert.match(body, /scopedCandidate(Read|Count)\(supabase, scopeIds\)/);
      assert.doesNotMatch(body, /\.from\('contact_enrichment_candidates'\)/);
    });
  }

  for (const name of ['getReviewableContactCandidateById', 'getRejectedContactCandidateById']) {
    it(`${name} (por id) usa la regla de corrida: autor o dueño de la empresa`, () => {
      const start = source.indexOf(`export async function ${name}(`);
      const body = source.slice(start, source.indexOf('\nexport ', start + 1));
      assert.match(body, /canSeeContactCandidate\(supabase, trimmedId\)/);
    });
  }
});

describe('isContactRunInScope — acceso por id a una corrida o su candidato', () => {
  const facts = { triggered_by: 'u-otro', account_owner_id: 'u-carla', account_created_by: null };

  it('sin alcance entra todo', () => {
    assert.equal(isContactRunInScope(facts, null), true);
  });

  it('entra si la lanzó alguien del alcance', () => {
    assert.equal(isContactRunInScope({ ...facts, account_owner_id: null }, ['u-otro']), true);
  });

  it('entra si la empresa es de alguien del alcance aunque la lanzara otro', () => {
    assert.equal(isContactRunInScope(facts, ['u-carla']), true);
  });

  it('no entra si ni el autor ni la empresa son del alcance, ni si no hay corrida', () => {
    assert.equal(isContactRunInScope(facts, ['u-tercero']), false);
    assert.equal(isContactRunInScope(null, ['u-carla']), false);
    assert.equal(isContactRunInScope(facts, []), false);
  });
});

describe('los accesos por id comprueban el alcance antes de leer o gastar', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');
  const cases: Array<[string, RegExp]> = [
    ['modules/contact-enrichment/run-viewer-actions.ts', /canSeeContactEnrichmentRun\(supabase, runId\)[\s\S]*canSeeContactEnrichmentRun\(supabase, runId\)[\s\S]*canSeeContactEnrichmentRunByAgentRunId/],
    ['modules/contact-enrichment/candidate-company-reassignment-actions.ts', /canSeeContactCandidate\(supabase, id\)/],
    ['modules/contact-enrichment/candidate-stored-phones-actions.ts', /canSeeContactCandidate[\s\S]*canSeeContactCandidate/],
    ['modules/contact-enrichment/account-run-history-actions.ts', /getAccountById\(accountId\)/],
    ['modules/contact-enrichment/automatic-routing-actions.ts', /canSeeContactEnrichmentRequest/],
    ['app/api/contact-enrichment/requests/[id]/search/route.ts', /canSeeContactEnrichmentRequest/],
    ['app/api/contact-enrichment/bulk-runs/[id]/execute/route.ts', /canSeeContactEnrichmentBulkRun\(supabase, bulkRunId\)/],
    ['modules/accounts/actions.ts', /getAccountAudit[\s\S]{0,200}getAccountById\(accountId\)/],
    ['modules/contacts/actions.ts', /getContactAudit[\s\S]{0,200}getContactById\(contactId\)/],
    ['app/(sellup)/source-catalog/socrata-batches/page.tsx', /isCurrentUserAdmin\(\)/],
    ['app/(sellup)/source-catalog/socrata-batches/[batchId]/page.tsx', /isCurrentUserAdmin\(\)/],
    ['app/api/contact-enrichment/requests/[id]/progress/route.ts', /canSeeContactEnrichmentRequest\(supabase, id\)/],
    ['modules/contact-enrichment/post-approval-reveal-actions.ts', /loadContact: async \(contactId\) =>\s*\(await canSeeOfficialContact/],
    ['modules/contact-enrichment/official-contact-stored-phones-actions.ts', /canSeeOfficialContact[\s\S]*canSeeOfficialContact/],
    ['modules/system-status/activity-actions.ts', /resolveCommercialScope\(\)/],
  ];
  for (const [rel, pattern] of cases) {
    it(rel, () => assert.match(read(rel), pattern));
  }

  it('revelar teléfono comprueba el alcance ANTES de abrir corrida o reserva', () => {
    const src = read('modules/contact-enrichment/phone-reveal-actions.ts');
    const gate = src.indexOf('canSeeContactCandidate(supabase, input.candidateId');
    const waterfall = src.indexOf('startWaterfallRunOrBlock(', gate);
    assert.ok(gate > 0 && waterfall > gate);
  });

  it('aprobar, fusionar, rechazar y reenviar cargan el candidato a través del alcance', () => {
    const src = read('modules/contact-enrichment/actions.ts');
    const gated = src.match(/loadCandidate: async \((id|candidateId)\) => \{\s*(\/\/[^\n]*\n\s*)?if \(!\(await canSeeContactCandidate\(supabase, (id|candidateId)\)\)\) return null;/g) ?? [];
    assert.equal(gated.length, 4);
    assert.match(src, /getDuplicateCandidateMergeOffer[\s\S]{0,400}canSeeContactCandidate\(supabase, trimmedId\)/);
  });
});

describe('Prospectos y lotes — mismo alcance en listas, KPIs y lecturas por id', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'prospect-batches', 'actions.ts'), 'utf8');
  const body = (name: string) => {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    return src.slice(start, src.indexOf('\nexport ', start + 1));
  };

  it('los KPIs usan la MISMA cláusula de responsable que el listado', () => {
    assert.match(body('getGlobalProspectsKPIs'), /resolveCandidateOwnershipClause\(supabase\)/);
    assert.match(body('getGlobalCandidatesList'), /resolveCandidateOwnershipClause\(supabase, filters\.ownerUserIds\)/);
  });

  for (const name of ['getProspectBatchesSummary', 'getProspectBatchesList']) {
    it(`${name} filtra por los lotes del alcance`, () => {
      assert.match(body(name), /resolveAllowedBatchIds\(\)/);
    });
  }

  for (const name of ['getBatchDetailSummary', 'getBatchAudit', 'getCandidatesByBatch']) {
    it(`${name} comprueba el lote por sí misma`, () => {
      assert.match(body(name), /isBatchInScope\(batchId\)/);
    });
  }
});
