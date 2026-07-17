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
                  "relative flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-sidebar-foreground/55 hover:bg-white/[0.05] hover:text-sidebar-foreground/85",
                )}
              >
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
        "group relative flex items-center gap-3 py-2.5 pl-3.5 pr-3 text-[0.8125rem] font-medium transition-all duration-200",
        isActive
          ? "bg-white/10 text-white"
          : "text-sidebar-foreground/60 hover:bg-white/[0.04] hover:text-sidebar-foreground",
      )}
    >
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
            "relative flex items-center gap-3 px-3.5 py-2.5 text-[0.8125rem] font-medium transition-all duration-200",
            isActive
              ? "bg-accent text-foreground"
              : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
          )}
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {item.title}
        </Link>
      }
    />
  );
}
