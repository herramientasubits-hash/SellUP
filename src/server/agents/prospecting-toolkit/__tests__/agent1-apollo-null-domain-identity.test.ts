/**
 * agent1-apollo-null-domain-identity.test.ts
 *
 * AGENT1-APOLLO-NULL-DOMAIN-IDENTITY-1 · § 10, § 11.
 *
 * ── Qué defecto congela esta suite ───────────────────────────────────────────
 *
 * Cuando Apollo devuelve una organización sin `website_url` ni `primary_domain`,
 * `mapApolloOrganizationToSearchResult` construye una URL de PERFIL:
 *
 *     https://apollo.io/companies/{organization_id}
 *
 * `metadata.domain` ya valía `null` —el provider nunca inventó un dominio—, pero
 * siete lectores aguas abajo re-derivaban el dominio desde esa URL y todas las
 * organizaciones sin dominio acababan compartiendo la MISMA identidad:
 *
 *     dom:apollo.io
 *
 * Producción lo confirma: dos filas de `prospect_discarded_dispositions` con
 * `source_key='domain:apollo.io'` y once lotes cuyo checkpoint durable guarda la
 * clave `dom:apollo.io`. Una organización válida podía quedar descartada porque
 * OTRA organización, también sin dominio, había pasado antes.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────
 *
 * La URL de perfil sigue existiendo: `WebSearchResult.url` es `string` y la ronda
 * multi-query descarta lo que no parsea. Es TRAZABILIDAD. Lo que cambia es que
 * ninguna ruta de identidad, dedupe o persistencia la lee.
 *
 * Sin Apollo real. Sin Lusha. Sin Tavily. Sin HubSpot. Sin Supabase. Sin
 * créditos. Sin red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mapApolloOrganizationToSearchResult,
  type ApolloOrganizationInput,
} from '../web-search-providers/apollo-organizations-search-provider';
import {
  buildApolloProviderIdentityKey,
  isApolloOrganizationsResult,
  isApolloSyntheticProfileUrl,
  readApolloCandidateDomain,
  readApolloCandidateWebsite,
  readApolloDedupeIdentity,
  readApolloProviderOrganizationId,
} from '../apollo-candidate-identity-readers';
import { toRawDiscoveredOrganization } from '../apollo-two-round/production-runner.server';
import {
  createSeenOrganizationRegistry,
  evaluateSeenOrganization,
  registerSeenOrganization,
} from '../apollo-two-round/seen-registry';
import { toSeenOrganizationKeys } from '../apollo-two-round/checkpoint';
import { buildProspectCandidateIdentityKey } from '../prospect-candidate-identity-key';
import { dedupeMultiQueryResultsByIdentity } from '../web-search-tool';
import type { MultiQuerySearchResultEntry } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TOOLKIT_DIR = join(process.cwd(), 'src/server/agents/prospecting-toolkit');

/** Organización SIN dominio — el caso que producía `apollo.io`. */
function orgWithoutDomain(id: string, name: string): ApolloOrganizationInput {
  return { id, name, website_url: null, primary_domain: null };
}

/** Organización CON dominio real — su comportamiento no debe moverse. */
function orgWithDomain(id: string, name: string, website: string): ApolloOrganizationInput {
  return { id, name, website_url: website, primary_domain: null };
}

/**
 * El caso real que motivó el hito. Apollo devuelve la entidad sin sitio
 * institucional, y antes de este corte llegaba con `domain='apollo.io'`.
 */
const MINISTERIO = orgWithoutDomain('org_min_igualdad', 'Ministerio de Igualdad y Equidad');
/** La organización que pasaba ANTES y sembraba `apollo.io` en el registro. */
const OTRA_SIN_DOMINIO = orgWithoutDomain('org_otra_sin_dominio', 'Fundación Sin Sitio Web');

// ─── 1-3. El mapper y los lectores canónicos ─────────────────────────────────

