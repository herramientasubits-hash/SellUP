import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeColombiaCompanyName,
  normalizeColombiaCompanyNameExact,
} from '../normalize-name';
import {
  isNameTooGeneric,
  hasDomainSignal,
  buildCandidate,
  findExactMatch,
  findPartialMatches,
} from '../resolve-candidate-tax-identifier-colombia';

// ─── 1. Normalización de nombres Colombia ────────────────────────────────────

describe('normalizeColombiaCompanyName', () => {
  it('removes S.A.S. suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Acti S.A.S.'),
      'acti',
    );
  });

  it('removes SAS suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Acti SAS'),
      'acti',
    );
  });

  it('removes S.A.S suffix variant', () => {
    assert.equal(
      normalizeColombiaCompanyName('Acti S.A.S'),
      'acti',
    );
  });

  it('removes LTDA suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Empresa Tech Ltda'),
      'empresa tech',
    );
  });

  it('removes S.A. suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Comercializadora ABC S.A.'),
      'comercializadora abc',
    );
  });

  it('removes SA suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Comercializadora ABC SA'),
      'comercializadora abc',
    );
  });

  it('removes S.A. de C.V. suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Empresa MX S.A. de C.V.'),
      'empresa mx',
    );
  });

  it('removes accent marks', () => {
    assert.equal(
      normalizeColombiaCompanyName('Tecnología Avanzada SAS'),
      'tecnologia avanzada',
    );
  });

  it('handles uppercase and lowercase normalization', () => {
    assert.equal(
      normalizeColombiaCompanyName('ACTI S.A.S.'),
      'acti',
    );
  });

  it('removes dots and commas', () => {
    assert.equal(
      normalizeColombiaCompanyName('Grupo Éxito, S.A.'),
      'grupo exito',
    );
  });

  it('removes S.R.L. suffix', () => {
    assert.equal(
      normalizeColombiaCompanyName('Distribuciones XYZ S.R.L.'),
      'distribuciones xyz',
    );
  });

  it('handles complex real-world name', () => {
    assert.equal(
      normalizeColombiaCompanyName('Rappi Colombia S.A.S.'),
      'rappi colombia',
    );
  });

  it('removes generic stop words for search normalization', () => {
    assert.equal(
      normalizeColombiaCompanyName('La Casa del Software SAS'),
      'casa software',
    );
  });

  it('empty string returns empty', () => {
    assert.equal(normalizeColombiaCompanyName(''), '');
  });

  it('whitespace-only returns empty', () => {
    assert.equal(normalizeColombiaCompanyName('   '), '');
  });

  it('handles S.A.S with spaces around dots', () => {
    assert.equal(
      normalizeColombiaCompanyName('Tech Solutions S . A . S'),
      'tech solutions',
    );
  });
});

describe('normalizeColombiaCompanyNameExact', () => {
  it('keeps stop words for exact matching', () => {
    const result = normalizeColombiaCompanyNameExact('La Casa del Software SAS');
    // The exact variant keeps all non-legal-suffix words
    assert.ok(result.includes('casa'));
    assert.ok(result.includes('software'));
  });

  it('removes legal suffix', () => {
    const result = normalizeColombiaCompanyNameExact('Mi Empresa SAS');
    assert.equal(result, 'mi empresa');
  });
});

// ─── 2. isNameTooGeneric ──────────────────────────────────────────────────────

describe('isNameTooGeneric', () => {
  it('returns true for very short name (single short token)', () => {
    assert.ok(isNameTooGeneric(['sa', 'de']));
  });

  it('returns true for single generic token', () => {
    assert.ok(isNameTooGeneric(['sa']));
  });

  it('returns false for meaningful name with multiple tokens', () => {
    assert.ok(!isNameTooGeneric(['acti', 'colombia']));
  });

  it('returns false for longer meaningful name', () => {
    assert.ok(!isNameTooGeneric(['tecnologia', 'avanzada', 'colombia']));
  });

  // ─── Single-token brand names with domain signals ─────────────────

  it('returns false for Softland single-token brand with domain softland.com', () => {
    assert.ok(!isNameTooGeneric(['softland'], 'softland.com'));
  });

  it('returns false for Kaizen single-token brand with domain containing kaizen', () => {
    assert.ok(!isNameTooGeneric(['kaizen'], 'kaizenempresarial.com'));
  });

  it('returns false for Cegid single-token brand with domain cegid.com', () => {
    assert.ok(!isNameTooGeneric(['cegid'], 'cegid.com'));
  });

  it('returns false for Loggro single-token brand with domain loggro.com', () => {
    assert.ok(!isNameTooGeneric(['loggro'], 'loggro.com'));
  });

  it('returns false for Softland with long token (>=5) even without domain', () => {
    assert.ok(!isNameTooGeneric(['softland']));
  });

  it('returns false for Buk with domain buk.com', () => {
    assert.ok(!isNameTooGeneric(['buk'], 'buk.com'));
  });

  // ─── Single-token short name without domain ───────────────────────

  it('returns true for single short token without domain signal', () => {
    assert.ok(isNameTooGeneric(['acti']));
  });

  // ─── Known generic keywords still skipped ─────────────────────────

  it('returns true for "software" single-token generic', () => {
    assert.ok(isNameTooGeneric(['software']));
  });

  it('returns true for "servicios" single-token generic', () => {
    assert.ok(isNameTooGeneric(['servicios']));
  });

  it('returns true for "tecnologia" single-token generic', () => {
    assert.ok(isNameTooGeneric(['tecnologia']));
  });

  it('returns true for "consultoria" single-token generic', () => {
    assert.ok(isNameTooGeneric(['consultoria']));
  });

  it('returns true for "soluciones" single-token generic', () => {
    assert.ok(isNameTooGeneric(['soluciones']));
  });

  it('returns true for "enterprise" single-token generic', () => {
    assert.ok(isNameTooGeneric(['enterprise']));
  });

  it('returns true for "colombia" single-token generic', () => {
    assert.ok(isNameTooGeneric(['colombia']));
  });

  it('returns true for "erp" single-token generic', () => {
    assert.ok(isNameTooGeneric(['erp']));
  });

  it('returns true for "crm" single-token generic', () => {
    assert.ok(isNameTooGeneric(['crm']));
  });

  it('returns true for generic "software" even with domain', () => {
    assert.ok(isNameTooGeneric(['software'], 'software.com'));
  });
});

