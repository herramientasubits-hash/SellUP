"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "@/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getRolePreviewOptions, startRolePreview, type RolePreviewOption } from "@/modules/access/role-preview-actions";
import type { PreviewableRoleKey } from "@/modules/access/role-preview";

interface RolePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * «Ver como…»: elige un rol y una persona real con ese rol; SellUp se ve como
 * lo ve esa persona (su menú y su equipo en cascada). Sólo para la persona
 * autorizada (lo revisa el servidor en cada acción).
 */
export function RolePreviewDialog({ open, onOpenChange }: RolePreviewDialogProps) {
  const router = useRouter();
  const [options, setOptions] = React.useState<RolePreviewOption[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<PreviewableRoleKey>("commercial_lead");
  const [query, setQuery] = React.useState("");
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || options) return;
    let alive = true;
    getRolePreviewOptions()
      .then((result) => {
        if (!alive) return;
        if (result) setOptions(result);
        else setError("No tienes acceso a esta opción.");
      })
      .catch(() => alive && setError("No pudimos cargar las personas. Vuelve a intentarlo."));
    return () => {
      alive = false;
    };
  }, [open, options]);

  const current = options?.find((o) => o.roleKey === role);
  const needle = query.trim().toLowerCase();
  const people = (current?.people ?? []).filter(
    (p) => !needle || p.name.toLowerCase().includes(needle) || (p.group ?? "").toLowerCase().includes(needle),
  );

  const choose = async (id: string) => {
    setPendingId(id);
    setError(null);
    const result = await startRolePreview(id);
    setPendingId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Ver como otro rol</DialogTitle>
        <DialogDescription>
          Elige el rol y una persona: verás SellUp como lo ve ella, con su equipo en cascada. Lo que hagas queda a tu
          nombre. Vuelves a Administrador desde el aviso de arriba o desde tu avatar.
        </DialogDescription>

        <div role="tablist" aria-label="Rol" className="flex flex-wrap gap-1.5">
          {(options ?? []).map((option) => (
            <button
              key={option.roleKey}
              type="button"
              role="tab"
              aria-selected={option.roleKey === role}
              onClick={() => setRole(option.roleKey)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                option.roleKey === role
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-surface-muted",
              )}
            >
              {option.roleLabel} · {option.people.length}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar persona o equipo…"
            aria-label="Buscar persona o equipo"
            className="pl-8"
          />
        </div>

        <div className="max-h-72 min-h-24 overflow-y-auto rounded-xl border border-border/60">
          {!options && !error && (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Cargando personas…
            </p>
          )}
          {options && people.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No hay personas activas con este rol.</p>
          )}
          <ul className="divide-y divide-border/60">
            {people.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={pendingId !== null}
                  onClick={() => void choose(person.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none disabled:opacity-60"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{person.name}</span>
                    {person.group && <span className="block truncate text-xs text-muted-foreground">{person.group}</span>}
                  </span>
                  {pendingId === person.id && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter showCloseButton>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
