/**
 * AGENT1-OWNERSHIP-REVIEW-VISIBILITY (opción C) — la relación empresa–dominio
 * sin verificar deja de ser invisible.
 *
 * ── El defecto que estas pruebas fijan ───────────────────────────────────────
 *
 * Desde X6.12 la ruta Lusha evalúa ownership y persiste su veredicto, pero sólo
 * en `metadata.ownership_gate`. La cola es
 * `record_origin='production' AND status='needs_review'`, sin filtro ni señal, y
 * ningún componente leía esa clave: una candidata cuya propiedad del dominio no
 * se pudo verificar entraba a revisión INDISTINGUIBLE de una acreditada.
 *
 * ── 🔴 Lo que estas pruebas NO permiten ──────────────────────────────────────
 *
 * · Que la marca cambie la política de ADMISIÓN: nadie se descarta por llevarla.
 * · Que la marca haga CONTAR a la candidata hacia el mínimo.
 * · Que una fila SIN evaluación reciba veredicto —ni marca, ni absolución—.
 * · Que el texto presente la falta de evidencia como «dominio incorrecto».
 *
 * Puro + writer con I/O simulado: sin red, sin base, sin proveedor, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hasOwnershipUnverifiedFlag,
  resolveOwnershipReviewFlags,
  OWNERSHIP_UNVERIFIED_DETAIL,
  OWNERSHIP_UNVERIFIED_LABEL,
  OWNERSHIP_UNVERIFIED_REVIEW_FLAG,
} from '@/modules/prospect-batches/ownership-review-flag';
import {
  buildLushaPendingReviewCandidateRows,
  toLushaSurvivorCompletenessInput,
  type ResolvedLushaCandidate,
} from '@/server/prospect-batches/lusha-pending-review';
import { evaluateLushaOwnershipEvidence } from '@/server/prospect-batches/lusha-ownership-evidence';
import {
  evaluateLushaSurvivorCompleteness,
  resolveLushaRunAcceptanceTruth,
} from '@/server/prospect-batches/lusha-run-acceptance-truth';
import type { LushaPreviewCompany } from '@/server/prospect-batches/lusha-preview';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function company(
  id: string,
  name: string,
  domain: string,
  overrides: Partial<LushaPreviewCompany> = {},
): LushaPreviewCompany {
  return {
    providerCompanyId: id,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Healthcare',
    employeesExact: 700,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: `https://www.linkedin.com/company/${id}-co`,
    score: 100,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

const RESOLUTION = {
  dbDuplicateStatus: 'no_match',
  matchedAccountId: null,
  matchedHubspotCompanyId: null,
  accountDuplicateCheck: 'no_match',
  hubSpotDuplicateCheck: 'no_match',
  activeCandidateDuplicateCheck: 'no_match',
  activeGuardReason: null,
  duplicateDetails: null,
} as unknown as ResolvedLushaCandidate['resolution'];

function resolved(
  target: LushaPreviewCompany,
  options: { evaluateOwnership: boolean } = { evaluateOwnership: true },
): ResolvedLushaCandidate {
  return {
    company: target,
    resolution: RESOLUTION,
    ...(options.evaluateOwnership
      ? {
          ownership: evaluateLushaOwnershipEvidence({
            name: target.name,
            domain: target.domain,
            linkedinUrl: target.linkedinUrl,
          }),
        }
      : {}),
  } as ResolvedLushaCandidate;
}

/**
 * 🔴 El caso REAL de Producción: `D1 S.A.S ↔ tiendasd1.com`, del lote
 * `bedebe9b`. La empresa es dueña legítima de su dominio y el heurístico
 * textual no lo acredita — evidencia INSUFICIENTE, no contradicción.
 */
const INSUFFICIENT_EVIDENCE = company('d1', 'D1 S.A.S', 'tiendasd1.com');
/** Acreditada por el gate textual: el dominio contiene el nombre. */
const ACCREDITED = company('cv', 'Cueros Velez SAS', 'cuerosvelez.com');

// ═════════════════════════════════════════════════════════════════════════════
// § A — LA MARCA Y SU TEXTO
// ═════════════════════════════════════════════════════════════════════════════

