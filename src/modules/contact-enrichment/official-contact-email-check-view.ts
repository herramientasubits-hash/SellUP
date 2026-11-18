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
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
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

/** Qué pasó al verificar, en una frase (después del clic). */
export function verificationOutcomeText(kind: EmailChangeCase, hubspot: string | null): string {
  switch (kind) {
    case 'same_email':
      return 'Correo verificado: es el mismo.';
    case 'same_company_new_email':
      return hubspot === 'conflict'
        ? 'Encontramos otro correo de la empresa y quedó como principal en SellUp. En HubSpot ya lo usa otro contacto: no se cambió allá.'
        : 'Encontramos otro correo de la empresa: quedó como principal y el anterior se conserva como adicional.';
    case 'personal_email':
      return 'Encontramos un correo personal: se guardó aparte y en HubSpot como correo adicional (no reemplaza al principal).';
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
