/**
 * AGENT1-APOLLO-STRUCTURED-NAME-X6.11-B
 *
 * El nombre que Apollo manda es el nombre de una fila de su base de datos, no
 * el título de una página web. Aplicarle las heurísticas de título lo rompía de
 * dos maneras, ambas medidas en Producción sobre 252 filas de 6 lotes (X6.11-A):
 *
 *   · TRUNCAMIENTO por separador (12 casos)
 *     «rtvc - señalcolombia» → «rtvc». El gate de ownership, que con el nombre
 *     entero acepta por su regla 3, rechazaba media entrada.
 *
 *   · SUSTITUCIÓN POR EL DOMINIO (12 casos)
 *     «BoP Consultoría» → «Cardonaprada». Cambia una empresa por otra y, peor,
 *     vuelve CIRCULAR al ownership: el nombre sale del dominio que después se
 *     pretende acreditar, y la regla 1 lo confirma por construcción.
 *
 * 🔴 Este corte NO toca ninguna regla de ownership, ni X6.9, ni X6.10-A/B/C.
 * Devuelve al gate la entrada que el proveedor había mandado. Que «rtvc -
 * señalcolombia» pase es mérito de la regla 3, que existe desde antes.
 *
 * 🔴 Y lo que el caso «BoP Consultoría» demuestra NO es quién posee
 * `cardonaprada.co`: demuestra que la validación anterior era INSUFICIENTE,
 * porque aprobaba una correspondencia que ella misma había fabricado.
 *
 * Sin red, sin proveedor, sin base, sin reloj. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { mapApolloOrganizationToSearchResult } from '../web-search-providers/apollo-organizations-search-provider';
import {
  readApolloCandidateName,
  isApolloOrganizationsResult,
} from '../apollo-candidate-identity-readers';
import {
  toCandidateEvidenceSnapshot,
  fromCandidateEvidenceSnapshot,
} from '../apollo-two-round/checkpoint';
import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';
import { buildProspectCandidateIdentityKey } from '../prospect-candidate-identity-key';
import { buildCanonicalCompanyIdentity } from '../canonical-company-identity';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
} from '../active-candidate-identity-guard';
import type { WebSearchResult } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apolloResult(name: string, domain: string | null): WebSearchResult {
  return mapApolloOrganizationToSearchResult(
    {
      id: '5ed1353bb929700001c97b45',
      name,
      website_url: domain === null ? null : `https://www.${domain}`,
      primary_domain: domain,
      linkedin_url: null,
    } as never,
    1,
  );
}

function ownershipAccepts(name: string, domain: string): boolean {
  return !isBlockedByCompanyOwnership(
    evaluateCompanyOwnership(name, `https://www.${domain}`, domain),
  );
}

/** El corpus de regresión de X6.11-A: nombre de Apollo → nombre que se usaba. */
const CORPUS_TRUNCAMIENTO: ReadonlyArray<readonly [string, string, string]> = [
  ['rtvc - señalcolombia', 'rtvc', 'senalcolombia.tv'],
  ['Alcaldía de Bello - Edificio Gaspar de Rodas', 'Alcaldía de Bello', 'bello.gov.co'],
  ['Concesionaria Vial Andina - Coviandina', 'Concesionaria Vial Andina', 'coviandina.com'],
  ['FONADE - Financial Fund For Development Projects', 'FONADE', 'fonade.gov.co'],
  ['Puerto de Santa Marta - Sociedad Portuaria de Santa Marta', 'Puerto de Santa Marta', 'puertodesantamarta.com'],
  ['Secretaría General - Alcaldía Mayor de Bogotá', 'Secretaría General', 'secretariageneralalcaldiamayor.gov.co'],
];

const CORPUS_SUSTITUCION: ReadonlyArray<readonly [string, string, string]> = [
  ['BoP Consultoría', 'Cardonaprada', 'cardonaprada.co'],
  ['Concejo de Medellin', 'Concejodemedellin', 'concejodemedellin.gov.co'],
  ['Hacienda Bogotá', 'Haciendabogota', 'haciendabogota.gov.co'],
  ['IDEAM Colombia', 'Ideam', 'ideam.gov.co'],
  ['IDIPRON Bogotá', 'Idipron', 'idipron.gov.co'],
  ['Corporación Interuniversitaria de Servicios', 'CIS', 'cis.org.co'],
];

// ─── § 1 · el lector canónico y su procedencia ────────────────────────────────

