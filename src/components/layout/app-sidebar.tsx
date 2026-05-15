"use client";

import { cn } from "@/lib/utils";
import { mainNavItems } from "@/config/navigation";
import { NavLink, MobileNavLink } from "@/components/navigation/nav-link";

export { MobileNavLink };

interface AppSidebarProps {
  className?: string;
}

export function AppSidebar({ className }: AppSidebarProps) {
  return (
    <nav className={cn("flex flex-col gap-2 p-4", className)}>
      {mainNavItems.map((item) => (
        <NavLink key={item.href} item={item} />
      ))}
    </nav>
  );
}
