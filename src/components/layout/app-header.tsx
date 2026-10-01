"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, ChevronRight, PanelLeft, User as UserIcon } from "@/icons";
import type { User } from "@supabase/supabase-js";
import {
  GlobalSearch,
  type SearchNavigateItem,
  type SearchObjectItem,
} from "@/components/search";
import { getAccountsList } from "@/modules/accounts/actions";
import { getAllContacts } from "@/modules/contacts/actions";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AccountMenu } from "@/components/layout/account-menu";
import { setShellHeaderHost, usePublishedCrumbs } from "@/components/layout/shell-header-slot";
import {
  mainNavItems,
  getVisibleNavItems,
  type NavAccessContext,
  type NavItem,
} from "@/config/navigation";
import { getVisibleSettingsSections } from "@/components/settings/settings-sections";
import { createClient } from "@/lib/supabase/client";

interface AppHeaderProps {
  user: User;
  initialUnreadCount?: number;
  navAccess: NavAccessContext;
}

/** Palabras con las que también se busca una sección de Configuración. */
const SETTINGS_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  users: ["roles", "permisos", "equipo"],
  providers: ["apollo", "lusha", "tavily", "claude", "presupuesto", "créditos", "gasto", "tope"],
  integrations: ["hubspot", "slack"],
  "source-catalog": ["países", "registros"],
  activity: ["historial", "auditoría"],
  "my-drive": ["google", "drive"],
};

const SEARCH_OBJECTS_HINT = "Registros: tus 200 empresas y 500 contactos más recientes.";

