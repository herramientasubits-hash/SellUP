/**
 * ══ AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 ═══════════════════════════════
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El catálogo canónico expone DOS puertas para resolver un identificador
 * PUBLICADO a la identidad macro —`getMacroIndustryBySlug` (slug exacto) y
 * `resolveMacroIndustryByDisplayName` (nombre visible normalizado)— y cada punta
 * del wizard las combinaba a su manera:
 *
 *   · metadata (`wizard-execution-actions.ts` ~1189)  → slug ?? nombre ?? null
 *   · capa gratuita (`wizard-execution-actions.ts` ~1210) → slug ?? null
 *   · pierna Lusha (`wizard-execution-actions.ts` ~2029) → slug ?? null
 *   · adaptador del pipeline (`wizard-pipeline-adapter.ts` ~87) → slug ?? nombre ?? null
 *   · criterios Lusha (`wizard-lusha-criteria.ts` ~113) → slug ?? nombre ?? null
 *   · Apollo (`apollo-macro-industry-request.ts` ~117) → SÓLO nombre visible
 *
 * Consecuencia observada en Prod: cuando el slug publicado por la resolución de
 * catálogo NO coincide con ningún slug macro pero el nombre visible SÍ resuelve,
 * Apollo funcionaba (resuelve por nombre) y la pierna Lusha se saltaba con
 * `macro_industry_unmapped` (resuelve por slug y obtenía `null`). Las dos puntas
 * de la MISMA corrida discrepaban sobre qué macro industria se pidió.
 *
 * ── Lo que fija esta suite ───────────────────────────────────────────────────
 *
 * UNA sola autoridad —`resolveMacroIndustryIdentity`— con UNA cadena de
 * precedencia documentada: slug → nombre visible canónico → null. Y que las
 * puntas reales (Apollo, metadata, Lusha) reciban la MISMA identidad canónica.
 *
 * 🔴 Fail-closed: un identificador inexistente termina en `null` EXPLÍCITO con
 * motivo estático, nunca en una macro adivinada. Nada de `includes`, nada de
 * coincidencia parcial, nada de caer a la primera macro del catálogo.
 *
 * Offline y determinista: sin red, sin Supabase, sin proveedor. Las 12 macros se
 * recorren desde `MACRO_INDUSTRIES`, nunca desde una lista escrita a mano: una
 * macro que desapareciera de la resolución tiene que poner ROJA esta suite.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  MACRO_INDUSTRIES,
  MACRO_INDUSTRY_KEYS,
  MACRO_INDUSTRY_COUNT,
  MACRO_INDUSTRY_CATALOG_VERSION,
} from '../macro-industries';
import {
  resolveMacroIndustryIdentity,
  resolveMacroIndustryKey,
  MACRO_INDUSTRY_IDENTITY_UNRESOLVED_REASON,
} from '../macro-industry-resolution';

import { resolveApolloMacroIndustryRequest } from '@/server/agents/prospecting-toolkit/apollo-macro-industry-request';
import { resolveWizardMacroIndustryKey } from '@/modules/prospect-batches/wizard-lusha-criteria';
import { adaptResolvedWizardToGenerationInput } from '@/modules/prospect-batches/chat-wizard-execution/wizard-pipeline-adapter';
import type { ResolvedWizardExecution } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-types';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ── Utilidades de guarda estática ────────────────────────────────────────────

const ROOT = path.join(process.cwd(), 'src');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Los comentarios NOMBRAN cosas; el código las HACE. Sólo el código cuenta. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/**
 * Los call-sites que este corte unifica. Ninguno puede volver a llamar a una
 * puerta de resolución de identificador PUBLICADO por su cuenta: si lo hace,
 * reaparece la divergencia que el corte cierra.
 */
const UNIFIED_CALL_SITES = [
  'modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  'modules/prospect-batches/chat-wizard-execution/wizard-pipeline-adapter.ts',
  'modules/prospect-batches/wizard-lusha-criteria.ts',
  'server/agents/prospecting-toolkit/apollo-macro-industry-request.ts',
  'server/agents/prospecting-toolkit/apollo-macro-industry-evidence.ts',
  'server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts',
] as const;

