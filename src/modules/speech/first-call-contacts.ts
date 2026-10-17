/**
 * Agente 3 · Primera llamada — los decisores que se pueden elegir (puro).
 */

export interface FirstCallContactOption {
  id: string;
  name: string;
  title: string | null;
}

/** Contactos activos para elegir decisor: primero los que deciden o llevan talento y formación. */
export function toFirstCallContactOptions(
  contacts: ReadonlyArray<{ id: string; full_name: string; job_title: string | null; role_in_account: string | null; contact_status: string }>,
): FirstCallContactOption[] {
  const priority = (role: string | null) =>
    role === 'decision_maker' || role === 'economic_buyer' ? 0 : role === 'hr_leader' || role === 'learning_leader' ? 1 : 2;
  return contacts
    .filter((c) => c.contact_status === 'active')
    .map((c, index) => ({ c, index }))
    .sort((a, b) => priority(a.c.role_in_account) - priority(b.c.role_in_account) || a.index - b.index)
    .map(({ c }) => ({ id: c.id, name: c.full_name, title: c.job_title }));
}
