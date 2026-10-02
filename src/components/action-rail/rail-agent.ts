"use client";

import * as React from "react";
import type { RailActionSpec } from "./rail-actions";

/**
 * El agente de IA dentro de la barra flotante — port de Thema
 * `action-rail/railAgent.ts`.
 *
 * Cuando las acciones viven en la barra, el agente también: quien monta la
 * barra declara su acción una vez (`RailAgentProvider`) y la barra la pone al
 * final, como una segunda principal con el degradado de IA. En SellUp el
 * agente es de cada módulo («Generar con IA» en Empresas, «Buscar contactos
 * con IA» en Contactos): la pantalla lo declara con
 * `<RailScreenActions agent={…} />` y `ListActionRailProvider` lo provee.
 *
 * Y al revés: quien pinte el agente en otro sitio necesita saber si hay una
 * barra a la vista para no repetirlo, así que cada barra se anuncia mientras
 * está montada (`useRailVisible`).
 */
const RailAgentContext = React.createContext<RailActionSpec | null>(null);

export const RailAgentProvider = RailAgentContext.Provider;

export const useRailAgentAction = (): RailActionSpec | null => React.useContext(RailAgentContext);

let mounted = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lo llama cada barra: cuenta como «a la vista» mientras esté montada. */
export function useAnnounceRail(): void {
  React.useEffect(() => {
    mounted += 1;
    emit();
    return () => {
      mounted -= 1;
      emit();
    };
  }, []);
}

/** Si hay alguna barra flotante en pantalla ahora mismo. */
export function useRailVisible(): boolean {
  return React.useSyncExternalStore(subscribe, () => mounted > 0, () => false);
}
