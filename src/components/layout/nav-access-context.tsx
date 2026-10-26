"use client";

import * as React from "react";
import type { NavAccessContext } from "@/config/navigation";

/**
 * Quién mira la pantalla, al alcance de cualquier componente cliente.
 *
 * Lo publica el shell (`AppShell`) con el mismo `navAccess` que filtra el
 * menú. Sirve para NO MOSTRAR lo que no le toca a alguien —el detalle técnico,
 * un botón que el servidor le negaría—, nunca para conceder: los permisos se
 * comprueban siempre en el servidor.
 */
const NavAccess = React.createContext<NavAccessContext>({ isAdmin: false, roleKey: null });

export function NavAccessProvider({
  value,
  children,
}: {
  value: NavAccessContext;
  children: React.ReactNode;
}) {
  return <NavAccess.Provider value={value}>{children}</NavAccess.Provider>;
}

/** Fuera del shell (tests, páginas públicas) responde «sin privilegios». */
export function useNavAccess(): NavAccessContext {
  return React.useContext(NavAccess);
}