describe('§ 2/§ 3 — lectores canónicos: la URL de perfil no funda identidad', () => {
  it('website_url = null ⇒ ni domain ni website contienen "apollo.io"', () => {
    const result = mapApolloOrganizationToSearchResult(orgWithoutDomain('A', 'Sin Sitio SAS'), 1);

    assert.equal(readApolloCandidateDomain(result), null);
    assert.equal(readApolloCandidateWebsite(result), null);
    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['domain'], null);
    assert.equal(meta['website'], null);
  });

  it('primary_domain = null ⇒ tampoco se rellena desde apollo_profile', () => {
    const result = mapApolloOrganizationToSearchResult(orgWithoutDomain('B', 'Otra Sin Sitio'), 1);
    const profile = (result.metadata as Record<string, unknown>)['apollo_profile'] as Record<
      string,
      unknown
    >;

    assert.equal(profile['primary_domain'], null);
    assert.equal(profile['website_url'], null);
    assert.equal(readApolloCandidateDomain(result), null);
  });

  it('una organización sin dominio conserva identidad ESTABLE: el id de Apollo', () => {
    const result = mapApolloOrganizationToSearchResult(orgWithoutDomain('org_x', 'Sin Sitio'), 1);

    assert.equal(readApolloProviderOrganizationId(result), 'org_x');
    assert.equal(buildApolloProviderIdentityKey(readApolloProviderOrganizationId(result)),
      'provider:apollo:org_x');
    // Y la URL de perfil sigue ahí, navegable, marcada como lo que es.
    assert.ok(isApolloSyntheticProfileUrl(result.url));
    assert.ok(isApolloOrganizationsResult(result));
  });

  it('organización CON dominio real: nada cambia', () => {
    const result = mapApolloOrganizationToSearchResult(
      orgWithDomain('org_y', 'Siigo', 'https://www.siigo.com'),
      1,
    );

    assert.equal(result.url, 'https://www.siigo.com');
    assert.equal(readApolloCandidateDomain(result), 'siigo.com');
    assert.equal(readApolloCandidateWebsite(result), 'https://www.siigo.com');
    assert.equal(isApolloSyntheticProfileUrl(result.url), false);
  });

  it('Apollo devolviendo apollo.io como website REAL lo conserva (no es una lista negra)', () => {
    const result = mapApolloOrganizationToSearchResult(
      { id: 'org_apollo', name: 'Apollo', website_url: 'https://apollo.io', primary_domain: 'apollo.io' },
      1,
    );

    assert.equal(readApolloCandidateDomain(result), 'apollo.io');
    assert.equal(readApolloCandidateWebsite(result), 'https://apollo.io');
    assert.equal(isApolloSyntheticProfileUrl(result.url), false);
    assert.equal(readApolloDedupeIdentity(result).domain, 'apollo.io');
  });
});

// ─── 4-5, 7. Seen-registry: colisión y dedupe legítimo ───────────────────────

