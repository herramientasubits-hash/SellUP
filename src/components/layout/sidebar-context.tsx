"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
});

const STORAGE_KEY = "sellup-sidebar-collapsed";
/** Aviso dentro de la misma pestaña: `storage` solo se dispara en las demás. */
const CHANGE_EVENT = "sellup-sidebar-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Respaldo en memoria si el almacenamiento está bloqueado (modo privado, políticas). */
let memoryCollapsed = false;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return memoryCollapsed;
  }
}

/**
 * Estado del menú lateral (desplegado / contraído), recordado por navegador.
 *
 * Se lee con `useSyncExternalStore`: en el servidor y durante la hidratación
 * el menú está desplegado, y solo después se aplica lo guardado. Leerlo en el
 * estado inicial hacía que servidor y cliente pintaran menús distintos a quien
 * lo tuviera contraído, y React descartaba la página del servidor.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const toggle = useCallback(() => {
    const next = !readCollapsed();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Sin almacenamiento el menú sigue funcionando; solo no se recuerda.
      memoryCollapsed = next;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