describe('X6.11-B § 1 — el nombre estructurado se transcribe, no se infiere', () => {
  it('1.1 · el lector devuelve el nombre que el mapper estampó', () => {
    const r = apolloResult('rtvc - señalcolombia', 'senalcolombia.tv');
    assert.equal(readApolloCandidateName(r), 'rtvc - señalcolombia');
    assert.equal(isApolloOrganizationsResult(r), true);
  });

  it('1.2 · sólo recorta espacio exterior: no parte ni descarta segmentos', () => {
    for (const name of [
      'rtvc - señalcolombia',
      'FONADE - Financial Fund For Development Projects',
      'Atenea, Agencia Distrital para la Educación Superior',
      'A | B :: C',
    ]) {
      assert.equal(readApolloCandidateName(apolloResult(name, 'ejemplo.com')), name);
    }
  });

  it('1.3 · procedencia REAL: sobrevive al viaje del checkpoint', () => {
    // El runner reconstruye el resultado desde el snapshot TAMBIÉN en la primera
    // pasada. Si el nombre no sobreviviera aquí, el arreglo duraría un tramo.
    const original = apolloResult('rtvc - señalcolombia', 'senalcolombia.tv');
    const restored = fromCandidateEvidenceSnapshot(toCandidateEvidenceSnapshot(original));
    assert.equal(readApolloCandidateName(restored), readApolloCandidateName(original));
    assert.equal(readApolloCandidateName(restored), 'rtvc - señalcolombia');
  });

  it('1.4 · un nombre vacío NO produce nombre: devuelve null', () => {
    const shell = { ...apolloResult('x', 'ejemplo.com'), title: '   ' } as WebSearchResult;
    assert.equal(readApolloCandidateName(shell), null);
  });

  it('1.5 · el mapper LANZA si el proveedor no manda nombre', () => {
    // La primera línea de defensa, anterior a este corte y que aquí se ancla.
    assert.throws(() => apolloResult('   ', 'ejemplo.com'));
  });
});

// ─── § 2 · truncamiento ───────────────────────────────────────────────────────

describe('X6.11-B § 2 — truncamiento por separador', () => {
  for (const [completo, truncado, domain] of CORPUS_TRUNCAMIENTO) {
    it(`2.1 · «${completo}» deja de quedarse en «${truncado}»`, () => {
      assert.equal(readApolloCandidateName(apolloResult(completo, domain)), completo);
      assert.notEqual(readApolloCandidateName(apolloResult(completo, domain)), truncado);
    });
  }

  it('2.2 · 🔴 RTVC: con el nombre entero, las reglas ACTUALES ya lo aceptan', () => {
    // El caso que motivó toda la cadena X6.10. No hace falta evidencia
    // estructural, ni LinkedIn, ni tocar las siglas: hacía falta el nombre.
    assert.equal(ownershipAccepts('rtvc', 'senalcolombia.tv'), false);
    assert.equal(ownershipAccepts('rtvc - señalcolombia', 'senalcolombia.tv'), true);

    const r = evaluateCompanyOwnership(
      'rtvc - señalcolombia',
      'https://www.senalcolombia.tv',
      'senalcolombia.tv',
    );
    assert.equal(r.confidence, 'medium');
    assert.ok(r.matchedSignals.includes('company_name_contains_domain_word'));
  });
});

// ─── § 3 · sustitución por dominio y validación circular ──────────────────────

describe('X6.11-B § 3 — el nombre deja de salir del dominio que se valida', () => {
  for (const [real, derivado, domain] of CORPUS_SUSTITUCION) {
    it(`3.1 · «${real}» deja de llamarse «${derivado}»`, () => {
      assert.equal(readApolloCandidateName(apolloResult(real, domain)), real);
    });
  }

  it('3.2 · 🔴 el nombre derivado del dominio se acreditaba a sí mismo', () => {
    // Demuestra la INSUFICIENCIA de la validación anterior, no quién posee el
    // dominio: el gate confirmaba una correspondencia fabricada por nosotros.
    for (const [, derivado, domain] of CORPUS_SUSTITUCION) {
      assert.equal(
        ownershipAccepts(derivado, domain),
        true,
        `«${derivado}» se acreditaba circularmente contra ${domain}`,
      );
    }
  });

  it('3.3 · «BoP Consultoría» deja de aprobar ownership contra cardonaprada.co', () => {
    assert.equal(ownershipAccepts('Cardonaprada', 'cardonaprada.co'), true);
    assert.equal(ownershipAccepts('BoP Consultoría', 'cardonaprada.co'), false);
  });

  it('3.4 · sin nombre estructurado NO se cae al dominio', () => {
    // Si el fallback derivara del dominio, la circularidad volvería justo por
    // donde menos se ve. El contrato del lector lo impide: `null`, no un nombre.
    const shell = {
      ...apolloResult('x', 'cardonaprada.co'),
      title: '',
    } as WebSearchResult;
    assert.equal(readApolloCandidateName(shell), null);
  });

  it('3.5 · 🔴 el nombre de reemplazo no puede acreditar NINGÚN dominio', () => {
    // Es la garantía que de verdad cierra la circularidad, y es de
    // comportamiento: da igual qué bandera se levante, «Unknown» no acredita.
    for (const [, , domain] of [...CORPUS_SUSTITUCION, ...CORPUS_TRUNCAMIENTO]) {
      assert.equal(
        ownershipAccepts('Unknown', domain),
        false,
        `«Unknown» no puede acreditar ${domain}`,
      );
    }
  });
});

