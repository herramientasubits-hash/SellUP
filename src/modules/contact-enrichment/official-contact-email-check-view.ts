// Agente 2A — Lo que la ficha del contacto muestra de «Verificar correo» y del empleo actual
// (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// PURO y sin dependencias de servidor: lo usan la acción (para armar la vista) y la UI (copy).

import { readCurrentEmploymentCheck, CURRENT_EMPLOYMENT_METADATA_KEY } from './current-employment-check';
import {
  hasPendingCompanyChange,
  readEmailCheckBlock,
  type EmailChangeCase,
  type EmailCheckResolution,
} from './email-change-classifier-core';
import { IDENTITY_COMPLETION_APOLLO_CREDITS } from './candidate-identity-completion-core';
import { formatAppDate } from '@/lib/format-date';

export interface OfficialContactEmploymentView {
  status: 'confirmed' | 'title_changed' | 'other_company' | 'no_current_role';
  currentCompany: string | null;
  currentTitle: string | null;
  since: string | null;
  checkedAt: string | null;
}

export interface OfficialContactEmailCheckView {
  case: EmailChangeCase;
  /** El correo que trajo el proveedor (ya pagado). */
  foundEmail: string | null;
  checkedAt: string;
  resolution: EmailCheckResolution | null;
  newCandidateId: string | null;
}

export interface OfficialContactEmailState {
  employment: OfficialContactEmploymentView | null;
  check: OfficialContactEmailCheckView | null;
  /** Hay un cambio de empresa detectado y nadie lo ha resuelto. */
  pendingCompanyChange: boolean;
  /** Empresa nueva según el proveedor (para el botón «Enviar a revisión en …»). */
  newCompanyName: string | null;
}

export const EMPTY_OFFICIAL_CONTACT_EMAIL_STATE: OfficialContactEmailState = {
  employment: null,
  check: null,
  pendingCompanyChange: false,
  newCompanyName: null,
};

export function buildOfficialContactEmailState(metadata: Record<string, unknown> | null | undefined): OfficialContactEmailState {
  const check = readEmailCheckBlock(metadata ?? null);
  const stored = readCurrentEmploymentCheck(metadata?.[CURRENT_EMPLOYMENT_METADATA_KEY]);
  const fromCheck = check?.employment ?? null;
  const employment: OfficialContactEmploymentView | null =
    fromCheck && fromCheck.status !== 'unknown'
      ? {
          status: fromCheck.status,
          currentCompany: fromCheck.current_company,
          currentTitle: fromCheck.current_title,
          since: fromCheck.current_since,
          checkedAt: check?.checked_at ?? null,
        }
      : stored && stored.status !== 'unknown'
        ? {
            status: stored.status,
            currentCompany: stored.current_company,
            currentTitle: stored.current_title,
            since: stored.current_since,
            checkedAt: stored.checked_at || null,
          }
        : null;
  return {
    employment,
    check: check
      ? {
          case: check.case,
          foundEmail: check.found_email,
          checkedAt: check.checked_at,
          resolution: check.resolution,
          newCandidateId: check.new_candidate_id,
        }
      : null,
    pendingCompanyChange: hasPendingCompanyChange(check),
    newCompanyName: check?.employment?.current_company ?? check?.found_email_domain ?? null,
  };
}

// ── Copy ────────────────────────────────────────────────────────────

export const VERIFY_EMAIL_BUTTON_LABEL = 'Verificar correo';

export const VERIFY_EMAIL_HELPER = `Pregunta a Apollo por su LinkedIn dónde trabaja hoy y cuál es su correo (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito) y, si Apollo no trae correo, a Lusha. No revela teléfonos.`;

function shortDate(iso: string | null): string | null {
  // Zona fija (Bogotá): servidor y navegador escriben el mismo día.
  const label = formatAppDate(iso, '');
  return label || null;
}

