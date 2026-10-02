import { ACCOUNTS_ROUTE } from '@/config/navigation';

/**
 * Las tres vistas del módulo «Empresas», según dónde está cada empresa en su
 * camino. Se llega a ellas desde el menú lateral (Empresas → Empresas / Por
 * revisar / Descartadas); las rutas son las de siempre, query params sobre
 * `/accounts`. La página ya no lleva pestañas propias.
 */
export type ModuleTabId = 'empresas' | 'prospectos' | 'descartadas';

/** El nombre del módulo: el del menú y el primer tramo de las migas. */
export const EMPRESAS_MODULE_TITLE = 'Empresas';

/**
 * El título de la página dice la vista en la que estás, con los mismos rótulos
 * que el menú lateral.
 */
export const EMPRESAS_VIEW_TITLES: Record<ModuleTabId, string> = {
  empresas: 'Empresas',
  prospectos: 'Por revisar',
  descartadas: 'Descartadas',
};

export const EMPRESAS_TAB_DESCRIPTIONS: Record<ModuleTabId, string> = {
  empresas: 'Las empresas ya aprobadas: tus cuentas de trabajo, con su estado y su responsable.',
  prospectos: 'Empresas candidatas, generadas con IA o importadas, que esperan tu decisión antes de ser cuentas.',
  descartadas: 'Empresas que el pipeline o una persona dejó fuera. Devuélvelas a revisión sin volver a buscar.',
};

/**
 * Las migas de una vista: «Empresas › Por revisar». La vista raíz no lleva
 * (la cabecera ya dice «SellUp › Empresas»).
 */
export function empresasViewCrumbs(view: ModuleTabId): (string | { label: string; href: string })[] | null {
  if (view === 'empresas') return null;
  return [{ label: EMPRESAS_MODULE_TITLE, href: ACCOUNTS_ROUTE }, EMPRESAS_VIEW_TITLES[view]];
}
