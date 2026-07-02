# Créditos y presupuestos

## Propósito

Permite a SellUp visualizar el consumo, costos, cuotas y estado de sincronización de proveedores externos e IA, y configurar reglas de presupuesto con alertas. No reemplaza la facturación del proveedor ni bloquea ejecuciones todavía.

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/settings/budget-credits` | Vista principal: proveedores, cuotas, consumo y sincronización |
| `/settings/budget-credits/rules` | CRUD de reglas de presupuesto alert-only |

## Estado por proveedor

| Proveedor | Estado | Fuente de cuota |
|-----------|--------|-----------------|
| Tavily | API synced | Sync automático por API |
| Lusha | API synced | Sync automático por API |
| Apollo | Manual requerido | Cuota configurada manualmente en SellUp |
| Claude / Anthropic | Manual requerido | Presupuesto USD configurado manualmente |
| OpenAI | Preparado | Sin sync real todavía |
| Gemini | Preparado | Sin sync real todavía |
| Samu IA | No medido | Fuera de medición en esta fase |

## Qué hace hoy

- Muestra proveedores activos con su estado de conexión y cuota.
- Muestra consumo del mes registrado desde SellUp.
- Permite configurar cuotas y presupuestos manuales por proveedor.
- Sincroniza Tavily y Lusha por API (botón manual en UI).
- Registra logs seguros de sync externo (`tool_quota_sync_logs`) con sanitización de secretos.
- Permite crear, editar y archivar reglas de presupuesto por proveedor, operación y scope (global / usuario / grupo / rol).
- Muestra evaluaciones `budget_check` para Apollo y Tavily en actividad reciente.
- Presenta side panel con detalle de cada evaluación de presupuesto.

## Qué NO hace todavía

- No bloquea ejecuciones por presupuesto agotado.
- No corre sincronización automática (sin cron todavía).
- No hace backfill de consumo histórico.
- No reemplaza ni duplica la facturación del proveedor.
- No mide Samu IA desde SellUp.
- No sincroniza Apollo ni Claude sin credenciales elevadas (Master key / Admin API key).

## Decisiones operativas

- **Tavily y Lusha** son API synced: la cuota disponible viene de la API del proveedor como fuente principal.
- **Apollo** queda manual: la credencial actual no expone la cuota por API. No se investigarán Master keys en esta fase.
- **Claude / Anthropic** queda manual: los costos externos requieren Admin API key. No se investigará en esta fase.
- **OpenAI / Gemini** quedan preparados para una fase futura.
- **Samu IA** queda fuera de medición hasta que se defina una fase específica.
- El enforcement por presupuesto (bloqueo real de ejecuciones) queda para una fase posterior.

## Tablas relevantes

| Tabla | Rol |
|-------|-----|
| `tool_catalog` | Configuración de proveedores: cuotas, estado de sync, costos, campos de billing |
| `budget_rules` | Reglas de presupuesto por proveedor, operación y scope |
| `provider_usage_logs` | Logs de uso con evaluaciones `budget_check` embebidas en metadata |
| `tool_quota_sync_logs` | Logs de sincronización externa con observabilidad segura |

## Consideraciones futuras

- Enforcement real: bloquear ejecuciones cuando se supere la cuota/presupuesto.
- Cron de sync automático para Tavily y Lusha.
- Incorporar OpenAI y Gemini cuando se active su sync.
- Definir medición de Samu IA si el negocio lo requiere.
- Evaluar Admin/Master keys para Apollo y Claude solo si el negocio decide habilitarlas.
