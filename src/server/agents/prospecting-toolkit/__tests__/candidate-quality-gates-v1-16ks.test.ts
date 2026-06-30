/**
 * Tests — v1.16K-S: Candidate Quality Gates Hardening
 *
 * Verifica que candidatos basura (repositorios documentales, directorios,
 * artículos de noticias/prensa) sean bloqueados ANTES de persistirse, y que
 * candidatos reales (Eclass, Edu Labs, Eulen) sigan pasando los gates.
 *
 * Sin IA. Sin llamadas externas. Sin Tavily real. Sin créditos. 100% determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySourceUrlQuality,
  isBlockedBySourceUrlQuality,
} from '../source-url-quality-gate';

import {
  isContentPageUrl,
} from '../candidate-writer';

// ─── DR: Gate de repositorios documentales ───────────────────────────────────

describe('DR1 — Unesdoc UNESCO: dominio → document_repository_page', () => {
  it('DR1-a: unesdoc.unesco.org con /ark:/ → bloqueado como document_repository_page', () => {
    const result = classifySourceUrlQuality(
      'https://unesdoc.unesco.org/ark:/48223/pf0000139970',
    );
    assert.ok(isBlockedBySourceUrlQuality(result), 'Unesdoc debe ser bloqueado');
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR1-b: unesdoc.unesco.org raíz → document_repository_page', () => {
    const result = classifySourceUrlQuality('https://unesdoc.unesco.org/');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR1-c: rankingBonus muy negativo para document_repository_page', () => {
    const result = classifySourceUrlQuality('https://unesdoc.unesco.org/ark:/48223/pf0000139970');
    assert.ok(result.rankingBonus <= -90, `rankingBonus debe ser ≤ -90, got ${result.rankingBonus}`);
  });
});

describe('DR2 — Path /ark:/ → document_repository_page', () => {
  it('DR2-a: cualquier dominio con /ark:/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://somesite.org/ark:/12345/abc');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });
});

describe('DR3 — URL con extensión .pdf → document_repository_page', () => {
  it('DR3-a: URL terminada en .pdf → bloqueada', () => {
    const result = classifySourceUrlQuality('https://empresa.com/docs/informe-anual-2024.pdf');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR3-b: PDF en subpath profundo → bloqueado', () => {
    const result = classifySourceUrlQuality('https://mineducacion.gov.co/portal/Decreto-123.pdf');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });
});

describe('DR4 — Paths de repositorio/biblioteca → document_repository_page', () => {
  it('DR4-a: /handle/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://repository.ucatolica.edu.co/handle/10983/123');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR4-b: /bitstream/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://repositorio.unal.edu.co/bitstream/1234/doc.pdf');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR4-c: /repositorio/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://example.com/repositorio/tesis/2024');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR4-d: /biblioteca/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://example.com/biblioteca/articulos/erp');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });

  it('DR4-e: /publication/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://idc.com/publication/report-2024');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'document_repository_page');
  });
});

// ─── DL: Gate de directorios y listados ──────────────────────────────────────

describe('DL1 — Kompass co.kompass.com: subdomain → directory_or_listing_page', () => {
  it('DL1-a: co.kompass.com/x/distributor/... → bloqueado como directory_or_listing_page', () => {
    const result = classifySourceUrlQuality(
      'https://co.kompass.com/x/distributor/s/educacion-formacion-y-organizaciones/14',
    );
    assert.ok(isBlockedBySourceUrlQuality(result), 'Kompass debe ser bloqueado');
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL1-b: kompass.com raíz → directory_or_listing_page', () => {
    const result = classifySourceUrlQuality('https://kompass.com/');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL1-c: es.kompass.com subdomain → directory_or_listing_page', () => {
    const result = classifySourceUrlQuality('https://es.kompass.com/empresa/empresa-x/123');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });
});

describe('DL2 — Path /distributor/ → directory_or_listing_page', () => {
  it('DL2-a: /distributor/ en cualquier dominio → bloqueado', () => {
    const result = classifySourceUrlQuality('https://directorio.com/distributor/empresa-x');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL2-b: /x/distributor/ (patrón Kompass-style) → bloqueado', () => {
    const result = classifySourceUrlQuality('https://sitio.com/x/distributor/s/categoria/1');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });
});

describe('DL3 — Paths de directorio/listado genéricos → directory_or_listing_page', () => {
  it('DL3-a: /directory/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://portal.com/directory/empresas-colombia');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL3-b: /directorio/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://portal.co/directorio/proveedores/ti');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL3-c: /listado/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://biz.com/listado/software-erp-colombia');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL3-d: /proveedores/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://portal.com/proveedores/tecnologia');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL3-e: /suppliers/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://platform.com/suppliers/erp');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });

  it('DL3-f: /catalog/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://platform.com/catalog/software-companies');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'directory_or_listing_page');
  });
});

// ─── CA: Gate de artículos/noticias/prensa de terceros ───────────────────────

describe('CA1 — Moodle noticias: /fr/nouvelles/ → bloqueado', () => {
  it('CA1-a: moodle.com/fr/nouvelles/... (artículo sobre Edu Labs) → content_article_third_party_mention', () => {
    const result = classifySourceUrlQuality(
      'https://moodle.com/fr/nouvelles/la-empresa-colombiana-experta-en-e-learning-edu-labs-expande-sus-servicios-como-partner-de-moodle-mexico-y-equuador',
    );
    assert.ok(isBlockedBySourceUrlQuality(result), 'Moodle nouvelles debe ser bloqueado');
    assert.equal(result.quality, 'content_article_third_party_mention');
  });

  it('CA1-b: /nouvelles/ en cualquier dominio → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/nouvelles/nota-sobre-otra-empresa');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });
});

describe('CA2 — Paths de prensa → content_article_third_party_mention', () => {
  it('CA2-a: /press/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/press/release-2024');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });

  it('CA2-b: /press-release/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/press-release/nueva-alianza');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });

  it('CA2-c: /comunicado/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/comunicado/expansion-colombia');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });
});

describe('CA3 — Paths de caso de éxito → content_article_third_party_mention', () => {
  it('CA3-a: /case-study/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/case-study/cliente-x-logros');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });

  it('CA3-b: /case-studies/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/case-studies/sector-educacion');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });

  it('CA3-c: /success-story/ → bloqueado', () => {
    const result = classifySourceUrlQuality('https://empresa.com/success-story/implementacion-erp');
    assert.ok(isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'content_article_third_party_mention');
  });
});

// ─── isContentPageUrl: Moodle nouvelles también bloqueado en content-page gate ─

describe('CP1 — isContentPageUrl amplía patrones de noticias/prensa', () => {
  it('CP1-a: /fr/nouvelles/ → isContentPageUrl = true', () => {
    assert.ok(
      isContentPageUrl('https://moodle.com/fr/nouvelles/la-empresa-colombiana-experta-en-e-learning-edu-labs-expande-sus-servicios-como-partner-de-moodle-mexico-y-equuador'),
      '/nouvelles/ debe detectarse como content page',
    );
  });

  it('CP1-b: /press/ → isContentPageUrl = true', () => {
    assert.ok(isContentPageUrl('https://empresa.com/press/comunicado-2024'));
  });

  it('CP1-c: /case-study/ → isContentPageUrl = true', () => {
    assert.ok(isContentPageUrl('https://empresa.com/case-study/implementacion-lms'));
  });

  it('CP1-d: /success-story/ → isContentPageUrl = true', () => {
    assert.ok(isContentPageUrl('https://empresa.com/success-story/cliente-x'));
  });

  it('CP1-e: /comunicado/ → isContentPageUrl = true', () => {
    assert.ok(isContentPageUrl('https://empresa.com/comunicado/expansion-colombia'));
  });
});

// ─── POS: Candidatos reales — deben seguir pasando ───────────────────────────

describe('POS1 — Eclass: página de solución corporativa → no bloqueada', () => {
  it('POS1-a: eclass.com/co/empresas/soluciones-a-la-medida → no bloqueado', () => {
    const result = classifySourceUrlQuality('https://www.eclass.com/co/empresas/soluciones-a-la-medida');
    assert.ok(!isBlockedBySourceUrlQuality(result), `Eclass no debe bloquearse (quality=${result.quality})`);
  });

  it('POS1-b: isContentPageUrl Eclass → false', () => {
    assert.ok(!isContentPageUrl('https://www.eclass.com/co/empresas/soluciones-a-la-medida'));
  });
});

describe('POS2 — Edu Labs: página de soluciones → no bloqueada', () => {
  it('POS2-a: edu-labs.co/soluciones-elearning-... → no bloqueado', () => {
    const result = classifySourceUrlQuality(
      'https://edu-labs.co/soluciones-elearning-ideales-para-el-aprendizaje-corporativo',
    );
    assert.ok(!isBlockedBySourceUrlQuality(result), `Edu Labs no debe bloquearse (quality=${result.quality})`);
  });

  it('POS2-b: isContentPageUrl Edu Labs → false', () => {
    assert.ok(!isContentPageUrl('https://edu-labs.co/soluciones-elearning-ideales-para-el-aprendizaje-corporativo'));
  });
});

describe('POS3 — Eulen: página de sector → no bloqueada', () => {
  it('POS3-a: eulen.com/co/sectores/educacion-y-ciencia → no bloqueado', () => {
    const result = classifySourceUrlQuality('https://www.eulen.com/co/sectores/educacion-y-ciencia');
    assert.ok(!isBlockedBySourceUrlQuality(result), `Eulen no debe bloquearse (quality=${result.quality})`);
  });

  it('POS3-b: isContentPageUrl Eulen → false', () => {
    assert.ok(!isContentPageUrl('https://www.eulen.com/co/sectores/educacion-y-ciencia'));
  });
});

describe('POS4 — Homepage corporativa válida → no bloqueada por ningún nuevo gate', () => {
  it('POS4-a: homepage raíz → official_homepage', () => {
    const result = classifySourceUrlQuality('https://sap.com/');
    assert.ok(!isBlockedBySourceUrlQuality(result));
    assert.equal(result.quality, 'official_homepage');
  });

  it('POS4-b: página de productos → no bloqueada', () => {
    const result = classifySourceUrlQuality('https://oracle.com/co/products/erp');
    assert.ok(!isBlockedBySourceUrlQuality(result));
  });

  it('POS4-c: página de sectores corporativa → no bloqueada', () => {
    const result = classifySourceUrlQuality('https://empresa.com/sectores/educacion');
    assert.ok(!isBlockedBySourceUrlQuality(result));
  });
});

// ─── INV: Invariantes de auditoría y no-regresión ────────────────────────────

describe('INV1 — Los nuevos quality types producen rankingBonus negativos', () => {
  it('INV1-a: document_repository_page rankingBonus < 0', () => {
    const r = classifySourceUrlQuality('https://unesdoc.unesco.org/ark:/48223/pf0000139970');
    assert.ok(r.rankingBonus < 0);
  });

  it('INV1-b: directory_or_listing_page rankingBonus < 0', () => {
    const r = classifySourceUrlQuality('https://co.kompass.com/x/distributor/s/cat/1');
    assert.ok(r.rankingBonus < 0);
  });

  it('INV1-c: content_article_third_party_mention rankingBonus < 0', () => {
    const r = classifySourceUrlQuality('https://moodle.com/fr/nouvelles/articulo-sobre-otra-empresa');
    assert.ok(r.rankingBonus < 0);
  });
});

describe('INV2 — Gates existentes no regresionan', () => {
  it('INV2-a: /blog/ sigue siendo blog_article', () => {
    const r = classifySourceUrlQuality('https://empresa.com/blog/articulo-tecnologia');
    assert.ok(isBlockedBySourceUrlQuality(r));
    assert.equal(r.quality, 'blog_article');
  });

  it('INV2-b: /lp/ sigue siendo landing_page', () => {
    const r = classifySourceUrlQuality('https://empresa.com/lp/demo-erp');
    assert.ok(isBlockedBySourceUrlQuality(r));
    assert.equal(r.quality, 'landing_page');
  });

  it('INV2-c: capterra.com raíz → source-url-quality no lo bloquea (lo bloquea el identity gate de candidate-writer)', () => {
    // capterra.com está en DIRECTORY_SOURCE_DOMAINS en candidate-writer.ts (identity gate).
    // Source-url-quality-gate no tiene por qué bloquearlo — el bloqueo ocurre antes en el pipeline.
    const r = classifySourceUrlQuality('https://capterra.com/');
    // En la raíz, capterra es official_homepage (depth=0). El identity gate lo excluye.
    assert.equal(r.quality, 'official_homepage');
    assert.ok(!isBlockedBySourceUrlQuality(r), 'source-url-quality no lo bloquea; lo hace el identity gate');
  });
});