/** Las dos puertas de bajo nivel que la autoridad encapsula. */
const LOW_LEVEL_RESOLVERS = ['getMacroIndustryBySlug', 'resolveMacroIndustryByDisplayName'] as const;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const INDUSTRY_ID = '11111111-1111-4111-8111-111111111111';

/**
 * La macro de referencia para el escenario del defecto. Se toma del catálogo,
 * no se escribe a mano: si el catálogo cambia, el escenario sigue siendo real.
 */
const REFERENCE = MACRO_INDUSTRIES[0];

/** Un slug que con seguridad NO pertenece a la taxonomía. */
const UNKNOWN_SLUG = 'slug-que-no-existe-en-el-catalogo-macro';

function makeResolvedWizardExecution(industry: {
  id: string;
  slug: string;
  name: string;
}): ResolvedWizardExecution {
  return {
    userId: 'user-1111',
    clientRequestId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    mode: 'exploratory',
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: MACRO_INDUSTRY_CATALOG_VERSION },
    industry,
    subindustries: [],
    additionalCriteria: null,
    systemControls: {
      targetCount: 25,
      minimumEmployees: 200,
      employeeThresholdMode: 'hard_filter',
    },
  };
}

function makeCatalog(industry: { id: string; slug: string; name: string }): ActiveIndustryCatalog {
  return {
    version: MACRO_INDUSTRY_CATALOG_VERSION,
    industries: [
      {
        id: industry.id,
        name: industry.name,
        slug: industry.slug,
        description: null,
        sortOrder: 0,
      },
    ],
    subindustries: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — cobertura del catálogo', () => {
  test('las 12 macros del catálogo resuelven por su slug canónico, con source "slug"', () => {
    // Se recorre el catálogo, NO una lista escrita a mano: quitar una macro de
    // la resolución tiene que poner ROJA esta prueba.
    assert.equal(MACRO_INDUSTRIES.length, MACRO_INDUSTRY_COUNT);

    for (const definition of MACRO_INDUSTRIES) {
      const identity = resolveMacroIndustryIdentity({ slug: definition.slug });

      assert.ok(identity, `la macro "${definition.key}" no resolvió por su slug canónico`);
      assert.equal(identity.key, definition.key);
      assert.equal(identity.slug, definition.slug);
      assert.equal(identity.displayName, definition.displayName);
      assert.equal(identity.source, 'slug');
      assert.equal(identity.definition, definition);
    }
  });

  test('las 12 macros resuelven por su nombre visible canónico, con source "display_name"', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const identity = resolveMacroIndustryIdentity({ displayName: definition.displayName });

      assert.ok(identity, `la macro "${definition.key}" no resolvió por su nombre visible`);
      assert.equal(identity.key, definition.key);
      assert.equal(identity.source, 'display_name');
    }
  });

  test('toda clave canónica del catálogo queda cubierta por la autoridad', () => {
    const resolved = new Set(
      MACRO_INDUSTRIES.map((definition) => resolveMacroIndustryKey({ slug: definition.slug })),
    );

    for (const key of MACRO_INDUSTRY_KEYS) {
      assert.ok(resolved.has(key), `la clave "${key}" no es alcanzable desde la autoridad`);
    }
  });
});

