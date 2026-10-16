/**
 * AGENT1-AUDIT-WS1 — «aprobar identificador fiscal».
 *
 * Defectos que cubre:
 *   · cambiaba el identificador en cualquier estado del candidato;
 *   · `?? 'CO'`: sin país, el identificador se trataba como NIT colombiano;
 *   · la comprobación de duplicados guardada (hecha con el identificador viejo)
 *     seguía mandando;
 *   · `approved_by` guardaba el id de AUTH, no el usuario interno;
 *   · la identidad fiscal nueva no se reclamaba («una empresa, un vendedor»).
 *
 * Reglas puras + guarda estática de la ruta. Sin red ni base.
 *
 * Correr: node --import tsx --test src/app/api/prospect-candidates/approve-tax-identifier/__tests__/approve-tax-identifier.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS,
  DUPLICATE_CHECK_STALE_REASON,
  markDuplicateChecksStale,
  resolveCandidateCountryCode,
  summarizeTaxIdentifierClaim,
} from '../approve-tax-identifier-core';

const AT = '2026-10-16T13:15:00.000Z';

describe('país del candidato', () => {
  it('usa el país real en ISO-2 mayúsculas', () => {
    assert.equal(resolveCandidateCountryCode('mx'), 'MX');
    assert.equal(resolveCandidateCountryCode(' PE '), 'PE');
  });

  it('sin país (o basura) devuelve null: nunca se inventa Colombia', () => {
    for (const value of [null, undefined, '', '  ', 'Colombia', 'C0', 12]) {
      assert.equal(resolveCandidateCountryCode(value), null, String(value));
    }
  });
});

describe('comprobación de duplicados desactualizada', () => {
  it('marca las dos formas guardadas sin mutar la metadata original', () => {
    const original = {
      keep: 1,
      duplicate_check: { status: 'no_match', matches: [] },
      validation: {
        validated_by: 'u',
        sellup_duplicate_check: { status: 'no_match' },
        hubspot_duplicate_check: { status: 'possible_match', matched_company_id: 'hs-1' },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const next = markDuplicateChecksStale(original, {
      markedAt: AT,
      previousTaxIdentifier: '900111222',
      newTaxIdentifier: '900333444',
    });

    assert.deepEqual(original, snapshot, 'inmutable');
    assert.equal(next.keep, 1);
    assert.deepEqual(next.duplicate_check_stale, {
      reason: DUPLICATE_CHECK_STALE_REASON,
      marked_at: AT,
      previous_tax_identifier: '900111222',
      new_tax_identifier: '900333444',
    });
    const dc = next.duplicate_check as Record<string, unknown>;
    assert.equal(dc.stale, true);
    assert.equal(dc.status, 'no_match', 'el veredicto viejo se conserva, marcado');
    const validation = next.validation as Record<string, Record<string, unknown>>;
    assert.equal(validation.sellup_duplicate_check.stale, true);
    assert.equal(validation.hubspot_duplicate_check.stale, true);
    assert.equal(validation.hubspot_duplicate_check.matched_company_id, 'hs-1');
    assert.equal((validation as Record<string, unknown>).validated_by, 'u');
  });

  it('sin comprobaciones guardadas sólo deja el aviso', () => {
    const next = markDuplicateChecksStale({}, { markedAt: AT, previousTaxIdentifier: null, newTaxIdentifier: '1' });
    assert.deepEqual(Object.keys(next), ['duplicate_check_stale']);
  });
});

describe('reclamo de la identidad fiscal nueva', () => {
  it('degradado ⇒ nadie se marca', () => {
    assert.deepEqual(summarizeTaxIdentifierClaim('c', { claimedElsewhere: [], degraded: true }), { status: 'degraded' });
  });

  it('otro candidato vivo ya la tenía ⇒ claimed_elsewhere', () => {
    assert.deepEqual(
      summarizeTaxIdentifierClaim('c', { claimedElsewhere: [{ candidateId: 'c', providerCompanyId: null }], degraded: false }),
      { status: 'claimed_elsewhere' },
    );
  });

  it('sin choque ⇒ claimed', () => {
    assert.deepEqual(summarizeTaxIdentifierClaim('c', { claimedElsewhere: [], degraded: false }), { status: 'claimed' });
  });
});

describe('la ruta', () => {
  const route = readFileSync(
    path.join(process.cwd(), 'src/app/api/prospect-candidates/approve-tax-identifier/route.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('sólo aprueba en revisión, y valla la escritura por ese estado', () => {
    assert.equal(APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS, 'needs_review');
    assert.match(route, /candidate\.status !== APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS/);
    assert.match(route, /\.eq\('status', APPROVE_TAX_IDENTIFIER_ALLOWED_STATUS\)/);
  });

  it('no inventa Colombia', () => {
    assert.doesNotMatch(route, /\?\?\s*'CO'/);
    assert.match(route, /resolveCandidateCountryCode\(candidate\.country_code\)/);
  });

  it('approved_by = usuario interno activo', () => {
    assert.match(route, /from\('internal_users'\)[\s\S]*?\.eq\('access_status', 'active'\)/);
    assert.match(route, /approved_by: internalUser\.id/);
    assert.doesNotMatch(route, /approved_by: user\.id/);
  });

  it('marca la comprobación de duplicados y reclama la identidad nueva con el cliente de servicio', () => {
    assert.match(route, /markDuplicateChecksStale\(/);
    assert.match(route, /claimGlobalIdentitiesForPersistedCandidates\(admin, batchId, \[candidateId\]\)/);
    assert.match(route, /globalIdentityClaim: claim/);
  });
});
