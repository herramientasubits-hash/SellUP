/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 3 — precisión de subindustria.
 *
 * Los cinco casos mínimos del contrato, construidos con patrones SINTÉTICOS: no
 * hay nombre de empresa real codificado en el gate ni en estas pruebas. Lo que se
 * ejercita son los patrones de subindustria y de modelo de negocio, que es lo que
 * el gate decide de verdad.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessApolloSubindustryPrecision,
  toApolloSubindustryPrecisionMetadata,
} from '../apollo-subindustry-precision';
import type { WebSearchResult } from '../types';

const SUBINDUSTRY = 'Supermercados e Hipermercados';

function result(
  title: string,
  metadata: Record<string, unknown>,
): WebSearchResult {
  return {
    title,
    url: 'https://example.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata,
  } as unknown as WebSearchResult;
}

describe('§ 3 · casos mínimos del contrato', () => {
  test('A. cadena real de hipermercados ⇒ confirmed', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Cadena Norte', {
        industry: 'retail',
        keywords: ['hipermercados', 'consumo masivo'],
        short_description: 'Operador de una cadena de hipermercados en el país.',
      }),
      SUBINDUSTRY,
    );

    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.verdictReason, 'anchor_evidence_confirmed');
    // La evidencia dice QUÉ término y en QUÉ campo. Sin eso, «confirmado» sería
    // una afirmación sin respaldo consultable.
    assert.ok(assessment.subindustryEvidence.length > 0);
    assert.ok(
      assessment.subindustryEvidence.some(
        (item) => item.field === 'keywords' && item.term === 'hipermercados',
      ),
    );
    assert.equal(assessment.classificationSource, 'provider_keywords');
    assert.ok(assessment.subindustryConfidence >= 70);
  });

  test('B. distribuidor B2B de alimentos ⇒ rejected para esta subindustria', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Distribuidora Central', {
        industry: 'food and beverages',
        keywords: ['food distribution', 'grocery', 'wholesale'],
        short_description:
          'Wholesale distribution de alimentos frescos para restaurantes y tiendas.',
      }),
      SUBINDUSTRY,
    );

    assert.equal(assessment.subindustryMatch, 'rejected');
    assert.equal(assessment.verdictReason, 'excluded_business_model');
    assert.ok(assessment.disqualifyingSignals.includes('food distribution'));
    // Un rechazo no reporta confianza: no hay clasificación que respaldar.
    assert.equal(assessment.subindustryConfidence, 0);
    assert.equal(assessment.classificationSource, 'none');
  });

  test('C. app de domicilios con ancla ⇒ ambiguous, y sin ancla ⇒ rejected', () => {
    const withAnchor = assessApolloSubindustryPrecision(
      result('Mercado Ya', {
        industry: 'consumer services',
        keywords: ['grocery delivery', 'supermercado online'],
        short_description: 'Delivery app de mercado con entrega en una hora.',
      }),
      SUBINDUSTRY,
    );
    assert.equal(withAnchor.subindustryMatch, 'ambiguous');
    assert.equal(withAnchor.verdictReason, 'conflicting_business_model_with_anchor');
    assert.ok(withAnchor.subindustryConfidence <= 40);

    const withoutAnchor = assessApolloSubindustryPrecision(
      result('Mercado Ya', {
        industry: 'consumer services',
        keywords: ['grocery delivery', 'marketplace'],
        short_description: 'Marketplace de domicilios de productos de consumo.',
      }),
      SUBINDUSTRY,
    );
    assert.equal(withoutAnchor.subindustryMatch, 'rejected');
  });

  test('D. empresa con «retail» genérico NO queda confirmed', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Grupo Comercial', { industry: 'retail' }),
      SUBINDUSTRY,
    );

    assert.notEqual(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.subindustryMatch, 'ambiguous');
    assert.equal(assessment.industryMatch, 'broad_compatible');
    assert.equal(assessment.verdictReason, 'broad_industry_only');
    assert.equal(assessment.subindustryEvidence.length, 0);
  });

  test('E. descripción explícita de supermercados e hipermercados ⇒ confirmed', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Almacenes del Sur', {
        industry: 'retail',
        short_description:
          'Opera supermercados e hipermercados con presencia en doce ciudades.',
      }),
      SUBINDUSTRY,
    );

    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.classificationSource, 'provider_description');
    assert.ok(
      assessment.subindustryEvidence.every((item) => item.field === 'short_description'),
    );
  });
});