// ─── § 4 · identidad persistida ───────────────────────────────────────────────

describe('X6.11-B § 4 — `identity_key` no se mueve', () => {
  it('4.1 · con dominio, la clave es del DOMINIO: el nombre no participa', () => {
    for (const [completo, truncado, domain] of [...CORPUS_TRUNCAMIENTO, ...CORPUS_SUSTITUCION]) {
      const antes = buildProspectCandidateIdentityKey({
        name: truncado, domain, website: `https://www.${domain}`,
        countryCode: 'CO', taxIdentifier: null, apolloOrganizationId: 'org-1',
      });
      const despues = buildProspectCandidateIdentityKey({
        name: completo, domain, website: `https://www.${domain}`,
        countryCode: 'CO', taxIdentifier: null, apolloOrganizationId: 'org-1',
      });
      assert.equal(antes, despues, `${domain}: la clave no puede cambiar`);
      assert.equal(antes, `domain:${domain}`);
    }
  });

  it('4.2 · sin dominio manda el id de Apollo, tampoco el nombre', () => {
    const antes = buildProspectCandidateIdentityKey({
      name: 'rtvc', domain: null, website: null,
      countryCode: 'CO', taxIdentifier: null, apolloOrganizationId: 'org-9',
    });
    const despues = buildProspectCandidateIdentityKey({
      name: 'rtvc - señalcolombia', domain: null, website: null,
      countryCode: 'CO', taxIdentifier: null, apolloOrganizationId: 'org-9',
    });
    assert.equal(antes, despues);
  });
});

// ─── § 5 · compatibilidad histórica: cooldown y deduplicación ─────────────────

describe('X6.11-B § 5 — una fila histórica y una nueva no se duplican', () => {
  /**
   * El riesgo que X6.11-A dejó declarado y sin demostrar: una candidata
   * persistida AYER como «FONADE» y la misma empresa HOY como «FONADE -
   * Financial Fund For Development Projects».
   */
  const HISTORICA: ActiveCandidateRecord = {
    id: 'cand-historica',
    name: 'FONADE',
    domain: 'fonade.gov.co',
    status: 'needs_review',
  };

  it('5.1 · 🔴 la identidad CANÓNICA sí cambia — el riesgo es real', () => {
    const antes = buildCanonicalCompanyIdentity('FONADE').identityKey;
    const despues = buildCanonicalCompanyIdentity(
      'FONADE - Financial Fund For Development Projects',
    ).identityKey;
    assert.notEqual(antes, despues);
  });

  it('5.2 · …y AUN ASÍ la guarda de duplicado activo lo caza, por DOMINIO', () => {
    // Es la comprobación que ya existía, y el eje que usa no es el nombre.
    // Por eso el cambio de nombre no puede crear un duplicado: el dominio es
    // el mismo, y `same_active_domain` es anterior a cualquier eje de nombre.
    const match = checkActiveCandidateDuplicate(
      {
        name: 'FONADE - Financial Fund For Development Projects',
        domain: 'fonade.gov.co',
        website: 'https://www.fonade.gov.co',
      },
      [HISTORICA],
    );
    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_active_domain');
    assert.equal(match.matchedCandidateId, 'cand-historica');
  });

  it('5.3 · el dominio se canoniza en las dos caras: `www.` y mayúsculas no parten la identidad', () => {
    const match = checkActiveCandidateDuplicate(
      { name: 'FONADE - Financial Fund For Development Projects', domain: 'WWW.Fonade.GOV.CO' },
      [HISTORICA],
    );
    assert.equal(match.matched, true);
    assert.equal(match.reason, 'same_active_domain');
  });

  it('5.4 · el hueco que QUEDA, declarado: sin dominio en alguna de las dos caras', () => {
    // 🔴 Si la fila histórica no tiene dominio, el eje fuerte no existe y sólo
    // queda el nombre — que es precisamente lo que cambia. No lo tapo: lo fijo.
    // No es nuevo de este corte (dos nombres distintos de la misma empresa ya
    // divergían antes), pero este corte lo hace MÁS probable durante la ventana
    // de solape, y por eso queda escrito.
    const sinDominio: ActiveCandidateRecord = {
      id: 'cand-sin-dominio',
      name: 'FONADE',
      domain: null,
      status: 'needs_review',
    };
    const match = checkActiveCandidateDuplicate(
      { name: 'FONADE - Financial Fund For Development Projects', domain: 'fonade.gov.co' },
      [sinDominio],
    );
    assert.equal(match.matched, false);
  });

  it('5.5 · RTVC y Coviandina conservan su dominio, así que su eje fuerte sigue', () => {
    for (const [completo, , domain] of CORPUS_TRUNCAMIENTO) {
      const historica: ActiveCandidateRecord = {
        id: `h-${domain}`, name: 'nombre anterior', domain, status: 'needs_review',
      };
      const match = checkActiveCandidateDuplicate({ name: completo, domain }, [historica]);
      assert.equal(match.matched, true, `${domain} debe seguir cazándose por dominio`);
      assert.equal(match.reason, 'same_active_domain');
    }
  });
});