describe('AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — precedencia slug → nombre → null', () => {
  test('el slug GANA cuando slug y nombre visible apuntan a macros distintas', () => {
    // La precedencia no es cosmética: el slug es la identidad que las migraciones
    // 118/119 sembraron en base de datos, así que manda sobre la etiqueta visible.
    const first = MACRO_INDUSTRIES[0];
    const second = MACRO_INDUSTRIES[1];

    const identity = resolveMacroIndustryIdentity({
      slug: first.slug,
      displayName: second.displayName,
    });

    assert.ok(identity);
    assert.equal(identity.key, first.key);
    assert.equal(identity.source, 'slug');
  });

  test('ÉSTE es el defecto: slug desconocido + nombre visible válido resuelve por nombre', () => {
    // Antes del corte, la pierna Lusha resolvía SÓLO por slug y aquí obtenía
    // `null` ⇒ `macro_industry_unmapped`, mientras Apollo —que resuelve por
    // nombre— sí encontraba la macro. Misma corrida, dos verdades.
    const identity = resolveMacroIndustryIdentity({
      slug: UNKNOWN_SLUG,
      displayName: REFERENCE.displayName,
    });

    assert.ok(identity, 'el respaldo por nombre visible no se aplicó');
    assert.equal(identity.key, REFERENCE.key);
    assert.equal(identity.source, 'display_name');
  });

  test('el nombre visible resuelve con espacios de sobra, mayúsculas y acentos', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const ruidoso = `  ${definition.displayName.toUpperCase()}  `;
      const sinAcentos = definition.displayName
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase();

      assert.equal(
        resolveMacroIndustryKey({ displayName: ruidoso }),
        definition.key,
        `"${ruidoso}" no resolvió a "${definition.key}"`,
      );
      assert.equal(
        resolveMacroIndustryKey({ displayName: sinAcentos }),
        definition.key,
        `"${sinAcentos}" no resolvió a "${definition.key}"`,
      );
    }
  });

  test('el slug resuelve con espacios de sobra alrededor', () => {
    const identity = resolveMacroIndustryIdentity({ slug: `  ${REFERENCE.slug}  ` });

    assert.ok(identity);
    assert.equal(identity.key, REFERENCE.key);
    assert.equal(identity.source, 'slug');
  });
});

describe('AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — fail-closed', () => {
  test('slug y nombre desconocidos terminan en null EXPLÍCITO, no en una macro adivinada', () => {
    assert.equal(
      resolveMacroIndustryIdentity({ slug: UNKNOWN_SLUG, displayName: 'Industria Inventada S.A.' }),
      null,
    );
    assert.equal(resolveMacroIndustryKey({ slug: UNKNOWN_SLUG }), null);
    assert.equal(resolveMacroIndustryKey({ displayName: 'Industria Inventada S.A.' }), null);
  });

  test('entrada vacía, nula o en blanco termina en null', () => {
    assert.equal(resolveMacroIndustryIdentity({}), null);
    assert.equal(resolveMacroIndustryIdentity({ slug: null, displayName: null }), null);
    assert.equal(resolveMacroIndustryIdentity({ slug: '', displayName: '' }), null);
    assert.equal(resolveMacroIndustryIdentity({ slug: '   ', displayName: '   ' }), null);
  });

  test('NINGUNA coincidencia parcial: una subcadena de una etiqueta no resuelve', () => {
    // «Retail» es subcadena de otras etiquetas del catálogo. Un `includes` en
    // cualquiera de los dos pasos resolvería la macro EQUIVOCADA sin que nadie
    // lo note, que es justo lo que un fail-closed tiene que impedir.
    for (const definition of MACRO_INDUSTRIES) {
      const primeraPalabra = definition.displayName.split(/\s+/)[0];
      if (primeraPalabra === definition.displayName) continue;

      assert.equal(
        resolveMacroIndustryKey({ displayName: primeraPalabra }),
        null,
        `la subcadena "${primeraPalabra}" resolvió una macro; hay coincidencia parcial`,
      );
    }

    // «Retail» es una etiqueta canónica COMPLETA, así que resuelve por igualdad
    // exacta — eso es lo correcto. Lo que no puede pasar es que resuelva por
    // contención en NINGUNA de las dos direcciones.
    assert.equal(resolveMacroIndustryKey({ displayName: 'Retail' }), 'retail');
    assert.equal(resolveMacroIndustryKey({ displayName: 'Reta' }), null);
    assert.equal(resolveMacroIndustryKey({ displayName: 'Retail Especializado' }), null);
    assert.equal(resolveMacroIndustryKey({ slug: 'retail-especializado' }), null);

    assert.equal(resolveMacroIndustryKey({ slug: REFERENCE.slug.slice(0, 4) }), null);
    assert.equal(
      resolveMacroIndustryKey({ displayName: `${REFERENCE.displayName} y algo más` }),
      null,
    );
  });

  test('el motivo del no-resuelto es una constante estática, no un texto improvisado', () => {
    assert.equal(typeof MACRO_INDUSTRY_IDENTITY_UNRESOLVED_REASON, 'string');
    assert.ok(MACRO_INDUSTRY_IDENTITY_UNRESOLVED_REASON.length > 0);
  });
});

