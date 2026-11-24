"use client";

/**
 * Cotizaciones guardadas: las mías, las de mi equipo y las que me toca
 * aprobar. Lo que se muestra es el cálculo que guardó el servidor.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Eye, Inbox } from "@/icons";
import { Field } from "@/components/forms/field";
import { ModalShell } from "@/components/shared/modal-shell";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatAppDateTime } from "@/lib/format-date";
import { ACCOUNT_TYPE_LABELS } from "@/modules/sales-quote/approval-draft";
import { USD_CONTEXT } from "@/modules/sales-quote/exchange-rates";
import { formatQuoteInteger, formatQuoteMoney, formatQuotePercent } from "@/modules/sales-quote/format";
import { cancelSalesQuote, decideSalesQuote, type SalesQuoteRow } from "@/modules/sales-quote/quote-actions";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@/modules/sales-quote/quote-record";
import { yearsLabel } from "@/modules/sales-quote/shared";

const STATUS_VARIANT: Record<QuoteStatus, "success" | "warning" | "negative" | "neutral" | "info"> = {
  ready: "success",
  pending_approval: "warning",
  approved: "success",
  rejected: "negative",
  cancelled: "neutral",
};

const formatDate = (iso: string) => formatAppDateTime(iso);
const usd = (value: number) => formatQuoteMoney(value, USD_CONTEXT, { withCode: true });
const clientOf = (row: SalesQuoteRow) => row.clientName || row.accountName || "Cliente sin nombre";

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}

/** Las líneas guardadas de una cotización. */
function QuoteLinesTable({ row }: { row: SalesQuoteRow }) {
  return (
    <Table containerClassName="overflow-x-auto">
      <TableHeader>
        <TableRow>
          <TableHead>Producto</TableHead>
          <TableHead className="text-right">Cantidad</TableHead>
          <TableHead className="text-right">Lista</TableHead>
          <TableHead className="text-right">Mínimo</TableHead>
          <TableHead className="text-right">Precio</TableHead>
          <TableHead className="text-right">Descuento</TableHead>
          <TableHead className="text-right">Por año</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {row.result.lines.map((line) => (
          <TableRow key={line.id}>
            <TableCell>
              <span className="text-foreground">{line.name}</span>
              <span className="block text-xs text-muted-foreground">{line.detail}</span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatQuoteInteger(line.qty)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.listUnit, USD_CONTEXT, { unit: true })}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{formatQuoteMoney(line.minUnit, USD_CONTEXT, { unit: true })}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatQuoteMoney(line.priceUnit, USD_CONTEXT, { unit: true })}
              {line.belowMinimum && <Badge variant="warning" className="ml-2">Bajo el mínimo</Badge>}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatQuotePercent(line.discount)}
              {line.maxDiscount !== null && <span className="block text-xs text-muted-foreground">máx. {formatQuotePercent(line.maxDiscount)}</span>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatQuoteMoney(line.perYear, USD_CONTEXT)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function summaryText(row: SalesQuoteRow): string {
  return [
    `Cotización UBITS · ${clientOf(row)} · ${row.countryName}`,
    `Versión ${row.version}. Plazo: ${yearsLabel(row.years)}.`,
    "",
    ...row.result.lines.map(
      (line) => `- ${line.name} (${line.detail}): ${formatQuoteMoney(line.priceUnit, USD_CONTEXT, { unit: true, withCode: true })} por unidad al año.`,
    ),
    "",
    `Total por año: ${usd(row.perYearTotal)}.`,
    `Total del contrato: ${usd(row.contractTotal)}.`,
  ].join("\n");
}

function QuoteDetail({ row, onClose }: { row: SalesQuoteRow; onClose: () => void }) {
  return (
    <ModalShell
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${clientOf(row)} · ${row.countryName}`}
      description={`Versión ${row.version} · ${yearsLabel(row.years)} · ${ACCOUNT_TYPE_LABELS[row.accountType]} · por ${row.createdByName}, ${formatDate(row.createdAt)}`}
      size="xl"
      footer={
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(summaryText(row)).catch(() => undefined);
            toast.success("Resumen copiado.");
          }}
        >
          <Copy />
          Copiar resumen
        </Button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <QuoteStatusBadge status={row.status} />
          <span className="text-sm text-muted-foreground">
            {usd(row.perYearTotal)} por año · <span className="font-medium text-foreground">{usd(row.contractTotal)}</span> en el contrato
          </span>
        </div>
        {row.decidedByName && row.status !== "cancelled" && (
          <p className="text-sm text-muted-foreground">
            {row.status === "approved" ? "La aprobó" : "La rechazó"} {row.decidedByName}
            {row.decidedAt ? ` (${formatDate(row.decidedAt)})` : ""}.{row.decisionNote ? ` Nota: «${row.decisionNote}».` : ""}
          </p>
        )}
        <QuoteLinesTable row={row} />
        {row.result.warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {row.result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

interface QuotesTableProps {
  rows: SalesQuoteRow[];
  showOwner?: boolean;
  /** Solo en «Mis cotizaciones»: duplicar y cancelar. */
  onDuplicate?: (row: SalesQuoteRow) => void;
  emptyTitle: string;
  emptyDescription: string;
}

export function QuotesTable({ rows, showOwner = false, onDuplicate, emptyTitle, emptyDescription }: QuotesTableProps) {
  const router = useRouter();
  const [detail, setDetail] = useState<SalesQuoteRow | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />;

  const cancel = (row: SalesQuoteRow) =>
    startTransition(async () => {
      const result = await cancelSalesQuote(row.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success("Solicitud cancelada.");
        router.refresh();
      }
    });

  return (
    <>
      <Table containerClassName="overflow-x-auto">
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Cliente</TableHead>
            {showOwner && <TableHead>Vendedor</TableHead>}
            <TableHead>País</TableHead>
            <TableHead>Versión</TableHead>
            <TableHead className="text-right">Contrato (USD)</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
              <TableCell>
                <span className="text-foreground">{clientOf(row)}</span>
                <span className="block text-xs text-muted-foreground">{yearsLabel(row.years)}</span>
              </TableCell>
              {showOwner && <TableCell>{row.createdByName}</TableCell>}
              <TableCell>{row.countryName}</TableCell>
              <TableCell>{row.version}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQuoteMoney(row.contractTotal, USD_CONTEXT)}</TableCell>
              <TableCell>
                <QuoteStatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
                    <Eye />
                    Ver
                  </Button>
                  {onDuplicate && (
                    <Button variant="ghost" size="sm" onClick={() => onDuplicate(row)}>
                      <Copy />
                      Duplicar
                    </Button>
                  )}
                  {onDuplicate && row.status === "pending_approval" && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => cancel(row)}>
                      Cancelar
                    </Button>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {detail && <QuoteDetail row={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** Una cotización por decidir: el pedido, las líneas y aprobar o rechazar. */
function ApprovalCard({ row }: { row: SalesQuoteRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    const result = await decideSalesQuote({ quoteId: row.id, decision, note });
    setBusy(null);
    if (!result.success) {
      toast.error(result.error ?? "No pudimos guardar la decisión.");
      return;
    }
    toast.success(decision === "approve" ? "Descuento aprobado." : "Descuento rechazado.");
    router.refresh();
  }

  const below = row.result.lines.filter((line) => line.belowMinimum).length;
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title={`${row.createdByName} pide aprobar un descuento`}
        description={`Pedida el ${formatDate(row.createdAt)} · ${clientOf(row)} · ${row.countryName} · ${yearsLabel(row.years)} · ${ACCOUNT_TYPE_LABELS[row.accountType]}. ${below === 1 ? "Una línea queda" : `${below} líneas quedan`} bajo el mínimo.`}
        actions={<QuoteStatusBadge status={row.status} />}
      />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {usd(row.perYearTotal)} por año · <span className="font-medium text-foreground">{usd(row.contractTotal)}</span> en el contrato
        </p>
        <QuoteLinesTable row={row} />
        <Field label="Nota para quien cotizó (opcional)">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => decide("reject")}>
            {busy === "reject" ? "Rechazando…" : "Rechazar"}
          </Button>
          <Button disabled={busy !== null} onClick={() => decide("approve")}>
            {busy === "approve" ? "Aprobando…" : "Aprobar"}
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function ApprovalsList({ rows }: { rows: SalesQuoteRow[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={Inbox} title="Nada por aprobar" description="Cuando alguien pida aprobar un descuento que te toca, llega aquí y por Slack." />;
  }
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <ApprovalCard key={row.id} row={row} />
      ))}
    </div>
  );
}
