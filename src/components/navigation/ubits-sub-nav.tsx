import * as React from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Settings,
  Search,
  ChevronDown,
  Sparkles,
} from "@/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface SubNavTab {
  id: string;
  label: string;
  icon?: keyof typeof ICON_MAP;
}

const ICON_MAP = {
  dashboard: LayoutDashboard,
  users: Users,
  companies: Briefcase,
  settings: Settings,
  search: Search,
  sparkles: Sparkles,
} as const;

export interface UbitsSubNavProps {
  tabs?: SubNavTab[];
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  showLogo?: boolean;
  clientName?: string;
  className?: string;
  isSticky?: boolean;
}

const DEFAULT_TABS: SubNavTab[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "prospects", label: "Prospectos", icon: "users" },
  { id: "accounts", label: "Cuentas", icon: "companies" },
  { id: "settings", label: "Configuración", icon: "settings" },
];

export function UbitsSubNav({
  tabs = DEFAULT_TABS,
  activeTabId,
  onTabChange,
  showLogo = true,
  clientName = "SellUp",
  className,
  isSticky = true,
}: UbitsSubNavProps) {
  const currentTabId = activeTabId || tabs[0].id;
  const activeTab = tabs.find((t) => t.id === currentTabId) || tabs[0];

  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <header
      className={cn(
        "w-full h-10 bg-card border border-border/60 rounded-md px-5 flex items-center justify-between transition-all duration-300 z-[40]",
        isSticky && "sticky top-4",
        className
      )}
    >
      {/* Left Area: Logo & Navigation */}
      <div className="flex items-center h-full gap-5 flex-1 overflow-hidden">
        {showLogo && (
          <div className="flex items-center gap-2 pr-5 border-r border-border/60 h-6">
            <div className="w-5 h-5 bg-primary rounded-xs flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-primary-foreground" aria-hidden="true" />
            </div>
            <span className="text-xs font-semibold tracking-tight text-muted-foreground">
              {clientName}
            </span>
          </div>
        )}

        {isMobile ? (
          /* Mobile: Module Selector */
          <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button type="button" className="flex items-center gap-1 rounded-md text-sm font-semibold text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40">
                    {activeTab.label}
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 rounded-xl p-1 border-border/60 shadow-drawer">
                {tabs.map((tab) => {
                  const TabIcon = tab.icon ? ICON_MAP[tab.icon] : null;
                  const isActive = tab.id === currentTabId;
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      onClick={() => onTabChange?.(tab.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer text-sm",
                        isActive
                          ? "text-primary font-semibold bg-primary/10"
                          : "text-muted-foreground"
                      )}
                    >
                      {TabIcon && <TabIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                      {tab.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          /* Desktop: Clean Horizontal Tabs */
          <nav className="flex items-center gap-2 h-full overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const isActive = tab.id === currentTabId;
              const TabIcon = tab.icon ? ICON_MAP[tab.icon] : null;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "relative h-full px-3 flex items-center gap-2 transition-all group outline-none focus-visible:ring-3 focus-visible:ring-ring/40 rounded-md",
                    isActive
                      ? "text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {TabIcon && (
                    <TabIcon
                      className={cn(
                        "w-3.5 h-3.5 opacity-50 transition-all",
                        isActive ? "opacity-100 scale-105" : "group-hover:opacity-100 group-hover:scale-105"
                      )}
                    />
                  )}
                  <span className="text-xs whitespace-nowrap font-medium">
                    {tab.label}
                  </span>

                  {/* Underline grow effect */}
                  <div
                    className={cn(
                      "absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full transition-all duration-300 transform origin-center",
                      isActive
                        ? "scale-x-100 opacity-100"
                        : "scale-x-0 opacity-0 group-hover:scale-x-40 group-hover:opacity-10"
                    )}
                  />
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* Right Area: Minimal Tools */}
      <div className="flex items-center gap-1.5 ml-4">
        <button type="button" aria-label="Buscar" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-muted transition-colors text-muted-foreground hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <Search className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Configuración" className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-muted transition-colors text-muted-foreground hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <Settings className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}