describe('§ 4 — seen-registry: dos organizaciones sin dominio NO colisionan', () => {
  const toOrganization = (org: ApolloOrganizationInput, rank: number) =>
    toRawDiscoveredOrganization(mapApolloOrganizationToSearchResult(org, rank), rank);

  it('Caso C — Apollo A y Apollo B, ambas sin dominio ⇒ A ≠ B', () => {
    const a = toOrganization(orgWithoutDomain('A', 'Empresa A'), 1);
    const b = toOrganization(orgWithoutDomain('B', 'Empresa B'), 2);

    assert.equal(a.domain, null, 'sin dominio declarado, el dominio es null');
    assert.equal(b.domain, null);
    assert.equal(a.providerOrganizationId, 'A');
    assert.equal(b.providerOrganizationId, 'B');

    let registry = createSeenOrganizationRegistry();
    const first = evaluateSeenOrganization(registry, a);
    assert.equal(first.seen, false);
    registry = registerSeenOrganization(registry, first.identity);

    const second = evaluateSeenOrganization(registry, b);
    assert.equal(second.seen, false, 'B no puede heredar la identidad de A');
  });

  it('Caso D — la MISMA organización sin dominio en R1 y R2 SÍ se reconoce', () => {
    const r1 = toOrganization(orgWithoutDomain('A', 'Empresa A'), 1);
    const r2 = toOrganization(orgWithoutDomain('A', 'Empresa A'), 7);

    let registry = createSeenOrganizationRegistry();
    registry = registerSeenOrganization(registry, evaluateSeenOrganization(registry, r1).identity);

    const verdict = evaluateSeenOrganization(registry, r2);
    assert.equal(verdict.seen, true);
    assert.equal(
      verdict.seen === true ? verdict.matchReason : null,
      'provider_organization_id',
      'el eje que identifica es el id del proveedor, no un dominio fabricado',
    );
  });

  it('REGRESIÓN Ministerio de Igualdad y Equidad — no se descarta por una colisión previa', () => {
    const previa = toOrganization(OTRA_SIN_DOMINIO, 1);
    const ministerio = toOrganization(MINISTERIO, 2);

    let registry = createSeenOrganizationRegistry();
    registry = registerSeenOrganization(
      registry,
      evaluateSeenOrganization(registry, previa).identity,
    );

    const verdict = evaluateSeenOrganization(registry, ministerio);
    assert.equal(
      verdict.seen,
      false,
      'el Ministerio es una organización distinta: no puede caer por el dominio de otra',
    );
    assert.equal(ministerio.domain, null);
    assert.equal(ministerio.providerOrganizationId, 'org_min_igualdad');
  });

  it('el dedupe por DOMINIO real sigue intacto', () => {
    const first = toOrganization(orgWithDomain('A', 'Éxito', 'https://www.exito.com'), 1);
    // Otro id de Apollo, mismo dominio: sigue siendo la misma empresa.
    const second = toOrganization(orgWithDomain('B', 'Almacenes Exito SA', 'https://exito.com'), 2);

    let registry = createSeenOrganizationRegistry();
    registry = registerSeenOrganization(
      registry,
      evaluateSeenOrganization(registry, first).identity,
    );

    const verdict = evaluateSeenOrganization(registry, second);
    assert.equal(verdict.seen, true);
    assert.equal(verdict.seen === true ? verdict.matchReason : null, 'normalized_domain');
  });

  it('el checkpoint durable ya no puede escribir la clave dom:apollo.io', () => {
    const a = toOrganization(orgWithoutDomain('A', 'Empresa A'), 1);
    const b = toOrganization(MINISTERIO, 2);

    const registry = createSeenOrganizationRegistry();
    const identities = [
      evaluateSeenOrganization(registry, a).identity,
      evaluateSeenOrganization(registry, b).identity,
    ];
    const keys = toSeenOrganizationKeys(identities);

    assert.equal(keys.includes('dom:apollo.io'), false);
    assert.ok(keys.includes('oid:A'));
    assert.ok(keys.includes('oid:org_min_igualdad'));
  });
});

// ─── 6. Dedupe multi-query (F5) ──────────────────────────────────────────────

describe('§ 4 (F5) — el dedupe multi-query no colapsa organizaciones distintas', () => {
  const toEntry = (org: ApolloOrganizationInput, rank: number): MultiQuerySearchResultEntry => ({
    ...mapApolloOrganizationToSearchResult(org, rank),
    originQuery: 'q',
  });

  it('tres organizaciones Apollo sin dominio se conservan las TRES', () => {
    const entries = [
      toEntry(orgWithoutDomain('A', 'Empresa A'), 1),
      toEntry(OTRA_SIN_DOMINIO, 2),
      toEntry(MINISTERIO, 3),
    ];

    const deduped = dedupeMultiQueryResultsByIdentity(entries);

    assert.equal(deduped.length, 3, 'antes el Map las colapsaba bajo la clave "apollo.io"');
    assert.deepEqual(
      deduped.map((r) => readApolloProviderOrganizationId(r)),
      ['A', 'org_otra_sin_dominio', 'org_min_igualdad'],
    );
  });

  it('la MISMA organización sin dominio, vista en dos queries, se colapsa a una', () => {
    const deduped = dedupeMultiQueryResultsByIdentity([
      toEntry(orgWithoutDomain('A', 'Empresa A'), 1),
      toEntry(orgWithoutDomain('A', 'Empresa A'), 9),
    ]);

    assert.equal(deduped.length, 1);
  });

  it('dos ids de Apollo con el MISMO dominio real siguen colapsando', () => {
    const deduped = dedupeMultiQueryResultsByIdentity([
      toEntry(orgWithDomain('A', 'Éxito', 'https://www.exito.com'), 1),
      toEntry(orgWithDomain('B', 'Almacenes Exito', 'https://exito.com'), 2),
    ]);

    assert.equal(deduped.length, 1, 'el eje de dominio no se debilita');
  });

  it('resultados NO-Apollo conservan el comportamiento anterior', () => {
    const tavily = (url: string, title: string): MultiQuerySearchResultEntry => ({
      title,
      url,
      rank: 1,
      provider: 'tavily',
      source: 'tavily',
      originQuery: 'q',
    });

    const deduped = dedupeMultiQueryResultsByIdentity([
      tavily('https://www.rappi.com/', 'Rappi'),
      tavily('https://rappi.com/nosotros', 'Rappi — Nosotros'),
      tavily('no-es-una-url', 'Ruido'),
    ]);

    assert.equal(deduped.length, 1, 'mismo hostname ⇒ una entrada; url inválida ⇒ descartada');
    assert.equal(deduped[0]!.title, 'Rappi');
  });
});

