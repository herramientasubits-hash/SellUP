"use client";

// TABLEROS-1 — «Vistas»: guardar la vista de ahora (pestaña + filtros) con un
// nombre y volver a ella con un clic. Versión 1: se guardan en ESTE navegador;
// para compartir una vista se copia su enlace. Seguir a la persona en cualquier
// equipo y compartir con el equipo necesita una tabla (ver «Lo que falta»).

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Check, Link2, Save, Star, Trash2 } from "@/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModalShell } from "@/components/shared/modal-shell";
import {
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  SAVED_VIEWS_STORAGE_KEY,
  addSavedView,
  isCurrentView,
  parseSavedViews,
  removeSavedView,
  sanitizeViewQuery,
  serializeSavedViews,
  type SavedDashboardView,
} from "@/modules/dashboards/saved-views";

function readStored(): SavedDashboardView[] {
  try {
    return parseSavedViews(window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY));
  } catch {
    return [];
  }
}

function writeStored(views: readonly SavedDashboardView[]): boolean {
  try {
    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, serializeSavedViews(views));
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

// La lista vive en `localStorage`; se lee al montar (en el servidor no existe).
const listeners = new Set<() => void>();
let snapshot: SavedDashboardView[] | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_VIEWS_STORAGE_KEY) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): SavedDashboardView[] {
  if (snapshot === null) snapshot = readStored();
  return snapshot;
}

const EMPTY: SavedDashboardView[] = [];

function commit(views: SavedDashboardView[]): boolean {
  const ok = writeStored(views);
  snapshot = ok ? views : null;
  for (const listener of listeners) listener();
  return ok;
}

export function SavedViewsMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const views = React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  // La pestaña la cambia `UrlTabs` con `history.replaceState`, así que se lee de la URL real.
  const currentQuery = () =>
    sanitizeViewQuery(typeof window === "undefined" ? searchParams.toString() : window.location.search);
  const activeView = views.find((view) => isCurrentView(view, searchParams.toString()));

  const save = () => {
    const result = addSavedView(views, { name, query: currentQuery(), id: newId(), now: new Date().toISOString() });
    if (!result.ok) {
      setMessage(
        result.reason === "empty_name"
          ? "Ponle un nombre a la vista."
          : `Ya tienes ${MAX_SAVED_VIEWS} vistas. Borra alguna para guardar otra.`,
      );
      return;
    }
    if (!commit(result.views)) {
      setMessage("Este navegador no deja guardar vistas (modo privado o almacenamiento bloqueado). Copia el enlace en su lugar.");
      return;
    }
    setDialogOpen(false);
    setName("");
    setMessage(null);
    toast.success(`Vista «${result.view.name}» guardada en este navegador.`);
  };

  const copyLink = async (query: string) => {
    const url = `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado. Quien lo abra ve los datos de SU alcance, no los tuyos.");
    } catch {
      toast.error("No se pudo copiar el enlace. Cópialo de la barra de direcciones.");
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
          <Star aria-hidden="true" />
          {activeView ? activeView.name : "Vistas"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Vistas guardadas en este navegador</DropdownMenuLabel>
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Aún no tienes vistas. Pon los filtros y guarda la vista para volver a ella con un clic.
            </p>
          ) : (
            views.map((view) => (
              <DropdownMenuItem key={view.id} onClick={() => router.push(view.query ? `${pathname}?${view.query}` : pathname)}>
                {view === activeView ? <Check aria-hidden="true" /> : <span aria-hidden="true" className="size-4" />}
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setName(activeView?.name ?? "");
              setMessage(null);
              setDialogOpen(true);
            }}
          >
            <Save aria-hidden="true" />
            {activeView ? "Actualizar o guardar como…" : "Guardar vista actual…"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copyLink(currentQuery())}>
            <Link2 aria-hidden="true" />
            Copiar enlace de esta vista
          </DropdownMenuItem>
          {activeView && (
            <DropdownMenuItem variant="destructive" onClick={() => commit(removeSavedView(views, activeView.id))}>
              <Trash2 aria-hidden="true" />
              Borrar «{activeView.name}»
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ModalShell
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        size="sm"
        title="Guardar vista"
        description="Guarda la pestaña y los filtros de ahora. Un periodo con atajo («Últimos 30 días») se mueve solo; un rango a mano queda fijo."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={save}>
              Guardar
            </Button>
          </>
        }
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label htmlFor="dashboard-view-name" className="text-sm font-medium text-foreground">
            Nombre
          </label>
          <Input
            id="dashboard-view-name"
            value={name}
            maxLength={MAX_VIEW_NAME_LENGTH}
            placeholder="Mi equipo · últimos 30 días"
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Con el mismo nombre de una vista que ya tienes, la actualiza con estos filtros.
          </p>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </form>
      </ModalShell>
    </>
  );
}
