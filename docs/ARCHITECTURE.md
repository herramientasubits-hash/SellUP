# Arquitectura de SellUp

## Visión General

La arquitectura de SellUp está diseñada para soportar el crecimiento desde una base técnica sólida hacia un producto completo de operación comercial asistida por IA.

## Principios de Diseño

1. **Modularidad**: Cada módulo puede evolucionar de forma independiente
2. **Separación de responsabilidades**: Frontend, lógica de aplicación, datos, agentes e integraciones están claramente separados
3. **Preparación para evolución**: La arquitectura permite migrar de Supabase a un backend agentic propio
4. **Configurabilidad**: Las reglas de negocio no están quemadas en componentes visuales

## Estructura de Carpetas

```
src/
├── app/              # Next.js App Router - rutas y layouts
├── components/      # Componentes reutilizables
│   ├── layout/      # Componentes de estructura (sidebar, header)
│   ├── navigation/  # Componentes de navegación
│   ├── theme/       # Theme provider y toggle
│   └── ui/          # Componentes base de shadcn/ui
├── config/          # Configuración global (nav, app)
├── lib/             # Utilidades y clientes externos
│   ├── env/         # Variables de entorno
│   ├── supabase/    # Clientes Supabase (client, server)
│   └── utils/       # Utilidades compartidas
├── modules/         # Dominios funcionales
│   ├── auth/        # Autenticación
│   ├── pipeline/    # Módulo de Pipeline
│   ├── accounts/    # Módulo de Cuentas
│   └── ...          # Otros módulos del MVP
├── server/          # Lógica de servidor (agentes, integraciones)
└── types/           # Tipos globales de TypeScript
```

## Capas de la Arquitectura

### 1. Capa de Presentación (`app/`, `components/`)

- Rutas de Next.js
- Componentes UI
- Layouts
- Temas Light/Dark

### 2. Capa de Aplicación (`modules/`)

- Casos de uso
- Flujos de negocio
- Coordinación de agentes
- hooks y servicios específicos

### 3. Capa de Datos (`lib/supabase/`)

- Cliente de Supabase
- Repositorios
- Modelos de datos (por definir)

### 4. Capa de Agentes (`server/agents/`)

- Definiciones de agentes
- Prompts
- Ejecución
- Outputs

### 5. Capa de Integraciones (`server/integraciones/`)

- Conectores externos (HubSpot, Apollo)
- Abstracciones para proveedores de IA

## Soporte para Supabase

La arquitectura está preparada para usar Supabase como backend inicial:

- Cliente navegador (`lib/supabase/client.ts`)
- Cliente servidor (`lib/supabase/server.ts`)
- Tipos base para tablas
- Preparación para RLS

## Soporte para Agentes de IA

Los agentes están diseñados como capacidades del producto, no como chats aislados:

- Inputs y outputs estructurados
- Registro de ejecuciones, tokens y costos
- Encadenamiento entre agentes
- Memoria contextual (preparada)

## Soporte para Integraciones

La arquitectura permite agregar integraciones de forma desacoplada:

- Conectores en `server/integrations/`
- Abstracción de proveedores de IA
- Configuración en `config/`

## Trazabilidad y Costos

Toda ejecución de agente registra:

- Usuario
- Cuenta
- Proveedor/modelo
- Tokens entrada/salida
- Costo estimado
- Duración
- Estado
- Resultado

## Evolución Futura

La arquitectura permite evolucionar hacia un backend agentic propio:

- Agentes separados del frontend
- Lógica de ejecución más compleja
- Memoria RAG integrada
- Orquestación de workflows

## siguiente paso

Esta arquitectura es la base para comenzar el desarrollo funcional de los módulos del MVP.

Para más detalles sobre la estructura del proyecto, ver `docs/PROJECT_STRUCTURE.md`.

Para guidelines de desarrollo, ver `docs/DEVELOPMENT_GUIDELINES.md`.
