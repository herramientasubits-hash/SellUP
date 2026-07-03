# Módulo: Proveedores y consumo

**Estado:** Funcional — cierre Q3D (2026-07-03)

---

## Rutas principales

| Ruta | Descripción |
|------|-------------|
| `/settings/providers` | Entrada principal del módulo (tab defecto: consumo) |
| `/settings/providers?tab=consumo` | Tab "Consumo y presupuestos" |
| `/settings/providers?tab=ia` | Tab "Configuración IA" |
| `/settings/providers/[providerKey]` | Detalle de proveedor (tabs: resumen, presupuesto, uso/logs, modelos) |

El query param `tab` en `/settings/providers` es gestionado por `ProvidersTabs` (client component). Si el valor es inválido, se abre `consumo` por defecto.

---

## Rutas legacy activas

Siguen vivas por compatibilidad. Cada una muestra un banner informativo apuntando al módulo principal.

| Ruta | Equivalente en módulo principal |
|------|--------------------------------|
| `/settings/ai` | `/settings/providers?tab=ia` |
| `/settings/usage` | `/settings/providers?tab=consumo` |
| `/settings/budget-credits` | `/settings/providers?tab=consumo` |
| `/settings/budget-credits/rules` | `/settings/providers?tab=consumo` |
| `/ai-usage` | Sin cambios (módulo separado de consumo por usuario) |

---

## Qué se puede hacer desde el módulo

- Ver tabla global de proveedores (tipo, estado, cuota, consumo mensual)
- Acceder al detalle de cada proveedor
- Configurar cuota/presupuesto por proveedor
- Crear, editar, activar/desactivar y archivar reglas de presupuesto
- Ver modelos y tarifas de proveedores LLM (Anthropic, OpenAI, Gemini)
- Ver logs de uso y sync por proveedor
- Reactivar regla archivada al crear una nueva

---

## Qué NO cambió en Q3D

- No hay enforcement nuevo de reglas
- No hay sync nuevo ni modificado
- No hay migraciones de base de datos
- No se eliminaron rutas
- No se tocaron agentes ni prospecting toolkit
- No se modificó la lógica de resolución de presupuesto

---

## Decisiones pendientes (futuro)

- **Edición inline de modelos/tarifas desde el detalle:** hoy el CTA apunta a `/settings/providers?tab=ia`.
- **Dashboard avanzado de consumo:** la ruta `/settings/usage` es la base interna; se puede evolucionar hacia un dashboard consolidado.
- **Consolidación de `/ai-usage`:** si el negocio decide unificar el consumo por usuario con el módulo de proveedores, se puede absorber `/ai-usage` en una nueva tab o sección.
- **Eliminar rutas legacy:** pendiente de decisión de producto; hoy se conservan con banner informativo.

---

## Visión UX objetivo

> Esta sección documenta la dirección aprobada por producto para la evolución UX del módulo.
> No describe el estado actual sino hacia dónde debe evolucionar en las iteraciones Q3F.

### Principio del módulo

Proveedores y consumo **no debe ser una pantalla de reportes pesada**. Debe ser una **consola operativa ligera** para administrar proveedores, configuración, consumo, presupuestos, efectividad y auditoría.

La experiencia objetivo es: **tabla light → acciones individuales/masivas → sidepanel por proveedor → tabs operativos**.

---

### 1. Vista principal: tabla light

La tabla principal (`/settings/providers`) debe ser ligera y enfocada en estado operativo.

**Columnas objetivo:**

| Columna | Descripción |
|---------|-------------|
| Selección | Checkbox para acciones masivas |
| Proveedor | Nombre clickeable que abre el sidepanel |
| Tipo | LLM / Datos / Enriquecimiento / Procurement |
| Estado | Activo / Inactivo / Error / No medido |
| Consumo del mes | Créditos y/o USD del período actual |
| Alerta / atención requerida | Indicador si hay alerta activa o acción pendiente |
| Última sincronización | Fecha/hora del último sync exitoso |
| Acciones | Menú de acciones rápidas por fila |

**Lo que NO va en la tabla principal:**

- Todos los logs de uso
- Todas las reglas de presupuesto
- Todas las tarifas por modelo
- Todos los modelos disponibles
- Todo el historial de cambios
- Todas las métricas de efectividad

Esa información vive en el sidepanel, organizada por tabs.

---

### 2. Acciones

**Acciones por fila:**

- Ver detalle (abre sidepanel)
- Configurar (abre tab Configuración del sidepanel)
- Ver consumo (abre tab Consumo del sidepanel)
- Editar presupuesto / reglas (abre tab Presupuesto y reglas)
- Ver logs (abre tab Logs y auditoría)

**Acciones masivas futuras (progresivas):**

- Sincronizar cuota
- Activar / desactivar proveedor
- Asignar regla global
- Exportar consumo / logs
- Marcar como manual / no medido

Las acciones masivas deben implementarse progresivamente; no deben llegar todas al mismo tiempo.

---

### 3. Sidepanel por proveedor

Al hacer click en el nombre del proveedor en la tabla principal se abre un **sidepanel / drawer** con la información completa organizada en tabs.

