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
                  "relative flex w-full items-center justify-center rounded-xl py-2.5 transition-all duration-200",
                  isActive
                    ? "bg-su-brand/15 text-white"
                    : "text-sidebar-foreground/55 hover:bg-white/[0.05] hover:text-sidebar-foreground/85",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
                )}
                <item.icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-all duration-200",
                    isActive ? "text-white" : "text-sidebar-foreground/50",
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
        "group relative flex items-center gap-3 rounded-xl py-2.5 pl-3.5 pr-3 text-[0.8125rem] font-medium transition-all duration-200",
        isActive
          ? "bg-su-brand/15 text-white"
          : "text-sidebar-foreground/60 hover:bg-white/[0.04] hover:text-sidebar-foreground",
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)]" />
      )}
      <item.icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-all duration-200",
          isActive
            ? "text-white"
            : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/80",
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
            "relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.8125rem] font-medium transition-all duration-200",
            isActive
              ? "bg-su-brand/15 text-su-brand shadow-[0_0_0_1px_rgba(12,91,239,0.15)]"
              : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
          )}
        >
          {isActive && (
            <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-su-brand" />
          )}
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {item.title}
        </Link>
      }
    />
  );
}
