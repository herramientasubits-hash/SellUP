/**
 * De dónde viene el cargo del candidato y si se comprobó (CONTACT-CURRENT-EMPLOYMENT-1).
 *
 * Helper PURO: lo comparten la ficha y la tabla. El cargo de Apollo o HubSpot puede tener años;
 * sólo cuando Apollo devolvió el historial laboral (people/match) sabemos el trabajo actual.
 */

import { formatInAppZone } from '@/lib/format-date';
import {
  CURRENT_EMPLOYMENT_LEFT_STATUSES,
  readCurrentEmploymentCheck,
} from '@/modules/contact-enrichment/current-employment-check';
import type { ContactSource } from '@/modules/contact-enrichment/types';

const SOURCE_NAMES: Record<ContactSource, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  manual: 'carga manual',
  mock: 'datos de prueba',
};

export type TitleProvenanceTone = 'verified' | 'updated' | 'unverified' | 'left';

export interface TitleProvenance {
  tone: TitleProvenanceTone;
  /** Línea corta bajo el cargo. */
  caption: string;
  /** Aviso cuando la persona posiblemente ya no está en la empresa. */
  leftNotice: { title: string; description: string } | null;
  /** «Verificar con IA»: la página que lo dice, para abrirla. */
  evidenceUrl: string | null;
  /** Ya se comprobó con la IA (el botón pasa a «Verificar de nuevo»). */
  checkedWithAi: boolean;
}

export interface TitleProvenanceInput {
  source: ContactSource | string;
  enrichment_metadata?: Record<string, unknown> | object | null;
}

function shortDate(iso: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatInAppZone(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

function sinceYear(since: string | null): string | null {
  const year = since?.match(/^\d{4}/)?.[0];
  return year ?? null;
}

export function resolveTitleProvenance(input: TitleProvenanceInput): TitleProvenance {
  const sourceName = SOURCE_NAMES[input.source as ContactSource] ?? input.source;
  const metadata = (input.enrichment_metadata ?? {}) as Record<string, unknown>;
  const check = readCurrentEmploymentCheck(metadata.current_employment);
  const byAi = check?.source === 'ai_web';
  const when = check ? shortDate(check.checked_at) : null;
  const on = when ? ` el ${when}` : '';
  const checker = byAi ? 'la IA en la web' : 'Apollo';
  const common = { evidenceUrl: byAi ? (check?.evidence_url ?? null) : null, checkedWithAi: byAi };

  if (!check || check.status === 'unknown') {
    return {
      tone: 'unverified',
      caption: byAi
        ? `Según ${sourceName} · sin verificar: la IA no encontró información pública confiable${on}`
        : `Según ${sourceName} · sin verificar, confírmalo en LinkedIn`,
      leftNotice: null,
      ...common,
    };
  }

  if (CURRENT_EMPLOYMENT_LEFT_STATUSES.has(check.status)) {
    const year = sinceYear(check.current_since);
    const who = byAi ? 'Según la web' : 'Según Apollo';
    const elsewhere = check.current_company
      ? `${who}, hoy trabaja en ${check.current_company}${check.current_title ? ` como ${check.current_title}` : ''}${year ? ` (desde ${year})` : ''}.`
      : 'Apollo no le conoce un trabajo actual.';
    return {
      tone: 'left',
      caption: `Según ${sourceName} · ${byAi ? 'la IA en la web' : 'Apollo'} no lo confirma${on}`,
      leftNotice: {
        title: 'Posiblemente ya no está en la empresa',
        description: `${elsewhere} Confirma en LinkedIn antes de contactar.`,
      },
      ...common,
    };
  }

  if (check.status === 'title_changed') {
    return {
      tone: 'updated',
      caption: `Actualizado con ${checker}${on}${check.previous_title ? ` · antes figuraba «${check.previous_title}»` : ''}`,
      leftNotice: null,
      ...common,
    };
  }

  const year = sinceYear(check.current_since);
  return {
    tone: 'verified',
    caption: `Confirmado con ${checker}${on}${year ? ` · en el cargo desde ${year}` : ''}`,
    leftNotice: null,
    ...common,
  };
}

/** Si ya se verificó con la IA y con qué fuente (para el botón «Verificar con IA»). */
export function aiVerifyState(input: TitleProvenanceInput): { checkedWithAi: boolean; evidenceUrl: string | null } {
  const { checkedWithAi, evidenceUrl } = resolveTitleProvenance(input);
  return { checkedWithAi, evidenceUrl };
}