describe('visibilidad § A · la marca dice lo que sabe y nada más', () => {
  it('sin evaluar NO se inventa veredicto: ni marca, ni absolución', () => {
    assert.deepEqual(resolveOwnershipReviewFlags({ evaluated: false, admitted: false }), []);
    assert.deepEqual(resolveOwnershipReviewFlags({ evaluated: false, admitted: true }), []);
  });

  it('evaluada y acreditada ⇒ sin marca', () => {
    assert.deepEqual(resolveOwnershipReviewFlags({ evaluated: true, admitted: true }), []);
  });

  it('evaluada y NO acreditada ⇒ la marca', () => {
    assert.deepEqual(resolveOwnershipReviewFlags({ evaluated: true, admitted: false }), [
      OWNERSHIP_UNVERIFIED_REVIEW_FLAG,
    ]);
  });

  it('🔴 el texto no afirma que el dominio sea incorrecto', () => {
    const copy = `${OWNERSHIP_UNVERIFIED_LABEL} ${OWNERSHIP_UNVERIFIED_DETAIL}`.toLowerCase();
    assert.ok(copy.includes('no verificada'), 'dice lo que de verdad pasó');
    assert.ok(
      copy.includes('no significa que el dominio sea incorrecto'),
      '🔴 y lo dice explícitamente, porque la ausencia de prueba no es prueba en contra',
    );
    for (const forbidden of ['dominio incorrecto.', 'dominio falso', 'no pertenece']) {
      assert.ok(!copy.includes(forbidden), `el texto no puede afirmar «${forbidden}»`);
    }
  });

  it('el lector tolera `null`, ausencia y basura', () => {
    assert.equal(hasOwnershipUnverifiedFlag(null), false);
    assert.equal(hasOwnershipUnverifiedFlag(undefined), false);
    assert.equal(hasOwnershipUnverifiedFlag('ownership_unverified'), false);
    assert.equal(hasOwnershipUnverifiedFlag([OWNERSHIP_UNVERIFIED_REVIEW_FLAG]), true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § B — LA FILA QUE SE ESCRIBE
// ═════════════════════════════════════════════════════════════════════════════

describe('visibilidad § B · la marca llega a la columna que la cola lee', () => {
  it('🔴 evidencia insuficiente ⇒ la fila lleva la marca', () => {
    const [row] = buildLushaPendingReviewCandidateRows('batch-1', [
      resolved(INSUFFICIENT_EVIDENCE),
    ]);
    assert.deepEqual(row.review_flags, [OWNERSHIP_UNVERIFIED_REVIEW_FLAG]);
    // Y el veredicto sigue estando en su bloque, sin contradecirse.
    const meta = row.metadata as { ownership_gate?: Record<string, unknown> };
    assert.equal(meta.ownership_gate?.verdict, 'fail');
    assert.equal(
      meta.ownership_gate?.structural_outcome,
      'insufficient_evidence',
      '🔴 es AUSENCIA de prueba, no una contradicción acreditada',
    );
  });

  it('acreditada ⇒ fila sin marca', () => {
    const [row] = buildLushaPendingReviewCandidateRows('batch-1', [resolved(ACCREDITED)]);
    assert.deepEqual(row.review_flags, []);
    assert.equal(hasOwnershipUnverifiedFlag(row.review_flags), false);
  });

  it('🔴 fila sin evaluación de ownership ⇒ `null`, y NO se le inventa nada', () => {
    const [row] = buildLushaPendingReviewCandidateRows('batch-1', [
      resolved(ACCREDITED, { evaluateOwnership: false }),
    ]);
    assert.equal(row.review_flags, null, 'nadie la juzgó: la columna lo dice');
    assert.equal(hasOwnershipUnverifiedFlag(row.review_flags), false);
    const meta = row.metadata as { ownership_gate?: unknown };
    assert.equal(meta.ownership_gate, undefined, 'ni bloque de veredicto');
  });

  it('🔴 la marca NO descarta: la fila existe y va a revisión', () => {
    const [row] = buildLushaPendingReviewCandidateRows('batch-1', [
      resolved(INSUFFICIENT_EVIDENCE),
    ]);
    assert.equal(row.status, 'needs_review');
    const meta = row.metadata as { ownership_gate?: Record<string, unknown> };
    assert.equal(meta.ownership_gate?.blocks_persistence, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § C — EL CONTEO NO SE MUEVE
// ═════════════════════════════════════════════════════════════════════════════

describe('visibilidad § C · marcar no es aprobar, y tampoco es contar', () => {
  const facts = { requestedSubindustries: [] as string[] };

  it('🔴 la candidata marcada NO cuenta hacia el mínimo', () => {
    const survivor = toLushaSurvivorCompletenessInput({
      ...resolved(INSUFFICIENT_EVIDENCE),
      macroPrecision: { verdict: 'confirmed' },
    } as ResolvedLushaCandidate);

    assert.equal(survivor.ownershipGate, 'fail');
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor, facts),
      'incomplete',
      '🔴 marcar la fila no la vuelve completa',
    );
  });

  it('una acreditada con el resto de la evidencia SÍ cuenta: el contraste', () => {
    const survivor = toLushaSurvivorCompletenessInput({
      ...resolved(ACCREDITED),
      macroPrecision: { verdict: 'confirmed' },
    } as ResolvedLushaCandidate);

    assert.equal(survivor.ownershipGate, 'pass');
    assert.equal(evaluateLushaSurvivorCompleteness(survivor, facts), 'complete');
  });

  it('🔴 una corrida con una de cada: dos filas, UNA aceptada', () => {
    const truth = resolveLushaRunAcceptanceTruth(
      [
        toLushaSurvivorCompletenessInput({
          ...resolved(ACCREDITED),
          macroPrecision: { verdict: 'confirmed' },
        } as ResolvedLushaCandidate),
        toLushaSurvivorCompletenessInput({
          ...resolved(INSUFFICIENT_EVIDENCE),
          macroPrecision: { verdict: 'confirmed' },
        } as ResolvedLushaCandidate),
      ],
      facts,
    );

    assert.equal(truth.survivors, 2, 'las dos se persisten y se revisan');
    assert.equal(truth.complete, 1);
    assert.equal(truth.incomplete, 1);
    assert.equal(truth.acceptedForTarget, 1, '🔴 la marcada no suma');
  });
});