export function lastVerificationLabel(state: OfficialContactEmailState): string | null {
  const when = shortDate(state.check?.checkedAt ?? null);
  return when ? `Última verificación: ${when}.` : null;
}

/** Una línea sobre dónde trabaja hoy (o null si no se sabe). */
export function employmentLine(employment: OfficialContactEmploymentView | null): string | null {
  if (!employment) return null;
  const when = shortDate(employment.checkedAt);
  const suffix = when ? ` · verificado ${when}` : '';
  switch (employment.status) {
    case 'confirmed':
      return `Trabaja aquí${suffix}.`;
    case 'title_changed':
      return employment.currentTitle ? `Sigue aquí, ahora como ${employment.currentTitle}${suffix}.` : `Sigue aquí${suffix}.`;
    case 'other_company': {
      const since = employment.since ? ` desde ${employment.since}` : '';
      const company = employment.currentCompany ?? 'otra empresa';
      return `Ahora trabaja en ${company}${since}${suffix}.`;
    }
    case 'no_current_role':
      return `El proveedor no le conoce un trabajo actual${suffix}.`;
  }
}

/**
 * Qué pasó en HubSpot con el correo principal (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE): la
 * frase dice la verdad de cada desenlace en vez de dar por hecho que llegó.
 */
export function hubspotPrimaryEmailNote(hubspot: string | null): string {
  switch (hubspot) {
    case 'promoted':
    case 'already_primary':
      return 'En HubSpot también quedó como principal.';
    case 'promoted_previous_not_kept':
      return 'En HubSpot quedó como principal, pero no aceptó guardar el anterior como adicional.';
    case 'conflict':
      return 'En HubSpot ese correo ya lo tiene otro contacto: puedes fusionarlos con «Fusionar en HubSpot».';
    case 'autosync':
      return 'El contacto no estaba en HubSpot: se envió para buscarlo por el correo o crearlo.';
    case 'unreadable':
      return 'En HubSpot no se cambió: no pudimos leer el contacto.';
    case 'hubspot_unavailable':
    case 'autosync_failed':
      return 'En HubSpot no se cambió: no pudimos conectar con HubSpot.';
    default:
      return 'En HubSpot no se pudo cambiar.';
  }
}

export function hubspotAdditionalEmailNote(hubspot: string | null): string {
  switch (hubspot) {
    case 'added_as_additional':
    case 'already_additional':
      return 'En HubSpot quedó como correo adicional.';
    case 'already_primary':
      return 'En HubSpot ya es el correo principal.';
    case 'not_in_hubspot':
      return 'El contacto no está en HubSpot.';
    case 'conflict':
      return 'En HubSpot no se agregó: ese correo ya lo tiene otro contacto.';
    default:
      return 'En HubSpot no se pudo agregar.';
  }
}

/** Qué pasó al verificar, en una frase (después del clic). */
export function verificationOutcomeText(kind: EmailChangeCase, hubspot: string | null): string {
  switch (kind) {
    case 'same_email':
      return 'Correo verificado: es el mismo.';
    case 'same_company_new_email':
      return `Encontramos otro correo de la empresa y quedó como principal en SellUp (el anterior se conserva como adicional). ${hubspotPrimaryEmailNote(hubspot)}`;
    case 'personal_email':
      return `Encontramos un correo personal: se guardó aparte, sin reemplazar al principal. ${hubspotAdditionalEmailNote(hubspot)}`;
    case 'company_change':
      return 'El correo que encontramos es de otra empresa: parece que cambió de trabajo. Revisa el aviso.';
    case 'conflicting':
      return 'Las señales no coinciden (el correo y el empleo cuentan historias distintas). Decide tú en el aviso.';
    case 'left_no_email':
      return 'No encontramos otro correo, pero el proveedor dice que ya no trabaja aquí. Revisa el aviso.';
    case 'no_new_email':
      return 'No encontramos otro correo para esta persona.';
  }
}
