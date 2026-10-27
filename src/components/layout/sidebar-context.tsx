"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
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
/**
 * Como en el playground de UX: bajo este ancho de ventana el menú se pliega
 * solo al riel, para que el contenido conserve su ancho en portátiles chicos.
 * Al volver a una ventana grande recupera lo que la persona eligió.
 */
const NARROW_QUERY = "(max-width: 1199px)";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function narrowQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY) : null;
}

function subscribeNarrow(onChange: () => void): () => void {
  const query = narrowQuery();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

const readNarrow = () => narrowQuery()?.matches ?? false;

/** Respaldo en memoria si el almacenamiento está bloqueado (modo privado, políticas). */
let memoryCollapsed = false;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return memoryCollapsed;
  }
}

/** ⌘B / Ctrl+B pliega y despliega, salvo mientras se escribe (ahí es negrita). */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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
  const stored = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  // En ventana angosta, abrirlo a mano vale mientras siga angosta: no se guarda.
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const [adoptedNarrow, setAdoptedNarrow] = useState(narrow);
  if (adoptedNarrow !== narrow) {
    setAdoptedNarrow(narrow);
    setNarrowExpanded(false);
  }
  const collapsed = narrow ? !narrowExpanded : stored;

  const toggle = useCallback(() => {
    if (readNarrow()) {
      setNarrowExpanded((expanded) => !expanded);
      return;
    }
    const next = !readCollapsed();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Sin almacenamiento el menú sigue funcionando; solo no se recuerda.
      memoryCollapsed = next;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (isTyping(event.target)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
