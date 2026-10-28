'use client';

// Logos de marca de los modos de búsqueda del panel del agente (F1).
//
// Los archivos son los SVG OFICIALES de cada marca, guardados SIN MODIFICAR en `public/brand/`
// (el kit de marca de LinkedIn y los lineamientos de HubSpot prohíben redibujarlos, cambiarles
// el color o añadirles efectos). Se muestran con <img> y no como SVG en línea para que el archivo
// quede byte a byte igual al descargado y sus colores de marca no entren al código (la regla
// `color-a-mano` del design-system sigue sin excepciones).
//
// Si el archivo todavía no está en el repo, se muestra el rótulo de texto en su lugar: el botón
// nunca queda vacío.

import * as React from 'react';

export type SearchModeBrand = 'hubspot' | 'linkedin';

export const SEARCH_MODE_BRAND_LOGO_SRC: Record<SearchModeBrand, string> = {
  hubspot: '/brand/hubspot-sprocket.svg',
  linkedin: '/brand/linkedin-in.svg',
};

/** El kit de LinkedIn fija 21 px como tamaño mínimo en pantalla; se usa el mismo para los dos. */
const LOGO_PX = 21;

const FALLBACK_TEXT: Record<SearchModeBrand, string> = {
  hubspot: 'ID',
  linkedin: 'in',
};

export function SearchModeBrandIcon({ brand }: { brand: SearchModeBrand }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <span aria-hidden className="text-xs font-semibold leading-none" data-testid={`brand-fallback-${brand}`}>
        {FALLBACK_TEXT[brand]}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG estático de marca: next/image no lo optimiza y debe quedar intacto.
    <img
      src={SEARCH_MODE_BRAND_LOGO_SRC[brand]}
      alt=""
      aria-hidden
      width={LOGO_PX}
      height={LOGO_PX}
      className="size-[21px] shrink-0"
      onError={() => setFailed(true)}
      data-testid={`brand-logo-${brand}`}
    />
  );
}
