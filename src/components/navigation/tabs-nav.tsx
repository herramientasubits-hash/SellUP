import * as React from "react";
import type { LucideIcon } from "@/icons";
import { ThemaTabs } from "@/components/navigation/thema-tabs";

export interface Tab {
  id: string;
  label: string;
  /** Icono a la izquierda del nombre. */
  icon?: LucideIcon;
  count?: number;
}

interface TabsNavProps extends React.HTMLAttributes<HTMLDivElement> {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
}

/**
 * TabsNav — las pestañas de un módulo (nivel `page` de Thema): una pista tenue
 * con las pestañas dentro; la activa va rellena con el primario. Cada pestaña
 * puede llevar su icono y su contador, en línea con el nombre.
 *
 * Es un envoltorio fino de `ThemaTabs` en modo `navigation`: cambia de vista
 * dentro de un mismo módulo navegando (query params), por eso son botones con
 * `aria-current` y no un `tablist`.
 */
const TabsNav = React.forwardRef<HTMLDivElement, TabsNavProps>(
  ({ tabs, activeTabId, onTabChange, ...props }, ref) => (
    <ThemaTabs
      ref={ref}
      navigation
      variant="page"
      fitContent
      tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon, badge: tab.count }))}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      {...props}
    />
  ),
);

TabsNav.displayName = "TabsNav";

export { TabsNav };
