/**
 * agent1-ownership-domain-snapshot-x6-1.test.ts
 *
 * AGENT1-OWNERSHIP-DOMAIN-SNAPSHOT-X6.1 — el website declarado sobrevive al
 * snapshot de la ruta de dos rondas.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Medido en la certificación `cfb2acd4…` (CO × retail × 5, Apollo forzado por
 * override): 34 empresas únicas, 33 rechazadas por ownership, 0 supervivientes.
 * El gate publicó, en las 25 que llegó a evaluar:
 *
 *     reason: "No domain available to evaluate ownership"
 *     effective_domain: null      missing_signals: ["domain"]
 *
 * …y esas mismas 25 filas llevaban un dominio VÁLIDO en su propia fila de
 * `prospect_discarded_dispositions` (`vaquitaexpress.com.co`, `superricas.com`,
 * `caribesupermercados.co`…). 25 evaluadas, 25 bloqueadas, 0 aprobadas.
 *
 * La causa no estaba en el gate. Estaba tres capas antes:
 *
 *   1. el mapper del proveedor estampa el sitio en DOS sitios —`metadata.website`
 *      y `metadata.apollo_profile.website_url`—;
 *   2. `toCandidateEvidenceSnapshot` conservaba `domain` y NINGUNO de esos dos;
 *   3. el runner reconstruye el resultado desde ese snapshot también en la
 *      PRIMERA pasada (no sólo en un reintento);
 *   4. desde #394 `buildProspectingPipelineCandidate` obtiene el website de un
 *      resultado Apollo con `readApolloCandidateWebsite` —que lee EXACTAMENTE
 *      esos dos campos— y deriva el dominio de ese website;
 *   5. luego `resolveApolloPreWriterEffectiveDomain` lee `candidate.domain ??
 *      extractDomain(candidate.website)`, y `evaluateCompanyOwnership` con dos
 *      nulos responde lo único que puede responder.
 *
 * La rama de IDENTIDAD (`identity.normalizedDomain`) lee el resultado ORIGINAL y
 * nunca pasó por el snapshot: de ahí que la fila persistida sí tuviera dominio.
 * Dos representaciones de la misma empresa divergiendo en un solo campo.
 *
 * ── Qué prueba esta suite, y qué NO ─────────────────────────────────────────
 *
 * Prueba la cadena REAL: `mapApolloOrganizationToSearchResult` (el mapper del
 * proveedor, puro) → `toCandidateEvidenceSnapshot` → `fromCandidateEvidenceSnapshot`
 * → `readApolloCandidateWebsite` / `readApolloCandidateDomain` (los lectores que
 * el constructor invoca) → `normalizeDomain` (la función con la que el
 * constructor deriva el dominio) → `resolveApolloPreWriterEffectiveDomain` →
 * `evaluateApolloPreWriterCompanyOwnershipWithInputs` (el veredicto REAL que
 * `applyFinalGates` consume). Ningún snapshot artificial: todos salen del mapper
 * o de la forma que produce el cascade de enrichment.
 *
 * 🔴 Lo que NO se ejecuta: `buildProspectingPipelineCandidate`. Hace I/O real
 * —`verifyWebsite` sale a la red contra el sitio de la empresa y
 * `checkCompanyDuplicate` consulta Supabase—, así que invocarlo en una suite
 * offline era imposible sin mockear dos módulos. En su lugar, § F ANCLA sus dos
 * líneas de derivación sobre el fuente: si alguien cambia cómo el constructor
 * obtiene `website`/`domain`, el ancla falla y esta suite deja de poder afirmar
 * lo que afirma. Es la costura honesta entre lo ejecutado y lo aseverado.
 *
 * ── Alcance ─────────────────────────────────────────────────────────────────
 *
 * X6.1 arregla EXCLUSIVAMENTE la pérdida de `website`. No toca las reglas de
 * ownership, no añade LinkedIn como respaldo del gate, y NO hace que el
 * constructor derive el dominio de `metadata.domain` —defecto latente, fuera de
 * alcance, documentado en § E sin fijar su valor defectuoso.
 *
 * Offline: sin red, sin Apollo, sin Lusha, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  toCandidateEvidenceSnapshot,
  fromCandidateEvidenceSnapshot,
} from '../apollo-two-round/checkpoint';
import { mapApolloOrganizationToSearchResult } from '../web-search-providers/apollo-organizations-search-provider';
import {
  isApolloOrganizationsResult,
  readApolloCandidateDomain,
  readApolloCandidateWebsite,
  readApolloProviderOrganizationId,
} from '../apollo-candidate-identity-readers';
import { normalizeDomain } from '../normalization';
import {
  resolveApolloPreWriterEffectiveDomain,
  evaluateApolloPreWriterCompanyOwnershipWithInputs,
} from '../apollo-pre-writer-target-conditions';
import type { WebSearchResult, ProspectingPipelineCandidate } from '../types';

// ─── Arnés ────────────────────────────────────────────────────────────────────

/** La empresa de la certificación `cfb2acd4…`, con sus valores reales. */
const WEBSITE = 'https://carnesfriascalimas.com';
const DOMAIN = 'carnesfriascalimas.com';
const ORG_ID = '66e743bad18deb0001112e52';

