/**
 * Lo encontrado en todo SellUp en la búsqueda general (presentación pura): a qué grupo va
 * y a dónde lleva cada cosa (dueña 17-11: «que busque en todo SellUp: por revisar,
 * búsquedas, descartadas, de empresas y contactos, todo»).
 */

import { Building2, Search, User as UserIcon } from '@/icons';
import type { SearchObjectItem } from './global-search';
import { CONTACTS_CANDIDATES_ROUTE, PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import {
  CANDIDATE_REVIEW_OPEN_EVENT,
  PROSPECT_CANDIDATE_OPEN_EVENT,
  candidateReviewHref,
} from '@/modules/contact-enrichment/candidate-review-link';
import type { ContactCandidateQueue, SellUpRecordHit } from '@/modules/global-search/types';

export const SELLUP_RECORD_GROUPS = {
  prospect: 'Empresas por revisar',
  discarded_company: 'Empresas descartadas',
  search: 'Búsquedas',
  pending_review: 'Contactos por revisar',
  duplicate: 'Contactos duplicados',
  discarded: 'Contactos rechazados',
} as const;

/** Aviso a la pantalla ya montada para que abra la ficha (navegar a la misma ruta no la remonta). */
export interface SellUpOpenEvent {
  type: string;
  candidateId: string;
  /** Cola del candidato de contacto: sólo la tabla de esa cola lo abre. */
  queue?: ContactCandidateQueue;
}

/** Cómo se abre lo encontrado: navegar y, si hace falta, avisar a la pantalla. */
export type OpenSellUpRecord = (href: string, event?: SellUpOpenEvent) => void;

const CONTACT_QUEUE_TAB: Record<ContactCandidateQueue, string> = {
  pending_review: CONTACTS_CANDIDATES_ROUTE,
  duplicate: '/contacts?tab=duplicates',
  discarded: '/contacts?tab=rejected',
};

function withParams(base: string, params: Record<string, string>): string {
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${new URLSearchParams(params).toString()}`;
}

/** A dónde lleva lo encontrado, y si la pantalla tiene que abrir una ficha. */
export function sellUpRecordTarget(hit: SellUpRecordHit): { href: string; event?: SellUpOpenEvent } {
  switch (hit.kind) {
    case 'prospect':
      // La lista se filtra por el nombre (así la fila está aunque la cola sea larga) y se
      // abre su ficha.
      return {
        href: withParams(PROSPECTOS_TAB_ROUTE, { search: hit.title, candidate: hit.id }),
        event: { type: PROSPECT_CANDIDATE_OPEN_EVENT, candidateId: hit.id },
      };
    case 'discarded_company':
      return { href: withParams(PROSPECTOS_TAB_ROUTE, { view: 'descartadas', search: hit.title }) };
    case 'search':
      return { href: withParams('/accounts', { tab: 'busquedas', focus: hit.id }) };
    case 'contact_candidate': {
      const queue = hit.queue ?? 'pending_review';
      const base = CONTACT_QUEUE_TAB[queue];
      // Un rechazado no se abre como revisable: se lleva a su lista.
      if (queue === 'discarded') return { href: base };
      return {
        href: candidateReviewHref(base, hit.id),
        event: { type: CANDIDATE_REVIEW_OPEN_EVENT, candidateId: hit.id, queue },
      };
    }
  }
}

/**
 * ¿La dirección actual es la misma lista que la de destino (misma ruta, misma pestaña y
 * misma vista)? Entonces la pantalla ya está montada y hay que avisarle; si no, se monta
 * nueva y abre la ficha desde la dirección.
 */
export function isSameListView(currentHref: string, targetHref: string): boolean {
  const current = new URL(currentHref, 'http://local');
  const target = new URL(targetHref, 'http://local');
  if (current.pathname !== target.pathname) return false;
  return ['tab', 'view'].every((key) => (current.searchParams.get(key) ?? '') === (target.searchParams.get(key) ?? ''));
}

function groupOf(hit: SellUpRecordHit): string {
  if (hit.kind === 'contact_candidate') return SELLUP_RECORD_GROUPS[hit.queue ?? 'pending_review'];
  return SELLUP_RECORD_GROUPS[hit.kind];
}

const ICON = { prospect: Building2, discarded_company: Building2, search: Search, contact_candidate: UserIcon } as const;

export function sellUpSearchItem(hit: SellUpRecordHit, open: OpenSellUpRecord): SearchObjectItem {
  const target = sellUpRecordTarget(hit);
  return {
    id: `${hit.kind}-${hit.id}`,
    title: hit.title,
    meta: hit.meta,
    keywords: hit.keywords,
    icon: ICON[hit.kind],
    group: groupOf(hit),
    href: target.href,
    onSelect: () => open(target.href, target.event),
  };
}

export function sellUpSearchItems(hits: readonly SellUpRecordHit[], open: OpenSellUpRecord): SearchObjectItem[] {
  return hits.map((hit) => sellUpSearchItem(hit, open));
}
