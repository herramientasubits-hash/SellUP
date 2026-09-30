/**
 * Tests — AGENT1-IMPORT-PARITY-1: la importación decide identidad con las MISMAS
 * autoridades que Apollo/Lusha.
 *
 * Puro: cero red, cero base de datos, cero proveedores.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectImportDomains,
  planImportIdentityAdmission,
  resolveImportExistingCompanyDuplicate,
  toImportAdmissionMetadata,
  type ImportIdentityRowInput,
} from '../import-identity-admission';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';

function row(overrides: Partial<ImportIdentityRowInput> & { rowNumber: number }): ImportIdentityRowInput {
  return {
    name: 'Empresa Ejemplo SAS',
    website: null,
    domain: null,
    countryCode: 'CO',
    taxIdentifier: null,
    linkedinUrl: null,
    ...overrides,
  };
}

function active(overrides: Partial<ActiveCandidateRecord> = {}): ActiveCandidateRecord {
  return {
    id: 'cand-otro-vendedor',
    name: 'Acme SAS',
    domain: 'www.acme.com.co',
    status: 'needs_review',
    ...overrides,
  };
}

describe('planImportIdentityAdmission — duplicados dentro del archivo', () => {
  it('la misma empresa por dominio dos veces: gana la primera fila', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, name: 'Acme SAS', website: 'https://acme.com.co', domain: 'acme.com.co' }),
        row({ rowNumber: 2, name: 'ACME S.A.S.', website: 'www.acme.com.co', domain: 'acme.com.co' }),
      ],
      [],
    );
    assert.equal(plan[0].kind, 'admitted');
    assert.equal(plan[1].kind, 'duplicate');
    assert.ok(plan[1].kind === 'duplicate' && plan[1].reason === 'intra_file_duplicate');
    assert.ok(plan[1].kind === 'duplicate' && plan[1].reason === 'intra_file_duplicate' && plan[1].duplicateOfRowNumber === 1);
  });

  it('el mismo NIT con y sin dígito verificador es la misma empresa', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, name: 'Uno SAS', taxIdentifier: '900123456-7' }),
        row({ rowNumber: 2, name: 'Otro nombre', taxIdentifier: 'NIT 900123456' }),
      ],
      [],
    );
    assert.equal(plan[1].kind, 'duplicate');
    assert.ok(plan[1].kind === 'duplicate' && plan[1].reason === 'intra_file_duplicate' && plan[1].signal === 'fiscal_identity');
  });

  it('dos empresas distintas en el mismo archivo entran las dos', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, name: 'Uno SAS', domain: 'uno.co' }),
        row({ rowNumber: 2, name: 'Dos SAS', domain: 'dos.co' }),
      ],
      [],
    );
    assert.deepEqual(plan.map((p) => p.kind), ['admitted', 'admitted']);
  });

  it('el mismo nombre con dominios distintos NO es duplicado duro (paridad CUT-L7)', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, name: 'Grupo Andino', domain: 'grupoandino.co' }),
        row({ rowNumber: 2, name: 'Grupo Andino', domain: 'grupoandino.pe', countryCode: 'PE' }),
      ],
      [],
    );
    assert.deepEqual(plan.map((p) => p.kind), ['admitted', 'admitted']);
  });

  it('siempre calcula identity_key con la autoridad compartida', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, taxIdentifier: '900123456-7' }),
        row({ rowNumber: 2, name: 'Sin fiscal', domain: 'sinfiscal.com' }),
      ],
      [],
    );
    assert.match(plan[0].identityKey ?? '', /^tax:co:/);
    assert.equal(plan[1].identityKey, 'domain:sinfiscal.com');
  });
});

describe('planImportIdentityAdmission — empresa activa de otro lote', () => {
  it('el dominio de un candidato activo la deja duplicada (aunque venga con www.)', () => {
    const plan = planImportIdentityAdmission(
      [row({ rowNumber: 1, name: 'Acme', website: 'https://acme.com.co/contacto', domain: 'acme.com.co' })],
      [active()],
    );
    assert.equal(plan[0].kind, 'duplicate');
    assert.ok(plan[0].kind === 'duplicate' && plan[0].reason === 'active_candidate_domain');
    assert.ok(plan[0].kind === 'duplicate' && plan[0].reason === 'active_candidate_domain' && plan[0].matchedCandidateId === 'cand-otro-vendedor');
  });

  it('un candidato descartado NO bloquea (descartar libera, #468)', () => {
    const plan = planImportIdentityAdmission(
      [row({ rowNumber: 1, domain: 'acme.com.co' })],
      [active({ status: 'discarded' })],
    );
    assert.equal(plan[0].kind, 'admitted');
  });

  it('sólo el nombre igual NO bloquea: queda para la revisión de posible duplicado', () => {
    const plan = planImportIdentityAdmission(
      [row({ rowNumber: 1, name: 'Acme SAS', domain: 'acme-otra.com' })],
      [active()],
    );
    assert.equal(plan[0].kind, 'admitted');
  });

  it('una fila duplicada de un activo no le gana a la siguiente del archivo', () => {
    const plan = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, domain: 'acme.com.co' }),
        row({ rowNumber: 2, name: 'Acme dos', domain: 'acme.com.co' }),
      ],
      [active()],
    );
    assert.ok(plan.every((p) => p.kind === 'duplicate' && p.reason === 'active_candidate_domain'));
  });
});

describe('collectImportDomains', () => {
  it('canonicaliza y deduplica dominios del archivo', () => {
    const domains = collectImportDomains([
      row({ rowNumber: 1, domain: 'www.acme.com.co' }),
      row({ rowNumber: 2, website: 'https://ACME.com.co/x' }),
      row({ rowNumber: 3 }),
    ]);
    assert.deepEqual(domains, ['acme.com.co']);
  });
});

describe('resolveImportExistingCompanyDuplicate — paridad con candidate-scorer', () => {
  it('cuenta existente en SellUp → duplicate', () => {
    assert.equal(
      resolveImportExistingCompanyDuplicate({
        sellup_duplicate_check: { status: 'duplicate', matched_source: 'account' },
        hubspot_duplicate_check: { status: 'no_match' },
      }),
      'existing_account',
    );
  });

  it('coincidencia exacta en HubSpot → duplicate', () => {
    assert.equal(
      resolveImportExistingCompanyDuplicate({
        sellup_duplicate_check: { status: 'no_match' },
        hubspot_duplicate_check: { status: 'match' },
      }),
      'existing_in_hubspot',
    );
  });

  it('posible coincidencia en HubSpot NO es duplicado', () => {
    assert.equal(
      resolveImportExistingCompanyDuplicate({
        sellup_duplicate_check: { status: 'possible_duplicate' },
        hubspot_duplicate_check: { status: 'possible_match' },
      }),
      null,
    );
  });

  it('coincidencia con otro CANDIDATO no decide aquí (lo deciden guarda y reclamos)', () => {
    assert.equal(
      resolveImportExistingCompanyDuplicate({
        sellup_duplicate_check: { status: 'duplicate', matched_source: 'prospect_candidate' },
        hubspot_duplicate_check: { status: 'no_match' },
      }),
      null,
    );
  });
});

describe('toImportAdmissionMetadata', () => {
  it('no guarda nombres ni valores fiscales, sólo la decisión', () => {
    const [, dup] = planImportIdentityAdmission(
      [
        row({ rowNumber: 1, taxIdentifier: '900123456-7' }),
        row({ rowNumber: 2, taxIdentifier: '900123456' }),
      ],
      [],
    );
    const meta = toImportAdmissionMetadata(dup);
    assert.deepEqual(meta, {
      decision: 'duplicate',
      reason: 'intra_file_duplicate',
      signal: 'fiscal_identity',
      duplicate_of_row: 1,
    });
  });
});
