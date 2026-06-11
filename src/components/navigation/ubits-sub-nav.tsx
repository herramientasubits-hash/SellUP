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
} from "lucide-react";
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
        "w-full h-10 bg-card border border-border/40 rounded-full px-5 flex items-center justify-between transition-all duration-300 z-[40]",
        isSticky && "sticky top-4",
        className
      )}
    >
      {/* Left Area: Logo & Navigation */}
      <div className="flex items-center h-full gap-5 flex-1 overflow-hidden">
        {showLogo && (
          <div className="flex items-center gap-2 pr-5 border-r border-border/40 h-6">
            <div className="w-5 h-5 bg-su-brand rounded flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-su-brand-foreground" />
            </div>
            <span className="text-xs font-bold tracking-tight text-foreground/70">
              {clientName}
            </span>
          </div>
        )}

        {isMobile ? (
          /* Mobile: Module Selector */
          <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <button className="flex items-center gap-1 text-sm font-bold text-foreground hover:text-su-brand transition-colors">
                    {activeTab.label}
                    <ChevronDown className="w-3.5 h-3.5 opacity-30" />
                  </button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 rounded-lg p-1 border-border/40 shadow-lg">
                {tabs.map((tab) => {
                  const TabIcon = tab.icon ? ICON_MAP[tab.icon] : null;
                  const isActive = tab.id === currentTabId;
                  return (
                    <DropdownMenuItem
                      key={tab.id}
                      onClick={() => onTabChange?.(tab.id)}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer text-sm",
                        isActive
                          ? "text-su-brand font-bold bg-su-brand/5"
                          : "text-muted-foreground"
                      )}
                    >
                      {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
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
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "relative h-full px-3 flex items-center gap-2 transition-all group outline-none",
                    isActive
                      ? "text-su-brand font-bold"
                      : "text-muted-foreground/60 hover:text-foreground"
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
                      "absolute bottom-0 left-0 right-0 h-[1.5px] bg-su-brand rounded-t-full transition-all duration-300 transform origin-center",
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
        <button className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted/40 transition-colors text-muted-foreground/50 hover:text-foreground">
          <Search className="w-3.5 h-3.5" />
        </button>
        <button className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-muted/40 transition-colors text-muted-foreground/50 hover:text-foreground">
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}