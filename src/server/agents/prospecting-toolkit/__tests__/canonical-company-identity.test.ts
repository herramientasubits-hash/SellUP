/**
 * Tests — Canonical Company Identity (Hito 16AB.43.25)
 *
 * Verifica:
 *   - buildIdentityKey colapsa variantes con descriptores de marca al final
 *   - buildIdentityKey normaliza sufijos legales
 *   - buildCanonicalCompanyIdentity detecta frases no-empresa (conjunction)
 *   - buildCanonicalCompanyIdentity detecta frases todo-categoría
 *   - Empresas válidas pasan sin bloqueo
 *   - Empresas con "Business School" no se sobrecolapsan
 *
 * Sin llamadas externas. Sin Supabase. Sin LLM.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalCompanyIdentity,
  buildIdentityKey,
} from '../canonical-company-identity';

// ─── Identity key collapsing ──────────────────────────────────────────────────

describe('buildIdentityKey — descriptores de marca al final', () => {
  it('Siesa Enterprise → siesa', () => {
    assert.equal(buildIdentityKey('Siesa Enterprise'), 'siesa');
  });

  it('Loggro Enterprise → loggro', () => {
    assert.equal(buildIdentityKey('Loggro Enterprise'), 'loggro');
  });

  it('EDUCA EDTECH Group → educa edtech', () => {
    assert.equal(buildIdentityKey('EDUCA EDTECH Group'), 'educa edtech');
  });

  it('SIESA S.A.S. → siesa', () => {
    assert.equal(buildIdentityKey('SIESA S.A.S.'), 'siesa');
  });

  it('Siigo SAS → siigo', () => {
    assert.equal(buildIdentityKey('Siigo SAS'), 'siigo');
  });

  it('Softland → softland', () => {
    assert.equal(buildIdentityKey('Softland'), 'softland');
  });

  it('Contarerp → contarerp', () => {
    assert.equal(buildIdentityKey('Contarerp'), 'contarerp');
  });

  it('Mokev.net → mokev net (punto normalizado a espacio)', () => {
    // El punto se normaliza a espacio; identityKey sigue siendo útil para dedup
    assert.equal(buildIdentityKey('Mokev.net'), 'mokev net');
  });
});

describe('buildIdentityKey — no sobrecolapsar marcas distintas', () => {
  it('IEBS Business School no queda solo "iebs"', () => {
    // Business School es parte de la identidad de IEBS
    const key = buildIdentityKey('IEBS Business School');
    // "business" y "school" no son trailing brand descriptors → se mantienen
    assert.equal(key, 'iebs business school');
  });

  it('Softland ≠ Softland Global (identity keys distintas)', () => {
    // "Global" al final sí es descriptor → colapsa
    assert.equal(buildIdentityKey('Softland'), 'softland');
    assert.equal(buildIdentityKey('Softland Global'), 'softland');
    // Misma identity key — intencionalmente (son la misma empresa)
  });

  it('Siesa Enterprise y Siesa tienen la misma identity key', () => {
    assert.equal(buildIdentityKey('Siesa Enterprise'), buildIdentityKey('Siesa'));
  });

  it('Contarerp y Softland no colapsan entre sí', () => {
    assert.notEqual(buildIdentityKey('Contarerp'), buildIdentityKey('Softland'));
  });

  it('Educa EdTech mantiene identidad clara', () => {
    const key = buildIdentityKey('Educa EdTech');
    assert.ok(key.includes('educa'), `Expected "educa" in key: ${key}`);
  });
});

// ─── Non-company phrase detection ────────────────────────────────────────────

describe('buildCanonicalCompanyIdentity — frases con conjunción', () => {
  it('SaaS y plataformas → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('SaaS y plataformas');
    assert.equal(result.isNonCompanyPhrase, true);
    assert.equal(result.identityKey, '');
  });

  it('Soluciones y tecnología → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Soluciones y tecnología');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('Software y servicios → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Software y servicios');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('Plataformas y soluciones → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Plataformas y soluciones');
    assert.equal(result.isNonCompanyPhrase, true);
  });
});

describe('buildCanonicalCompanyIdentity — frases todo-categoría', () => {
  it('Software empresarial → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Software empresarial');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('Plataformas LMS → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Plataformas LMS');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('Software ERP → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Software ERP');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('Soluciones tecnológicas → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('Soluciones tecnológicas');
    assert.equal(result.isNonCompanyPhrase, true);
  });
});

describe('buildCanonicalCompanyIdentity — empresas válidas (no bloqueadas)', () => {
  it('Contarerp → isNonCompanyPhrase: false', () => {
    const result = buildCanonicalCompanyIdentity('Contarerp');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.equal(result.identityKey, 'contarerp');
  });

  it('Softland → isNonCompanyPhrase: false', () => {
    const result = buildCanonicalCompanyIdentity('Softland');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.equal(result.identityKey, 'softland');
  });

  it('IEBS Business School → isNonCompanyPhrase: false', () => {
    const result = buildCanonicalCompanyIdentity('IEBS Business School');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.ok(result.identityKey.length > 0);
  });

  it('Loggro Enterprise → isNonCompanyPhrase: false', () => {
    const result = buildCanonicalCompanyIdentity('Loggro Enterprise');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.equal(result.identityKey, 'loggro');
  });

  it('Siesa Enterprise → isNonCompanyPhrase: false', () => {
    const result = buildCanonicalCompanyIdentity('Siesa Enterprise');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.equal(result.identityKey, 'siesa');
  });
});

describe('buildCanonicalCompanyIdentity — casos límite', () => {
  it('cadena vacía → isNonCompanyPhrase: true', () => {
    const result = buildCanonicalCompanyIdentity('');
    assert.equal(result.isNonCompanyPhrase, true);
  });

  it('preserva rawName en todos los casos', () => {
    const raw = 'Siesa Enterprise';
    const result = buildCanonicalCompanyIdentity(raw);
    assert.equal(result.rawName, raw);
  });

  it('frase con sufijo legal no se bloquea como categoría', () => {
    // "Software SAS" tiene sufijo legal → no es una frase genérica
    const result = buildCanonicalCompanyIdentity('Software SAS');
    assert.equal(result.isNonCompanyPhrase, false);
    assert.ok(result.identityKey.length > 0);
  });
});
