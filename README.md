# SellUp

**SellUp** es una plataforma de operación comercial asistida por inteligencia artificial que acompaña al vendedor desde la prospección hasta la preparación del contacto comercial.

## Estado del Proyecto

**Base técnica inicial construida** - El desarrollo funcional real aún no ha iniciado.

## Stack Técnico

- **Framework:** Next.js 15+ con App Router
- **Lenguaje:** TypeScript
- **Estilos:** Tailwind CSS con shadcn/ui
- **Backend inicial:** Supabase (preparado, no conectado)
- **Theming:** next-themes con soporte Light/Dark
- **Calidad:** ESLint, Prettier, TypeScript strict

## Instalación

```bash
# Instalar dependencias
npm install

# Levantar proyecto en desarrollo
npm run dev
```

## Scripts Disponibles

```bash
npm run dev          # Iniciar servidor de desarrollo
npm run build        # Construir para producción
npm run start        # Iniciar en producción
npm run lint         # Ejecutar ESLint
npm run typecheck    # Verificar tipos TypeScript
npm run format       # Formatear código con Prettier
npm run format:check # Verificar formato sin aplicar
```

## Rutas Placeholder

Las siguientes rutas están creadas como placeholders para validar la estructura:

- `/login` - Página de login (placeholder)
- `/pipeline` - Pipeline SellUp / Prospección
- `/accounts` - Vista de Empresas / Cuentas
- `/accounts/[accountId]` - Expediente de cuenta
- `/ai-usage` - Uso de IA y costos
- `/settings` - Configuración e Integraciones

## Soporte Light / Dark

El proyecto incluye implementación completa de modo Light y Dark:

- Toggle visible en el header de la aplicación
- Persistencia de preferencia del usuario
- Soporte para tema del sistema
- Integración con shadcn/ui

## Estado de Funcionalidades

| Módulo               | Estado                        |
| -------------------- | ----------------------------- |
| Pipeline SellUp      | Placeholder - por implementar |
| Cuentas/Empresas     | Placeholder - por implementar |
| Expediente de cuenta | Placeholder - por implementar |
| Agente: Prospección  | Placeholder - por implementar |
| Agente: Inteligencia | Placeholder - por implementar |
| Agente: Speech       | Placeholder - por implementar |
| Uso de IA y costos   | Placeholder - por implementar |
| Configuración        | Placeholder - por implementar |
| Supabase             | Preparado - por conectar      |
| Autenticación        | Por implementar               |
| Integraciones        | Por implementar               |

## Siguientes Pasos

1. Conectar Supabase e inicializar base de datos
2. Implementar autenticación con Supabase Auth
3. Desarrollar módulo de Pipeline
4. Desarrollar módulo de Cuentas
5. Implementar agentes del MVP

---

Para más información, consulta la documentación en la carpeta `docs/`.
