/**
 * Dimensiones de cada consulta (agente, paso, país, industria, forma) — el espejo
 * TypeScript de la migración 147 dice EXACTAMENTE lo mismo que su SQL.
 *
 * La migración es la que escribe las columnas en Producción; esta tabla es la que
 * la página usa para nombrarlas y para calcularlas en memoria mientras la 147 no
 * está aplicada. Si divergen, la página y la base cuentan cosas distintas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AGENT_DIMENSION_RULES,
  BATCH_MACRO_METADATA_BLOCKS,
  RUN_AGENT_KEY_MAP,
  SEARCH_MODE_BY_BATCH_SOURCE,
  SEARCH_MODES_FROM_BATCH_METADATA,
  agentKeyFromRunKey,
  agentStepLabel,
  completeAgentDimensions,
  resolveAgentDimensions,
  resolveBatchDimensions,
  searchModeLabel,
  type AgentDimensionRule,
  type OperationMatch,
} from '../usage-dimensions';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/147_provider_usage_log_dimensions.sql'),
  'utf8',
);

function functionBody(name: string): string {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`);
  assert.ok(start >= 0, `la 147 declara public.${name}`);
  const open = MIGRATION.indexOf('$$', start);
  const close = MIGRATION.indexOf('$$', open + 2);
  return MIGRATION.slice(open + 2, close);
}

const quotedList = (text: string): string[] =>
  [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);

function parseOperation(clause: string | undefined): OperationMatch {
  if (!clause) return { kind: 'any' };
  const inMatch = /^p_operation_key IN \(([^)]*)\)$/.exec(clause);
  if (inMatch) return { kind: 'in', values: quotedList(inMatch[1]) };
  const prefix = /^starts_with\(p_operation_key, '([^']+)'\)$/.exec(clause);
  if (prefix) return { kind: 'prefix', value: prefix[1] };
  const contains = /^strpos\(p_operation_key, '([^']+)'\) > 0$/.exec(clause);
  if (contains) return { kind: 'contains', value: contains[1] };
  throw new Error(`cláusula de operación no reconocida: ${clause}`);
}

/** Lee las líneas WHEN de `provider_usage_agent_dimensions` como reglas. */
function parseSqlRules(): AgentDimensionRule[] {
  const lines = functionBody('provider_usage_agent_dimensions')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('WHEN '));
  return lines.map((line) => {
    const m = /^WHEN (.+) THEN ARRAY\['([^']+)', '([^']+)'\]$/.exec(line);
    assert.ok(m, `línea WHEN con formato inesperado: ${line}`);
    const clauses = m[1].split(' AND ');
    const providerClause = clauses.shift() ?? '';
    const providers = /^p_provider_key IN \(([^)]*)\)$/.exec(providerClause);
    assert.ok(providers, `la regla empieza por p_provider_key IN (...): ${line}`);
    let flow: string | null = null;
    let operationClause: string | undefined;
    for (const clause of clauses) {
      const flowMatch = /^p_flow = '([^']+)'$/.exec(clause);
      if (flowMatch) flow = flowMatch[1];
      else operationClause = clause;
    }
    return {
      providers: quotedList(providers[1]),
      operation: parseOperation(operationClause),
      flow,
      agentKey: m[2] as AgentDimensionRule['agentKey'],
      agentStep: m[3],
    };
  });
}