/** El viaje completo: proyectar a evidencia mínima y reconstruir. */
function roundtrip(result: WebSearchResult): WebSearchResult {
  return fromCandidateEvidenceSnapshot(toCandidateEvidenceSnapshot(result));
}

function metadataOf(result: WebSearchResult): Record<string, unknown> {
  return (result.metadata ?? {}) as Record<string, unknown>;
}

function profileOf(result: WebSearchResult): Record<string, unknown> {
  return (metadataOf(result)['apollo_profile'] ?? {}) as Record<string, unknown>;
}

/** Resultado del proveedor para una organización con sitio declarado. */
function apolloResultWithWebsite(): WebSearchResult {
  return mapApolloOrganizationToSearchResult(
    {
      id: ORG_ID,
      name: 'Carnes Frias',
      website_url: WEBSITE,
      primary_domain: DOMAIN,
      linkedin_url: 'linkedin.com/company/carnes-frias',
      industry: 'retail',
      estimated_num_employees: 250,
      city: 'Cali',
      country: 'Colombia',
    },
    1,
  );
}

/** Resultado del proveedor para una organización SIN sitio ni dominio. */
function apolloResultWithoutWebsite(): WebSearchResult {
  return mapApolloOrganizationToSearchResult(
    { id: ORG_ID, name: 'Carnes Frias', industry: 'retail', country: 'Colombia' },
    1,
  );
}

/**
 * La forma que produce el cascade de enrichment PAGADO: mezcla sólo dentro de
 * `apollo_profile` y conserva `...meta` intacto.
 *
 * No es una invención de esta suite — § F ancla que el cascade siga escribiendo
 * exactamente así. Es la forma en la que un `website_url` que COSTÓ un crédito
 * llega sin que `metadata.website` se entere.
 */
function withProfileMerge(
  result: WebSearchResult,
  merged: Record<string, unknown>,
): WebSearchResult {
  const meta = metadataOf(result);
  return {
    ...result,
    metadata: {
      ...meta,
      apollo_profile: { ...profileOf(result), ...merged },
      apollo_enrichment_applied: true,
    },
  } as WebSearchResult;
}

/**
 * El candidato TAL COMO lo derivará `buildProspectingPipelineCandidate`.
 *
 * Las dos líneas son las suyas, con sus mismas funciones (§ F las ancla sobre el
 * fuente). Sólo se ensambla el objeto: ejecutar el constructor exigiría red y
 * base, y lo que aquí importa son los dos campos que el gate consume.
 */
function candidateAsBuilderWouldDerive(result: WebSearchResult): ProspectingPipelineCandidate {
  const declaredWebsite = isApolloOrganizationsResult(result)
    ? readApolloCandidateWebsite(result)
    : result.url;
  return {
    website: declaredWebsite,
    domain: declaredWebsite === null ? null : normalizeDomain(declaredWebsite),
    name: 'Carnes Frias',
  } as ProspectingPipelineCandidate;
}