**Tabs del sidepanel:**

1. **Resumen**
2. **Configuración**
3. **Consumo**
4. **Presupuesto y reglas**
5. **Efectividad**
6. **Logs y auditoría**

La ruta `/settings/providers/[providerKey]` **sigue viva** como deep link y fallback técnico (acceso directo, bookmarks, navegación programática). La experiencia principal futura será:

```
/settings/providers → click nombre del proveedor → sidepanel
```

---

### 4. Tab Resumen

Muestra el estado operativo rápido del proveedor:

- Estado de conexión
- Estado de medición
- Consumo del mes (créditos + costo estimado)
- Última sincronización
- Alertas activas
- Agentes que usan el proveedor

---

### 5. Tab Configuración

**Para proveedores IA (LLM):**

- Estado activo / inactivo
- API key / conexión
- Modelos disponibles
- Modelo activo
- Tarifas por millón de tokens (input / output)
- Context window
- Fallback / prioridad futura

**Para proveedores no IA (datos, enriquecimiento, procurement):**

- Conexión y credenciales seguras
- Modo de medición (API / manual / estimado)
- Cuota mensual
- Sincronización manual / automática vía API
- Acción configurada al superar límite

---

### 6. Tab Consumo

Filtros disponibles:

- Fecha (rango)
- Rol
- Grupo organizacional
- Usuario
- Agente
- Cuenta / prospecto
- Estado de la ejecución
- Modelo usado

Métricas que muestra:

- Tokens (input / output)
- Créditos
- Costo USD estimado
- Número de runs
- Errores
- Proveedor / modelo desglosado

---

### 7. Tab Presupuesto y reglas

Gestión de límites y comportamiento al superarlos:

- Cuota mensual (créditos)
- Presupuesto USD
- Reglas globales del proveedor
- Reglas por usuario
- Reglas por rol
- Reglas por grupo organizacional
- Acción al superar el límite

**Estados de acción posibles:**

| Estado | Comportamiento |
|--------|---------------|
| `alert-only` | Notifica pero no bloquea |
| `bloquear ejecución` | Rechaza la llamada al proveedor |
| `pedir aprobación` | Escala a admin antes de continuar |
| `cambiar proveedor / modelo` | Redirige a fallback configurado |
| `bajar prioridad` | Mantiene ejecución con menor prioridad |

> **Nota:** Hoy el sistema está principalmente en modo `alert-only` (configuración y alerta). El enforcement real (bloqueo, fallback automático, aprobación) es evolución futura progresiva.

---

### 8. Tab Efectividad

Tab **futuro / progresivo** que responde preguntas de calidad y costo-efectividad:

- ¿Qué proveedor entrega mejores resultados?
- ¿Cuál es la relación costo vs calidad por agente?
- ¿Cuántos errores por agente genera cada proveedor?
- ¿Cuántos duplicados / rechazos?
- ¿Cuál es el costo por candidato útil aprobado?
- ¿Cuál es el costo por cuenta enriquecida con datos accionables?

Puede iniciar como **placeholder informativo** hasta tener suficiente data real acumulada.

---

### 9. Tab Logs y auditoría

Registro completo de actividad del proveedor:

- Ejecuciones recientes (éxito / error)
- Errores y mensajes de falla
- Sync logs (cuota, actualización de datos)
- Cambios de configuración
- Reglas creadas / editadas / archivadas
- Proveedor / modelo usado en cada run
- Usuario responsable de cada cambio

---

### 10. Estrategia de implementación por fases

#### Q3F-2
- Convertir la tabla principal (`/settings/providers`) en tabla light con las columnas objetivo.
- Habilitar click en nombre del proveedor para abrir sidepanel.
- Abrir sidepanel con tabs usando datos ya existentes (reutilizar lo que carga `/settings/providers/[providerKey]`).
- Mantener la ruta de detalle actual sin cambios como fallback.

#### Q3F-3
- Migrar la organización de tabs del detalle actual (`/settings/providers/[providerKey]`) al sidepanel como experiencia primaria.
- Mejorar tabs Configuración, Consumo y Presupuesto con la visión definida aquí.
- Conservar el deep link `[providerKey]` funcional.

#### Q3F-4
- Agregar tab Efectividad como base (puede iniciar con placeholder).
- Conectar métricas reales a medida que se acumula data suficiente.

#### Q3F-5
- Definir acciones masivas reales con control de permisos progresivo.
- Priorizar las acciones de mayor impacto operativo primero.

---

### 11. No objetivos de Q3F

Q3F **no debe**:

- Eliminar las rutas legacy (`/settings/ai`, `/settings/usage`, `/settings/budget-credits`)
- Eliminar `/settings/providers/[providerKey]`
- Crear enforcement real de reglas (bloqueo, fallback automático)
- Tocar credenciales de forma insegura
- Convertir la tabla principal en un dashboard pesado con métricas consolidadas
- Duplicar lógica de consumo ya existente en `/ai-usage`
- Crear un módulo paralelo de proveedores fuera de `/settings/providers`
- Tocar agentes, contact-enrichment, PanamaCompra, source catalog ni prospecting-toolkit