describe('AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — paridad entre puntas reales', () => {
  test('Apollo y la autoridad resuelven la MISMA macro cuando sólo el nombre visible sirve', () => {
    // Escenario del defecto, sobre la función REAL de Apollo.
    const apollo = resolveApolloMacroIndustryRequest({
      industry: REFERENCE.displayName,
      selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    });

    assert.equal(apollo.mode, 'macro_industry');
    assert.ok(apollo.mode === 'macro_industry' && apollo.definition);

    const lushaLegKey = resolveMacroIndustryKey({
      slug: UNKNOWN_SLUG,
      displayName: REFERENCE.displayName,
    });

    assert.equal(
      lushaLegKey,
      apollo.mode === 'macro_industry' ? (apollo.definition?.key ?? null) : null,
      'Apollo y la pierna Lusha discrepan sobre la macro industria de la MISMA corrida',
    );
  });

  test('Apollo y la autoridad coinciden para las 12 macros del catálogo', () => {
    for (const definition of MACRO_INDUSTRIES) {
      const apollo = resolveApolloMacroIndustryRequest({
        industry: definition.displayName,
        selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
      });

      const apolloKey =
        apollo.mode === 'macro_industry' ? (apollo.definition?.key ?? null) : null;

      assert.equal(
        apolloKey,
        resolveMacroIndustryKey({ slug: definition.slug, displayName: definition.displayName }),
        `divergencia Apollo/autoridad en "${definition.key}"`,
      );
    }
  });

  test('Apollo falla cerrado —sin macro adivinada— cuando el nombre no está en el catálogo', () => {
    const apollo = resolveApolloMacroIndustryRequest({
      industry: 'Industria Inventada S.A.',
      selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    });

    assert.equal(apollo.mode, 'macro_industry');
    assert.equal(apollo.mode === 'macro_industry' ? apollo.definition : undefined, null);
    assert.equal(
      apollo.mode === 'macro_industry' ? apollo.blockReason : undefined,
      MACRO_INDUSTRY_IDENTITY_UNRESOLVED_REASON,
    );
  });

  test('la punta de criterios Lusha (función REAL) usa la misma cadena de precedencia', () => {
    const industry = { id: INDUSTRY_ID, slug: UNKNOWN_SLUG, name: REFERENCE.displayName };

    assert.equal(
      resolveWizardMacroIndustryKey({ industryId: INDUSTRY_ID }, makeCatalog(industry)),
      REFERENCE.key,
      'la punta de criterios Lusha no aplicó el respaldo por nombre visible',
    );
  });

  test('la punta de metadata (adaptador REAL) publica la misma identidad canónica', () => {
    const industry = { id: INDUSTRY_ID, slug: UNKNOWN_SLUG, name: REFERENCE.displayName };

    const command = adaptResolvedWizardToGenerationInput(makeResolvedWizardExecution(industry));

    assert.equal(
      command.wizardContext.taxonomy.macroIndustryKey,
      REFERENCE.key,
      'la metadata del wizard no publicó la macro que Apollo sí resuelve',
    );
    assert.equal(command.wizardContext.taxonomy.macroIndustryDisplayName, REFERENCE.displayName);
  });

  test('las tres puntas reales publican EXACTAMENTE la misma clave', () => {
    const industry = { id: INDUSTRY_ID, slug: UNKNOWN_SLUG, name: REFERENCE.displayName };

    const apollo = resolveApolloMacroIndustryRequest({
      industry: industry.name,
      selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    });
    const apolloKey = apollo.mode === 'macro_industry' ? (apollo.definition?.key ?? null) : null;

    const metadataKey = adaptResolvedWizardToGenerationInput(
      makeResolvedWizardExecution(industry),
    ).wizardContext.taxonomy.macroIndustryKey;

    const lushaKey = resolveWizardMacroIndustryKey(
      { industryId: INDUSTRY_ID },
      makeCatalog(industry),
    );

    assert.equal(apolloKey, metadataKey);
    assert.equal(metadataKey, lushaKey);
    assert.equal(lushaKey, REFERENCE.key);
  });

  test('una industria fuera del catálogo macro deja las tres puntas en null, no en macros distintas', () => {
    const industry = { id: INDUSTRY_ID, slug: UNKNOWN_SLUG, name: 'Industria Inventada S.A.' };

    const apollo = resolveApolloMacroIndustryRequest({
      industry: industry.name,
      selectionCatalogVersion: MACRO_INDUSTRY_CATALOG_VERSION,
    });
    const apolloKey = apollo.mode === 'macro_industry' ? (apollo.definition?.key ?? null) : null;

    const metadataKey = adaptResolvedWizardToGenerationInput(
      makeResolvedWizardExecution(industry),
    ).wizardContext.taxonomy.macroIndustryKey;

    const lushaKey = resolveWizardMacroIndustryKey(
      { industryId: INDUSTRY_ID },
      makeCatalog(industry),
    );

    assert.equal(apolloKey, null);
    assert.equal(metadataKey, null);
    assert.equal(lushaKey, null);
  });
});

