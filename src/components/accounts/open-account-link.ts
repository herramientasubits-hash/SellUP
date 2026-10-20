/**
 * Abrir una empresa en Empresas, con su ficha a la vista (dueña 20-10: «si apruebo una
 * empresa debe ir a la empresa donde quedó ya aprobada»).
 */
import { ACCOUNTS_ROUTE } from '@/config/navigation';

export const OPEN_ACCOUNT_PARAM = 'abrir';

/** `/accounts?abrir=<id>`: la lista de Empresas abre esa ficha al cargar. */
export function openAccountHref(accountId: string): string {
  return `${ACCOUNTS_ROUTE}?${OPEN_ACCOUNT_PARAM}=${encodeURIComponent(accountId)}`;
}

/** La empresa pedida en la dirección, si la hay (y la dirección sin ese parámetro). */
export function readOpenAccountParam(search: string): { accountId: string | null; rest: string } {
  const params = new URLSearchParams(search);
  const accountId = params.get(OPEN_ACCOUNT_PARAM)?.trim() || null;
  params.delete(OPEN_ACCOUNT_PARAM);
  const rest = params.toString();
  return { accountId, rest: rest ? `?${rest}` : '' };
}