function readersOf(result: WebSearchResult) {
  return {
    website: readApolloCandidateWebsite(result),
    domain: readApolloCandidateDomain(result),
    organizationId: readApolloProviderOrganizationId(result),
    isApollo: isApolloOrganizationsResult(result),
  };
}

function sourceWithoutComments(relativePath: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

// ══ A · `metadata.website` presente — el caso de la certificación ════════════

describe('X6.1 § A · el website declarado sobrevive al viaje', () => {
  test('el mapper del proveedor estampa el sitio en las DOS representaciones', () => {
    const original = apolloResultWithWebsite();

    assert.equal(metadataOf(original)['website'], WEBSITE);
    assert.equal(profileOf(original)['website_url'], WEBSITE);
    assert.equal(readApolloCandidateWebsite(original), WEBSITE);
  });

  test('🔴 tras el roundtrip, `metadata.website` SIGUE presente', () => {
    const reconstructed = roundtrip(apolloResultWithWebsite());

    assert.equal(
      metadataOf(reconstructed)['website'],
      WEBSITE,
      'el lector consulta este campo PRIMERO: sin él vuelve el defecto',
    );
  });

  test('🔴 tras el roundtrip, `apollo_profile.website_url` SIGUE presente', () => {
    const reconstructed = roundtrip(apolloResultWithWebsite());

    assert.equal(
      profileOf(reconstructed)['website_url'],
      WEBSITE,
      'restituir sólo uno de los dos deja el contrato dependiendo de cuál se lea',
    );
  });

  test('`readApolloCandidateWebsite` responde IDÉNTICO antes y después', () => {
    const original = apolloResultWithWebsite();
    const reconstructed = roundtrip(original);

    assert.equal(readApolloCandidateWebsite(reconstructed), readApolloCandidateWebsite(original));
    assert.equal(readApolloCandidateWebsite(reconstructed), WEBSITE);
  });

  test('el candidato que el constructor derivará ya no nace vacío', () => {
    const candidate = candidateAsBuilderWouldDerive(roundtrip(apolloResultWithWebsite()));

    assert.equal(candidate.website, WEBSITE);
    assert.equal(candidate.domain, DOMAIN);
  });

  test('🔴 y el gate de ownership recibe por fin un dominio que evaluar', () => {
    const candidate = candidateAsBuilderWouldDerive(roundtrip(apolloResultWithWebsite()));

    assert.equal(resolveApolloPreWriterEffectiveDomain(candidate), DOMAIN);

    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);
    assert.equal(evaluation.effectiveDomain, DOMAIN, 'el campo que salía null en las 25');
    assert.notEqual(
      evaluation.verdict.reason,
      'No domain available to evaluate ownership',
      'el motivo exacto que publicaron las 25 filas de la certificación',
    );
    assert.ok(
      !evaluation.verdict.missingSignals.includes('domain'),
      'ya no puede faltar la señal que el proveedor sí entregó',
    );
  });

  test('sin el arreglo, el mismo candidato reproduce el defecto exacto', () => {
    // La prueba en negativo: un resultado reconstruido al que se le quita el
    // website —el estado PRE-X6.1— vuelve a producir, palabra por palabra, el
    // veredicto de la certificación. Es lo que ata esta suite al defecto real.
    const reconstructed = roundtrip(apolloResultWithWebsite());
    const meta = metadataOf(reconstructed);
    const withoutWebsite = {
      ...reconstructed,
      metadata: {
        ...meta,
        website: null,
        apollo_profile: { ...profileOf(reconstructed), website_url: null },
      },
    } as WebSearchResult;

    const candidate = candidateAsBuilderWouldDerive(withoutWebsite);
    assert.equal(candidate.website, null);
    assert.equal(candidate.domain, null);

    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);
    assert.equal(evaluation.effectiveDomain, null);
    assert.equal(evaluation.verdict.allowed, false);
    assert.equal(evaluation.verdict.reason, 'No domain available to evaluate ownership');
    assert.deepEqual([...evaluation.verdict.missingSignals], ['domain']);
  });
});

