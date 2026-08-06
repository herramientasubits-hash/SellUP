/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 4 — persistir lo que el enrichment
 * devolvió.
 *
 * La corrida `be181d2d…` pagó cinco enrichments y persistió dos candidatos con
 * `city`, `subindustry`, `sector_code`, `classification_source` y
 * `classification_confidence` todos en null.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assessApolloSubindustryPrecision } from '../apollo-subindustry-precision';
import {
  captureApolloEnrichmentForPersistence,
  toApolloEnrichmentCandidateColumns,
  toApolloEnrichmentPersistenceMetadata,
  type ApolloEnrichmentProvenance,
} from '../apollo-enrichment-persistence-capture';
import type { WebSearchResult } from '../types';

const SUBINDUSTRY = 'Supermercados e Hipermercados';

const PROVENANCE: ApolloEnrichmentProvenance = {
  sourceProvider: 'apollo',
  sourceOperation: 'organization_enrichment',
  sourceRequestId: 'apollo:enrich:batch:domain',
  observedAt: '2026-08-05T22:20:00.000Z',
};

function enrichedResult(overrides: Record<string, unknown> = {}): WebSearchResult {
  return {
    title: 'Almacenes del Sur',
    url: 'https://ejemplo.test',
    snippet: null,
    rank: 1,
    source: 'apollo_organizations',
    metadata: {
      domain: 'ejemplo.test',
      apollo_profile: {
        industry: 'retail',
        city: 'Bogotá',
        short_description: 'Opera supermercados e hipermercados en doce ciudades.',
      },
      ...overrides,
    },
  } as unknown as WebSearchResult;
}

function capture(result: WebSearchResult, subindustry: string | null = SUBINDUSTRY) {
  return captureApolloEnrichmentForPersistence({
    result,
    precision: assessApolloSubindustryPrecision(result, subindustry),
    provenance: PROVENANCE,
  });
}

describe('§ 4 · lo devuelto llega a columnas', () => {
  test('la ciudad del perfil enriquecido se persiste', () => {
    const columns = toApolloEnrichmentCandidateColumns(capture(enrichedResult()));
    assert.equal(columns.city, 'Bogotá');
  });

  test('la subindustria confirmada se persiste con su fuente y su confianza', () => {
    const captured = capture(enrichedResult());
    const columns = toApolloEnrichmentCandidateColumns(captured);

    assert.equal(columns.subindustry, SUBINDUSTRY);
    // FORENSICS-1 § 3 — la COLUMNA responde «quién clasificó» y su CHECK
    // (migración 093) sólo admite ese vocabulario. El campo del proveedor que
    // aportó la evidencia es otra cosa y vive en la metadata: escribirlo aquí
    // hacía fallar el INSERT de todo candidato con subindustria confirmada.
    assert.equal(columns.classification_source, 'writer');
    assert.equal(captured.classificationSource, 'provider_description');
    assert.ok((columns.classification_confidence ?? 0) > 0);
  });

  test('la ciudad de la BÚSQUEDA tiene precedencia sobre la del perfil', () => {
    // El enrichment RELLENA lo que la búsqueda dejó vacío; no la reemplaza.
    const columns = toApolloEnrichmentCandidateColumns(
      capture(enrichedResult({ city: 'Medellín' })),
    );
    assert.equal(columns.city, 'Medellín');
  });
});

