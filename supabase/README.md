# SellUp - Supabase Backend

## Estado

Supabase está **preparado pero no inicializado** en este repositorio.

## Siguientes Pasos

1. **Inicializar Supabase:**

   ```bash
   npx supabase init
   ```

2. **Configurar variables de entorno:**
   Copiar `.env.example` a `.env.local` y completar con las credenciales del proyecto de Supabase.

3. **Crear estructura de tablas:**
   - Tablas para el modelo de datos del MVP
   - Políticas RLS
   - Índices

4. **Configurar autenticación:**
   - Proveedor de Google OAuth
   - Políticas de acceso

## Tablas Previstas del MVP

Basado en la documentación funcional de SellUp:

- `accounts` - Cuentas/empresas
- `prospects` - Prospectos
- `account_intelligence` - Inteligencia de cuenta
- `speeches` - Speechs generados
- `executions` - Registro de ejecuciones de agentes
- `costs` - Costos de IA
- `activities` - Actividad y logs

## Documentación Relacionada

- `docs/ARCHITECTURE.md` - Arquitectura técnica
- `docs/PROJECT_STRUCTURE.md` - Estructura del proyecto
- `.env.example` - Variables de entorno requeridas

## Nota

Esta carpeta contendrá en el futuro:

- Migraciones de base de datos
- Seeds de datos iniciales
- Configuración de Supabase (funciones, triggers, etc.)