// ══ B · sólo `apollo_profile.website_url` — la forma del enrichment pagado ═══

describe('X6.1 § B · el website que sólo vive en el perfil', () => {
  test('la premisa es real: el cascade mezcla en el perfil y no toca `metadata.website`', () => {
    const enriched = withProfileMerge(apolloResultWithoutWebsite(), { website_url: WEBSITE });

    assert.equal(metadataOf(enriched)['website'], null, 'la búsqueda no trajo sitio');
    assert.equal(profileOf(enriched)['website_url'], WEBSITE, 'el crédito pagado sí');
    assert.equal(
      readApolloCandidateWebsite(enriched),
      WEBSITE,
      'el lector cae al perfil, que es justo para lo que existe ese respaldo',
    );
  });

  test('🔴 sobrevive: un website que costó un crédito ya no se tira', () => {
    const enriched = withProfileMerge(apolloResultWithoutWebsite(), { website_url: WEBSITE });
    const reconstructed = roundtrip(enriched);

    assert.equal(readApolloCandidateWebsite(reconstructed), WEBSITE);
    assert.equal(metadataOf(reconstructed)['website'], WEBSITE);
    assert.equal(profileOf(reconstructed)['website_url'], WEBSITE);
    assert.equal(candidateAsBuilderWouldDerive(reconstructed).domain, DOMAIN);
  });
});

// ══ C · los dos presentes — la precedencia del lector, ni una más ════════════

describe('X6.1 § C · precedencia', () => {
  const OTHER = 'https://otro-sitio-distinto.com';

  test('el lector prefiere `metadata.website` sobre `apollo_profile.website_url`', () => {
    const divergent = withProfileMerge(apolloResultWithWebsite(), { website_url: OTHER });

    assert.equal(metadataOf(divergent)['website'], WEBSITE);
    assert.equal(profileOf(divergent)['website_url'], OTHER);
    assert.equal(readApolloCandidateWebsite(divergent), WEBSITE, 'metadata manda');
  });

  test('🔴 el snapshot conserva EL QUE EL LECTOR DEVUELVE, no el otro', () => {
    const divergent = withProfileMerge(apolloResultWithWebsite(), { website_url: OTHER });
    const snapshot = toCandidateEvidenceSnapshot(divergent);

    assert.equal(snapshot.website, WEBSITE, 'invertir la precedencia guardaría el otro');
    assert.notEqual(snapshot.website, OTHER);
  });

  test('🔴 y el roundtrip devuelve ese mismo valor por los dos caminos', () => {
    const divergent = withProfileMerge(apolloResultWithWebsite(), { website_url: OTHER });
    const reconstructed = roundtrip(divergent);

    assert.equal(readApolloCandidateWebsite(reconstructed), WEBSITE);
    assert.equal(metadataOf(reconstructed)['website'], WEBSITE);
    // Consecuencia declarada del contrato: el gemelo del perfil queda con el
    // valor que el lector habría devuelto, no con su valor original. Lo que el
    // contrato promete es lo OBSERVABLE, no la colocación interna.
    assert.equal(profileOf(reconstructed)['website_url'], WEBSITE);
    assert.equal(candidateAsBuilderWouldDerive(reconstructed).website, WEBSITE);
  });
});

// ══ D · ninguno presente — ausencia es ausencia ══════════════════════════════

