"use client";

/**
 * Regiones del cotizador por persona.
 *
 * Se marca a una o varias personas y se les agrega, quita o reemplaza regiones.
 * Admin, manager y líder comercial cotizan todo por su rol: aparecen en la
 * lista, pero no se les puede marcar.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine } from "@/icons";
import { Field } from "@/components/forms/field";
import { ModalShell } from "@/components/shared/modal-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { roleLabelFor } from "@/modules/access/role-labels";
import { QUOTE_MARKETS, countriesForMarkets, type QuoteMarket } from "@/modules/sales-quote/markets";
import type { MarketAssignmentMode } from "@/modules/sales-quote/quote-access";
import { setQuoteMarkets, type QuoteMarketAssignmentRow } from "@/modules/sales-quote/quote-markets-actions";

const MODE_LABELS: Record<MarketAssignmentMode, string> = {
  add: "Agregar a las que ya tienen",
  remove: "Quitar de las que tienen",
  replace: "Dejar solo estas",
};

const marketCountries = (market: QuoteMarket) =>
  countriesForMarkets([market])
    .filter((country) => country.code !== "XX")
    .map((country) => country.name)
    .join(", ");

interface EditTarget {
  userIds: string[];
  /** Una sola persona: se edita su lista completa. */
  single: QuoteMarketAssignmentRow | null;
}

export function QuoteMarketsClient({ rows }: { rows: QuoteMarketAssignmentRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [markets, setMarkets] = useState<QuoteMarket[]>([]);
  const [mode, setMode] = useState<MarketAssignmentMode>("add");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? rows.filter((row) => row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle))
      : rows;
  }, [rows, query]);
  const editable = visible.filter((row) => !row.seesAll);
  const withoutRegion = rows.filter((row) => !row.seesAll && row.markets.length === 0).length;
  const allSelected = editable.length > 0 && editable.every((row) => selected.has(row.userId));

  const toggle = (userId: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });

  const openFor = (next: EditTarget) => {
    setTarget(next);
    setMarkets(next.single ? next.single.markets : []);
    setMode(next.single ? "replace" : "add");
  };

  const save = () => {
    if (!target) return;
    startTransition(async () => {
      const result = await setQuoteMarkets({ userIds: target.userIds, markets, mode });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.updated === 1 ? "Regiones guardadas." : `Regiones guardadas para ${result.updated} personas.`);
      setTarget(null);
      setSelected(new Set());
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          className="max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o correo"
          aria-label="Buscar persona"
        />
        <div className="flex flex-wrap items-center gap-3">
          {withoutRegion > 0 && (
            <Badge variant="warning">
              {withoutRegion} {withoutRegion === 1 ? "persona sin región" : "personas sin región"}
            </Badge>
          )}
          <Button disabled={selected.size === 0} onClick={() => openFor({ userIds: [...selected], single: null })}>
            Asignar regiones{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>

      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                disabled={editable.length === 0}
                onCheckedChange={(value) =>
                  setSelected(value === true ? new Set(editable.map((row) => row.userId)) : new Set())
                }
                aria-label="Marcar a todas las personas de la lista"
              />
            </TableHead>
            <TableHead>Persona</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Regiones que cotiza</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.userId}>
              <TableCell>
                <Checkbox
                  checked={selected.has(row.userId)}
                  disabled={row.seesAll}
                  onCheckedChange={(value) => toggle(row.userId, value === true)}
                  aria-label={`Marcar a ${row.name}`}
                />
              </TableCell>
              <TableCell>
                <span className="text-foreground">{row.name}</span>
                <span className="block text-xs text-muted-foreground">{row.email}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{roleLabelFor(row.roleKey)}</TableCell>
              <TableCell>
                {row.seesAll ? (
                  <span className="text-sm text-muted-foreground">Todas, por su rol</span>
                ) : row.markets.length === 0 ? (
                  <Badge variant="warning">Sin región</Badge>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {row.markets.map((market) => (
                      <Badge key={market} variant="neutral">
                        {market}
                      </Badge>
                    ))}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {!row.seesAll && (
                  <Button variant="ghost" size="sm" onClick={() => openFor({ userIds: [row.userId], single: row })}>
                    <PenLine />
                    Editar
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                Nadie coincide con la búsqueda.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <ModalShell
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={
          target?.single
            ? `Regiones de ${target.single.name}`
            : `Regiones de ${target?.userIds.length ?? 0} ${target?.userIds.length === 1 ? "persona" : "personas"}`
        }
        description="Cada región trae sus países al cotizador."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={pending || (markets.length === 0 && mode !== "replace")}>
              {pending ? "Guardando…" : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {!target?.single && (
            <Field label="Qué hacer con sus regiones">
              <Select value={mode} onValueChange={(value) => value && setMode(value as MarketAssignmentMode)} items={MODE_LABELS}>
                <SelectTrigger className="w-full" aria-label="Qué hacer con sus regiones">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as MarketAssignmentMode[]).map((item) => (
                    <SelectItem key={item} value={item}>
                      {MODE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Regiones</legend>
            {QUOTE_MARKETS.map((market) => (
              <label key={market} className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={markets.includes(market)}
                  onCheckedChange={(value) =>
                    setMarkets((current) =>
                      value === true ? QUOTE_MARKETS.filter((item) => item === market || current.includes(item)) : current.filter((item) => item !== market),
                    )
                  }
                />
                <span className="space-y-0.5">
                  <span className="block font-medium text-foreground">{market}</span>
                  <span className="block text-muted-foreground">{marketCountries(market)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {target?.single && markets.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin regiones, esta persona no podrá cotizar.</p>
          )}
        </div>
      </ModalShell>
    </div>
  );
}
