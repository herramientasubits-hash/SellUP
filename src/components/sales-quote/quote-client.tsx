"use client";

/**
 * Cotizador de Ventas: cotizar, mis cotizaciones, las del equipo y las que me
 * toca aprobar.
 *
 * Hasta el 31 de diciembre de 2026 conviven la 2026 (vigente) y la 2027 (la
 * nueva); desde el 1 de enero solo queda la 2027. Cada versión muestra solo los
 * países de la región de quien cotiza (la de su grupo de SellUp).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "@/icons";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsBadge, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QUOTE_COUNTRIES_2026, type Quote2026Input } from "@/modules/sales-quote/engine-2026";
import type { Quote2027Input } from "@/modules/sales-quote/engine-2027";
import { QUOTE_COUNTRIES, type QuoteMarket } from "@/modules/sales-quote/markets";
import type { SalesQuoteRow, SalesQuotesBoard } from "@/modules/sales-quote/quote-actions";
import { quotableCountries } from "@/modules/sales-quote/quote-access";
import type { PricingVersion } from "@/modules/sales-quote/version";
import { Quote2026View } from "./quote-2026-view";
import { Quote2027View } from "./quote-2027-view";
import { ApprovalsList, QuotesTable } from "./quote-lists";

const VERSION_LABELS: Record<PricingVersion, string> = {
  "2026": "2026 · hasta el 31 de diciembre",
  "2027": "2027 · nueva versión de precios",
};

export type QuotesTab = "quote" | "mine" | "team" | "approvals";

export interface QuoteClientProps {
  markets: QuoteMarket[];
  seesAllMarkets: boolean;
  /** El grupo de SellUp del que salió la región (o el suyo, si no dice ninguna). */
  fromGroup: string | null;
  versions: PricingVersion[];
  defaultVersion: PricingVersion;
  board: SalesQuotesBoard;
  initialTab: QuotesTab;
}

/** Una cotización guardada que se vuelve a abrir para editarla como nueva. */
interface Seed {
  key: number;
  version: PricingVersion;
  input: unknown;
  clientName: string;
}