// ─── 7. Identidad de persistencia ────────────────────────────────────────────

describe('§ 7 — identity_key persistida', () => {
  it('dominio real ⇒ domain:<dominio>, exactamente como antes', () => {
    assert.equal(
      buildProspectCandidateIdentityKey({
        name: 'Siigo SAS',
        domain: 'siigo.com',
        apolloOrganizationId: 'org_ignored',
      }),
      'domain:siigo.com',
      'el eje de proveedor NUNCA desplaza a un dominio real',
    );
  });

  it('identidad fiscal sigue mandando sobre todo lo demás', () => {
    assert.equal(
      buildProspectCandidateIdentityKey({
        name: 'Siigo SAS',
        domain: 'siigo.com',
        taxIdentifier: '900123456-7',
        countryCode: 'CO',
        apolloOrganizationId: 'org_ignored',
      }),
      'tax:co:9001234567',
    );
  });

  it('sin dominio ⇒ provider:apollo:<id>, NO domain:apollo.io ni el nombre', () => {
    assert.equal(
      buildProspectCandidateIdentityKey({
        name: 'Ministerio de Igualdad y Equidad',
        domain: null,
        website: null,
        apolloOrganizationId: 'org_min_igualdad',
      }),
      'provider:apollo:org_min_igualdad',
    );
  });

  it('dos organizaciones sin dominio producen claves persistidas DISTINTAS', () => {
    const a = buildProspectCandidateIdentityKey({
      name: 'Fundación Sin Sitio Web',
      apolloOrganizationId: 'org_otra_sin_dominio',
    });
    const b = buildProspectCandidateIdentityKey({
      name: 'Ministerio de Igualdad y Equidad',
      apolloOrganizationId: 'org_min_igualdad',
    });

    assert.notEqual(a, b);
    assert.equal(a?.includes('apollo.io'), false);
    assert.equal(b?.includes('apollo.io'), false);
  });

  it('sin dominio y sin id de proveedor cae al nombre canónico, como antes', () => {
    const key = buildProspectCandidateIdentityKey({ name: 'Empresa Sin Señales' });
    assert.ok(key?.startsWith('name:'));
  });
});

// ─── 11. Guardas estáticas anti-regresión ────────────────────────────────────

/**
 * Las guardas leen el CÓDIGO, no los comentarios: un módulo que EXPLICA por qué
 * ya no deriva el dominio de la URL nombra el patrón prohibido en su cabecera, y
 * un grep crudo confundiría «nombrarlo» con «hacerlo».
 */
