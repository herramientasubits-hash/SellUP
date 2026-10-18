/**
 * El «siguiente paso» de una empresa (puro). Reemplaza al estado guardado en la lista
 * de Empresas: casi todas decían «Nueva» y no ayudaban a decidir (dueña 18-10). Se
 * deduce de lo que ya pasó con cada agente: contactos (Agente 2), preparaciones y su
 * resultado (Agente 3).
 */

export type AccountNextStepKey =
  | 'find_contacts'
  | 'finding_contacts'
  | 'review_contacts'
  | 'retry_contacts'
  | 'prepare_first_contact'
  | 'review_and_contact'
  | 'make_first_contact'
  | 'log_outcome'
  | 'book_meeting'
  | 'hold_meeting'
  | 'follow_up_later'
  | 'insist'
  | 'find_decision_maker'
  | 'archived';

export type AccountNextStepTone = 'neutral' | 'brand' | 'info' | 'warning' | 'positive';

export interface AccountNextStepDefinition {
  label: string;
  /** Qué agente lo hace (o `null` si lo hace el vendedor). */
  agent: 'Agente 2' | 'Agente 3' | null;
  tone: AccountNextStepTone;
}

export const ACCOUNT_NEXT_STEPS: Readonly<Record<AccountNextStepKey, AccountNextStepDefinition>> = {
  find_contacts: { label: 'Buscar contactos', agent: 'Agente 2', tone: 'neutral' },
  finding_contacts: { label: 'Buscando contactos', agent: 'Agente 2', tone: 'info' },
  review_contacts: { label: 'Revisar contactos', agent: 'Agente 2', tone: 'warning' },
  retry_contacts: { label: 'Volver a buscar contactos', agent: 'Agente 2', tone: 'warning' },
  prepare_first_contact: { label: 'Preparar primer contacto', agent: 'Agente 3', tone: 'brand' },
  review_and_contact: { label: 'Revisar y contactar', agent: 'Agente 3', tone: 'warning' },
  make_first_contact: { label: 'Hacer el primer contacto', agent: null, tone: 'positive' },
  log_outcome: { label: 'Registrar qué pasó', agent: null, tone: 'warning' },
  book_meeting: { label: 'Agendar la reunión', agent: null, tone: 'positive' },
  hold_meeting: { label: 'Hacer la reunión', agent: null, tone: 'positive' },
  follow_up_later: { label: 'Retomar más adelante', agent: null, tone: 'neutral' },
  insist: { label: 'Insistir', agent: null, tone: 'warning' },
  find_decision_maker: { label: 'Buscar al decisor', agent: 'Agente 2', tone: 'warning' },
  archived: { label: 'Archivada', agent: null, tone: 'neutral' },
};

/** Orden en el filtro: el recorrido de la empresa. */
export const ACCOUNT_NEXT_STEP_ORDER: readonly AccountNextStepKey[] = [
  'find_contacts',
  'finding_contacts',
  'review_contacts',
  'retry_contacts',
  'find_decision_maker',
  'prepare_first_contact',
  'review_and_contact',
  'make_first_contact',
  'log_outcome',
  'insist',
  'book_meeting',
  'hold_meeting',
  'follow_up_later',
  'archived',
];

export interface AccountNextStepPack {
  status: string;
  createdAt: string;
  outcome: string | null;
}

export interface AccountNextStepInput {
  archived: boolean;
  contactsTotal: number;
  /** La corrida más reciente del Agente 2, si hubo. */
  lastEnrichmentStatus: string | null;
  packs: readonly AccountNextStepPack[];
}

const ENRICHMENT_RUNNING = new Set(['pending', 'resolving', 'ready_to_enrich', 'enriching']);

const OUTCOME_STEP: Readonly<Record<string, AccountNextStepKey>> = {
  meeting_booked: 'hold_meeting',
  interested: 'book_meeting',
  not_now: 'follow_up_later',
  no_answer: 'insist',
  wrong_person: 'find_decision_maker',
};

const newestFirst = (a: AccountNextStepPack, b: AccountNextStepPack) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

export function resolveAccountNextStep(input: AccountNextStepInput): AccountNextStepKey {
  if (input.archived) return 'archived';

  // Lo más avanzado manda: el último resultado de un contacto hecho.
  const used = input.packs.filter((p) => p.status === 'used').sort(newestFirst);
  const withOutcome = used.find((p) => p.outcome && OUTCOME_STEP[p.outcome]);
  // Una reunión agendada en cualquier preparación pesa más que un «no respondió» posterior.
  if (used.some((p) => p.outcome === 'meeting_booked')) return 'hold_meeting';
  if (withOutcome) return OUTCOME_STEP[withOutcome.outcome!];
  if (used.length > 0) return 'log_outcome';

  const ready = input.packs.filter((p) => p.status === 'draft' || p.status === 'needs_review');
  if (ready.some((p) => p.status === 'draft')) return 'make_first_contact';
  if (ready.length > 0) return 'review_and_contact';

  if (input.contactsTotal > 0) return 'prepare_first_contact';

  const run = input.lastEnrichmentStatus;
  if (run && ENRICHMENT_RUNNING.has(run)) return 'finding_contacts';
  if (run === 'ready_for_review') return 'review_contacts';
  if (run === 'failed') return 'retry_contacts';
  return 'find_contacts';
}
