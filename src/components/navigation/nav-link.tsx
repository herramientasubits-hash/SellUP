"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { type NavItem } from "@/config/navigation";
import { SheetClose } from "@/components/ui/sheet";

interface NavLinkProps {
  item: NavItem;
}

export function NavLink({ item }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <item.icon className="h-4 w-4" />
      {item.title}
    </Link>
  );
}

export function MobileNavLink({ item }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <SheetClose
      render={
        <Link
          href={item.href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <item.icon className="h-4 w-4" />
          {item.title}
        </Link>
      }
    />
  );
}
