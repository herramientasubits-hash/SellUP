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
  { key: 'py_dncp_directory', country: 'PY', status: 'connected_free_discovery' },
  { key: 'uy_rupe_registry', country: 'UY', status: 'connected_identity_in_run' },
  { key: 'us_sec_edgar_registry', country: 'US', status: 'connected_identity_in_run' },
  { key: 'us_irs_eo_registry', country: 'US', status: 'connected_identity_in_run' },
  { key: 'es_placsp_registry', country: 'ES', status: 'connected_identity_in_run' },
  { key: 'cl_res_registry', country: 'CL', status: 'connected_identity_in_run' },
  { key: 'cl_sii_registry', country: 'CL', status: 'connected_identity_in_run' },
  { key: 'cr_company_registry', country: 'CR', status: 'connected_identity_in_run' },
  { key: 'cr_free_directory', country: 'CR', status: 'connected_free_discovery' },
];

/** Fuentes consultadas EN VIVO (no son una carga): mismo estado, modo backend_connected. */
const LIVE_IDENTITY_SOURCES = [{ key: 'bo_seprec_live', country: 'BO' }] as const;

describe('fuentes en vivo de número fiscal por nombre', () => {
  for (const { key, country } of LIVE_IDENTITY_SOURCES) {
    it(`${key}: existe, país ${country}, connected_identity_in_run, backend_connected, fuera de las recomendaciones`, () => {
      const s = CATALOG_SOURCES.find((source) => source.key === key);
      assert.ok(s, key);
      assert.deepEqual(s.countryCodes, [country]);
      assert.equal(s.aiFlowStatus, 'connected_identity_in_run');
      assert.equal(s.connectionMode, 'backend_connected');
      for (const depth of ['basic', 'standard', 'deep'] as const) {
        const ctx = getCatalogContext({ country, countryCode: country, industry: 'technology', searchDepth: depth });
        assert.equal(ctx.recommendedSources.some((r) => r.key === key), false, `${key} ${depth}`);
      }
    });
  }
});

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

describe('Ecuador capa gratuita (SOURCES-EC-FREE-DISCOVERY-1): cargada y verificada', () => {
  it('existe, EC, capa gratuita, carga verificada y fuera de las recomendaciones', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'ec_scvs_directory');
    assert.ok(s);
    assert.deepEqual(s.countryCodes, ['EC']);
    assert.equal(s.aiFlowStatus, 'connected_free_discovery');
    assert.equal(s.connectionMode, 'read_only_snapshot');
    assert.equal(s.operationalStatus, 'operational_verified');
    assert.deepEqual(s.sectors, []);
    assert.match(s.nextAction ?? '', /2\.041 compañías activas/);
    for (const industry of INDUSTRIES) {
      for (const depth of DEPTHS) {
        const ctx = getCatalogContext({ country: 'Ecuador', countryCode: 'EC', industry, searchDepth: depth });
        assert.equal(ctx.recommendedSources.some((r) => r.key === 'ec_scvs_directory'), false, `${industry}/${depth}`);
        assert.equal(ctx.sectorSources.some((r) => r.key === 'ec_scvs_directory'), false, `${industry}/${depth}`);
      }
    }
  });
});

describe('Chile capa gratuita (SOURCES-CL-SII-FREE-DISCOVERY-1): conectada en código, carga pendiente', () => {
  it('existe, CL, capa gratuita, sin carga verificada todavía y fuera de las recomendaciones', () => {
    const s = CATALOG_SOURCES.find((source) => source.key === 'cl_sii_directory');
    assert.ok(s);
    assert.deepEqual(s.countryCodes, ['CL']);
    assert.equal(s.aiFlowStatus, 'connected_free_discovery');
    assert.equal(s.connectionMode, 'read_only_snapshot');
    assert.equal(s.operationalStatus, 'pending_validation');
    assert.deepEqual(s.sectors, []);
    assert.match(s.nextAction ?? '', /espera la autorización/);
    for (const industry of INDUSTRIES) {
      for (const depth of DEPTHS) {
        const ctx = getCatalogContext({ country: 'Chile', countryCode: 'CL', industry, searchDepth: depth });
        assert.equal(ctx.recommendedSources.some((r) => r.key === 'cl_sii_directory'), false, `${industry}/${depth}`);
        assert.equal(ctx.sectorSources.some((r) => r.key === 'cl_sii_directory'), false, `${industry}/${depth}`);
      }
    }
  });
});

describe('proveedores globales con su estado real (SOURCES-CATALOG-COUNTRY-AUDIT-1)', () => {
  const byKey = (key: string) => CATALOG_SOURCES.find((s) => s.key === key);

  it('Apollo y Lusha: proveedores pagados conectados, en la pestaña de la IA y sin «Conectar»', () => {
    for (const key of ['global_apollo', 'global_lusha']) {
      const source = byKey(key);
      assert.equal(source?.aiFlowStatus, 'connected_paid_provider', key);
      assert.equal(source?.operationalStatus, 'operational_verified', key);
      assert.equal(source?.priority, 'P2', `${key}: la prioridad no cambia (puntuación)`);
      assert.equal(shouldSkipGenericConnectionPanels(source as never), true, key);
    }
    const operativas = filterTab(getSourceCatalogViewModel().sources, 'operativas').map((s) => s.key);
    assert.ok(operativas.includes('global_apollo') && operativas.includes('global_lusha'));
    assert.equal(AI_FLOW_STATUS_LABELS.connected_paid_provider, 'Conectada · proveedor pagado (usa créditos)');
  });

  it('OpenCorporates: descartada (de pago), fuera de la pestaña de la IA, misma clave y prioridad', () => {
    const source = byKey('global_opencorporates');
    assert.equal(source?.operationalStatus, 'discarded_paid_or_tos');
    assert.equal(source?.priority, 'P2');
    const operativas = filterTab(getSourceCatalogViewModel().sources, 'operativas').map((s) => s.key);
    assert.equal(operativas.includes('global_opencorporates'), false);
  });

  it('el estado nuevo no entra en el flujo automático: Lusha sigue fuera y Apollo sólo como último recurso', () => {
    const deep = getCatalogContext({ country: 'X', countryCode: 'XX', industry: 'technology', searchDepth: 'deep' });
    const keys = deep.recommendedSources.map((s) => s.key);
    assert.deepEqual(keys, ['global_opencorporates', 'global_apollo']);
    const basic = getCatalogContext({ country: 'Colombia', countryCode: 'CO', industry: 'technology', searchDepth: 'basic' });
    assert.equal(basic.recommendedSources.some((s) => s.key.startsWith('global_')), false);
  });
});
