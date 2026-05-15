"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileNavLink } from "@/components/layout/app-sidebar";
import { mainNavItems } from "@/config/navigation";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b bg-background px-4 md:px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/pipeline"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <span className="text-primary">Sell</span>
          <span className="text-foreground">Up</span>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            }
          />
          <SheetContent side="left" className="w-64">
            <nav className="flex flex-col gap-2 p-4">
              {mainNavItems.map((item) => (
                <MobileNavLink key={item.href} item={item} />
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <ThemeToggle />
      </div>
    </header>
  );
}
