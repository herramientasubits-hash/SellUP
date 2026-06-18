/**
 * Tests — Sentence/phrase name detection + Corrida 1 quality hardening (Hito 16AB.43.20)
 *
 * Verifica que:
 *   1. isSentenceOrPhraseName rechaza nombres que son frases/oraciones
 *   2. isSentenceOrPhraseName acepta nombres de empresa válidos
 *   3. Nuevos dominios bloqueados (yahoo.com, colombiaedtech.org)
 *   4. classifySearchResult rechaza los dominios de Corrida 1 que debían filtrarse
 *   5. Empresas válidas de Corrida 1 pasan los filtros
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSentenceOrPhraseName,
  classifySearchResult,
  isProspectableCompanyResult,
} from '../noise-filter';

// ── SN1: Nombres claramente inválidos (frases/oraciones) ─────────────────────

describe('SN1: isSentenceOrPhraseName rejects verb-conjugation names', () => {
  it('rejects "Trabajamos por fortalecer y representar"', () => {
    assert.equal(isSentenceOrPhraseName('Trabajamos por fortalecer y representar'), true);
  });

  it('rejects "Colaboramos con empresas líderes"', () => {
    assert.equal(isSentenceOrPhraseName('Colaboramos con empresas líderes'), true);
  });

  it('rejects "Fortaleciendo el ecosistema EdTech"', () => {
    assert.equal(isSentenceOrPhraseName('Fortaleciendo el ecosistema EdTech'), true);
  });

  it('rejects "Impulsamos el desarrollo tecnológico"', () => {
    assert.equal(isSentenceOrPhraseName('Impulsamos el desarrollo tecnológico'), true);
  });

  it('rejects "Brindamos soluciones innovadoras"', () => {
    assert.equal(isSentenceOrPhraseName('Brindamos soluciones innovadoras'), true);
  });

  it('rejects "Conectamos empresas con talento"', () => {
    assert.equal(isSentenceOrPhraseName('Conectamos empresas con talento'), true);
  });
});

// ── SN2: Titulares noticiosos ─────────────────────────────────────────────────

describe('SN2: isSentenceOrPhraseName rejects news headlines', () => {
  it('rejects "La fintech Cobre será la primera"', () => {
    assert.equal(isSentenceOrPhraseName('La fintech Cobre será la primera'), true);
  });

  it('rejects "El banco digital fue la primera opción"', () => {
    assert.equal(isSentenceOrPhraseName('El banco digital fue la primera opción'), true);
  });

  it('rejects "La startup lanzó su nueva plataforma"', () => {
    assert.equal(isSentenceOrPhraseName('La startup lanzó su nueva plataforma'), true);
  });
});

// ── SN3: Categorías con dos puntos ───────────────────────────────────────────

describe('SN3: isSentenceOrPhraseName rejects colon-separated section titles', () => {
  it('rejects "Fintech y pagos masivos: inclusión financiera"', () => {
    assert.equal(isSentenceOrPhraseName('Fintech y pagos masivos: inclusión financiera'), true);
  });

  it('rejects "Empresas de tecnología: guía completa de servicios"', () => {
    assert.equal(isSentenceOrPhraseName('Empresas de tecnología: guía completa de servicios'), true);
  });
});

// ── SN4: Nombres de sección de contenido ─────────────────────────────────────

describe('SN4: isSentenceOrPhraseName rejects content section names', () => {
  it('rejects "Guía y reseñas"', () => {
    assert.equal(isSentenceOrPhraseName('Guía y reseñas'), true);
  });

  it('rejects "Cómo elegir el mejor software"', () => {
    assert.equal(isSentenceOrPhraseName('Cómo elegir el mejor software'), true);
  });

  it('rejects "Aprende sobre tecnología empresarial"', () => {
    assert.equal(isSentenceOrPhraseName('Aprende sobre tecnología empresarial'), true);
  });
});

// ── SN5: Nombres largos sin sufijo legal ─────────────────────────────────────

describe('SN5: isSentenceOrPhraseName rejects overly long names without legal suffix', () => {
  it('rejects 8-word name without legal suffix', () => {
    assert.equal(
      isSentenceOrPhraseName('Soluciones de tecnología para empresas del sector financiero digital'),
      true,
    );
  });
});

// ── SN6: Nombres de empresa válidos que NO deben rechazarse ──────────────────

describe('SN6: isSentenceOrPhraseName accepts valid company names', () => {
  it('accepts "Loopay"', () => {
    assert.equal(isSentenceOrPhraseName('Loopay'), false);
  });

  it('accepts "Loggro"', () => {
    assert.equal(isSentenceOrPhraseName('Loggro'), false);
  });

  it('accepts "Puntored"', () => {
    assert.equal(isSentenceOrPhraseName('Puntored'), false);
  });

  it('accepts "Intive"', () => {
    assert.equal(isSentenceOrPhraseName('Intive'), false);
  });

  it('accepts "Educa EdTech"', () => {
    assert.equal(isSentenceOrPhraseName('Educa EdTech'), false);
  });

  it('accepts "Komet Sales"', () => {
    assert.equal(isSentenceOrPhraseName('Komet Sales'), false);
  });

  it('accepts "Siesa Enterprise"', () => {
    assert.equal(isSentenceOrPhraseName('Siesa Enterprise'), false);
  });

  it('accepts "Pragma S.A.S."', () => {
    assert.equal(isSentenceOrPhraseName('Pragma S.A.S.'), false);
  });

  it('accepts "Accenture" (single word)', () => {
    assert.equal(isSentenceOrPhraseName('Accenture'), false);
  });

  it('accepts "Heinsohn Business Technology"', () => {
    assert.equal(isSentenceOrPhraseName('Heinsohn Business Technology'), false);
  });

  it('accepts "La Polar S.A." (legal suffix preserves)', () => {
    assert.equal(isSentenceOrPhraseName('La Polar S.A.'), false);
  });
});

// ── SN7: Dominio yahoo.com ahora bloqueado en noise-filter ───────────────────

describe('SN7: yahoo.com blocked as news_or_media', () => {
  it('blocks noticias.yahoo.com as news_or_media', () => {
    const result = classifySearchResult({
      url: 'https://noticias.yahoo.com/la-fintech-cobre',
      title: 'La fintech Cobre será la primera en integrarse',
      snippet: 'Cobre anunció hoy su nueva integración',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'news_or_media');
  });

  it('blocks es-us.noticias.yahoo.com as news_or_media', () => {
    const result = classifySearchResult({
      url: 'https://es-us.noticias.yahoo.com/articulo-fintech',
      title: 'Fintech y pagos masivos: inclusión financiera en LATAM',
      snippet: '',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'news_or_media');
  });

  it('isProspectableCompanyResult returns false for yahoo.com', () => {
    const result = isProspectableCompanyResult({
      url: 'https://finance.yahoo.com/company-profile',
      title: 'Company Financial Profile',
    });
    assert.equal(result.isProspectable, false);
  });
});

// ── SN8: colombiaedtech.org bloqueado como association ───────────────────────

describe('SN8: colombiaedtech.org blocked as association_or_chamber', () => {
  it('blocks colombiaedtech.org', () => {
    const result = classifySearchResult({
      url: 'https://colombiaedtech.org',
      title: 'Colombia EdTech | Fortaleciendo el ecosistema EdTech',
      snippet: 'Asociación del sector EdTech en Colombia',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'association_or_chamber');
  });

  it('isProspectableCompanyResult returns false for colombiaedtech.org', () => {
    const result = isProspectableCompanyResult({
      url: 'https://colombiaedtech.org/miembros',
      title: 'Miembros del ecosistema EdTech Colombia',
    });
    assert.equal(result.isProspectable, false);
  });
});

// ── SN9: Empresas válidas de Corrida 1 pasan los filtros ─────────────────────

describe('SN9: Valid Corrida 1 companies pass noise filter', () => {
  it('loopay.com passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://loopay.com',
      title: 'Loopay | Pagos digitales para Colombia',
      snippet: 'Plataforma de pagos',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });

  it('loggro.com passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://loggro.com',
      title: 'Loggro | ERP para PyMEs colombianas',
      snippet: 'Software empresarial',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });

  it('puntored.co passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://puntored.co',
      title: 'Puntored | Red de pagos Colombia',
      snippet: 'Soluciones de pagos masivos',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });

  it('educaedtech.com passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://educaedtech.com',
      title: 'Educa EdTech | Plataforma de aprendizaje',
      snippet: 'Empresa EdTech',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });

  it('intive.com passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://intive.com',
      title: 'Intive | Software engineering',
      snippet: 'Global IT company',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });
});

// ── SN10: Mixed batch — writer recibe solo candidatos válidos ─────────────────

describe('SN10: isSentenceOrPhraseName correctly partitions a mixed batch', () => {
  const NOISY_NAMES = [
    'Trabajamos por fortalecer y representar',
    'Colaboramos con empresas líderes del sector',
    'Fortaleciendo el ecosistema EdTech',
    'La fintech Cobre será la primera en Colombia',
    'Fintech y pagos masivos: inclusión financiera',
    'Guía y reseñas',
  ];

  const VALID_NAMES = [
    'Loopay',
    'Loggro',
    'Puntored',
    'Intive',
  ];

  it('all noisy names are rejected', () => {
    for (const name of NOISY_NAMES) {
      assert.equal(
        isSentenceOrPhraseName(name),
        true,
        `Expected "${name}" to be rejected as sentence/phrase`,
      );
    }
  });

  it('all valid names are accepted', () => {
    for (const name of VALID_NAMES) {
      assert.equal(
        isSentenceOrPhraseName(name),
        false,
        `Expected "${name}" to be accepted as company name`,
      );
    }
  });

  it('batch of 10 with 6 noisy + 4 valid → 4 pass filter', () => {
    const ALL = [...NOISY_NAMES, ...VALID_NAMES];
    const passed = ALL.filter((n) => !isSentenceOrPhraseName(n));
    assert.equal(passed.length, 4);
  });
});

// ── SN11: isSentenceOrPhraseName edge cases ────────────────────────────────────

describe('SN11: isSentenceOrPhraseName edge cases', () => {
  it('rejects empty string', () => {
    assert.equal(isSentenceOrPhraseName(''), true);
  });

  it('rejects whitespace-only string', () => {
    assert.equal(isSentenceOrPhraseName('   '), true);
  });

  it('accepts single-word names', () => {
    assert.equal(isSentenceOrPhraseName('Rappi'), false);
    assert.equal(isSentenceOrPhraseName('Nequi'), false);
  });

  it('accepts two-word names', () => {
    assert.equal(isSentenceOrPhraseName('Digital House'), false);
  });

  it('accepts names with numbers', () => {
    assert.equal(isSentenceOrPhraseName('A4N'), false);
    assert.equal(isSentenceOrPhraseName('3Scale'), false);
  });
});