describe('X6.1 § D · sin website declarado no se inventa ninguno', () => {
  test('el original no tiene sitio y su `url` es el perfil sintético de Apollo', () => {
    const original = apolloResultWithoutWebsite();

    assert.equal(readApolloCandidateWebsite(original), null);
    assert.equal(original.url, `https://apollo.io/companies/${ORG_ID}`);
  });

  test('🔴 tras el roundtrip sigue siendo null — la URL de perfil NO se cuela', () => {
    const reconstructed = roundtrip(apolloResultWithoutWebsite());

    assert.equal(readApolloCandidateWebsite(reconstructed), null);
    assert.equal(metadataOf(reconstructed)['website'], null);
    assert.equal(profileOf(reconstructed)['website_url'], null);
    // La `url` sí viaja (trazabilidad), y justamente por eso el lector no la mira:
    // derivar identidad de ella es el defecto que cerró NULL-DOMAIN-IDENTITY.
    assert.equal(reconstructed.url, `https://apollo.io/companies/${ORG_ID}`);
    assert.notEqual(metadataOf(reconstructed)['website'], reconstructed.url);
  });

  test('y el candidato derivado no fabrica un dominio `apollo.io`', () => {
    const candidate = candidateAsBuilderWouldDerive(roundtrip(apolloResultWithoutWebsite()));

    assert.equal(candidate.website, null);
    assert.equal(candidate.domain, null);
    assert.notEqual(candidate.domain, 'apollo.io');
  });
});

// ══ E · `primary_domain` sin website — el defecto latente, NO resuelto ═══════

describe('X6.1 § E · alcance: el dominio del perfil sin website', () => {
  /**
   * 🔴 Este bloque documenta un defecto que X6.1 NO arregla, y lo hace SIN fijar
   * su valor defectuoso.
   *
   * `buildProspectingPipelineCandidate` deriva el dominio del WEBSITE, nunca de
   * `metadata.domain` —que sí sobrevive al snapshot y aquí vale
   * `carnesfriascalimas.com`—. Una organización con `primary_domain` y sin
   * `website_url` seguirá llegando al gate sin dominio efectivo.
   *
   * Deliberadamente NO se asevera `candidate.domain === null`: un trinquete que
   * fija el valor defectuoso BLOQUEA su corrección, y este defecto tiene que
   * poder arreglarse en su propio corte sin tocar esta suite. Lo único que se
   * asevera aquí es el contrato de X6.1: no se inventó un website.
   */
  test('el dominio del perfil SÍ sobrevive al snapshot', () => {
    const domainOnly = withProfileMerge(apolloResultWithoutWebsite(), {
      primary_domain: DOMAIN,
    });
    const reconstructed = roundtrip(domainOnly);

    assert.equal(readApolloCandidateDomain(domainOnly), DOMAIN);
    assert.equal(readApolloCandidateDomain(reconstructed), DOMAIN, 'el dominio no era el problema');
  });

  test('🔴 y X6.1 NO inventa un website a partir de él', () => {
    const domainOnly = withProfileMerge(apolloResultWithoutWebsite(), {
      primary_domain: DOMAIN,
    });
    const snapshot = toCandidateEvidenceSnapshot(domainOnly);
    const reconstructed = roundtrip(domainOnly);

    assert.equal(snapshot.website, null, 'usar `primary_domain` como website sería inventar');
    assert.equal(readApolloCandidateWebsite(reconstructed), null);
    assert.equal(metadataOf(reconstructed)['website'], null);
    assert.notEqual(metadataOf(reconstructed)['website'], DOMAIN);
    assert.notEqual(metadataOf(reconstructed)['website'], `https://${DOMAIN}`);
  });
});

// ══ F · anclas al fuente — la costura entre lo ejecutado y lo aseverado ══════

describe('X6.1 § F · anclas', () => {
  test('el constructor sigue derivando el website con el lector que esta suite usa', () => {
    const pipeline = sourceWithoutComments('prospecting-pipeline.ts');

    assert.ok(
      pipeline.includes(
        'const declaredWebsite = isApolloResult ? readApolloCandidateWebsite(result) : result.url;',
      ),
      'si el constructor cambia de lector, esta suite ya no puede hablar por él',
    );
    assert.ok(
      pipeline.includes(
        'const domain = declaredWebsite === null ? null : normalizeDomain(declaredWebsite);',
      ),
      'el dominio del candidato se deriva del website: es lo que hace load-bearing a X6.1',
    );
  });

  test('el cascade de enrichment sigue mezclando sólo dentro de `apollo_profile`', () => {
    const cascade = sourceWithoutComments('apollo-organization-enrichment-cascade.ts');

    assert.ok(cascade.includes('apollo_profile: mergedProfile'), 'premisa de § B');
    assert.ok(
      cascade.includes('...meta,'),
      'conserva metadata intacta: por eso `metadata.website` puede quedar vacío',
    );
  });

  test('el gate de ownership NO fue modificado por X6.1', () => {
    const gate = sourceWithoutComments('company-ownership-gate.ts');

    // La regla que produjo los 33 rechazos sigue viva y sin respaldos nuevos: lo
    // que cambió es la ENTRADA, no el juicio.
    assert.ok(gate.includes("reason: 'No domain available to evaluate ownership'"));
    assert.ok(
      gate.includes('const effectiveDomain = domain ?? (url ? extractDomain(url) : null);'),
      'ninguna precedencia nueva',
    );
    assert.ok(
      !/linkedin/i.test(gate),
      'X6.1 no añade LinkedIn como respaldo del gate: eso sería cambiar las reglas',
    );
  });
});