describe('147 ↔ usage-dimensions.ts: la misma tabla de reglas', () => {
  it('las reglas del SQL son, en el mismo orden, las de TypeScript', () => {
    const sqlRules = parseSqlRules();
    assert.equal(sqlRules.length, AGENT_DIMENSION_RULES.length);
    assert.deepEqual(
      sqlRules,
      AGENT_DIMENSION_RULES.map((rule) => ({ ...rule, providers: [...rule.providers] })),
    );
  });

  it('el agente que sale de agent_runs es el mismo en los dos lados', () => {
    const body = functionBody('provider_usage_agent_from_run');
    const parsed: Record<string, string> = {};
    for (const m of body.matchAll(/WHEN p_run_agent_key IN \(([^)]*)\) THEN '([^']+)'/g)) {
      for (const key of quotedList(m[1])) parsed[key] = m[2];
    }
    assert.deepEqual(parsed, RUN_AGENT_KEY_MAP);
    assert.equal(agentKeyFromRunKey('account_intelligence'), 'account_intelligence');
    assert.equal(agentKeyFromRunKey(null), null);
  });

  it('el lote da la macro desde los mismos bloques y la misma forma de búsqueda', () => {
    const body = functionBody('provider_usage_batch_dimensions');
    const blocks = [...body.matchAll(/b\.metadata -> '([a-z_]+)' ->> 'macro_industry_key'/g)].map((m) => m[1]);
    assert.deepEqual(blocks, [...BATCH_MACRO_METADATA_BLOCKS]);
    const modes: Record<string, string> = {};
    for (const m of body.matchAll(/WHEN b\.source (?:= '([a-z_0-9]+)'|IN \(([^)]*)\)) THEN '([a-z_]+)'/g)) {
      const keys = m[1] ? [m[1]] : quotedList(m[2]);
      for (const key of keys) modes[key] = m[3];
    }
    assert.deepEqual(modes, SEARCH_MODE_BY_BATCH_SOURCE);
  });

  it('el disparador no pisa valores enviados y nunca usa un search_path abierto', () => {
    assert.match(MIGRATION, /BEFORE INSERT ON public\.provider_usage_logs/);
    assert.match(MIGRATION, /SECURITY DEFINER\s+SET search_path = pg_temp/);
    assert.match(MIGRATION, /IF NEW\.agent_key IS NULL THEN/);
    assert.match(MIGRATION, /COALESCE\(NEW\.country_code, v_batch\[1\]\)/);
    // El relleno sólo escribe donde la columna está en NULL.
    const updates = [...MIGRATION.matchAll(/UPDATE public\.provider_usage_logs AS l\s+SET (\w+) =[\s\S]*?WHERE l\.(\w+) IS NULL/g)];
    assert.equal(updates.length, 6);
    for (const [, setColumn, whereColumn] of updates) assert.equal(setColumn, whereColumn);
  });
});

describe('resolveAgentDimensions — las operaciones reales del código', () => {
  const cases: Array<[string, string, string | null, string | null, string | null]> = [
    ['anthropic', 'company_classification', null, 'agent1', 'clasificador'],
    ['anthropic', 'company_classification', 'claude_rescue', 'agent1', 'rescate'],
    ['anthropic', 'company_domain_search', 'claude_rescue', 'agent1', 'rescate_web'],
    ['anthropic', 'company_search', 'claude_company_search', 'agent1', 'claude_busca_empresas'],
    ['tavily', 'multi_query_web_search', null, 'agent1', 'busqueda_web'],
    ['tavily', 'linkedin_company_search', null, 'agent1', 'busqueda_web'],
    ['tavily', 'rich_profile_enrichment', null, 'agent1', 'busqueda_web'],
    ['apollo', 'organizations_search', null, 'agent1', 'apollo'],
    ['apollo', 'organization_enrichment', null, 'agent1', 'enriquecer_empresa'],
    ['lusha', 'company_prospecting_v3', null, 'agent1', 'lusha'],
    ['hubspot', 'crm_companies_search', null, 'agent1', 'duplicados_hubspot'],
    ['apollo', 'people_search', null, 'agent2a', 'buscar_contactos'],
    ['apollo', 'person_match', null, 'agent2a', 'identificar_contacto'],
    ['apollo', 'person_phone_reveal', null, 'agent2a', 'revelar_telefono'],
    ['lusha', 'lusha_person_phone_reveal', null, 'agent2a', 'revelar_telefono'],
    ['lusha', 'contact_phone_search_more', null, 'agent2a', 'revelar_telefono'],
    ['lusha', 'person_phone_cache_hit', null, 'agent2a', 'telefono_en_cache'],
    ['lusha', 'lusha_contact_search', null, 'agent2a', 'identificar_contacto'],
    ['lusha', 'lusha_contact_prospecting', null, 'agent2a', 'buscar_contactos'],
    ['openai', 'generate', null, null, null],
    ['tavily', 'company_discovery_benchmark_dry_run', null, null, null],
  ];
  for (const [provider, operation, flow, agent, step] of cases) {
    it(`${provider} · ${operation}${flow ? ` · ${flow}` : ''} → ${agent ?? 'sin agente'}`, () => {
      assert.deepEqual(resolveAgentDimensions(provider, operation, flow), { agentKey: agent, agentStep: step });
    });
  }
});

