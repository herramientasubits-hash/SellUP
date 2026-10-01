import type { ModuleTabId } from '@/components/navigation/module-tabs-nav';

/**
 * La voz del módulo «Empresas».
 *
 * El módulo se llama igual en el menú, en la miga y en el título, sea cual sea
 * la pestaña: antes el título saltaba a «Prospectos» al cambiar de pestaña y
 * la miga seguía diciendo «Empresas». Lo que cambia con la pestaña es la
 * descripción, que dice qué hay en esa vista.
 *
 * Vive aparte para que la página, sus paneles de servidor y el estado de carga
 * lean el mismo texto.
 */
export const EMPRESAS_MODULE_TITLE = 'Empresas';

export const EMPRESAS_TAB_DESCRIPTIONS: Record<ModuleTabId, string> = {
  empresas: 'Las empresas ya aprobadas: tus cuentas de trabajo, con su estado y su responsable.',
  prospectos: 'Empresas candidatas, generadas con IA o importadas, que esperan tu decisión antes de ser cuentas.',
  descartadas: 'Empresas que el pipeline o una persona dejó fuera. Devuélvelas a revisión sin volver a buscar.',
};
