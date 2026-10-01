"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { type NavItem } from "@/config/navigation";
import { SheetClose } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface NavLinkProps {
  item: NavItem;
  mode?: "full" | "rail";
}

export function NavLink({ item, mode = "full" }: NavLinkProps) {
  const pathname = usePathname();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");

  if (mode === "rail") {
    return (
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={item.href}
                aria-label={item.title}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive
                    ? "bg-sidebar-accent text-primary"
                    : "text-text-muted hover:bg-background hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "size-[18px] shrink-0",
                  )}
                />
              </Link>
            }
          />
          <TooltipContent side="right" sideOffset={12}>
            {item.title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-md py-2.5 pl-3.5 pr-3 text-sm font-medium transition-colors duration-200",
        isActive
          ? "bg-sidebar-accent font-semibold text-primary"
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      <item.icon
        className={cn(
          "size-[18px] shrink-0",
        )}
      />
      <span className="flex-1 truncate">{item.title}</span>
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
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors duration-200",
            isActive
              ? "bg-sidebar-accent font-semibold text-primary"
              : "text-muted-foreground hover:bg-background hover:text-foreground",
          )}
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {item.title}
        </Link>
      }
    />
  );
}
