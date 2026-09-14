/**
 * agent1-ownership-verdict-seam-x3-1.test.ts
 *
 * AGENT1-OWNERSHIP-VERDICT-SEAM-X3.1 — el veredicto llega al escritor tal como
 * el gate lo emitió.
 *
 * ── El hueco que cierra ──────────────────────────────────────────────────────
 *
 * X3 puso trinquete en los dos EXTREMOS de la cadena —el evaluador, que produce
 * el veredicto, y el constructor de filas, que lo persiste— y dejó el tramo del
 * medio al aire: ocho campos copiados a mano en un literal dentro de
 * `production-runner.server.ts`, módulo que necesita Supabase y que por eso no
 * tiene suite pura.
 *
 * La auditoría de X3 lo midió, no lo supuso: invertir `allowed` en ese literal
 * —de modo que el gate dijera «permitido» y la fila persistiera «rechazado»—
 * pasaba **821 tests de seis suites** y `typecheck` sin que nada se inmutara.
 *
 * ── Qué fija esta suite ─────────────────────────────────────────────────────
 *
 * Que `toOwnershipGateVerdictLike` COPIA los ocho campos, uno a uno, sobre
 * veredictos REALES producidos por `evaluateCompanyOwnership` — no sobre objetos
 * escritos a mano, que sólo demostrarían que un literal se copia a sí mismo.
 *
 * Offline: sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateApolloPreWriterCompanyOwnershipWithInputs,
  toOwnershipGateVerdictLike,
  type ApolloPreWriterOwnershipEvaluation,
} from '../apollo-pre-writer-target-conditions';
import { buildDiscardedDispositionRows } from '@/modules/prospect-discards/dispositions-row-builder';

type PipelineCandidateLike = Parameters<
  typeof evaluateApolloPreWriterCompanyOwnershipWithInputs
>[0];

function candidateOf(name: string, domain: string | null): PipelineCandidateLike {
  return {
    name,
    domain,
    website: domain ? `https://${domain}` : null,
  } as unknown as PipelineCandidateLike;
}

/**
 * Casos que producen veredictos REALES y VARIADOS: permitidos por cuatro reglas
 * distintas, rechazados por dos, sin dominio, y con recuperación de frase SEO.
 *
 * La variedad no es adorno: una costura que copiase sólo los campos que en la
 * mayoría de los casos coinciden pasaría un corpus homogéneo.
 */
const SEAM_CORPUS: readonly { label: string; name: string; domain: string | null }[] = [
  { label: 'permitido · coincidencia exacta', name: 'Vaquita Express', domain: 'vaquitaexpress.com.co' },
  { label: 'permitido · el dominio contiene el nombre', name: 'Primavera', domain: 'tiendaprimavera.com' },
  { label: 'permitido · institucional territorial', name: 'Alcaldía de Segovia', domain: 'segovia-antioquia.gov.co' },
  { label: 'permitido · abreviatura institucional', name: 'Ministerio de Ambiente', domain: 'minambiente.gov.co' },
  { label: 'rechazado · empresa ajena a su dominio', name: 'Acme Manufacturing', domain: 'microsoft.com' },
  { label: 'rechazado · mismos tokens, otro orden', name: 'Supermercados Caribe', domain: 'caribesupermercados.co' },
  { label: 'bloqueado low · raíz genérica', name: 'Dinámica CD', domain: 'software.com' },
  { label: 'sin dominio', name: 'Postobón', domain: null },
  {
    label: 'frase SEO · el nombre evaluado NO es el crudo',
    name: 'Consultoría ERP, CRM, HCM y software empresarial',
    domain: 'dinamicacd.com',
  },
];

describe('§ 1 · la costura copia 1:1 el veredicto del gate', () => {
  for (const entry of SEAM_CORPUS) {
    test(`${entry.label} — los ocho campos, uno a uno`, () => {
      const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(
        candidateOf(entry.name, entry.domain),
      );
      const persisted = toOwnershipGateVerdictLike(evaluation);

      assert.equal(persisted.allowed, evaluation.verdict.allowed, 'allowed');
      assert.equal(persisted.confidence, evaluation.verdict.confidence, 'confidence');
      assert.equal(persisted.reason, evaluation.verdict.reason, 'reason');
      assert.deepEqual(
        persisted.matchedSignals,
        evaluation.verdict.matchedSignals,
        'matchedSignals',
      );
      assert.deepEqual(
        persisted.missingSignals,
        evaluation.verdict.missingSignals,
        'missingSignals',
      );
      assert.equal(persisted.evaluationName, evaluation.evaluationName, 'evaluationName');
      assert.equal(
        persisted.recoveredFromDomain,
        evaluation.recoveredFromDomain,
        'recoveredFromDomain',
      );
      assert.equal(persisted.effectiveDomain, evaluation.effectiveDomain, 'effectiveDomain');
    });
  }

  /**
   * 🔴 `allowed` se COPIA, no se deduce de `confidence`.
   *
   * Hoy las dos cifras son coherentes —es un invariante del propio gate— así que
   * un corpus de veredictos reales no puede distinguir copiar de deducir. Este
   * test usa una evaluación SINTÉTICA e incoherente a propósito: si alguien
   * sustituyera la copia por una regla, la costura "corregiría" el veredicto en
   * silencio, que es justo lo que no debe hacer. Fabricar la regla es tarea del
   * gate, y el gate está fuera de este corte.
   */
  test('allowed se copia aunque contradiga a confidence', () => {
    const incoherent = {
      verdict: {
        allowed: true,
        confidence: 'reject',
        reason: 'veredicto sintético incoherente a propósito',
        candidateIdentityKey: 'x',
        domainIdentityKey: 'y',
        matchedSignals: [],
        missingSignals: ['domain_name_match'],
      },
      evaluationName: 'X',
      originalName: 'X',
      recoveredFromDomain: false,
      effectiveDomain: 'x.com',
    } as unknown as ApolloPreWriterOwnershipEvaluation;

    const persisted = toOwnershipGateVerdictLike(incoherent);
    assert.equal(persisted.allowed, true, 'copiado, no derivado de confidence=reject');
    assert.equal(persisted.confidence, 'reject');
  });

  test('las señales viajan por valor observable, no como nombre vacío', () => {
    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(
      candidateOf('Vaquita Express', 'vaquitaexpress.com.co'),
    );
    const persisted = toOwnershipGateVerdictLike(evaluation);
    assert.deepEqual(persisted.matchedSignals, ['exact_domain_name_match']);
    assert.deepEqual(persisted.missingSignals, []);
  });
});