describe('§ 4 · nada se rellena por suposición', () => {
  test('una subindustria ambigua NO se escribe', () => {
    const result = enrichedResult({
      apollo_profile: { industry: 'retail', city: 'Cali' },
    });
    const columns = toApolloEnrichmentCandidateColumns(capture(result));

    // Escribirla afirmaría una pertenencia que la evidencia no sostiene.
    assert.equal(columns.subindustry, undefined);
    assert.equal(columns.classification_source, undefined);
    assert.equal(columns.classification_confidence, undefined);
    // La ciudad sí: es un dato observado, no una clasificación.
    assert.equal(columns.city, 'Cali');
  });

  test('un campo ausente omite la clave en vez de escribir null', () => {
    const result = {
      title: 'Sin Datos',
      url: 'https://vacio.test',
      snippet: null,
      rank: 1,
      source: 'apollo_organizations',
      metadata: { domain: 'vacio.test' },
    } as unknown as WebSearchResult;

    const columns = toApolloEnrichmentCandidateColumns(capture(result));
    // Una clave con `null` sobrescribiría una columna que ya tuviera dato bueno.
    assert.equal('city' in columns, false);
    assert.equal('subindustry' in columns, false);
    assert.equal('sector_code' in columns, false);
  });

  test('sin catálogo validado NO se inventa un sector_code, y se dice por qué', () => {
    const captured = capture(enrichedResult());

    assert.equal(captured.sectorCode, null);
    assert.equal(captured.sectorCodeReason, 'no_validated_catalog_code_available');
    assert.equal('sector_code' in toApolloEnrichmentCandidateColumns(captured), false);
  });

  test('con un código de catálogo validado, sí se persiste', () => {
    const result = enrichedResult();
    const captured = captureApolloEnrichmentForPersistence({
      result,
      precision: assessApolloSubindustryPrecision(result, SUBINDUSTRY),
      provenance: PROVENANCE,
      catalogSectorCode: 'G4711',
    });

    assert.equal(captured.sectorCodeReason, 'catalog_code_present');
    assert.equal(toApolloEnrichmentCandidateColumns(captured).sector_code, 'G4711');
  });

  test('el número de empleados NO viaja por esta vía', () => {
    // Lo cubre A1-APOLLO-LINKEDIN-EMPLOYEES-1. Dos rutas escribiendo la misma
    // columna es cómo se consiguen dos verdades.
    const columns = toApolloEnrichmentCandidateColumns(
      capture(enrichedResult({ employee_count: 4200 })),
    );
    assert.equal('employee_count' in columns, false);
  });
});

describe('§ 4 · procedencia', () => {
  test('cada dato lleva proveedor, operación, petición e instante', () => {
    const metadata = toApolloEnrichmentPersistenceMetadata(capture(enrichedResult()));
    const provenance = metadata['provenance'] as Record<string, unknown>;

    assert.equal(provenance['source_provider'], 'apollo');
    assert.equal(provenance['source_operation'], 'organization_enrichment');
    assert.equal(provenance['source_request_id'], 'apollo:enrich:batch:domain');
    assert.equal(provenance['observed_at'], '2026-08-05T22:20:00.000Z');
  });

  test('la evidencia estructurada acompaña al dato', () => {
    const metadata = toApolloEnrichmentPersistenceMetadata(capture(enrichedResult()));
    const precision = metadata['precision'] as Record<string, unknown>;

    assert.equal(precision['subindustry_match'], 'confirmed');
    assert.ok(Array.isArray(precision['subindustry_evidence']));
    assert.ok((precision['subindustry_evidence'] as unknown[]).length > 0);
    assert.equal(metadata['sector_code_reason'], 'no_validated_catalog_code_available');
  });

  test('una operación no pagada se declara como búsqueda, no como enrichment', () => {
    const result = enrichedResult();
    const captured = captureApolloEnrichmentForPersistence({
      result,
      precision: assessApolloSubindustryPrecision(result, SUBINDUSTRY),
      provenance: {
        sourceProvider: 'apollo',
        sourceOperation: 'organizations_search',
        sourceRequestId: null,
        observedAt: '2026-08-05T22:19:00.000Z',
      },
    });

    const provenance = toApolloEnrichmentPersistenceMetadata(captured)['provenance'] as Record<
      string,
      unknown
    >;
    assert.equal(provenance['source_operation'], 'organizations_search');
    assert.equal(provenance['source_request_id'], null);
  });
});