// ══ G · TRINQUETE · el contrato del snapshot frente a los lectores ══════════

/**
 * Lista EXPLÍCITA de lo que los lectores canónicos de identidad consultan.
 *
 * No es una heurística: es un contrato declarado, con dos comprobaciones
 * independientes encima.
 *
 *   1. SUPERVIVENCIA (conductual) — con un valor centinela en cada ruta, cada
 *      lector debe responder lo MISMO antes y después del viaje. Nótese que la
 *      respuesta puede sobrevivir sin que la clave se restituya: el proveedor se
 *      reconoce por `result.provider`, no por `metadata.source_key`. Lo que el
 *      contrato promete es la RESPUESTA del lector.
 *   2. COMPLETITUD (derivada del fuente) — el conjunto de campos que el módulo
 *      de lectores lee de verdad debe estar cubierto por esta lista. Si mañana
 *      un lector empieza a leer otro campo, la lista queda incompleta y el test
 *      obliga a declararlo — y, si debe sobrevivir, a añadirlo al snapshot.
 */
const READER_METADATA_FIELDS = [
  // El CONTENEDOR del perfil, que `readApolloProfile` lee de metadata antes de
  // cualquier campo. Está declarado porque es una lectura real y porque su
  // supervivencia es condición de todas las del perfil: si la reconstrucción
  // dejara de emitir `apollo_profile`, los tres respaldos caerían a la vez.
  'apollo_profile',
  'domain',
  'website',
  'apollo_organization_id',
  'organization_id',
  'source_key',
  'source_provider',
] as const;

const READER_PROFILE_FIELDS = ['primary_domain', 'website_url', 'organization_id'] as const;

/**
 * Lecturas declaradas que el snapshot NO cubre, con su razón.
 *
 * Es un hueco DOCUMENTADO, no una aserción sobre su valor: si alguien lo cierra,
 * este test no falla. Sólo impide que el hueco sea invisible.
 */
const UNCOVERED_BY_DESIGN: readonly { path: string; reason: string }[] = [
  {
    path: 'apollo_profile.organization_id',
    reason:
      'el snapshot toma el id de `metadata.apollo_organization_id` ?? `metadata.organization_id`, ' +
      'nunca del perfil. Un resultado cuyo id viva SÓLO en el perfil pierde su identidad de ' +
      'proveedor al reconstruirse. Es la misma familia de defecto que X6.1 y queda fuera de su ' +
      'alcance: corregirlo es un corte propio, con su propia evidencia.',
  },
];

