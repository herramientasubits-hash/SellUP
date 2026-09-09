/**
 * AGENT1-HARDENING-CUT-1 — el ownership de Apollo juzga con la evidencia del writer.
 *
 * ── El defecto ───────────────────────────────────────────────────────────────
 *
 * `candidate-writer.ts` nunca evalúa la propiedad con el nombre crudo: desde la
 * Recall Recovery v1.10, un nombre que parece un TÍTULO SEO se sustituye por el
 * inferido desde el dominio antes de juzgar. El orquestador de Apollo, en
 * cambio, llamaba a `evaluateCompanyOwnership(candidate.name, …)` tal cual — y
 * su rechazo es DEFINITIVO (`applyFinalGates` marca `definitivelyRejected`, el
 * candidato deja de ser elegible y no llega al writer).
 *
 * Resultado: una empresa REAL con dominio propio, cuya fuente devolvió un
 * título genérico, se descartaba aguas arriba y la recuperación que la habría
 * rescatado no llegaba a ejecutarse nunca.
 *
 * ── Lo que este corte NO hace ────────────────────────────────────────────────
 *
 * No relaja el gate. La recuperación exige que el nombre crudo SEA una frase SEO
 * y que el nombre inferido desde el dominio no lo sea. Una empresa ajena a su
 * dominio no cumple lo primero, así que se sigue rechazando — y se rechaza
 * aguas arriba, antes de gastar en ella.
 *
 * Sin red, sin proveedor, sin base, sin créditos. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
  resolveOwnershipEvaluationName,
} from '../company-ownership-gate';
import { evaluateApolloPreWriterCompanyOwnership } from '../apollo-pre-writer-target-conditions';
import type { ProspectingPipelineCandidate } from '../types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCandidate(
  overrides: Partial<ProspectingPipelineCandidate> & { name: string },
): ProspectingPipelineCandidate {
  return {
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function candidateOf(name: string, domain: string): ProspectingPipelineCandidate {
  return makeCandidate({ name, domain, website: `https://${domain}` });
}

/**
 * El ownership tal como el WRITER lo resuelve, reproducido aquí con las mismas
 * dos funciones que `candidate-writer.ts` Pass 1 invoca. Es el patrón de
 * referencia contra el que se mide la paridad.
 */
function writerOwnershipBlocked(candidate: ProspectingPipelineCandidate): boolean {
  const evaluationName = resolveOwnershipEvaluationName(
    candidate.name,
    candidate.website ?? null,
    candidate.domain ?? null,
  );
  return isBlockedByCompanyOwnership(
    evaluateCompanyOwnership(
      evaluationName.name,
      candidate.website ?? null,
      candidate.domain ?? null,
    ),
  );
}

/** El comportamiento PREVIO al corte: nombre crudo, sin recuperación. */
function preCutUpstreamBlocked(candidate: ProspectingPipelineCandidate): boolean {
  return isBlockedByCompanyOwnership(
    evaluateCompanyOwnership(
      candidate.name,
      candidate.website ?? null,
      candidate.domain ?? null,
    ),
  );
}

function upstreamBlocked(candidate: ProspectingPipelineCandidate): boolean {
  return isBlockedByCompanyOwnership(evaluateApolloPreWriterCompanyOwnership(candidate));
}

/** Empresas REALES cuya fuente devolvió un título de servicio, no una razón social. */
const SEO_TITLE_WITH_OWN_DOMAIN: ReadonlyArray<{ name: string; domain: string }> = [
  { name: 'Consultoría ERP, CRM, HCM y software empresarial', domain: 'dinamicacd.com' },
  { name: 'Soluciones de software a la medida para empresas en Colombia', domain: 'sofka.com.co' },
  { name: 'Desarrollo de software, aplicaciones web y móviles', domain: 'pragma.com.co' },
];

/** Empresas realmente AJENAS al dominio de la URL. Deben seguir rechazadas. */
const FOREIGN_TO_DOMAIN: ReadonlyArray<{ name: string; domain: string }> = [
  { name: 'Acme Manufacturing', domain: 'microsoft.com' },
  { name: 'Ferretería El Tornillo', domain: 'paginasamarillas.com.co' },
  { name: 'Distribuidora La Sabana', domain: 'elespectador.com' },
];

// ─── § 1 POSITIVO — el título SEO deja de descartar aguas arriba ─────────────

describe('CUT-1 § 1 · POSITIVO — nombre tipo SEO + dominio propio llega al writer', () => {
  for (const { name, domain } of SEO_TITLE_WITH_OWN_DOMAIN) {
    it(`«${name.slice(0, 40)}…» + ${domain} → NO se descarta aguas arriba`, () => {
      const candidate = candidateOf(name, domain);
      assert.equal(
        upstreamBlocked(candidate),
        false,
        'el ownership PRE-writer no puede rechazar a una empresa que el writer recupera',
      );
    });

    it(`«${name.slice(0, 40)}…» — la recuperación se declara, no se supone`, () => {
      const resolved = resolveOwnershipEvaluationName(name, `https://${domain}`, domain);
      assert.equal(resolved.recoveredFromDomain, true);
      assert.equal(resolved.originalName, name);
      assert.notEqual(resolved.name, name, 'el nombre evaluado tiene que ser el recuperado');
    });
  }
});