// ─── 3. hasDomainSignal ─────────────────────────────────────────────────────────

describe('hasDomainSignal', () => {
  it('returns true when domain root matches token', () => {
    assert.ok(hasDomainSignal('softland', 'softland.com', null));
  });

  it('returns true when domain root matches token exact by root only', () => {
    assert.ok(hasDomainSignal('softland', 'https://softland.com', null));
  });

  it('returns true when domain contains token', () => {
    assert.ok(hasDomainSignal('kaizen', 'kaizenempresarial.com', null));
  });

  it('returns true when website contains token', () => {
    assert.ok(hasDomainSignal('cegid', null, 'https://cegid.com/co'));
  });

  it('returns false when domain is null and website is null', () => {
    assert.ok(!hasDomainSignal('softland', null, null));
  });

  it('returns false when domain is undefined', () => {
    assert.ok(!hasDomainSignal('softland', undefined, undefined));
  });

  it('returns false when domain has no relation to token', () => {
    assert.ok(!hasDomainSignal('softland', 'google.com', null));
  });

  it('is case insensitive', () => {
    assert.ok(hasDomainSignal('SoftLand', 'SOFTLAND.COM.CO', null));
  });

  it('handles www prefix in domain', () => {
    assert.ok(hasDomainSignal('softland', 'www.softland.com', null));
  });
});

// ─── 4. buildCandidate ────────────────────────────────────────────────────────

describe('buildCandidate', () => {
  it('builds candidate from snapshot row', () => {
    const row = {
      normalized_tax_id: '900123456',
      legal_name: 'Acti SAS',
      normalized_legal_name: 'acti',
      source_year: 2024,
    };

    const candidate = buildCandidate(row, 0.85, 'Exact match');

    assert.equal(candidate.taxIdentifier, '900123456');
    assert.equal(candidate.legalName, 'Acti SAS');
    assert.equal(candidate.sourceKey, 'co_siis');
    assert.equal(candidate.confidence, 0.85);
    assert.equal(candidate.reason, 'Exact match');
  });

  it('falls back to normalized_legal_name when legal_name is missing', () => {
    const row = {
      normalized_tax_id: '800123456',
      normalized_legal_name: 'empresa test',
    };

    const candidate = buildCandidate(row, 0.60, 'Partial match');
    assert.equal(candidate.legalName, 'empresa test');
  });

  it('handles empty normalized_tax_id', () => {
    const row = {
      normalized_tax_id: '',
      legal_name: 'Test',
    };

    const candidate = buildCandidate(row, 0.50, 'Low confidence');
    assert.equal(candidate.taxIdentifier, '');
  });
});

// ─── 5. findExactMatch ────────────────────────────────────────────────────────

describe('findExactMatch', () => {
  it('returns candidate for single exact match', () => {
    const rows = [
      { normalized_tax_id: '900123456', legal_name: 'Acti SAS', normalized_legal_name: 'acti' },
    ];

    const result = findExactMatch(rows, 'acti');
    assert.ok(result !== null);
    assert.equal(result!.taxIdentifier, '900123456');
    assert.equal(result!.confidence, 0.85);
  });

  it('returns null when no rows match the exact normalized name', () => {
    const rows = [
      { normalized_tax_id: '900123456', legal_name: 'Acti SAS', normalized_legal_name: 'acti colombia' },
    ];

    const result = findExactMatch(rows, 'acti');
    assert.equal(result, null);
  });

  it('returns null when multiple rows match exactly', () => {
    const rows = [
      { normalized_tax_id: '900111111', legal_name: 'Acti Uno SAS', normalized_legal_name: 'acti' },
      { normalized_tax_id: '900222222', legal_name: 'Acti Dos SAS', normalized_legal_name: 'acti' },
    ];

    const result = findExactMatch(rows, 'acti');
    assert.equal(result, null);
  });

  it('returns null for empty rows', () => {
    const result = findExactMatch([], 'acti');
    assert.equal(result, null);
  });
});