describe('completeAgentDimensions — lo mismo que hace el disparador', () => {
  const base = { providerKey: 'apollo', operationKey: 'organizations_search', flow: null, runAgentKey: null };

  it('no pisa un agente ni un paso ya escritos', () => {
    assert.deepEqual(
      completeAgentDimensions({ ...base, agentKey: 'agent2a', agentStep: 'mi_paso' }),
      { agentKey: 'agent2a', agentStep: 'mi_paso' },
    );
  });

  it('no inventa un paso de otro agente', () => {
    assert.deepEqual(
      completeAgentDimensions({ ...base, agentKey: 'agent2a', agentStep: null }),
      { agentKey: 'agent2a', agentStep: null },
    );
  });

  it('sin regla, el agente sale de la ejecución y el paso queda vacío', () => {
    assert.deepEqual(
      completeAgentDimensions({
        providerKey: 'openai',
        operationKey: 'generate',
        flow: null,
        agentKey: null,
        agentStep: null,
        runAgentKey: 'prospect_generation',
      }),
      { agentKey: 'agent1', agentStep: null },
    );
  });
});

describe('resolveBatchDimensions', () => {
  it('lee país en mayúsculas, la macro del primer bloque con valor y la forma', () => {
    assert.deepEqual(
      resolveBatchDimensions({
        country_code: ' co ',
        source: 'agent_1',
        metadata: {
          apollo_discovery_taxonomy: { macro_industry_key: '' },
          claude_company_search: { macro_industry_key: 'technology' },
        },
      }),
      { countryCode: 'CO', macroIndustryKey: 'technology', searchMode: 'exploratory' },
    );
  });

  it('sin lote, nada', () => {
    assert.deepEqual(resolveBatchDimensions(null), {
      countryCode: null,
      macroIndustryKey: null,
      searchMode: null,
    });
  });

  it('un paso desconocido se lee igual sin enseñar la clave cruda', () => {
    assert.equal(agentStepLabel('nuevo_paso'), 'Nuevo paso');
    assert.equal(agentStepLabel(null), 'Otro paso');
  });
});

describe('149 ↔ usage-dimensions.ts: la forma declarada en la metadata del lote', () => {
  const MIGRATION_149 = readFileSync(
    join(process.cwd(), 'supabase/migrations/149_provider_usage_search_mode_from_batch_metadata.sql'),
    'utf8',
  );

  it('el SQL y TypeScript aceptan las mismas formas desde la metadata', () => {
    const m = /WHEN b\.metadata ->> 'search_mode' IN \(([^)]*)\) THEN b\.metadata ->> 'search_mode'/.exec(MIGRATION_149);
    assert.ok(m, 'la 149 lee metadata.search_mode');
    assert.deepEqual(quotedList(m[1]), [...SEARCH_MODES_FROM_BATCH_METADATA]);
    // Y la regla por `source` sigue igual que en la 147.
    const modes: Record<string, string> = {};
    for (const r of MIGRATION_149.matchAll(/WHEN b\.source (?:= '([a-z_0-9]+)'|IN \(([^)]*)\)) THEN '([a-z_]+)'/g)) {
      for (const key of r[1] ? [r[1]] : quotedList(r[2])) modes[key] = r[3];
    }
    assert.deepEqual(modes, SEARCH_MODE_BY_BATCH_SOURCE);
  });

  it('el relleno sólo corrige NULL o el exploratory derivado', () => {
    assert.match(MIGRATION_149, /AND \(l\.search_mode IS NULL OR l\.search_mode = 'exploratory'\);/);
  });

  it('un lote del árbol, de proveedores o de competidores no sale como exploratorio', () => {
    for (const mode of SEARCH_MODES_FROM_BATCH_METADATA) {
      assert.equal(resolveBatchDimensions({ country_code: 'cl', source: 'agent_1', metadata: { search_mode: mode } }).searchMode, mode);
    }
    assert.equal(resolveBatchDimensions({ country_code: 'cl', source: 'agent_1', metadata: { search_mode: 'otra' } }).searchMode, 'exploratory');
    assert.equal(searchModeLabel('corporate_tree'), 'Árbol de empresa');
  });
});
