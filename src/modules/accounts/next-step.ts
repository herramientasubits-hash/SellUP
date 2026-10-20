/**
 * El «siguiente paso» de una empresa (puro). Reemplaza al estado guardado en la lista
 * de Empresas: casi todas decían «Nueva» y no ayudaban a decidir (dueña 18-10). Se
 * deduce de lo que ya pasó con los agentes, con los estados que hoy existen de verdad:
 *
 *   sin contactos ............................ Buscar contactos
 *   el Agente 2 está buscando ................ Buscando contactos
 *   el Agente 2 buscó y nadie aprobó contactos Revisar contactos
 *   con contactos y sin el Agente 3 .......... Preparar primer contacto
 *   el Agente 3 está investigando o escribiendo Preparando primer contacto
 *   el Agente 3 ya preparó ................... Hacer el primer contacto
 *
 * «La usé» es una marca del vendedor: todavía no cambia el siguiente paso.
 */

export type AccountNextStepKey =
  | 'find_contacts'
  | 'finding_contacts'
  | 'review_contacts'
  | 'prepare_first_contact'
  | 'preparing_first_contact'
  | 'make_first_contact'
  | 'archived';

export type AccountNextStepTone = 'neutral' | 'brand' | 'info' | 'warning' | 'positive';

export interface AccountNextStepDefinition {
  label: string;
  tone: AccountNextStepTone;
}

export const ACCOUNT_NEXT_STEPS: Readonly<Record<AccountNextStepKey, AccountNextStepDefinition>> = {
  find_contacts: { label: 'Buscar contactos', tone: 'neutral' },
  finding_contacts: { label: 'Buscando contactos', tone: 'info' },
  review_contacts: { label: 'Revisar contactos', tone: 'warning' },
  prepare_first_contact: { label: 'Preparar primer contacto', tone: 'brand' },
  preparing_first_contact: { label: 'Preparando primer contacto', tone: 'info' },
  make_first_contact: { label: 'Hacer el primer contacto', tone: 'positive' },
  archived: { label: 'Archivada', tone: 'neutral' },
};

/** Orden en el filtro: el recorrido de la empresa. */
export const ACCOUNT_NEXT_STEP_ORDER: readonly AccountNextStepKey[] = [
  'find_contacts',
  'finding_contacts',
  'review_contacts',
  'prepare_first_contact',
  'preparing_first_contact',
  'make_first_contact',
  'archived',
];

export interface AccountNextStepInput {
  archived: boolean;
  contactsTotal: number;
  /** La corrida más reciente del Agente 2, si hubo. */
  lastEnrichmentStatus: string | null;
  /** El Agente 3 está investigando o escribiendo ahora. */
  firstContactInProgress: boolean;
  /** Hay al menos una preparación usable (lista, para revisar o usada). */
  firstContactPrepared: boolean;
}

const ENRICHMENT_RUNNING = new Set(['pending', 'resolving', 'ready_to_enrich', 'enriching']);

export function resolveAccountNextStep(input: AccountNextStepInput): AccountNextStepKey {
  if (input.archived) return 'archived';
  if (input.firstContactInProgress) return 'preparing_first_contact';
  if (input.firstContactPrepared) return 'make_first_contact';
  if (input.contactsTotal > 0) return 'prepare_first_contact';

  const run = input.lastEnrichmentStatus;
  if (run && ENRICHMENT_RUNNING.has(run)) return 'finding_contacts';
  // El Agente 2 ya buscó y todavía no hay contactos aprobados (una corrida fallida no trae qué revisar).
  if (run && run !== 'failed') return 'review_contacts';
  return 'find_contacts';
}