describe('AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 — guarda estática', () => {
  test('ningún call-site unificado llama por su cuenta a una puerta de bajo nivel', () => {
    // Éste es el trinquete: reintroducir `getMacroIndustryBySlug(...)` en la
    // pierna Lusha —el defecto original— pone ROJA esta prueba.
    for (const rel of UNIFIED_CALL_SITES) {
      const code = stripComments(read(rel));

      for (const resolver of LOW_LEVEL_RESOLVERS) {
        assert.ok(
          !code.includes(resolver),
          `${rel} vuelve a llamar a "${resolver}" en vez de a la autoridad única`,
        );
      }
    }
  });

  test('todo call-site unificado llama a la autoridad', () => {
    for (const rel of UNIFIED_CALL_SITES) {
      const code = stripComments(read(rel));

      assert.ok(
        code.includes('resolveMacroIndustryIdentity') || code.includes('resolveMacroIndustryKey'),
        `${rel} no llama a la autoridad de resolución macro`,
      );
    }
  });

  test('la autoridad NO usa coincidencia parcial ni fallback arbitrario', () => {
    const code = stripComments(read('modules/macro-industry-catalog/macro-industry-resolution.ts'));

    assert.ok(!code.includes('.includes('), 'la autoridad usa `includes`: hay match difuso');
    assert.ok(!code.includes('.startsWith('), 'la autoridad usa `startsWith`: hay match difuso');
    assert.ok(!code.includes('MACRO_INDUSTRIES[0]'), 'la autoridad cae a una macro arbitraria');
    assert.ok(!code.includes('.find('), 'la autoridad recorre el catálogo en vez de indexarlo');
  });

  test('la autoridad es el ÚNICO módulo que encapsula las dos puertas de bajo nivel', () => {
    const code = stripComments(read('modules/macro-industry-catalog/macro-industry-resolution.ts'));

    for (const resolver of LOW_LEVEL_RESOLVERS) {
      assert.ok(code.includes(resolver), `la autoridad no delega en "${resolver}"`);
    }
  });
});
