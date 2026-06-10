/**
 * Context Assembler — Candidate Delta Builder (Hito 16AB.24.2)
 *
 * Construye el delta dinámico por candidato a partir de VerificationCandidateInput.
 * Las preguntas específicas se derivan de los riesgos del candidato,
 * nunca por nombre literal. No hardcodea lógica de aprobación o rechazo.
 */

import type { VerificationCandidateInput, CandidateDelta } from './types';
import { DELTA_LIMITS, TRACKING_PARAMS } from './context-config';

// ─── Sanitización de URL ──────────────────────────────────────────────────────

function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length > DELTA_LIMITS.maxUrlLength) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }

    url.searchParams.sort();
    const result = url.toString();
    return result.length <= DELTA_LIMITS.maxUrlLength ? result : null;
  } catch {
    return null;
  }
}

function sanitizeUrls(urls: string[] | undefined): string[] {
  if (!urls || !Array.isArray(urls)) return [];
  return urls
    .map(sanitizeUrl)
    .filter((u): u is string => u !== null)
    .slice(0, DELTA_LIMITS.maxDiscoveryUrls);
}

// ─── Detección de tipo de LinkedIn ───────────────────────────────────────────

const LINKEDIN_COMPANY_RE = /^https?:\/\/(www\.)?linkedin\.com\/company\//i;
const LINKEDIN_PERSONAL_RE = /^https?:\/\/(www\.)?linkedin\.com\/in\//i;

type LinkedInClassification =
  | { type: 'company'; url: string; warning: null }
  | { type: 'personal'; url: string; warning: string }
  | { type: 'invalid'; url: null; warning: string }
  | { type: 'absent'; url: null; warning: null };

function classifyLinkedIn(raw: string | null | undefined): LinkedInClassification {
  if (!raw) return { type: 'absent', url: null, warning: null };

  const trimmed = raw.trim();

  if (LINKEDIN_PERSONAL_RE.test(trimmed)) {
    return {
      type: 'personal',
      url: trimmed,
      warning:
        'LinkedIn proporcionado es perfil personal (/in/), no corporativo (/company/). No se considera LinkedIn corporativo válido.',
    };
  }

  if (LINKEDIN_COMPANY_RE.test(trimmed)) {
    const sanitized = sanitizeUrl(trimmed);
    if (sanitized) return { type: 'company', url: sanitized, warning: null };
  }

  return {
    type: 'invalid',
    url: null,
    warning: `URL de LinkedIn no reconocida como corporativa: ${trimmed.slice(0, 100)}`,
  };
}

// ─── Generación de preguntas específicas a partir de riesgos ─────────────────

function buildQuestionsFromRisks(risks: string[], duplicateStatus: string | null): string[] {
  const questions: string[] = [];

  const riskText = risks.join(' ').toLowerCase();
  const isDuplicateRisk =
    duplicateStatus === 'possible_duplicate' ||
    duplicateStatus === 'confirmed_duplicate' ||
    riskText.includes('duplicado') ||
    riskText.includes('duplicate');

  const isSectorBoundary =
    riskText.includes('frontera sectorial') ||
    riskText.includes('sector_boundary') ||
    riskText.includes('actividad principal no confirmada') ||
    riskText.includes('salud') ||
    riskText.includes('health') ||
    riskText.includes('financier') ||
    riskText.includes('finanza');

  const hasWeakEvidence =
    riskText.includes('evidencia débil') ||
    riskText.includes('evidencia agregadora') ||
    riskText.includes('directorio') ||
    riskText.includes('weak evidence');

  const hasNameConfusionRisk =
    riskText.includes('nombre similar') ||
    riskText.includes('confusión') ||
    riskText.includes('homónima') ||
    riskText.includes('name similar');

  if (isDuplicateRisk) {
    questions.push(
      '¿Existe un duplicado confirmado en el pool histórico, en SellUp o en HubSpot que corresponda a esta misma entidad?',
      '¿El dominio, nombre comercial o LinkedIn coincide con otra cuenta ya registrada?',
      '¿Debe quedar en estado requires_review hasta que se resuelva la unicidad con evidencia directa?'
    );
  }

  if (isSectorBoundary) {
    questions.push(
      '¿La actividad principal de la empresa es desarrollar, comercializar, implementar u operar tecnología B2B para organizaciones?',
      '¿Es una empresa tecnológica que vende a otras empresas, o es una empresa del sector que utiliza tecnología internamente?',
      '¿Existen clientes corporativos identificables que compran o usan su producto/servicio tecnológico?'
    );
  }

  if (hasWeakEvidence) {
    questions.push(
      '¿La evidencia disponible proviene de fuentes directas (sitio oficial, registro público) o solo de agregadores y directorios?',
      '¿Tiene escala suficiente para UBITS (100+ empleados o señal equivalente)?'
    );
  }

  if (hasNameConfusionRisk) {
    questions.push(
      '¿La identidad corresponde a esta empresa específica y no a otra entidad con nombre similar?',
      '¿El dominio y el LinkedIn apuntan a la misma entidad con el mismo nombre comercial?'
    );
  }

  // Preguntas base siempre presentes
  questions.push(
    '¿La identidad y dominio corresponden específicamente a esta empresa y no a otra entidad con nombre similar?',
    '¿Opera realmente en Colombia? ¿Tiene sede, equipo o clientes locales confirmados?',
    '¿Su actividad principal es tecnología B2B (desarrollo, integración, comercialización o servicios TI para organizaciones)?'
  );

  return deduplicate(questions);
}

function deduplicate(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ─── Builder principal ────────────────────────────────────────────────────────

export function buildCandidateDelta(input: VerificationCandidateInput): CandidateDelta {
  const sanitizedWebsite = sanitizeUrl(input.proposedWebsite ?? null);
  const linkedinClass = classifyLinkedIn(input.proposedLinkedin);
  const sanitizedUrls = sanitizeUrls(input.discoveryUrls);

  const knownRisks = Array.isArray(input.knownRisks) ? [...input.knownRisks] : [];
  const fieldsToVerify = Array.isArray(input.fieldsToVerify) ? [...input.fieldsToVerify] : [];
  const duplicateStatus = input.duplicateStatus ?? null;
  const discoveryReason = input.discoveryReason ?? null;

  const linkedinUrl =
    linkedinClass.type === 'company' ? linkedinClass.url : null;
  const linkedinWarning =
    linkedinClass.type === 'personal' || linkedinClass.type === 'invalid'
      ? linkedinClass.warning
      : null;

  const candidateSpecificQuestions = buildQuestionsFromRisks(knownRisks, duplicateStatus);

  return {
    candidateName: input.candidateName,
    proposedWebsite: sanitizedWebsite,
    proposedLinkedin: linkedinUrl,
    linkedinWarning,
    discoveryReason,
    discoveryUrls: sanitizedUrls,
    duplicateStatus,
    knownRisks,
    fieldsToVerify,
    candidateSpecificQuestions,
  };
}