function compact(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/**
 * Los registros de la búsqueda general: empresas y contactos. Reutiliza las
 * lecturas que ya alimentan sus tablas (mismo permiso y mismo alcance
 * comercial); no hay consulta nueva. Si una de las dos falla, la otra sigue.
 */
async function loadSearchObjects(): Promise<SearchObjectItem[]> {
  const [accounts, contacts] = await Promise.allSettled([getAccountsList(), getAllContacts()]);
  if (accounts.status === "rejected" && contacts.status === "rejected") {
    throw new Error("No se pudieron cargar los registros de la búsqueda.");
  }

  const accountItems: SearchObjectItem[] =
    accounts.status === "fulfilled"
      ? accounts.value.map((account) => ({
          id: `account-${account.id}`,
          title: account.name,
          meta: compact([account.industry, account.country]),
          keywords: compact([account.domain, account.website, account.owner_name]),
          icon: Building2,
          group: "Empresas",
          href: `/accounts/${account.id}`,
        }))
      : [];
  const contactItems: SearchObjectItem[] =
    contacts.status === "fulfilled"
      ? contacts.value.map((contact) => ({
          id: `contact-${contact.id}`,
          title: contact.full_name,
          meta: compact([contact.job_title, contact.account_name]),
          keywords: compact([contact.email]),
          icon: UserIcon,
          group: "Contactos",
          href: `/contacts/${contact.id}`,
        }))
      : [];

  return [...accountItems, ...contactItems];
}

/** Cómo se nombra el rol en el chip de la cuenta. */
function roleLabel({ isAdmin, roleKey }: NavAccessContext): string {
  if (isAdmin) return "Administrador";
  if (!roleKey) return "Miembro";
  return roleKey.charAt(0).toUpperCase() + roleKey.slice(1).replace(/_/g, " ");
}

/**
 * La ruta de la cabecera. Sin migas publicadas pinta «SellUp › sección». Cuando
 * la pantalla publica las suyas (`PageHeader breadcrumbs`, vía
 * `ShellBreadcrumbs`), la sección pasa a ser un enlace y las migas de la
 * pantalla se pintan a continuación, en el hueco.
 */
function HeaderRoute({ current }: { current: NavItem | undefined }) {
  const published = usePublishedCrumbs();
  const hasPublished = published.length > 0;
  // Si la pantalla ya empieza sus migas por la sección, no se repite.
  const showSection = Boolean(current) && !(hasPublished && published[0]?.firstLabel === current?.title);

  return (
    <div data-slot="shell-route" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
      <nav aria-label="Ruta" className="flex shrink-0 items-center gap-1.5">
        <Link
          href="/pipeline"
          className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          SellUp
        </Link>
        {showSection && current && (
          <>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />
            {hasPublished ? (
              <Link
                href={current.href}
                className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {current.title}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-semibold text-foreground">
                {current.title}
              </span>
            )}
          </>
        )}
        {hasPublished && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />}
      </nav>
      {/* El hueco donde la pantalla montada pinta sus migas. `overflow-hidden`:
          en pantalla estrecha cede el sitio en vez de montarse sobre los
          botones de la derecha. */}
      <div
        ref={setShellHeaderHost}
        data-slot="shell-header-slot"
        className="flex min-w-0 items-center gap-2 overflow-hidden [&_[data-slot=breadcrumbs]]:flex-nowrap [&_[data-slot=breadcrumbs]]:gap-1.5 [&_[data-slot=breadcrumbs]]:whitespace-nowrap [&_[data-slot=breadcrumbs]]:text-sm [&_[data-slot=breadcrumbs]_[aria-current=page]]:font-semibold"
      />
    </div>
  );
}

/**
 * Cabecera del shell — port de Thema (`app-shell/AppHeader`).
 *
 * Esta franja es para lo transversal: dónde estás (la ruta, con las migas que
 * publica cada pantalla), la búsqueda, los avisos y la cuenta. El tema y la
 * configuración no están aquí: cuelgan de la marca, en el menú lateral. No
 * repite el título de la pantalla: ese es el `PageHeader`.
 */
export function AppHeader({ user, initialUnreadCount = 0, navAccess }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const { isAdmin, roleKey } = navAccess;
  const current = mainNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  );

  // Las secciones de Configuración también son destinos de la búsqueda: son
  // justo a lo que se llega una vez al mes y de lo que no se recuerda la ruta.
  const searchDestinations = React.useMemo<SearchNavigateItem[]>(
    () => [
      ...getVisibleNavItems(mainNavItems, { isAdmin, roleKey }).map((item) => ({
        id: item.href,
        label: item.title,
        href: item.href,
        icon: item.icon,
      })),
      ...getVisibleSettingsSections({ isAdmin, isActive: true }).map((section) => ({
        id: `settings-${section.id}`,
        label: section.title,
        href: section.href,
        icon: section.icon,
        section: "Configuración",
        keywords: SETTINGS_KEYWORDS[section.id],
      })),
    ],
    [isAdmin, roleKey],
  );

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Usuario";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4 sm:gap-3 sm:px-6">
      {/* Menú en móvil: ahí el lateral es un cajón. */}
      <button
        type="button"
        onClick={() => setMobileMenuOpen(true)}
        aria-label="Abrir menú"
        aria-haspopup="dialog"
        className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:hidden"
      >
        <PanelLeft className="size-4" />
      </button>
      <DrawerShell
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        side="left"
        size="sm"
        title="Menú"
        className="w-72 sm:!max-w-xs"
      >
        <AppSidebar
          navAccess={navAccess}
          forceExpanded
          onNavigate={() => setMobileMenuOpen(false)}
          className="p-0 pt-0"
        />
      </DrawerShell>

      <HeaderRoute current={current} />

      {/* Acciones transversales */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        <GlobalSearch
          navigate={searchDestinations}
          loadObjects={loadSearchObjects}
          objectsHint={SEARCH_OBJECTS_HINT}
          placeholder="Buscar…"
        />
        <NotificationBell initialUnreadCount={initialUnreadCount} />
        <AccountMenu
          user={{ name: displayName, email: user.email, avatarUrl }}
          roleLabel={roleLabel(navAccess)}
          onLogout={handleSignOut}
        />
      </div>
    </header>
  );
}
