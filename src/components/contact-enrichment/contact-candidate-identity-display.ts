/**
 * Presentación de consistencia de identidad — Agente 2A · 17B.4W.6
 *
 * Helpers puros (sin React) para mapear la evidencia de identidad de persona a
 * copy y estilo de UI. Vive separado del componente para ser testeable sin
 * importar server actions ni el árbol de React.
 *
 * Observacional, NO bloqueante. No afirma "email verificado", "propiedad del
 * correo confirmada" ni "persona verificada": solo describe la evidencia.
 */

import type { LushaPersonIdentityEvidenceV1 } from '@/modules/contact-enrichment/types';

export type IdentityDisplayTone = 'consistent' | 'mismatch' | 'unverified';

export interface IdentityDisplay {
  label: string;
  description: string;
  tone: IdentityDisplayTone;
}

/** Estilos por tono (tokens del sistema; sin colores hardcodeados de marca). */
export const IDENTITY_TONE_STYLES: Record<IdentityDisplayTone, string> = {
  consistent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  mismatch: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  unverified: 'bg-muted text-muted-foreground',
};

/**
 * Resuelve la presentación de la consistencia de identidad. `null`/`undefined`
 * ⇒ candidato legacy sin evidencia registrada (previo al hito): permanece
 * "Identidad sin verificar" con copy específico de legacy.
 */
export function resolveIdentityDisplay(
  identity: LushaPersonIdentityEvidenceV1 | null | undefined,
): IdentityDisplay {
  if (!identity) {
    return {
      label: 'Identidad sin verificar',
      description: 'Esta ejecución no registró evidencia de consistencia de identidad.',
      tone: 'unverified',
    };
  }
  switch (identity.identity_consistency) {
    case 'consistent':
      return {
        label: 'Identidad coincidente',
        description:
          'La identidad devuelta por el enriquecimiento coincide con la persona encontrada en la búsqueda de Lusha.',
        tone: 'consistent',
      };
    case 'mismatch':
      return {
        label: 'Requiere revisión de identidad',
        description:
          'La identidad devuelta por el enriquecimiento no coincide completamente con la persona encontrada inicialmente en Lusha. Revisa el perfil y el correo antes de aprobar.',
        tone: 'mismatch',
      };
    default:
      return {
        label: 'Identidad sin verificar',
        description:
          'No hay suficiente evidencia técnica para comparar la identidad encontrada con la identidad devuelta por el enriquecimiento.',
        tone: 'unverified',
      };
  }
}