// ─── 6. findPartialMatches ────────────────────────────────────────────────────

describe('findPartialMatches', () => {
  it('returns single candidate for 80%+ token overlap', () => {
    const rows = [
      { normalized_tax_id: '900123456', legal_name: 'Acti SAS', normalized_legal_name: 'acti colombia tecnologia' },
      { normalized_tax_id: '800654321', legal_name: 'Otra Empresa', normalized_legal_name: 'otra cosa' },
    ];

    const result = findPartialMatches(rows, 'acti colombia');
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 0.60);
    assert.equal(result[0].taxIdentifier, '900123456');
  });

  it('returns multiple candidates when multiple rows match partially', () => {
    const rows = [
      { normalized_tax_id: '900111111', legal_name: 'Servicios Tech', normalized_legal_name: 'servicios tech bogota' },
      { normalized_tax_id: '900222222', legal_name: 'Tech Solutions', normalized_legal_name: 'tech soluciones medellin' },
    ];

    const result = findPartialMatches(rows, 'tech colombia');
    // Both have partial matches, none has 80% of tokens
    assert.ok(result.length >= 1);
    // All should be at 0.50 confidence (partial, not strong enough)
    assert.ok(result.every(c => c.confidence === 0.50));
  });

  it('returns empty array for no matches', () => {
    const rows = [
      { normalized_tax_id: '900123456', legal_name: 'Acti SAS', normalized_legal_name: 'acti colombia' },
    ];

    const result = findPartialMatches(rows, 'xyz nada');
    assert.equal(result.length, 0);
  });

  it('returns single high-confidence match when one row has all tokens and others partial', () => {
    const rows = [
      { normalized_tax_id: '900111111', legal_name: 'Tecnologia Avanzada SAS', normalized_legal_name: 'tecnologia avanzada colombia' },
      { normalized_tax_id: '900222222', legal_name: 'Tech Corp', normalized_legal_name: 'tech colombia' },
    ];

    const result = findPartialMatches(rows, 'tecnologia avanzada');
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 0.60);
    assert.equal(result[0].taxIdentifier, '900111111');
  });
});

// ─── 7. Resolver guard clauses ────────────────────────────────────────────────

describe('resolveCandidateTaxIdentifierForColombia — guard clauses', () => {
  it('returns skipped for non-CO country', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Acti SAS',
      countryCode: 'MX',
    });
    assert.equal(result.status, 'skipped');
  });

  it('returns skipped for empty name', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: '',
      countryCode: 'CO',
    });
    assert.equal(result.status, 'skipped');
  });

  it('returns skipped for short name (< 3 chars)', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'AB',
      countryCode: 'CO',
    });
    assert.equal(result.status, 'skipped');
  });

  it('returns error when Supabase is not configured', async () => {
    // Just verify the guard clause for getSupabaseClient
    const { getSupabaseClient } = await import('../resolve-candidate-tax-identifier-colombia');
    // In CI/test env, SUPABASE_SERVICE_ROLE_KEY is likely not set
    const client = getSupabaseClient();
    // If no key, getSupabaseClient returns null — this is expected
    if (!client) {
      const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
      // Use a name that passes the generic check but still needs Supabase
      const result = await resolveCandidateTaxIdentifierForColombia({
        name: 'Rappi Colombia SAS',
        countryCode: 'CO',
      });
      assert.equal(result.status, 'error');
      assert.equal(result.confidence, 0);
    }
  });
});

// ─── 8. Resolver — single-token brand domain flow ────────────────────────────

describe('resolveCandidateTaxIdentifierForColombia — single-token brand names', () => {
  it('does not return skipped for Softland with domain softland.com (generic check bypassed)', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Softland',
      domain: 'softland.com',
      countryCode: 'CO',
    });
    // It should NOT be skipped due to "Name too generic" — it may go further
    // (to 'error' if Supabase not available, or to actual resolution if configured)
    assert.notEqual(result.status, 'skipped');
  });

  it('does not return skipped for Kaizen with domain containing kaizen', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Kaizen',
      domain: 'kaizenempresarial.com',
      countryCode: 'CO',
    });
    assert.notEqual(result.status, 'skipped');
  });

  it('does not return skipped for Cegid with domain cegid.com', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Cegid',
      domain: 'cegid.com',
      countryCode: 'CO',
    });
    assert.notEqual(result.status, 'skipped');
  });

  it('does not return skipped for Long single-token brand (>=5 chars) without domain', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Softland',
      countryCode: 'CO',
    });
    assert.notEqual(result.status, 'skipped');
  });

  it('does return skipped for single-token generic keyword (Software)', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Software',
      countryCode: 'CO',
    });
    assert.equal(result.status, 'skipped');
  });

  it('does return skipped for single-token generic keyword with even with domain signal', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Software',
      domain: 'software.com',
      countryCode: 'CO',
    });
    assert.equal(result.status, 'skipped');
  });
});