// ─── § 2 NEGATIVO — lo ajeno se sigue rechazando ─────────────────────────────

describe('CUT-1 § 2 · NEGATIVO — una empresa ajena al dominio sigue rechazada', () => {
  for (const { name, domain } of FOREIGN_TO_DOMAIN) {
    it(`«${name}» + ${domain} → sigue bloqueada aguas arriba`, () => {
      const candidate = candidateOf(name, domain);
      assert.equal(
        upstreamBlocked(candidate),
        true,
        'el corte NO relaja el gate: lo ajeno se rechaza, y se rechaza antes de gastar',
      );
    });

    it(`«${name}» — no se recupera nada: su nombre no es una frase SEO`, () => {
      const resolved = resolveOwnershipEvaluationName(name, `https://${domain}`, domain);
      assert.equal(resolved.recoveredFromDomain, false);
      assert.equal(resolved.name, name);
    });
  }
});

// ─── § 3 PARIDAD — las dos capas dan el MISMO veredicto ──────────────────────

describe('CUT-1 § 3 · el veredicto PRE-writer coincide con el del writer', () => {
  for (const { name, domain } of [...SEO_TITLE_WITH_OWN_DOMAIN, ...FOREIGN_TO_DOMAIN]) {
    it(`paridad para «${name.slice(0, 40)}…» + ${domain}`, () => {
      const candidate = candidateOf(name, domain);
      assert.equal(
        upstreamBlocked(candidate),
        writerOwnershipBlocked(candidate),
        'dos capas con veredictos distintos es exactamente el defecto que este corte cierra',
      );
    });
  }

  it('un nombre con sufijo legal no se toca: no hay recuperación que aplicar', () => {
    const resolved = resolveOwnershipEvaluationName(
      'Siigo S.A.S.',
      'https://siigo.com',
      'siigo.com',
    );
    assert.equal(resolved.recoveredFromDomain, false);
    assert.equal(resolved.name, 'Siigo S.A.S.', 'el nombre EVALUADO es el crudo, no el mostrado');
    assert.equal(upstreamBlocked(candidateOf('Siigo S.A.S.', 'siigo.com')), false);
  });

  it('sin dominio no hay recuperación posible y el gate rechaza igual que antes', () => {
    const candidate = makeCandidate({
      name: 'Consultoría ERP, CRM, HCM y software empresarial',
      domain: null as unknown as string,
      website: null as unknown as string,
    });
    assert.equal(upstreamBlocked(candidate), true);
    assert.equal(upstreamBlocked(candidate), writerOwnershipBlocked(candidate));
  });
});

// ─── § 4 MUTACIÓN — el rechazo temprano forzado pone el test en rojo ─────────

describe('CUT-1 § 4 · MUTACIÓN — revertir al nombre crudo vuelve a descartar', () => {
  it('el comportamiento PREVIO bloquea justo los casos que el corte rescata', () => {
    const rescuedByTheCut = SEO_TITLE_WITH_OWN_DOMAIN.filter(({ name, domain }) => {
      const candidate = candidateOf(name, domain);
      return preCutUpstreamBlocked(candidate) && !upstreamBlocked(candidate);
    });
    assert.equal(
      rescuedByTheCut.length,
      SEO_TITLE_WITH_OWN_DOMAIN.length,
      'si esta cuenta baja, o el corte se revirtió o los casos dejaron de ser testigos del defecto',
    );
  });

  it('la mutación NO puede pasar por rescatar también a las ajenas', () => {
    for (const { name, domain } of FOREIGN_TO_DOMAIN) {
      const candidate = candidateOf(name, domain);
      assert.equal(preCutUpstreamBlocked(candidate), true);
      assert.equal(upstreamBlocked(candidate), true);
    }
  });
});

// ─── § 5 GUARDA ESTÁTICA — el orquestador no puede volver al nombre crudo ────

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

function readSource(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
  );
}

const PRODUCTION_RUNNER =
  'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';

describe('CUT-1 § 5 · guarda estática — una sola entrada de ownership aguas arriba', () => {
  it('el orquestador NO llama a evaluateCompanyOwnership directamente', () => {
    const source = readSource(PRODUCTION_RUNNER);
    assert.equal(
      /\bevaluateCompanyOwnership\s*\(/.test(source),
      false,
      'volver a llamar al gate aquí reintroduce la divergencia de nombre con el writer',
    );
  });

  it('las dos evaluaciones aguas arriba pasan por la entrada PRE-writer', () => {
    const source = readSource(PRODUCTION_RUNNER);
    const calls = source.match(/evaluateApolloPreWriterCompanyOwnership\s*\(/g) ?? [];
    assert.equal(
      calls.length,
      2,
      'son dos: readContractConditions (proyección) y applyFinalGates (rechazo definitivo)',
    );
  });

  it('la recuperación del writer sale del cuerpo COMPARTIDO, no de una copia local', () => {
    const writer = readSource('src/server/agents/prospecting-toolkit/candidate-writer.ts');
    assert.ok(
      /resolveOwnershipEvaluationName\s*\(/.test(writer),
      'el writer tiene que usar el mismo resolutor que el orquestador',
    );
    assert.equal(
      /normalizeProspectCompanyName\s*\(/.test(writer),
      false,
      'una segunda copia de la recuperación es cómo las dos capas vuelven a separarse',
    );
  });
});
