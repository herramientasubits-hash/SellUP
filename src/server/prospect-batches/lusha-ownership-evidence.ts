/**
 * lusha-ownership-evidence.ts — AGENT1-LUSHA-MEASURABLE-ACCEPTANCE-X6.12.
 *
 * El veredicto de OWNERSHIP de la ruta Lusha, producido con la MISMA autoridad
 * que la ruta Apollo y con evidencia REAL: el nombre recuperado, el dominio
 * normalizado y la página de empresa de LinkedIn que el proveedor entregó.
 *
 * ── 🔴 Qué responde y qué NO decide ─────────────────────────────────────────
 *
 * Responde la condición `ownership_gate` del contrato canónico de completitud,
 * que hasta este corte la ruta Lusha declaraba NO DISPONIBLE. Nada más.
 *
 * **NO bloquea la persistencia**, y no es un descuido: es la conclusión de una
 * medición previa. X6.4 llegó a aplicar `evaluateCompanyOwnership` como gate
 * bloqueante en esta ruta y se retiró al contrastarlo con datos reales — sobre
 * el lote vivo `26f49596` rechazaba 4 de 25 empresas, las cuatro dueñas
 * legítimas de su dominio (EPM/`une.com.co`, RCN/`canalrcn.com`, Caracol
 * Televisión/`caracoltv.com`, Universidad de Nariño/`udenar.edu.co`), más
 * `D1 S.A.S`/`tiendasd1.com` en `bedebe9b`. Convertir ese ~15 % de falso
 * positivo en descartes duros contradiría la regla de producto vigente
 * —conservar TODAS las válidas— y perdería empresas reales.
 *
 * Lo que sí cambia respecto de declarar la condición «no disponible»: el
 * veredicto EXISTE, es el de la autoridad compartida, queda persistido por
 * candidata y es por tanto MEDIBLE. Una candidata que el ownership no acredita
 * se persiste igual y sale `incomplete` — se revisa, pero no cuenta hacia el
 * mínimo de 5, exactamente como en la ruta Apollo.
 *
 * ── 🔴 Por qué la decisión sale de la ADMISIÓN y no del gate textual ────────
 *
 * X6.10-C fijó UNA costura de admisión (`resolveCompanyOwnershipAdmission`) que
 * combina el veredicto textual con la evidencia estructural y sólo puede
 * RECUPERAR. Preguntar aquí por `isBlockedByCompanyOwnership` habría creado una
 * cuarta semántica de ownership en el repo, que es justo lo que ese corte cerró.
 *
 * Lusha no entrega conjunto de alias de dominio (`LushaPreviewCompany` no tiene
 * ese campo), así que la regla E1 nunca podrá admitir por aquí y la evidencia
 * estructural se limita hoy a registrar la corroboración de LinkedIn —que por
 * contrato NUNCA decide—. Se cablea igualmente porque la costura es una sola y
 * porque el día que el adaptador publique alias, esta ruta los aprovecha sin
 * tocar una línea.
 *
 * Puro: sin IO, sin proveedor, sin base, sin reloj.
 */

import {
  resolveCompanyOwnershipAdmission,
  type OwnershipAdmissionDecision,
} from '@/server/agents/prospecting-toolkit/company-ownership-admission';
import {
  evaluateCompanyOwnership,
  type CompanyOwnershipResult,
} from '@/server/agents/prospecting-toolkit/company-ownership-gate';
import {
  evaluateStructuralDomainOwnership,
  type StructuralOwnershipResult,
} from '@/server/agents/prospecting-toolkit/structural-domain-ownership';
// 🔴 El MISMO normalizador que usa el gate de país de esta ruta (X6.4-A): Lusha
// puede devolver una URL entera en `domain`, y `https://${domain}` sobre ella
// produce `https://https://…`, que el gate leería como un dominio sin señal.
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

/** Verdicto del contrato canónico para la condición `ownership_gate`. */
export type LushaOwnershipGateVerdict = 'pass' | 'fail';

