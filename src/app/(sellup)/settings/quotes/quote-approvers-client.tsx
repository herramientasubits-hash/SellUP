"use client";

/**
 * Quién aprueba los descuentos del cotizador, por tipo de cuenta.
 *
 * Aprobadores: deciden (en SellUp o con los botones de Slack). En copia: les
 * llega el aviso, sin decidir. Sin aprobadores, deciden los administradores.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { MultiSelect } from "@/components/forms/multi-select";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type QuoteAccountType } from "@/modules/sales-quote/approval-draft";
import { setQuoteApprovers, type QuoteApproverSettings } from "@/modules/sales-quote/quote-actions";

const DESCRIPTIONS: Record<QuoteAccountType, string> = {
  ventas: "Cotizaciones de cuentas nuevas.",
  cs: "Cotizaciones de cuentas que ya son clientes (renovaciones y ampliaciones).",
};

function AccountTypeCard({
  accountType,
  initial,
  users,
}: {
  accountType: QuoteAccountType;
  initial: QuoteApproverSettings["byType"][QuoteAccountType];
  users: QuoteApproverSettings["users"];
}) {
  const router = useRouter();
  const [approverIds, setApproverIds] = useState(initial.approverIds);
  const [ccIds, setCcIds] = useState(initial.ccIds);
  const [pending, startTransition] = useTransition();
  const options = users.map((user) => ({ value: user.id, label: user.name }));
  const dirty =
    approverIds.join() !== initial.approverIds.join() || ccIds.join() !== initial.ccIds.join();

  const save = () =>
    startTransition(async () => {
      const result = await setQuoteApprovers({ accountType, approverIds, ccIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Guardado: ${ACCOUNT_TYPE_LABELS[accountType]}.`);
      router.refresh();
    });

  return (
    <SurfaceCard>
      <SurfaceCardHeader title={ACCOUNT_TYPE_LABELS[accountType]} description={DESCRIPTIONS[accountType]} />
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Aprueban"
          description={
            initial.fallbackToAdmins
              ? `Sin aprobadores elegidos: hoy deciden los administradores${initial.approverNames.length ? ` (${initial.approverNames.join(", ")})` : ""}.`
              : "Deciden en SellUp o con los botones del aviso de Slack."
          }
        >
          <MultiSelect options={options} value={approverIds} onValueChange={setApproverIds} placeholder="Elige personas" searchPlaceholder="Buscar persona" emptyMessage="Nadie coincide." />
        </Field>
        <Field label="En copia" description="Les llega el aviso, pero no deciden.">
          <MultiSelect
            options={options.filter((option) => !approverIds.includes(option.value))}
            value={ccIds.filter((id) => !approverIds.includes(id))}
            onValueChange={setCcIds}
            placeholder="Elige personas"
            searchPlaceholder="Buscar persona"
            emptyMessage="Nadie coincide."
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={save} disabled={!dirty || pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </SurfaceCard>
  );
}

export function QuoteApproversClient({ settings }: { settings: QuoteApproverSettings }) {
  return (
    <div className="flex flex-col gap-4">
      {ACCOUNT_TYPES.map((accountType) => (
        <AccountTypeCard key={accountType} accountType={accountType} initial={settings.byType[accountType]} users={settings.users} />
      ))}
    </div>
  );
}
