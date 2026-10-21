/**
 * Agente 1 · Búsqueda en árbol — FASE D (auditoría 21-10): ¿el GRUPO ya es de UBITS?
 *
 * Si alguna empresa del árbol ya es cliente en HubSpot, tiene un negocio abierto o la trabaja
 * un vendedor, las hermanas que entran a «Por revisar» son una oportunidad TIBIA: se vende
 * con la referencia del grupo («ya trabajamos con Bimbo México»). Se lee HubSpot SÓLO para
 * leer (nunca se escribe) y se guarda en el lote; aquí sólo se resume y se dice. Puro.
 */

/** Lo que dijo HubSpot de una empresa del grupo (la regla de `hubspot-free-company-policy`). */
export type CorporateTreeGroupMemberStatus =
  | 'customer'
  | 'open_deal'
  | 'recent_sales_activity'
  | 'active_owner'
  | 'free'
  | 'unknown';

export type CorporateTreeGroupMember = { name: string; countryCode: string | null; status: CorporateTreeGroupMemberStatus };

/** `metadata.corporate_tree.group_hubspot` del lote. */
export type CorporateTreeGroupSignal = {
  /** Fichas de HubSpot del grupo que se leyeron (con tope). */
  checked: number;
  customers: { name: string; countryCode: string | null }[];
  /** Negocio abierto, actividad de venta reciente o dueño activo: alguien de UBITS ya lo trabaja. */
  worked: { name: string; countryCode: string | null }[];
};

/** Como mucho, fichas del grupo que se leen en HubSpot por corrida. */
export const CORPORATE_TREE_GROUP_HUBSPOT_MAX_READS = 12;

const WORKED: ReadonlySet<CorporateTreeGroupMemberStatus> = new Set(['open_deal', 'recent_sales_activity', 'active_owner']);
const MAX_LISTED = 8;

export function summarizeCorporateTreeGroup(members: readonly CorporateTreeGroupMember[]): CorporateTreeGroupSignal {
  const pick = (want: (s: CorporateTreeGroupMemberStatus) => boolean) =>
    members.filter((m) => want(m.status)).slice(0, MAX_LISTED).map((m) => ({ name: m.name, countryCode: m.countryCode }));
  return {
    checked: members.filter((m) => m.status !== 'unknown').length,
    customers: pick((s) => s === 'customer'),
    worked: pick((s) => WORKED.has(s)),
  };
}

/** La oportunidad que esto le da a las nuevas del lote: `null` si el grupo no es de UBITS. */
export type CorporateTreeGroupOpportunity = 'customer_group' | 'worked_group';

export function corporateTreeGroupOpportunity(signal: CorporateTreeGroupSignal | null): CorporateTreeGroupOpportunity | null {
  if (!signal) return null;
  if (signal.customers.length > 0) return 'customer_group';
  if (signal.worked.length > 0) return 'worked_group';
  return null;
}

/** Lee la señal guardada en el lote (dato no confiable: se valida). */
export function readCorporateTreeGroupSignal(raw: unknown): CorporateTreeGroupSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const list = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => !!item && typeof item.name === 'string' && item.name.trim() !== '')
      .slice(0, MAX_LISTED)
      .map((item) => ({
        name: (item.name as string).trim().slice(0, 200),
        countryCode: typeof item.countryCode === 'string' && /^[A-Z]{2}$/.test(item.countryCode) ? item.countryCode : null,
      }));
  const checked = typeof record.checked === 'number' && Number.isFinite(record.checked) && record.checked >= 0 ? Math.round(record.checked) : 0;
  return { checked, customers: list(record.customers), worked: list(record.worked) };
}

function namesOf(items: readonly { name: string }[]): string {
  const names = items.slice(0, 3).map((i) => i.name);
  const rest = items.length - names.length;
  return rest > 0 ? `${names.join(', ')} y ${rest} más` : names.join(', ');
}

/**
 * La frase para el vendedor: «El grupo ya es cliente de UBITS (Bimbo México): las nuevas son
 * una oportunidad tibia; úsalo como referencia.» Vacía si el grupo no es de UBITS.
 */
export function corporateTreeGroupSentence(signal: CorporateTreeGroupSignal | null): string {
  const opportunity = corporateTreeGroupOpportunity(signal);
  if (!signal || !opportunity) return '';
  return opportunity === 'customer_group'
    ? `El grupo ya es cliente de UBITS (${namesOf(signal.customers)}): las nuevas son una oportunidad tibia; úsalo como referencia.`
    : `Alguien de UBITS ya trabaja el grupo (${namesOf(signal.worked)}): coordina con su dueño antes de contactar a las nuevas.`;
}