describe('§ 3 · evidencia amplia nunca confirma', () => {
  for (const broad of [
    'retail',
    'food and beverages',
    'food distribution',
    'grocery delivery',
    'marketplace',
    'wholesale',
    'consumer services',
  ]) {
    test(`«${broad}» por sí sola no confirma la subindustria`, () => {
      const assessment = assessApolloSubindustryPrecision(
        result('Empresa Sin Señal', { industry: broad, keywords: [broad] }),
        SUBINDUSTRY,
      );
      assert.notEqual(assessment.subindustryMatch, 'confirmed');
    });
  }

  test('la industria declarada contradictoria rechaza aunque el texto coincida', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Banco Retail', {
        industry: 'retail banking',
        keywords: ['supermercado'],
      }),
      SUBINDUSTRY,
    );
    assert.equal(assessment.subindustryMatch, 'rejected');
    assert.equal(assessment.industryMatch, 'contradictory');
    assert.equal(assessment.verdictReason, 'declared_industry_contradicts');
  });
});

describe('§ 3 · procedencia de la evidencia', () => {
  test('el dominio y el snippet NO son campos clasificadores', () => {
    const assessment = assessApolloSubindustryPrecision(
      {
        title: 'Empresa Neutra',
        url: 'https://supermercado-ejemplo.test',
        snippet: 'Un texto que menciona supermercado sin que Apollo lo clasifique.',
        rank: 1,
        source: 'apollo_organizations',
        metadata: { domain: 'supermercado-ejemplo.test', industry: 'retail' },
      } as unknown as WebSearchResult,
      SUBINDUSTRY,
    );

    // Ni el dominio ni el snippet son una clasificación del proveedor: leerlos
    // como tal es cómo «cualquier empresa con la palabra en la URL» se confirmaba.
    assert.equal(assessment.subindustryMatch, 'ambiguous');
    assert.equal(assessment.subindustryEvidence.length, 0);
  });

  test('el nombre comercial cuenta como palabra, no como substring', () => {
    const inequivocal = assessApolloSubindustryPrecision(
      result('Supermercados Del Valle', { industry: 'retail' }),
      SUBINDUSTRY,
    );
    assert.equal(inequivocal.subindustryMatch, 'confirmed');
    assert.equal(inequivocal.classificationSource, 'commercial_name');

    // «Supermundo» contiene las letras de «superm…» pero no la palabra.
    const coincidencia = assessApolloSubindustryPrecision(
      result('Supermundo', { industry: 'retail' }),
      SUBINDUSTRY,
    );
    assert.equal(coincidencia.subindustryMatch, 'ambiguous');
  });
});

describe('§ 3 · subindustria sin catálogo', () => {
  test('sin subindustria pedida el veredicto es ambiguo y no mapeado', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Cualquiera', { industry: 'retail' }),
      null,
    );
    assert.equal(assessment.subindustryMapped, false);
    assert.equal(assessment.subindustryMatch, 'ambiguous');
    assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
  });

  test('una subindustria fuera del catálogo tampoco confirma a nadie', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Cualquiera', { industry: 'retail', keywords: ['supermercado'] }),
      'Subindustria Inexistente',
    );
    assert.equal(assessment.subindustryMapped, false);
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
  });
});

describe('§ 3 · proyección a metadata', () => {
  test('la metadata lleva veredicto, confianza, fuente y evidencia', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Almacenes del Sur', {
        industry: 'retail',
        short_description: 'Opera supermercados e hipermercados.',
      }),
      SUBINDUSTRY,
    );
    const metadata = toApolloSubindustryPrecisionMetadata(assessment);

    assert.equal(metadata['subindustry_match'], 'confirmed');
    assert.equal(metadata['requested_subindustry'], SUBINDUSTRY);
    assert.equal(metadata['classification_source'], 'provider_description');
    assert.equal(metadata['industry_match'], 'broad_compatible');
    assert.ok(Array.isArray(metadata['subindustry_evidence']));
    const evidence = metadata['subindustry_evidence'] as Record<string, unknown>[];
    assert.ok(evidence.length > 0);
    assert.deepEqual(Object.keys(evidence[0]).sort(), ['field', 'source', 'term']);
  });
});

