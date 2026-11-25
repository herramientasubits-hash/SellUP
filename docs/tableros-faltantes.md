# Tableros — lo que falta (TABLEROS-1)

**Estado:** fase 1 construida sin cambios en la base de datos (dueño 25-11: «por ahora no puedo editar la base de datos»).
**Ruta:** `/dashboards` («Tableros» en el menú). Código en `src/modules/dashboards/` y `src/app/(sellup)/dashboards/`.

## Qué hay hoy (fase 1)

- **Quién ve qué** (alcance comercial de siempre): admin ve todo; líder/manager, su equipo en cascada (grupos + reportes); BD/KAM, sólo su propia actividad. Los filtros sólo achican el alcance; un id de fuera pegado en la URL no trae nada.
- **Desde el lanzamiento:** nada anterior al **11-11-2026** (`DASHBOARDS_LAUNCH_DAY`).
- **Uso vs resultado:** lo buscado y lo pendiente por revisar es *uso*; sólo lo **aprobado/revisado** es *enriquecido*.
- **Crédito:** el uso, a quien **buscó** (`triggered_by`, `created_by`); el resultado, a quien **aprobó** (`reviewed_by`). «Enriquecer empresa de HubSpot» (#894) no tiene aprobación: va a quien lo pidió.
- **Fuentes:** empresas y contactos de todas las fuentes cuentan; filtro de fuente con vista «una a una» o «agrupadas».
- **Contactos nuevos** cuentan igual que los de HubSpot, con su procedencia («Ya estaba en HubSpot» / «Nuevo»).
- **Tamaño** en lugar de segmento.
- **Filtros en la URL:** periodo (atajos o rango a mano), agrupar por día/semana/mes, equipos, personas (2 a 8 = comparativa), fuentes, países.
- **Vistas guardadas v1:** en el navegador (`localStorage`, clave `sellup:dashboards:views:v1`) y por enlace.

Tablas que lee (sólo lectura): `contact_enrichment_runs`, `contact_enrichment_candidates`, `contacts` (`metadata.source_candidate_id`, `metadata.hubspot_sync`), `prospect_batches`, `prospect_candidates`, `accounts` (`metadata.hubspot_enrichment_request`), `internal_users`, `organization_groups`.

## Faltantes (necesitan tablas nuevas)

### 1. Registro de enriquecimiento
Una fila por cada vez que SellUp completa algo de una empresa o un contacto.

| Campo | Para qué |
|---|---|
| `entity_type` (`account` \| `contact`) y `entity_id` | Qué se enriqueció |
| `field` | Qué dato (NIT, razón social, tamaño, correo, teléfono, LinkedIn…) |
| `source` | De qué fuente salió (HubSpot, Apollo, Lusha, catálogo oficial…) |
| `requested_by`, `approved_by` | Quién lo pidió y quién lo aprobó |
| `outcome` | Completado, sin datos nuevos, fallido |
| `created_at` | Cuándo |

**Por qué:** hoy sólo queda el *último* estado (`metadata.hubspot_enrichment_request` guarda el último pedido; `metadata.hubspot_sync.fill_empty` la última sincronización; si alguien vuelve a revisar, `reviewed_by/at` se pisa).
**Habilita:** historial exacto, detalle por campo **y** fuente, tableros que no cambian cuando se re-revisa.
**Backfill posible:** parcial, desde lo que ya está guardado (último estado).

### 2. Tabla de vistas guardadas
`dashboard_views (id, owner_id, page_key, name, query, visibility private|team, is_default, created_at, updated_at)` con RLS por dueño y por alcance de equipo.
**Habilita:** vistas que siguen a la persona en cualquier equipo, vistas de equipo compartidas y una vista por defecto. Reemplaza la v1 en el navegador (se puede importar desde `localStorage` la primera vez).

### 3. Sumas en la base de datos
Vistas o funciones SQL (o vistas materializadas) que devuelvan los conteos por día, persona, fuente y estado.
**Por qué:** hoy se leen las filas del periodo y se suma en el servidor; desde el 11-11 el volumen es bajo, pero con años de datos y muchos equipos se vuelve lento.

### 4. Segmento de empresa
Es un cálculo interno de Ubits que aún no vive en SellUp. Cuando exista (columna o tabla de reglas), se agrega como corte junto a Tamaño.

## Limitaciones conocidas de la fase 1

- Los datos completados son el último estado, no cada evento.
- Las búsquedas y solicitudes no tienen fuente: el filtro de fuente aplica a lo encontrado y a lo aprobado.
- «Completo» mira el candidato y el teléfono principal del contacto de SellUp (no la colección de teléfonos ni el móvil).
- La fuente de prueba (`mock`) no cuenta.
