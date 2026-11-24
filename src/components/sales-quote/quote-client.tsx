"use client";

/**
 * Cotizador de Ventas: elige la versión de precios y muestra su pantalla.
 *
 * Hasta el 31 de diciembre de 2026 conviven la 2026 (vigente) y la 2027 (la
 * nueva); desde el 1 de enero solo queda la 2027. Cada versión muestra solo los
 * países de la región de quien cotiza (la de su grupo de SellUp).
 */

import { useState } from "react";
import { Globe } from "@/icons";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QUOTE_COUNTRIES_2026 } from "@/modules/sales-quote/engine-2026";
import { QUOTE_COUNTRIES, type QuoteMarket } from "@/modules/sales-quote/markets";
import { quotableCountries } from "@/modules/sales-quote/quote-access";
import type { PricingVersion } from "@/modules/sales-quote/version";
import { Quote2026View } from "./quote-2026-view";
import { Quote2027View } from "./quote-2027-view";

const VERSION_LABELS: Record<PricingVersion, string> = {
  "2026": "2026 · hasta el 31 de diciembre",
  "2027": "2027 · nueva versión de precios",
};

export interface QuoteClientProps {
  markets: QuoteMarket[];
  seesAllMarkets: boolean;
  /** El grupo de SellUp del que salió la región (o el suyo, si no dice ninguna). */
  fromGroup: string | null;
  versions: PricingVersion[];
  defaultVersion: PricingVersion;
}

export function QuoteClient({ markets, seesAllMarkets, fromGroup, versions, defaultVersion }: QuoteClientProps) {
  const [version, setVersion] = useState<PricingVersion>(defaultVersion);
  const access = { markets, seesAll: seesAllMarkets };
  const countries2027 = quotableCountries(access, QUOTE_COUNTRIES);
  const countries2026 = quotableCountries(access, QUOTE_COUNTRIES_2026);

  const header = (
    <PageHeader
      title="Cotizador"
      description="Arma la cotización de UBITS con los precios oficiales: productos, descuentos y lo que paga el cliente por año y en el contrato."
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

  if (markets.length === 0) {
    return (
      <PageShell className="min-h-auto pb-8 lg:pb-12">
        {header}
        <EmptyState
          icon={Globe}
          title="Tu grupo no dice una región"
          description={
            fromGroup
              ? `El cotizador muestra los países de la región de tu grupo, y «${fromGroup}» no nombra ninguna. Pídele a un admin que te ubique en el grupo de tu región (Andina, Chile, México, Centroamérica u Otros) en Configuración → Usuarios y acceso.`
              : "El cotizador muestra los países de la región de tu grupo y aún no tienes grupo. Pídele a un admin que te ubique en el de tu región en Configuración → Usuarios y acceso."
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell className="min-h-auto pb-8 lg:pb-12">
      {header}
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
            {countries2026.length > 0 ? (
              <Quote2026View countries={countries2026} />
            ) : (
              <EmptyState icon={Globe} title="Tu región no se cotiza en la versión 2026" description="Usa la versión 2027." />
            )}
          </TabsContent>
        )}
        <TabsContent value="2027">
          <Quote2027View countries={countries2027} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
