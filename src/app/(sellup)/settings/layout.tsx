import type { ReactNode } from 'react';

/**
 * Marco de Configuración: la pantalla a todo el ancho, sin menú lateral. Se
 * entra por el resumen (`/settings`) o por el menú de la marca, y dentro de
 * cada sección las migas de la barra superior dicen dónde se está y llevan de
 * vuelta («SellUp › Configuración › Integraciones comerciales › HubSpot»).
 *
 * La columna de contenido es su propia caja con scroll: una pantalla con tabla
 * (`DataTablePage`) sigue llenando el alto. El margen negativo deja sitio a
 * sombras y anillos de foco, que una caja con scroll recortaría.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-1">
      {children}
    </div>
  );
}