// ─── AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5, § 6, § 7 ──────────
//
// «Tiendas por Departamento, Moda y Calzado» — subindustria COMPUESTA (tres
// familias) del catálogo real de SellUp. Fixtures sintéticas: ninguna empresa
// real está codificada aquí, sólo patrones de subindustria y de modelo de
// negocio, igual que en el resto de este archivo.
//
// Reproduce, con datos sintéticos, la corrida `8c86eb06…`: cuatro candidatos de
// Retail y Consumo sin una sola señal de tienda por departamentos, moda o
// calzado deben resolver TODOS a `ambiguous` + `subindustryMapped: false`
// —exactamente lo que la corrida real mostró para LA14, Arturo Calle, Olímpica
// y Quala— y NINGUNO a `confirmed`.

const TIENDAS_MODA_CALZADO = 'Tiendas por Departamento, Moda y Calzado';

describe('§ 5–7 · Tiendas por Departamento, Moda y Calzado — casos A–I', () => {
  test('A. cadena de tiendas de ropa para consumidor ⇒ confirmed, familia fashion_apparel', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Moda Norte', {
        industry: 'retail',
        keywords: ['clothing store', 'fashion retail'],
        short_description: 'Cadena de tiendas de ropa para el consumidor final.',
      }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.subindustryMatchFamily, 'fashion_apparel');
    assert.equal(assessment.subindustryMapped, true);
    assert.ok(assessment.subindustryEvidence.length > 0);
  });

  test('B. cadena de tiendas de calzado ⇒ confirmed, familia footwear', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Pasos Ltda', {
        industry: 'retail',
        keywords: ['shoe store'],
        short_description: 'Cadena de tiendas de calzado con presencia nacional.',
      }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.subindustryMatchFamily, 'footwear');
  });

  test('C. tienda por departamentos ⇒ confirmed, familia department_store', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Almacenes Central', {
        industry: 'retail',
        short_description: 'Tienda por departamentos con líneas de hogar, moda y electro.',
      }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.subindustryMatchFamily, 'department_store');
  });

  test('D. supermercado/hipermercado NO confirma esta subindustria', () => {
    const rejected = assessApolloSubindustryPrecision(
      result('Mercado Grande', { industry: 'supermarkets' }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(rejected.subindustryMatch, 'rejected');
    assert.equal(rejected.industryMatch, 'contradictory');

    const ambiguous = assessApolloSubindustryPrecision(
      result('Mercado Grande', { industry: 'retail', keywords: ['grocery'] }),
      TIENDAS_MODA_CALZADO,
    );
    assert.notEqual(ambiguous.subindustryMatch, 'confirmed');
  });

  test('E. fabricante de alimentos ⇒ rejected', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Alimentos del Valle', {
        industry: 'food production',
        keywords: ['retail', 'consumer goods'],
      }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'rejected');
    assert.equal(assessment.industryMatch, 'contradictory');
  });

  test('F. empresa marcada sólo como retail ⇒ ambiguous', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Comercial Genérica', { industry: 'retail' }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'ambiguous');
    assert.equal(assessment.subindustryMatchFamily, 'none');
    assert.equal(assessment.subindustryEvidence.length, 0);
  });

  test('G. distribuidor mayorista de prendas sin evidencia de retail ⇒ no confirma', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Mayorista Textil', {
        industry: 'wholesale',
        keywords: ['distributor', 'manufacturer'],
        short_description: 'Distribuidor mayorista de prendas para otros comercios.',
      }),
      TIENDAS_MODA_CALZADO,
    );
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
  });

  test('H. marketplace genérico ⇒ ambiguous', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Plataforma XYZ', { industry: 'marketplace', keywords: ['marketplace'] }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(assessment.subindustryMatch, 'ambiguous');
  });

  test('I. subindustria sin mapeo ⇒ unmapped/ambiguous, nunca confirmed', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Cualquiera', { industry: 'retail', keywords: ['tienda de ropa'] }),
      'Una Subindustria Que No Existe En El Catálogo',
    );
    assert.equal(assessment.subindustryMapped, false);
    assert.equal(assessment.subindustryMatch, 'ambiguous');
    assert.equal(assessment.verdictReason, 'subindustry_not_mapped');
  });

  test('el nombre comercial usado sólo como parte del nombre no confirma nada', () => {
    // «Almacenes La 14» — el patrón real de la corrida `8c86eb06…`: `almacen`
    // suelto en el nombre comercial no debe demostrar tienda por departamentos.
    const assessment = assessApolloSubindustryPrecision(
      result('Almacenes La Catorce', { industry: 'retail' }),
      TIENDAS_MODA_CALZADO,
    );
    assert.notEqual(assessment.subindustryMatch, 'confirmed');
  });

  test('patrón de la corrida 8c86eb06…: cuatro candidatos sin una sola señal de tienda/moda/calzado, ninguno confirmed', () => {
    // Mismos patrones de industria que LA14, Arturo Calle, Olímpica y Quala en
    // la corrida real — ninguno con evidencia positiva de esta subindustria.
    // Antes de este PR la subindustria no tenía catálogo (`subindustryMapped:
    // false` para los cuatro, tal como muestra la corrida real); ahora SÍ lo
    // tiene, así que el resultado por candidato varía con su industria
    // declarada — pero la invariante que importa se sostiene igual: NINGUNO
    // confirma sin evidencia positiva y trazable.
    const syntheticCandidates = [
      result('Bazar Uno', { industry: 'food production', city: 'Bogota' }),
      result('Bazar Dos', { industry: 'retail', city: 'Barranquilla' }),
      result('Bazar Tres', { industry: 'textiles', city: 'Bogota' }),
      result('Bazar Cuatro', { industry: 'retail', city: 'Cali' }),
    ];

    const assessments = syntheticCandidates.map((candidate) =>
      assessApolloSubindustryPrecision(candidate, TIENDAS_MODA_CALZADO),
    );

    assert.equal(assessments.filter((a) => a.subindustryMatch === 'confirmed').length, 0);
    assert.ok(assessments.every((a) => a.subindustryMapped === true));
  });

  test('la MISMA subindustria, sin catálogo, sigue siendo fail-closed para los cuatro (estado real de la corrida antes de este PR)', () => {
    // Cualquiera de las otras ~71 subindustrias del catálogo real sin anclas
    // propias sirve aquí: el punto es que NO contenga ni esté contenida por
    // ninguna de las dos claves mapeadas, para que `resolveSubindustryKey` la
    // trate como genuinamente sin catálogo.
    const UNMAPPED_NAME = 'Software Empresarial (SaaS / ERP / CRM)';
    const syntheticCandidates = [
      result('Bazar Uno', { industry: 'food production', city: 'Bogota' }),
      result('Bazar Dos', { industry: 'retail', city: 'Barranquilla' }),
      result('Bazar Tres', { industry: 'textiles', city: 'Bogota' }),
      result('Bazar Cuatro', { industry: 'retail', city: 'Cali' }),
    ];

    const assessments = syntheticCandidates.map((candidate) =>
      assessApolloSubindustryPrecision(candidate, UNMAPPED_NAME),
    );

    assert.ok(assessments.every((a) => a.subindustryMapped === false));
    assert.ok(assessments.every((a) => a.subindustryMatch === 'ambiguous'));
    assert.equal(assessments.filter((a) => a.subindustryMatch === 'confirmed').length, 0);
  });
});

describe('§ 6 · familias de una subindustria compuesta', () => {
  test('supermercados e hipermercados no distingue familias: siempre none', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Cadena Norte', { industry: 'retail', keywords: ['hipermercados'] }),
      SUBINDUSTRY,
    );
    assert.equal(assessment.subindustryMatch, 'confirmed');
    assert.equal(assessment.subindustryMatchFamily, 'none');
  });

  test('una familia confirmada basta: no se exige cumplir las tres', () => {
    const onlyFootwear = assessApolloSubindustryPrecision(
      result('Solo Zapatos', { industry: 'retail', keywords: ['shoe store'] }),
      TIENDAS_MODA_CALZADO,
    );
    assert.equal(onlyFootwear.subindustryMatch, 'confirmed');
    assert.equal(onlyFootwear.subindustryMatchFamily, 'footwear');
  });

  test('la familia viaja a la metadata persistida', () => {
    const assessment = assessApolloSubindustryPrecision(
      result('Moda Norte', { industry: 'retail', keywords: ['fashion retail'] }),
      TIENDAS_MODA_CALZADO,
    );
    const metadata = toApolloSubindustryPrecisionMetadata(assessment);
    assert.equal(metadata['subindustry_match_family'], 'fashion_apparel');
  });
});