export function QuoteClient({ markets, seesAllMarkets, fromGroup, versions, defaultVersion, board, initialTab }: QuoteClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<QuotesTab>(initialTab);
  const [version, setVersion] = useState<PricingVersion>(defaultVersion);
  const [seed, setSeed] = useState<Seed | null>(null);
  const access = { markets };
  const countries2027 = quotableCountries(access, QUOTE_COUNTRIES);
  const countries2026 = quotableCountries(access, QUOTE_COUNTRIES_2026);

  const onSaved = () => {
    setSeed(null);
    setTab("mine");
    router.refresh();
  };

  const duplicate = (row: SalesQuoteRow) => {
    const target: PricingVersion = versions.includes(row.version) ? row.version : "2027";
    setSeed({
      key: Date.now(),
      version: target,
      // Una 2026 que ya no se cotiza arranca la 2027 desde cero (otros productos).
      input: target === row.version ? row.input : undefined,
      clientName: row.clientName ?? row.accountName ?? "",
    });
    setVersion(target);
    setTab("quote");
  };

  const pendingToDecide = board.toDecide.length;
  const myPending = board.mine.filter((row) => row.status === "pending_approval").length;

  const header = (
    <PageHeader
      title="Cotizador"
      description="Arma la cotización de UBITS con los precios oficiales, guárdala y, si un descuento pasa el máximo, pide aprobación."
      meta={
        <Badge variant={markets.length === 0 ? "warning" : "neutral"} title={fromGroup ? `Por tu grupo: ${fromGroup}` : undefined}>
          {seesAllMarkets
            ? "Todas las regiones"
            : markets.length === 0
              ? "Sin región"
              : markets.length === 1
                ? `Región ${markets[0]}`
                : `Regiones: ${markets.join(", ")}`}
        </Badge>
      }
    />
  );

  const quotePanel =
    markets.length === 0 ? (
      <EmptyState
        icon={Globe}
        title="Tu grupo no dice una región"
        description={
          fromGroup
            ? `El cotizador muestra los países de la región de tu grupo, y «${fromGroup}» no nombra ninguna. Pídele a un admin que te ubique en el grupo de tu región (Andina, Chile, México, Centroamérica u Otros) en Configuración → Usuarios y acceso.`
            : "El cotizador muestra los países de la región de tu grupo y aún no tienes grupo. Pídele a un admin que te ubique en el de tu región en Configuración → Usuarios y acceso."
        }
      />
    ) : (
      <Tabs value={version} onValueChange={(value) => setVersion(value as PricingVersion)}>
        {versions.length > 1 && (
          <TabsList variant="segmented" aria-label="Versión de precios" className="mb-5 max-w-full overflow-x-auto">
            {versions.map((item) => (
              <TabsTrigger key={item} value={item}>
                {VERSION_LABELS[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        )}
        {versions.includes("2026") && (
          <TabsContent value="2026">
            <Alert variant="warning" className="mb-5">
              <AlertDescription>
                La versión 2026 se puede usar hasta el 31 de diciembre de 2026. Desde el 1 de enero de 2027 solo se cotiza con la 2027.
              </AlertDescription>
            </Alert>
            {countries2026.length > 0 ? (
              <Quote2026View
                key={seed?.version === "2026" ? seed.key : "base"}
                countries={countries2026}
                initialInput={seed?.version === "2026" ? (seed.input as Quote2026Input | undefined) : undefined}
                initialClientName={seed?.version === "2026" ? seed.clientName : undefined}
                onSaved={onSaved}
              />
            ) : (
              <EmptyState icon={Globe} title="Tu región no se cotiza en la versión 2026" description="Usa la versión 2027." />
            )}
          </TabsContent>
        )}
        <TabsContent value="2027">
          <Quote2027View
            key={seed?.version === "2027" ? seed.key : "base"}
            countries={countries2027}
            initialInput={seed?.version === "2027" ? (seed.input as Quote2027Input | undefined) : undefined}
            initialClientName={seed?.version === "2027" ? seed.clientName : undefined}
            onSaved={onSaved}
          />
        </TabsContent>
      </Tabs>
    );

  return (
    <PageShell className="min-h-auto pb-8 lg:pb-12">
      {header}
      {board.storageMissing && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Todavía no se pueden guardar cotizaciones</AlertTitle>
          <AlertDescription>Falta aplicar la migración 170 en la base de datos. Puedes cotizar y copiar el resumen mientras tanto.</AlertDescription>
        </Alert>
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(value as QuotesTab)}>
        <TabsList aria-label="Cotizador" className="mb-5 max-w-full overflow-x-auto">
          <TabsTrigger value="quote">Cotizar</TabsTrigger>
          <TabsTrigger value="mine">
            Mis cotizaciones
            <TabsBadge count={myPending} tone="warning" />
          </TabsTrigger>
          {board.team !== null && <TabsTrigger value="team">Del equipo</TabsTrigger>}
          {board.canApprove && (
            <TabsTrigger value="approvals">
              Por aprobar
              <TabsBadge count={pendingToDecide} tone="warning" />
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="quote">{quotePanel}</TabsContent>
        <TabsContent value="mine">
          <QuotesTable
            rows={board.mine}
            onDuplicate={duplicate}
            emptyTitle="Aún no guardas cotizaciones"
            emptyDescription="Arma una en «Cotizar» y guárdala desde el resumen."
          />
        </TabsContent>
        {board.team !== null && (
          <TabsContent value="team">
            <QuotesTable
              rows={board.team}
              showOwner
              emptyTitle="Tu equipo aún no guarda cotizaciones"
              emptyDescription="Aquí ves las cotizaciones de las personas a tu cargo."
            />
          </TabsContent>
        )}
        {board.canApprove && (
          <TabsContent value="approvals">
            <ApprovalsList rows={board.toDecide} />
          </TabsContent>
        )}
      </Tabs>
    </PageShell>
  );
}
