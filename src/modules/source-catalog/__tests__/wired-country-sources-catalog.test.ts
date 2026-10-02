/**
 * SOURCES-CATALOG-REFLECTS-WIRED-SOURCES-1 — el Catálogo de fuentes refleja las
 * fuentes oficiales por país que el Agente 1 usa hoy en cada corrida, SIN
 * cambiar su comportamiento.
 *
 * Fija:
 *   - cada entrada nueva existe con el estado presentacional correcto
 *     (`connected_identity_in_run`, o `connected_free_discovery` para ar_rns),
 *     el país correcto y el modo `read_only_snapshot`;
 *   - ninguna de ellas entra en `getCatalogContext().recommendedSources` de su
 *     país (cero cambio en la puntuación de candidatos) ni en las consultas
 *     guiadas por fuente de la estrategia;
 *   - FISCAL_IDENTIFIERS y COUNTRY_LABELS cubren Estados Unidos y España.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_SOURCES,
  FISCAL_IDENTIFIERS,
} from '@/server/agents/prospecting-toolkit/source-catalog';
import { getCatalogContext } from '@/server/agents/prospecting-toolkit/catalog-context-retriever';
import { buildSearchStrategyFromCatalog } from '@/server/agents/prospecting-toolkit/search-strategy-builder';
import type { AiFlowStatus } from '@/server/agents/prospecting-toolkit/types';
import { AI_FLOW_STATUS_LABELS, COUNTRY_LABELS } from '../labels';
import { filterTab } from '../filter-tab';
import { shouldSkipGenericConnectionPanels } from '../connection-panel-guards';
import { getSourceCatalogViewModel } from '../queries';

const WIRED: ReadonlyArray<{ key: string; country: string; status: AiFlowStatus }> = [
  { key: 'pe_sunat_registry', country: 'PE', status: 'connected_identity_in_run' },
  { key: 'ar_rns_registry', country: 'AR', status: 'connected_identity_in_run' },
  { key: 'ar_rns', country: 'AR', status: 'connected_free_discovery' },
  { key: 'py_set_registry', country: 'PY', status: 'connected_identity_in_run' },
  { key: 'uy_rupe_registry', country: 'UY', status: 'connected_identity_in_run' },
  { key: 'us_sec_edgar_registry', country: 'US', status: 'connected_identity_in_run' },
  { key: 'us_irs_eo_registry', country: 'US', status: 'connected_identity_in_run' },
  { key: 'es_placsp_registry', country: 'ES', status: 'connected_identity_in_run' },
  { key: 'cl_res_registry', country: 'CL', status: 'connected_identity_in_run' },
];

const INDUSTRIES = ['technology', 'health_pharma', 'government', 'retail', 'Tecnología'];
const DEPTHS = ['basic', 'standard', 'deep'] as const;

const byKey = (key: string) => CATALOG_SOURCES.find((s) => s.key === key);

describe('Catálogo — entradas nuevas de fuentes conectadas por país', () => {
  for (const { key, country, status } of WIRED) {
    it(`${key}: existe, país ${country}, ${status}, read_only_snapshot`, () => {
      const s = byKey(key);
      assert.ok(s, `${key} debe existir`);
      assert.deepEqual(s.countryCodes, [country]);
      assert.equal(s.aiFlowStatus, status);
      assert.equal(s.connectionMode, 'read_only_snapshot');
      assert.equal(s.operationalStatus, 'operational_verified');
      assert.deepEqual(s.sectors, [], 'sin sectores: no entra en sectorSources');
      assert.ok((s.nextAction ?? '').length > 0, 'nextAction no vacío');
      assert.ok((s.limitations ?? []).length > 0, 'limitaciones honestas');
    });

    it(`${key}: NO aparece en recommendedSources de ${country} (cero cambio de puntuación)`, () => {
      for (const industry of INDUSTRIES) {
        for (const searchDepth of DEPTHS) {
          const ctx = getCatalogContext({ country, countryCode: country, industry, searchDepth });
          assert.ok(
            !ctx.recommendedSources.some((r) => r.key === key),
            `${key} en recommendedSources (${industry}/${searchDepth})`,
          );
          assert.ok(!ctx.sectorSources.some((r) => r.key === key), `${key} en sectorSources`);
        }
      }
    });

    it(`${key}: no es semilla de consultas guiadas ni bloquea consultas en la estrategia`, () => {
      const st = buildSearchStrategyFromCatalog({ countryCode: country, country, industry: 'technology' });
      assert.ok(!st.queryStrategy.sourceGuidedQuerySeeds.includes(key));
      assert.ok(!st.queryStrategy.blockedSourceKeys.includes(key));
      const dec = st.sourceDecisions.find((d) => d.sourceKey === key);
      assert.ok(dec, `${key} debe tener decisión`);
      assert.equal(dec.allowedForDiscovery, false);
      assert.equal(dec.allowedForSourceGuidedQueries, false);
    });

    it(`${key}: visible en «Operativas» y sin paneles genéricos de conexión`, () => {
      const { sources } = getSourceCatalogViewModel();
      assert.ok(filterTab(sources, 'operativas').some((s) => s.key === key));
      const s = byKey(key);
      assert.ok(s && shouldSkipGenericConnectionPanels(s));
    });
  }

  it('las claves del catálogo siguen siendo únicas', () => {
    const keys = CATALOG_SOURCES.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('labels de los estados nuevos', () => {
    assert.equal(
      AI_FLOW_STATUS_LABELS.connected_identity_in_run,
      'Conectada · número fiscal por nombre en cada corrida',
    );
    assert.equal(
      AI_FLOW_STATUS_LABELS.connected_free_discovery,
      'Conectada · capa gratuita por industria antes de pagar',
    );
  });
});

describe('Catálogo — identificadores y nombres de país', () => {
  it('FISCAL_IDENTIFIERS incluye US = EIN y ES = NIF', () => {
    assert.equal(FISCAL_IDENTIFIERS.US, 'EIN');
    assert.equal(FISCAL_IDENTIFIERS.ES, 'NIF');
  });

  it('COUNTRY_LABELS incluye US = Estados Unidos y ES = España', () => {
    assert.equal(COUNTRY_LABELS.US, 'Estados Unidos');
    assert.equal(COUNTRY_LABELS.ES, 'España');
  });

  it('getCatalogContext expone el identificador fiscal de US y ES', () => {
    assert.equal(getCatalogContext({ country: 'Estados Unidos', countryCode: 'US', industry: 'technology' }).fiscalIdentifierLabel, 'EIN');
    assert.equal(getCatalogContext({ country: 'España', countryCode: 'ES', industry: 'technology' }).fiscalIdentifierLabel, 'NIF');
  });
});
