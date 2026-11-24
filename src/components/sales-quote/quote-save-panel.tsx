"use client";

/**
 * Guardar la cotización desde el resumen.
 *
 * Si nada baja del mínimo se guarda «Lista para enviar». Si algo baja (solo en
 * la 2027), el botón dice «Pedir aprobación»: se guarda pendiente y le llega a
 * quien aprueba ese tipo de cuenta. La empresa de SellUp es opcional.
 */

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Search, X } from "@/icons";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type QuoteAccountType } from "@/modules/sales-quote/approval-draft";
import { saveSalesQuote, searchQuoteAccounts, type QuoteAccountOption } from "@/modules/sales-quote/quote-actions";
import type { PricingVersion } from "@/modules/sales-quote/version";

interface QuoteSavePanelProps {
  version: PricingVersion;
  input: unknown;
  clientName: string;
  needsApproval: boolean;
  disabled?: boolean;
  /** Después de guardar: pasa a «Mis cotizaciones». */
  onSaved: () => void;
}

function AccountPicker({ value, onChange }: { value: QuoteAccountOption | null; onChange: (value: QuoteAccountOption | null) => void }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<QuoteAccountOption[]>([]);

  const searching = !value && query.trim().length >= 2;
  const shown = searching ? options : [];

  useEffect(() => {
    if (!searching) return;
    let active = true;
    const timer = setTimeout(async () => {
      const found = await searchQuoteAccounts(query);
      if (active) setOptions(found);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, searching]);

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm">
        <span className="truncate text-foreground">{value.name}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Quitar la empresa">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en Empresas" aria-label="Empresa en SellUp" />
      {shown.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-card">
          {shown.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-muted focus-visible:bg-muted"
                onClick={() => {
                  onChange(option);
                  setQuery("");
                }}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QuoteSavePanel({ version, input, clientName, needsApproval, disabled = false, onSaved }: QuoteSavePanelProps) {
  const [accountType, setAccountType] = useState<QuoteAccountType>("ventas");
  const [account, setAccount] = useState<QuoteAccountOption | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveSalesQuote({
        version,
        input,
        clientName: clientName.trim() || account?.name || "",
        accountId: account?.id ?? null,
        accountType,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.status === "pending_approval") {
        toast.success(
          result.approverNames.length > 0
            ? `Cotización guardada. Le pedimos aprobación a ${result.approverNames.join(", ")}.`
            : "Cotización guardada y pendiente de aprobación.",
        );
      } else {
        toast.success("Cotización guardada: lista para enviar.");
      }
      setAccount(null);
      onSaved();
    });

  return (
    <div className="flex flex-col gap-4 border-t border-border/60 pt-4">
      {version === "2027" && (
        <Field label="Tipo de cuenta" description="Define quién aprueba si un descuento pasa el máximo.">
          <Select
            value={accountType}
            onValueChange={(value) => value && setAccountType(value as QuoteAccountType)}
            items={ACCOUNT_TYPE_LABELS}
          >
            <SelectTrigger className="w-full" aria-label="Tipo de cuenta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {ACCOUNT_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Empresa en SellUp" description="Opcional: liga la cotización a una de tus empresas.">
        <AccountPicker value={account} onChange={setAccount} />
      </Field>
      <Button onClick={save} disabled={disabled || pending}>
        {pending ? "Guardando…" : needsApproval ? "Pedir aprobación" : "Guardar cotización"}
      </Button>
    </div>
  );
}
