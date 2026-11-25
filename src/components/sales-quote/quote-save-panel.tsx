"use client";

/**
 * Guardar la cotización desde el resumen.
 *
 * Si nada baja del mínimo se guarda «Lista para enviar». Si algo baja (solo en
 * la 2027), el botón dice «Pedir aprobación»: se guarda pendiente y le llega a
 * quien aprueba descuentos (Configuración → Cotizador). El cliente es la empresa
 * de HubSpot elegida en las condiciones. El cotizador es solo de Ventas.
 */

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveSalesQuote } from "@/modules/sales-quote/quote-actions";
import type { QuoteClientRef } from "./quote-client-picker";
import type { PricingVersion } from "@/modules/sales-quote/version";

interface QuoteSavePanelProps {
  version: PricingVersion;
  input: unknown;
  client: QuoteClientRef;
  needsApproval: boolean;
  disabled?: boolean;
  /** Después de guardar: pasa a «Mis cotizaciones». */
  onSaved: () => void;
}

export function QuoteSavePanel({ version, input, client, needsApproval, disabled = false, onSaved }: QuoteSavePanelProps) {
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveSalesQuote({
        version,
        input,
        clientName: client.name.trim(),
        accountId: client.accountId,
        hubspotCompanyId: client.hubspotCompanyId,
        accountType: "ventas",
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
      onSaved();
    });

  return (
    <div className="flex flex-col gap-4 border-t border-border/60 pt-4">
      <Button onClick={save} disabled={disabled || pending}>
        {pending ? "Guardando…" : needsApproval ? "Pedir aprobación" : "Guardar cotización"}
      </Button>
    </div>
  );
}
