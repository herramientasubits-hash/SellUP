"use client";

import * as React from "react";

const NOOP = () => {};

/** Port de Thema `app-shell/workspaceMenuContext.ts`. */
export const CloseWorkspaceMenuContext = React.createContext<() => void>(NOOP);

/** Cierra el menú de la marca desde lo que se puso en su `extra` (p. ej. antes de abrir una ventana). */
export function useCloseWorkspaceMenu(): () => void {
  return React.useContext(CloseWorkspaceMenuContext);
}