describe('§ 2 · de la costura a la fila persistida, sin pérdida', () => {
  /**
   * La cadena completa que X3 abrió y X3.1 cierra:
   *
   *   evaluateCompanyOwnership → toOwnershipGateVerdictLike →
   *   buildDiscardedDispositionRows → evidence.ownership_gate
   *
   * Si cualquiera de los tres tramos alterase el veredicto, aquí se ve.
   */
  for (const entry of SEAM_CORPUS) {
    test(`${entry.label} — el veredicto del gate llega intacto a evidence`, () => {
      const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(
        candidateOf(entry.name, entry.domain),
      );
      const { rows } = buildDiscardedDispositionRows({
        batchId: 'seam-x31',
        requestedCountryCode: 'CO',
        requestedIndustry: 'Retail',
        sourcePrimary: 'apollo',
        evaluatedCandidates: [
          {
            candidateKey: 'apollo:seam',
            identity: {
              providerOrganizationId: 'org-seam',
              normalizedDomain: entry.domain,
              canonicalName: 'nombre canonico',
              normalizedLinkedInUrl: 'linkedin.com/company/seam',
            },
            providerRawName: entry.name,
            ownership: toOwnershipGateVerdictLike(evaluation),
          },
        ],
        finalDispositions: [
          {
            candidateKey: 'apollo:seam',
            roundNumber: 1,
            finalDisposition: 'ownership_rejected_final',
            finalReason: 'ownership_mismatch',
          },
        ],
      });

      assert.equal(rows.length, 1);
      const gate = (rows[0].evidence as Record<string, unknown>).ownership_gate as Record<
        string,
        unknown
      >;
      assert.equal(gate.allowed, evaluation.verdict.allowed);
      assert.equal(gate.confidence, evaluation.verdict.confidence);
      assert.equal(gate.reason, evaluation.verdict.reason);
      assert.deepEqual(gate.matched_signals, [...evaluation.verdict.matchedSignals]);
      assert.deepEqual(gate.missing_signals, [...evaluation.verdict.missingSignals]);
      assert.equal(gate.evaluation_name, evaluation.evaluationName);
      assert.equal(gate.recovered_from_domain, evaluation.recoveredFromDomain);
      assert.equal(gate.effective_domain, evaluation.effectiveDomain);
    });
  }
});

// ─── Guarda estática, complementaria ─────────────────────────────────────────

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const PRODUCTION_RUNNER =
  'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';

describe('§ 3 · el runner usa la costura y no vuelve a copiar a mano', () => {
  /**
   * Complemento, NO sustituto de los tests de arriba.
   *
   * Los §§ 1 y 2 fijan COMPORTAMIENTO sobre la costura. Este guard cubre lo que
   * ellos no alcanzan: que el runner —que no tiene suite pura— siga delegando en
   * ella en vez de reintroducir el literal de ocho campos que era el hueco.
   * Sin él, alguien podría volver a escribir la copia a mano y las suites puras
   * seguirían verdes evaluando una función que ya nadie llama.
   *
   * Lee el fuente SIN comentarios: nombrar algo en una explicación no es usarlo.
   */
  test('la propagación al escritor de disposiciones pasa por toOwnershipGateVerdictLike', () => {
    const source = stripComments(
      fs.readFileSync(path.join(process.cwd(), PRODUCTION_RUNNER), 'utf8'),
    );
    assert.ok(
      /ownership:\s*ownershipEvaluation\s*\?\s*toOwnershipGateVerdictLike\(/.test(source),
      'el runner tiene que delegar la copia del veredicto en la costura pura',
    );
  });

  test('no queda ninguna copia manual del veredicto en el runner', () => {
    const source = stripComments(
      fs.readFileSync(path.join(process.cwd(), PRODUCTION_RUNNER), 'utf8'),
    );
    // El literal que existía era `allowed: ownershipEvaluation.verdict.allowed`.
    // Cualquier reaparición de una copia campo a campo vuelve a abrir el hueco.
    assert.equal(
      /allowed:\s*ownershipEvaluation\.verdict\.allowed/.test(source),
      false,
      'volver a copiar el veredicto a mano reabre el tramo sin trinquete',
    );
  });
});
