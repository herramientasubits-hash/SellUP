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
