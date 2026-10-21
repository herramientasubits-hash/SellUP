'use client';

/**
 * GENERATE-DRAWER-WITHOUT-CLONE-1 — controlar un panel que armó el servidor sin clonarlo.
 *
 * «Generar con IA» lo arma el servidor (`resolveGenerateProspectsAgent`) y la pantalla sólo
 * decide cuándo está abierto. Antes se hacía con `React.cloneElement`, pero el elemento que
 * llega del servidor puede venir DIFERIDO (`react.lazy`, un trozo aparte del envío): clonarlo
 * da un elemento sin tipo y la página entera cae con «Element type is invalid… got: undefined».
 * Así se cayó «Empresas» en Producción el 21-10. Ahora el control viaja por contexto y el
 * elemento se pinta tal cual llegó, diferido o no.
 */

import * as React from 'react';

/** Lo que estos componentes necesitan poder decirle al asistente de IA. */
export interface ControllablePanelProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** «Volver» a «¿Qué quieres hacer?» de Rumbo (sólo cuando se abrió desde ahí). */
  onBack?: () => void;
}

const PanelControlContext = React.createContext<ControllablePanelProps | null>(null);

/** Pinta `panel` (un elemento del servidor) controlado con `open`, `onOpenChange` y `onBack`. */
export function ControlledPanelSlot({ panel, open, onOpenChange, onBack }: ControllablePanelProps & { panel: React.ReactNode }) {
  const control = React.useMemo(() => ({ open, onOpenChange, onBack }), [open, onOpenChange, onBack]);
  return <PanelControlContext.Provider value={control}>{panel}</PanelControlContext.Provider>;
}

/** El control de la pantalla si el panel está dentro de un `ControlledPanelSlot`; si no, sus props. */
export function usePanelControl(own: ControllablePanelProps): ControllablePanelProps {
  return React.useContext(PanelControlContext) ?? own;
}
