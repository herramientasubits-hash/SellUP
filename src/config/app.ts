/**
 * Configuration - Configuración global de la aplicación
 */

export const appConfig = {
  name: "SellUp",
  description:
    "Plataforma de operación comercial asistida por inteligencia artificial",
  version: "0.1.0",

  // Estado actual del proyecto
  status: {
    phase: "base-tecnica-inicial",
    description:
      "Fundación técnica, estructural y visual construida. Desarrollo funcional por iniciar.",
  },

  // Características habilitadas por fase
  features: {
    auth: false,
    supabase: false,
    agents: false,
    integrations: false,
  },

  // URLs y endpoints
  urls: {
    supabase: process.env.NEXT_PUBLIC_SUPABASE_URL,
  },
} as const;
