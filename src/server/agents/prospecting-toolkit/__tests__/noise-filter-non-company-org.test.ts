/**
 * Tests — Non-company org detection (Hito 16AB.43.14)
 *
 * Verifica que eventos, congresos y cámaras de comercio sean clasificados
 * correctamente como no-empresa por el noise filter. Cubre:
 *   - Bloqueo por dominio (ASSOCIATION_CHAMBER_DOMAINS)
 *   - Bloqueo semántico por título (detectNonCompanyOrg)
 *   - Falsos positivos conocidos que NO deben filtrarse
 *   - isProspectableCompanyResult como segunda defensa
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySearchResult, isProspectableCompanyResult } from '../noise-filter';

// ── NC1: andicom.co bloqueado por dominio ─────────────────────────────────────

describe('NC1: andicom.co blocked by ASSOCIATION_CHAMBER_DOMAINS', () => {
  it('shouldKeep is false', () => {
    const result = classifySearchResult({
      url: 'https://andicom.co',
      title: 'ANDICOM | Congreso de TIC',
      snippet: 'El congreso más importante de tecnología en Colombia',
    });
    assert.equal(result.shouldKeep, false);
  });

  it('resultType is association_or_chamber', () => {
    const result = classifySearchResult({
      url: 'https://www.andicom.co/2025',
      title: 'ANDICOM 2025',
      snippet: '',
    });
    assert.equal(result.resultType, 'association_or_chamber');
  });
});

// ── NC2: ccc.org.co bloqueado por dominio ─────────────────────────────────────

describe('NC2: ccc.org.co blocked by ASSOCIATION_CHAMBER_DOMAINS', () => {
  it('shouldKeep is false', () => {
    const result = classifySearchResult({
      url: 'https://www.ccc.org.co',
      title: 'Cámara de Comercio de Cali',
      snippet: '',
    });
    assert.equal(result.shouldKeep, false);
  });

  it('resultType is association_or_chamber', () => {
    const result = classifySearchResult({
      url: 'https://ccc.org.co/servicios',
      title: 'Servicios empresariales — Cámara de Comercio de Cali',
      snippet: '',
    });
    assert.equal(result.resultType, 'association_or_chamber');
  });
});

// ── NC3: evento detectado por título (dominio desconocido) ────────────────────

describe('NC3: event detected semantically by title', () => {
  it('blocks "Congreso de Tecnología" title as event_or_congress', () => {
    const result = classifySearchResult({
      url: 'https://techforum2025.co',
      title: 'Congreso de Tecnología e Innovación Colombia 2025',
      snippet: 'Evento anual de tecnología',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'event_or_congress');
  });

  it('blocks "Feria de " in title as event_or_congress', () => {
    const result = classifySearchResult({
      url: 'https://feriatech.com.co',
      title: 'Feria de Innovación Digital Colombia',
      snippet: '',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'event_or_congress');
  });
});

// ── NC4: cámara detectada por título (dominio desconocido) ────────────────────

describe('NC4: chamber detected semantically by title', () => {
  it('blocks "Cámara de Comercio de X" title', () => {
    const result = classifySearchResult({
      url: 'https://ccantioquia.org.co',
      title: 'Cámara de Comercio de Antioquia',
      snippet: '',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'association_or_chamber');
  });

  it('blocks "Chamber of Commerce" in snippet', () => {
    const result = classifySearchResult({
      url: 'https://examplecc.org.co',
      title: 'Servicios empresariales',
      snippet: 'Somos la chamber of commerce de la región',
    });
    assert.equal(result.shouldKeep, false);
    assert.equal(result.resultType, 'association_or_chamber');
  });
});

// ── NC5: empresa .org corporativa válida — no filtrar ────────────────────────

describe('NC5: valid .org corporate site not filtered', () => {
  it('dragonjar.org (cybersec) passes as official_company_site', () => {
    const result = classifySearchResult({
      url: 'https://dragonjar.org',
      title: 'DragonJAR | Seguridad Informática Colombia',
      snippet: 'Empresa líder en ciberseguridad',
    });
    assert.equal(result.shouldKeep, true);
    assert.equal(result.resultType, 'official_company_site');
  });
});

// ── NC6: empresa con path /events — no filtrar ───────────────────────────────

describe('NC6: company with /events path not filtered by path alone', () => {
  it('eventtech.com.co/events kept when title has no strong event terms', () => {
    const result = classifySearchResult({
      url: 'https://eventtech.com.co/events',
      title: 'EventTech | Plataforma para Gestión de Eventos Corporativos',
      snippet: '',
    });
    assert.equal(result.shouldKeep, true);
  });
});

// ── NC7: software para eventos — no filtrar (corporate override) ──────────────

describe('NC7: event management software company not filtered', () => {
  it('"Software para gestión de eventos B2B" title passes corporate override', () => {
    const result = classifySearchResult({
      url: 'https://eventsoftware.com.co',
      title: 'EventManager | Software para gestión de eventos B2B',
      snippet: '',
    });
    assert.equal(result.shouldKeep, true);
  });

  it('"Plataforma de organización de eventos empresariales" passes corporate override', () => {
    const result = classifySearchResult({
      url: 'https://eventosbiz.co',
      title: 'EventosBiz | Plataforma de organización de eventos empresariales',
      snippet: '',
    });
    assert.equal(result.shouldKeep, true);
  });
});

// ── NC8: defensa del scorer — isProspectableCompanyResult también bloquea ─────

describe('NC8: isProspectableCompanyResult blocks non-company orgs', () => {
  it('andicom.co is not prospectable', () => {
    const result = isProspectableCompanyResult({
      url: 'https://andicom.co',
      title: 'ANDICOM',
      snippet: '',
    });
    assert.equal(result.isProspectable, false);
  });

  it('event title with unknown domain is not prospectable', () => {
    const result = isProspectableCompanyResult({
      url: 'https://cumbretech2025.co',
      title: 'Cumbre de Transformación Digital Colombia 2025',
      snippet: '',
    });
    assert.equal(result.isProspectable, false);
    assert.equal(result.resultType, 'event_or_congress');
  });

  it('chamber title with unknown domain is not prospectable', () => {
    const result = isProspectableCompanyResult({
      url: 'https://ccregional.org.co',
      title: 'Cámara de Comercio Regional',
      snippet: '',
    });
    assert.equal(result.isProspectable, false);
    assert.equal(result.resultType, 'association_or_chamber');
  });
});