// ─── § 6 · rutas NO Apollo ────────────────────────────────────────────────────

describe('X6.11-B § 6 — lo que no es Apollo no se mueve', () => {
  it('6.1 · un resultado de Tavily no pasa por el lector estructurado', () => {
    const tavily = {
      title: 'Siigo | Software contable en la nube',
      url: 'https://www.siigo.com',
      snippet: null,
      source: 'tavily',
      rank: 1,
      provider: 'tavily',
      metadata: {},
    } as unknown as WebSearchResult;
    assert.equal(isApolloOrganizationsResult(tavily), false);
  });

  it('6.2 · el builder sigue infiriendo fuera de Apollo (ancla sobre el fuente)', () => {
    // `buildProspectingPipelineCandidate` hace I/O real y no se puede ejecutar
    // offline; se ancla la rama, con la misma costura que X6.1 documentó y su
    // misma limitación declarada.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/prospecting-pipeline.ts'),
      'utf8',
    );
    const body = src.slice(src.indexOf('export async function buildProspectingPipelineCandidate'));
    assert.match(body, /if \(isApolloResult\) \{/);
    // 🔴 El mutation testing lo pidió: anclar sólo el `if` dejaba pasar que la
    // ternaria de arriba dejara de consultar `isApolloResult`, con lo que Apollo
    // volvía entero a la inferencia de título sin que ningún test lo viera.
    assert.match(
      body,
      /const structuredName = isApolloResult \? readApolloCandidateName\(result\) : null;/,
    );
    assert.match(body, /inferCompanyNameFromSearchResult\(result\.title, nameInferenceUrl\)/);
    // 🔴 Y en la rama Apollo NO puede aparecer la inferencia desde el dominio.
    const apolloBranch = body.slice(body.indexOf('if (isApolloResult) {'), body.indexOf('} else {'));
    // 🔴 La rama Apollo no puede tocar el dominio de NINGUNA forma. El mutation
    // testing lo exigió: sustituir 'Unknown' por el dominio crudo reintroduce la
    // circularidad —«cardonaprada.co» como nombre SÍ acredita cardonaprada.co
    // por la regla 3— y ninguna suite lo veía, porque el constructor hace I/O
    // real y no se puede ejecutar offline.
    //
    // Es un ancla sobre el fuente, con la misma costura que X6.1 documentó y su
    // misma limitación declarada: defiende el NOMBRE de la línea, no su
    // comportamiento. La garantía de comportamiento que sí es ejecutable está
    // en § 3.5 (el nombre de reemplazo no acredita ningún dominio).
    for (const forbidden of ['inferNameFromDomain', 'readApolloCandidateDomain', 'domain']) {
      assert.equal(
        apolloBranch.includes(forbidden),
        false,
        `la rama Apollo no puede derivar el nombre de "${forbidden}"`,
      );
    }
    assert.match(apolloBranch, /name = 'Unknown';/);
  });
});