describe('X6.1 § G · trinquete del contrato snapshot ↔ lectores', () => {
  test('SUPERVIVENCIA · cada lector responde lo mismo antes y después del viaje', () => {
    // Centinela distinto por ruta: si el viaje confundiera dos campos, el valor
    // delataría cuál llegó.
    const sentinel = {
      ...apolloResultWithWebsite(),
      metadata: {
        ...metadataOf(apolloResultWithWebsite()),
        domain: DOMAIN,
        website: WEBSITE,
        apollo_organization_id: ORG_ID,
        source_key: 'apollo_organizations',
        source_provider: 'apollo',
        apollo_profile: {
          ...profileOf(apolloResultWithWebsite()),
          primary_domain: DOMAIN,
          website_url: WEBSITE,
          organization_id: ORG_ID,
        },
      },
    } as WebSearchResult;

    assert.deepEqual(readersOf(roundtrip(sentinel)), readersOf(sentinel));
    // Y ninguna respuesta puede ser nula: un contrato que sobrevive con todo en
    // null no demuestra nada.
    for (const [reader, value] of Object.entries(readersOf(roundtrip(sentinel)))) {
      assert.ok(value !== null && value !== false, `${reader} perdió su respuesta en el viaje`);
    }
  });

  test('COMPLETITUD · el fuente de los lectores no lee ningún campo sin declarar', () => {
    const readers = sourceWithoutComments('apollo-candidate-identity-readers.ts');

    const metadataReads = new Set(
      [...readers.matchAll(/(?:readMetadata\(result\)|meta)\['([a-z_]+)'\]/g)].map((m) => m[1]),
    );
    const profileReads = new Set(
      [...readers.matchAll(/readApolloProfile\(result\)\['([a-z_]+)'\]/g)].map((m) => m[1]),
    );

    assert.ok(metadataReads.size > 0, 'el escaneo no encontró lecturas: el patrón cambió');
    assert.ok(profileReads.size > 0, 'el escaneo no encontró lecturas del perfil');

    const declaredMetadata = new Set<string>([
      ...READER_METADATA_FIELDS,
      ...UNCOVERED_BY_DESIGN.filter((e) => !e.path.startsWith('apollo_profile.')).map(
        (e) => e.path,
      ),
    ]);
    const declaredProfile = new Set<string>([
      ...READER_PROFILE_FIELDS,
      ...UNCOVERED_BY_DESIGN.filter((e) => e.path.startsWith('apollo_profile.')).map((e) =>
        e.path.replace('apollo_profile.', ''),
      ),
    ]);

    for (const field of metadataReads) {
      assert.ok(
        declaredMetadata.has(field),
        `metadata.${field} lo lee un lector canónico y NO está declarado: añádelo al contrato ` +
          `del snapshot (y, si debe sobrevivir, a su lista blanca)`,
      );
    }
    for (const field of profileReads) {
      assert.ok(
        declaredProfile.has(field),
        `apollo_profile.${field} lo lee un lector canónico y NO está declarado: añádelo al ` +
          `contrato del snapshot (y, si debe sobrevivir, a su lista blanca)`,
      );
    }
  });

  test('las dos rutas del website están en la lista blanca del snapshot', () => {
    const checkpoint = sourceWithoutComments('apollo-two-round/checkpoint.ts');

    assert.ok(
      /website:\s*truncateText\(meta\['website'\]\)\s*\?\?\s*truncateText\(profile\['website_url'\]\)/.test(
        checkpoint,
      ),
      'la proyección debe leer las dos rutas en el orden del lector',
    );
    assert.ok(
      /website:\s*snapshot\.website\s*\?\?\s*null/.test(checkpoint),
      'la reconstrucción debe restituir `metadata.website`',
    );
    assert.ok(
      /website_url:\s*snapshot\.website\s*\?\?\s*null/.test(checkpoint),
      'la reconstrucción debe restituir `apollo_profile.website_url`',
    );
  });

  test('un checkpoint LEGACY sin la clave se sigue leyendo sin romperse', () => {
    const snapshot = toCandidateEvidenceSnapshot(apolloResultWithWebsite());
    // Exactamente lo que hay hoy en los 28 lotes de Producción: el documento no
    // tiene la clave. Debe reconstruirse sin website, no lanzar.
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy['website'];

    const reconstructed = fromCandidateEvidenceSnapshot(
      legacy as unknown as ReturnType<typeof toCandidateEvidenceSnapshot>,
    );

    assert.equal(readApolloCandidateWebsite(reconstructed), null);
    assert.equal(metadataOf(reconstructed)['website'], null);
    assert.equal(readApolloCandidateDomain(reconstructed), DOMAIN, 'el dominio sí sigue ahí');
  });
});