export type LushaOwnershipEvidenceInput = {
  /** Nombre de la empresa tal como se va a persistir. */
  readonly name: string | null;
  /** `domain` de Lusha, que puede venir como host o como URL entera. */
  readonly domain: string | null;
  /** Página de empresa de LinkedIn declarada por el proveedor. */
  readonly linkedinUrl: string | null;
};

export type LushaOwnershipEvidence = {
  /** La decisión de la costura única de X6.10-C. */
  readonly admission: OwnershipAdmissionDecision;
  /** El veredicto TEXTUAL, sin reinterpretar. */
  readonly textual: CompanyOwnershipResult;
  /** El desenlace ESTRUCTURAL, sin reinterpretar. */
  readonly structural: StructuralOwnershipResult;
  /** Lo que el contrato de completitud recibe. */
  readonly gateVerdict: LushaOwnershipGateVerdict;
  /** El dominio efectivamente juzgado, ya normalizado. `null` ⇒ no había. */
  readonly evaluatedDomain: string | null;
};

/**
 * Evalúa el ownership de UNA empresa de Lusha.
 *
 * 🔴 Sin nombre o sin dominio la pregunta no se puede formular, y el gate
 * textual ya responde `reject` a eso (`No domain available to evaluate
 * ownership`). Se conserva esa respuesta tal cual en vez de fabricar un pase:
 * una empresa sin dominio no es una empresa acreditada.
 */
export function evaluateLushaOwnershipEvidence(
  input: LushaOwnershipEvidenceInput,
): LushaOwnershipEvidence {
  const name = (input.name ?? '').trim();
  const evaluatedDomain = input.domain === null ? null : normalizeDomain(input.domain);
  const website = evaluatedDomain === null ? null : `https://${evaluatedDomain}`;

  const textual = evaluateCompanyOwnership(name, website, evaluatedDomain);
  const structural = evaluateStructuralDomainOwnership({
    companyName: name,
    domain: evaluatedDomain,
    // Lusha no publica conjunto de alias. Declararlo vacío es el hecho, no una
    // omisión: la regla E1 se queda sin fuente y no puede admitir.
    providerDomainAliases: [],
    providerLinkedInCompanyUrl: input.linkedinUrl,
    provenance: {
      provider: 'lusha',
      operation: null,
      observedAt: null,
    },
  });
  const admission = resolveCompanyOwnershipAdmission(textual, structural);

  return {
    admission,
    textual,
    structural,
    // 🔴 `blocked` es la decisión de la costura única. Aquí NO mata a nadie: sólo
    // responde la condición del contrato.
    gateVerdict: admission.blocked ? 'fail' : 'pass',
    evaluatedDomain,
  };
}

/**
 * Bloque durable por candidata. Acotado, sin PII y sin payload del proveedor:
 * el veredicto, quién lo admitió y con qué dominio se juzgó.
 *
 * Existe para que el ~15 % de falso positivo del heurístico textual se pueda
 * MEDIR sobre filas reales en vez de discutirse. Un corte futuro sobre el
 * heurístico necesita exactamente esta serie.
 */
export function toLushaOwnershipGateMetadata(
  evidence: LushaOwnershipEvidence,
): Record<string, unknown> {
  return {
    verdict: evidence.gateVerdict,
    admitted_by: evidence.admission.admittedBy,
    textual_confidence: evidence.admission.textualConfidence,
    textual_blocked: evidence.admission.textualBlocked,
    structural_outcome: evidence.admission.structuralOutcome,
    structural_signal: evidence.admission.structuralSignal,
    recovered_by_structural_evidence: evidence.admission.recoveredByStructuralEvidence,
    linkedin_corroboration: evidence.structural.linkedInCorroboration,
    evaluated_domain: evidence.evaluatedDomain,
    // 🔴 NO bloquea: lo dice la fila, no sólo el comentario del módulo.
    blocks_persistence: false,
  };
}
