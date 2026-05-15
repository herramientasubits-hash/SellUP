/**
 * Supabase Client - Cliente para el navegador
 *
 * Este archivo está preparado para conectar con Supabase desde el frontend.
 * La implementación real se realizará en una fase posterior cuando:
 * - Se inicialice el proyecto de Supabase
 * - Se configuren las tablas del modelo de datos
 * - Se establezcan las políticas de RLS
 *
 * Próximos pasos:
 * 1. Inicializar proyecto Supabase: npx supabase init
 * 2. Configurar variables de entorno en .env.local
 * 3. Implementar autenticación con Supabase Auth
 * 4. Crear tablas y políticas RLS
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cliente para uso en el navegador
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Tipos base para las tablas de SellUp
 * Se definirán con más detalle cuando se cree el modelo de datos
 */
export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: unknown;
        Insert: unknown;
        Update: unknown;
      };
      executions: {
        Row: unknown;
        Insert: unknown;
        Update: unknown;
      };
    };
  };
};
