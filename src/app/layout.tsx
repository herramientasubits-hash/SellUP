import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { ThemaToaster } from "@/components/feedback/thema-toaster";

// Inter va dentro del proyecto (fuente variable 400–800, subconjunto latino de
// Google Fonts, licencia OFL): el build de Producción falló dos veces al
// descargarla de Google (#842, #848). Así no depende de la red.
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  variable: "--font-inter",
  weight: "400 800",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SellUp - Plataforma de Operación Comercial Asistida por IA",
  description:
    "SellUp centraliza la operación comercial, automatiza la investigación, genera inteligencia comercial y produce materiales de preparación.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        <Providers>{children}</Providers>
        <ThemaToaster />
      </body>
    </html>
  );
}
