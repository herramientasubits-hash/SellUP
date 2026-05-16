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
import { useSidebar } from "@/components/layout/sidebar-context";

interface NavLinkProps {
  item: NavItem;
}

export function NavLink({ item }: NavLinkProps) {
  const pathname = usePathname();
  const { collapsed } = useSidebar();
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");

  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={item.href}
                aria-label={item.title}
                className={cn(
                  "relative flex w-full items-center justify-center rounded-xl py-2.5 transition-all duration-200",
                  isActive
                    ? "bg-su-brand/10 text-su-brand"
                    : "text-muted-foreground/60 hover:bg-accent hover:text-foreground",
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-su-brand" />
                )}
                <item.icon className="h-[18px] w-[18px] shrink-0" />
              </Link>
            }
          />
          <TooltipContent side="right" sideOffset={10}>
            {item.title}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl py-2.5 pr-3 pl-3.5 text-[0.8125rem] font-medium transition-all duration-200",
        isActive
          ? "bg-su-brand/[0.08] text-su-brand shadow-sm shadow-su-brand/[0.04]"
          : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-su-brand" />
      )}
      <item.icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors duration-200",
          isActive
            ? "text-su-brand"
            : "text-muted-foreground/50 group-hover:text-foreground",
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
          className={cn(
            "relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[0.8125rem] font-medium transition-all duration-200",
            isActive
              ? "bg-su-brand/[0.08] text-su-brand"
              : "text-muted-foreground/70 hover:bg-accent hover:text-foreground",
          )}
        >
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-su-brand" />
          )}
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {item.title}
        </Link>
      }
    />
  );
}