function readSourceWithoutComments(relativePath: string): string {
  const raw = readFileSync(join(TOOLKIT_DIR, relativePath), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('§ 11 — guardas estáticas: la URL sintética no puede volver a fundar identidad', () => {
  const IDENTITY_PATH_FILES = [
    'apollo-two-round/production-runner.server.ts',
    'prospecting-pipeline.ts',
    'web-search-tool.ts',
    'apollo-two-round/apollo-shared-intake-bridge.ts',
  ];

  /**
   * Derivar un dominio de una URL NO está prohibido: para Tavily y Google CSE es
   * exactamente lo correcto, porque su `url` ES el sitio de la empresa. Lo
   * prohibido es hacerlo SIN haber distinguido antes el resultado de Apollo.
   *
   * Por eso la guarda no busca el patrón: busca el patrón SIN su condición. Cada
   * derivación superviviente tiene que estar a la vista de un
   * `isApolloOrganizationsResult`, que es lo que separa una URL real de una URL
   * de perfil.
   */
  const DERIVATION = /(normalizeDomain|extractDomainForDedup|extractDomain)\s*\(\s*\w+\.url\s*\)/;
  const GUARD_PROXIMITY_LINES = 4;

  it('toda derivación superviviente de dominio-desde-URL está separada del caso Apollo', () => {
    for (const file of IDENTITY_PATH_FILES) {
      const lines = readSourceWithoutComments(file).split('\n');

      lines.forEach((line, index) => {
        if (!DERIVATION.test(line)) return;
        const window = lines
          .slice(Math.max(0, index - GUARD_PROXIMITY_LINES), index + GUARD_PROXIMITY_LINES + 1)
          .join('\n');
        assert.ok(
          window.includes('isApolloOrganizationsResult'),
          `${file}:${index + 1} deriva un dominio de la URL sin distinguir el resultado de Apollo:\n  ${line.trim()}`,
        );
      });
    }
  });

  it('BARRIDO — ningún punto de identidad devuelve apollo.io para una organización sin dominio', () => {
    const result = mapApolloOrganizationToSearchResult(MINISTERIO, 1);
    const organization = toRawDiscoveredOrganization(result, 1);
    const registry = createSeenOrganizationRegistry();
    const identity = evaluateSeenOrganization(registry, organization).identity;

    const identityValues: (string | null)[] = [
      readApolloCandidateDomain(result),
      readApolloCandidateWebsite(result),
      readApolloDedupeIdentity(result).domain,
      organization.domain ?? null,
      identity.normalizedDomain,
      identity.normalizedLinkedInUrl,
      buildApolloProviderIdentityKey(readApolloProviderOrganizationId(result)),
      buildProspectCandidateIdentityKey({
        name: organization.name ?? null,
        domain: organization.domain ?? null,
        apolloOrganizationId: organization.providerOrganizationId ?? null,
      }),
      ...toSeenOrganizationKeys([identity]),
    ];

    for (const value of identityValues) {
      assert.equal(
        value === null || !value.includes('apollo.io'),
        true,
        `una señal de identidad sigue trayendo apollo.io: ${String(value)}`,
      );
    }

    // Y la URL de perfil sigue disponible para trazabilidad — ése es el trato.
    assert.ok(isApolloSyntheticProfileUrl(result.url));
  });

  it('el bridge de intake compartido no cae a `result.url` como website', () => {
    const source = readSourceWithoutComments('apollo-two-round/apollo-shared-intake-bridge.ts');
    assert.equal(
      /website_url\s*:[^,]*result\.url/.test(source),
      false,
      'la URL de perfil volvería a entrar como dominio por buildNormalizedDomains',
    );
  });

  it('la URL de perfil se construye en UN solo sitio y no se cita en las rutas de identidad', () => {
    const providerSource = readSourceWithoutComments(
      'web-search-providers/apollo-organizations-search-provider.ts',
    );
    assert.ok(
      /apollo\.io\/companies\//.test(providerSource),
      'la URL de trazabilidad sigue existiendo: es el contrato de WebSearchResult.url',
    );

    // Las rutas de identidad no pueden ni nombrarla: si vuelven a necesitar
    // distinguirla, el sitio correcto es `apollo-candidate-identity-readers.ts`,
    // cuyo trabajo ES reconocerla (`isApolloSyntheticProfileUrl`).
    for (const file of IDENTITY_PATH_FILES) {
      assert.equal(
        /apollo\.io/.test(readSourceWithoutComments(file)),
        false,
        `${file} no debe mencionar apollo.io en código ejecutable`,
      );
    }
  });
});

// ─── 11-14. Alcance: lo que este corte NO toca ───────────────────────────────

describe('§ 15 — alcance quirúrgico', () => {
  it('los lectores canónicos son puros: sin red, sin env, sin proveedor', () => {
    const source = readSourceWithoutComments('apollo-candidate-identity-readers.ts');
    for (const banned of ['fetch(', 'process.env', 'supabase', 'reserveCredits', 'lusha', 'hubspot']) {
      assert.equal(
        source.toLowerCase().includes(banned.toLowerCase()),
        false,
        `el lector canónico no puede depender de ${banned}`,
      );
    }
  });

  it('el eje de proveedor es OPCIONAL: un candidato que no lo trae se comporta igual', () => {
    assert.equal(
      buildProspectCandidateIdentityKey({ name: 'Rappi', domain: 'rappi.com' }),
      'domain:rappi.com',
    );
    assert.equal(buildProspectCandidateIdentityKey({}), null);
  });
});
