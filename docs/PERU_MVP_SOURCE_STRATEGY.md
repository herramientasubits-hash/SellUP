# Perú.3O — Gate de decisión: Estrategia MVP Perú sin fuente CIIU confiable

**Hito:** Perú.3O  
**Fecha:** 2026-06-25  
**HEAD inicial:** `bb7fc02` — fix(source-catalog): reclassify Migo Peru as RUC lookup source  
**Tipo:** Gate de decisión — documentación. Sin código productivo, sin Supabase runtime, sin candidatos, sin llamadas de API.  
**Depende de:** Perú.3N-S (Migo reclasificado como `validation_only / P2` tras spike real)

---

## Decisión formal — Perú MVP Source Strategy

```
Perú MVP Source Strategy
─────────────────────────────────────────────────────────────────
Official legal validation:  SUNAT Padrón Reducido RUC
Official sector / CIIU:     unavailable for MVP
Private CIIU provider:      not confirmed — Migo rejected for CIIU (MIGO_NOT_USEFUL_FOR_CIIU)
Sector source:              inferred from web / AI / semantic search on razón social + domain
Confidence label:           sector_inferred  (NOT official_ciiu)
Human review required:      before candidate conversion when sector is inferred
─────────────────────────────────────────────────────────────────
```

---

## 1. Estado previo de fuentes CIIU para Perú

### 1.1 Estado al cierre de Perú.3N-S

| Fuente | CIIU | Estado operativo | Verdict |
|--------|------|-----------------|---------|
| SUNAT Padrón Reducido RUC | ❌ | ✅ Operable — ZIP diario gratuito | BASE_LEGAL_NO_CIIU |
| SUNAT e-consultaruc (web) | ✅ | ❌ Captcha bloquea automatización | REJECT_MASIVO |
| PRODUCE MiPyme por Sector | ✅ | ❌ WAF-bloqueado (CloudFront 403) | `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` |
| PRODUCE Grandes Empresas Manufactura | ✅ | ❌ WAF-bloqueado | `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` |
| Migo API | ❌ (spike real) | ✅ Operable — sin CIIU | `MIGO_NOT_USEFUL_FOR_CIIU` |
| ApiDni.com | ✅ (docs) | ⚠️ No evaluado con spike real | `PRIVATE_PROVIDER_PENDING_SPIKE` |

### 1.2 Conclusión

**No existe fuente oficial ni privada confirmada que devuelva CIIU masivo para Perú en el contexto actual de SellUp MVP.**

Las dos rutas disponibles quedaron bloqueadas:
- **Ruta oficial:** PRODUCE WAF-bloqueado. SUNAT no exporta CIIU en el padrón reducido.
- **Ruta privada:** Migo API fue la única fuente privada evaluada con spike real — el payload real no contiene CIIU. ApiDni.com queda como siguiente candidato, pero no está evaluado.

---

## 2. Respuestas a las preguntas del gate

### 2.1 ¿Podemos avanzar Perú MVP sin CIIU?

**Sí.**

El MVP puede entregar valor real con los campos que SUNAT sí provee:
- Identificación legal de la empresa (RUC + razón social)
- Estado tributario (ACTIVO / BAJA PROVISIONAL / BAJA DEFINITIVA)
- Condición de domicilio (HABIDO / NO HABIDO / NO HALLADO)
- Ubicación geográfica (ubigeo departamento/provincia/distrito, cuando disponible)

El sector se puede inferir mediante búsqueda web/IA sobre la razón social y dominio, con la etiqueta de confianza `sector_inferred`.

El MVP sin CIIU aún permite:
- Generar universo base de 851,883 empresas activas habidas
- Filtrar por estado (ACTIVO) y condición (HABIDO)
- Filtrar por región (departamento/provincia/distrito)
- Inferir sector con confianza media para orientación al equipo comercial

---

### 2.2 ¿Qué pierde SellUp al no tener CIIU?

| Capacidad | Sin CIIU | Con CIIU oficial |
|-----------|----------|-----------------|
| Filtrar por sector en el universo Perú | ❌ No confiable — inferencia con error estimado 15–35% | ✅ Preciso — ~700 códigos CIIU Rev 4 |
| Segmentar candidatos por industria precisa | ⚠️ Solo orientativo | ✅ Exacto y auditable |
| Reportar cobertura sectorial del pipeline | ⚠️ No auditable con fuente citable | ✅ Auditable con fuente oficial |
| Filtros de ICP con sector como criterio duro | ❌ No usar CIIU como criterio duro sin fuente oficial | ✅ Usar como criterio confiable |
| Escalar discovery por sector en Perú | ⚠️ Solo aproximado | ✅ Preciso |

**El mayor impacto:** sin CIIU oficial, el filtro por sector en Perú es orientativo, no preciso. SellUp puede seguir generando prospectos peruanos, pero no puede garantizar la segmentación sectorial con la misma calidad que tiene en Colombia (RUES con CIIU) o Chile (RUNT con actividad).

---

### 2.3 ¿Qué puede cubrirse con inferencia web/IA?

La inferencia web/IA puede estimar el sector a partir de:

| Señal | Cobertura estimada | Confianza |
|-------|-------------------|-----------|
| Palabras clave en razón social (ej: "Sistemas", "Consultores", "Construcciones") | Alta (~90% de RUCs tienen razón social parseable) | Media (~70% correcto para sector amplio) |
| Búsqueda web sobre razón social + RUC (Tavily o similar) | Media (~50–70% tienen presencia web) | Media-Alta (~80% correcto si hay resultado web) |
| Dominio web de la empresa (cuando disponible) | Baja (~20–30% tienen web identificable en sources) | Alta (>90% correcto si hay web) |
| Sector de SEACE (si la empresa tiene historial de contratos) | Baja (~5–15% del universo) | Alta — señal B2G confirmada |

**Casos donde la inferencia funciona bien:**
- "SISTEMAS Y TECNOLOGÍA SAC" → Tecnología (alta confianza)
- "CONSTRUCTORA LOS ANDES SAC" → Construcción (alta confianza)
- "SERVICIOS MÉDICOS LIMA SAC" → Salud (alta confianza)

**Casos donde la inferencia falla:**
- "INVERSIONES GENERALES DEL SUR SAC" → sector ambiguo
- "GRUPO EMPRESARIAL DEL NORTE SAC" → sector no inferible
- Holdings o empresas genéricas sin sector explícito en el nombre

---

### 2.4 ¿Qué debe quedar marcado como "sector inferido", no "sector oficial"?

**Regla:** Cualquier sector derivado de un proceso que no sea una fuente oficial con campo CIIU explícito debe llevar `confidence_label: sector_inferred`.

| Origen del dato de sector | Label a usar | Descripción en UI |
|--------------------------|-------------|-------------------|
| CIIU de SUNAT e-consultaruc (manual) | `official_ciiu` | "Sector confirmado (CIIU oficial SUNAT)" |
| CIIU de PRODUCE MiPyme (cuando operable) | `official_ciiu` | "Sector confirmado (CIIU PRODUCE)" |
| CIIU de ApiDni.com u otro proveedor evaluado con spike | `private_ciiu` | "Sector confirmado (proveedor privado)" |
| Inferencia por razón social + web/IA | `sector_inferred` | "Sector estimado (inferencia web/IA)" |
| Sin dato disponible | `sector_unavailable` | "Sector no disponible" |

**Perú MVP usa:** `sector_inferred` o `sector_unavailable` exclusivamente.

---

### 2.5 ¿SUNAT es suficiente como validador legal?

**Sí — dentro de sus límites.**

SUNAT Padrón Reducido RUC es suficiente para confirmar:

| Campo | Cobertura | Confiabilidad |
|-------|-----------|---------------|
| RUC 11 dígitos | 100% | Alta — identificador oficial |
| Razón social | 100% | Alta — dato tributario oficial |
| Estado del contribuyente | 100% | Alta — ACTIVO / BAJA / SUSPENSIÓN |
| Condición de domicilio | 100% | Alta — HABIDO / NO HABIDO / NO HALLADO |
| Ubigeo (departamento) | ~60–70% | Media — muchas filas vacías en el padrón |
| Dirección postal | Baja cobertura | Baja — muy incompleto |

**SUNAT NO puede confirmar:**
- Sector / actividad económica / CIIU
- Representantes legales
- Contactos (email, teléfono)
- Tamaño de empresa (número de empleados, ingresos)

**Conclusión:** Para el propósito del MVP de SellUp (identificar si una empresa peruana existe, está activa y es habida), SUNAT es suficiente. Para el propósito de calificar esa empresa en un ICP por sector, SUNAT no alcanza.

---

### 2.6 ¿Migo aporta algo adicional frente a SUNAT o debe quedar opcional?

**Migo aporta valor marginal frente a SUNAT en la práctica del MVP:**

| Dimensión | SUNAT Padrón Reducido | Migo API |
|-----------|----------------------|----------|
| RUC + razón social | ✅ | ✅ (redundante) |
| Estado tributario | ✅ | ✅ (tiempo real) |
| Condición domicilio | ✅ | ✅ (tiempo real) |
| Ubigeo / dirección | ✅ (parcial) | ✅ |
| CIIU / sector | ❌ | ❌ (confirmado por spike) |
| Actualización | Diario (snapshot) | Tiempo real |
| Costo | Gratuito | S/15–25/mes |

**Ventaja de Migo:** actualización en tiempo real vs. snapshot diario. Si una empresa cambia de ACTIVO a BAJA en el mismo día, Migo lo refleja antes que el ZIP de SUNAT.

**Recomendación:** Migo permanece como `validation_only / P2` — útil para casos específicos de validación puntual en tiempo real (ej: confirmar estado antes de crear un candidato), pero no justifica costo mensual para enriquecimiento masivo del universo Perú.

**No activar Migo como fuente de enrichment masivo en el MVP.**

---

### 2.7 ¿Qué campos son confiables para Perú MVP?

Campos de **alta confianza** (fuente: SUNAT Padrón Reducido):

| Campo | Tipo | Confiabilidad | Notas |
|-------|------|---------------|-------|
| `ruc` | String (11 dígitos) | ✅ Alta | Identificador fiscal único |
| `nombre_o_razon_social` | String | ✅ Alta | Dato tributario oficial |
| `estado_del_contribuyente` | Enum | ✅ Alta | ACTIVO / BAJA PROVISIONAL / BAJA DEFINITIVA / SUSPENSIÓN TEMPORAL |
| `condicion_de_domicilio` | Enum | ✅ Alta | HABIDO / NO HABIDO / NO HALLADO |
| `ubigeo_departamento` | String | ✅ Alta (cuando presente) | Presente en ~60–70% de registros |
| `ubigeo_provincia` | String | ✅ Alta (cuando presente) | Presente en ~60–70% de registros |
| `ubigeo_distrito` | String | ✅ Alta (cuando presente) | Presente en ~60–70% de registros |

Campos de **confianza media** (inferencia web/IA):

| Campo | Tipo | Confiabilidad | Notas |
|-------|------|---------------|-------|
| `sector_inferido` | String | ⚠️ Media | Derivado de razón social + web/IA. Orientativo. |
| `sector_confidence_score` | Float [0–1] | ⚠️ Media | Score de confianza de la inferencia |

---

### 2.8 ¿Qué campos deben quedar como no disponibles?

| Campo | Estado | Razón |
|-------|--------|-------|
| `ciiu_codigo` | ❌ NOT_AVAILABLE_MVP | SUNAT no lo exporta; PRODUCE WAF-bloqueado; Migo no lo devuelve |
| `ciiu_descripcion` | ❌ NOT_AVAILABLE_MVP | Mismo motivo |
| `actividad_economica_oficial` | ❌ NOT_AVAILABLE_MVP | Mismo motivo |
| `sector_oficial` | ❌ NOT_AVAILABLE_MVP | Sin fuente oficial operable |
| `representantes_legales` | ❌ NOT_AVAILABLE_MVP | SUNAT: solo en consulta web con captcha. Migo: no devuelve. |
| `numero_empleados` | ❌ NOT_AVAILABLE_MVP | Ninguna fuente gratuita operable disponible |
| `ingresos_estimados` | ❌ NOT_AVAILABLE_MVP | Fuente privada enterprise (CIAL D&B) |
| `email_empresa` | ❌ NOT_AVAILABLE_MVP | No en fuentes oficiales (violación de privacidad si se obtiene por scraping) |
| `telefono_empresa` | ❌ NOT_AVAILABLE_MVP | No en fuentes oficiales |

---

### 2.9 ¿Qué debe ver el usuario en la UI cuando Perú no tiene CIIU?

#### Principios generales

1. **No mostrar campos vacíos sin contexto.** Evitar "-" o "N/A" sin explicación.
2. **Distinguir visualmente sector inferido vs. sector oficial.**
3. **Informar activamente la limitación** sin bloquear el flujo del usuario.
4. **No mentir:** si el sector es inferido, debe decir "inferido" o "estimado".

#### Tratamiento recomendado por campo en UI

| Campo | Comportamiento UI |
|-------|------------------|
| Sector | Mostrar badge: `Tecnología · inferido` (con ícono de advertencia) |
| CIIU | No mostrar el campo si no hay dato. O mostrar: "CIIU: no disponible para Perú en MVP" |
| Actividad económica | Mostrar sector inferido con nota: "Estimado a partir de razón social y búsqueda web" |
| Fuente de sector | Tooltip o metadato: "Fuente: inferencia web/IA (sin CIIU oficial)" |

#### Ejemplo de ficha de candidato Perú en UI

```
┌─────────────────────────────────────────────────────────────┐
│ Empresa: SISTEMAS Y TECNOLOGÍA S.A.C.                       │
│ RUC: 20512345678                                            │
│ Estado: ACTIVO · HABIDO                                     │
│ Región: Lima, Lima, Miraflores                              │
│                                                              │
│ Sector: Tecnología  ⚠ inferido                             │
│         [i] Estimado a partir de razón social y web.         │
│             Verificar antes de usar como criterio de ICP.   │
│                                                              │
│ CIIU: no disponible (Perú MVP — fuente oficial en evaluación)│
└─────────────────────────────────────────────────────────────┘
```

#### Advertencia en filtros de búsqueda Perú

Cuando el usuario filtra por sector en Perú, mostrar:

> ⚠️ El sector de empresas peruanas es inferido, no oficial. No existe fuente CIIU confiable disponible para Perú en esta versión. Los resultados son orientativos y pueden incluir errores de clasificación.

---

### 2.10 ¿Cuál es el siguiente paso técnico correcto?

**Paso 1 — Activar discovery Perú con SUNAT como base de identidad (Perú.4 o similar)**

- Conectar `pe_sunat_bulk` en `SOURCE_DISCOVERY_REGISTRY`
- Conectar Perú en `source-discovery-preflight`
- Usar solo campos de alta confianza: RUC, razón social, estado, condición, ubigeo
- Omitir campo CIIU del pipeline de discovery

**Paso 2 — Implementar inferencia sectorial con label correcto**

- Pipeline de inferencia: razón social → búsqueda semántica / keywords → sector SellUp
- Siempre etiquetar resultado con `confidence_label: sector_inferred`
- Agregar campo `sector_source: 'inferred_web_ai'`
- No filtrar candidatos por sector en Perú usando criterio duro en MVP

**Paso 3 — Evaluar ApiDni.com como siguiente candidato CIIU**

- Objetivo: confirmar si ApiDni.com devuelve CIIU en un spike técnico real
- Alcance: 10–20 RUCs de muestra del snapshot Perú.3J
- Si spike confirma CIIU → migrar etiqueta `sector_inferred` a `private_ciiu`
- Si spike falla → evaluar siguiente candidato

**Paso 4 — Post-MVP: cuando exista fuente CIIU confiable**

- Migrar `sector_source` de `inferred_web_ai` a `official_ciiu` o `private_ciiu`
- Actualizar badge en UI de "inferido" a "confirmado"
- Habilitar filtros por sector con criterio duro en Perú

---

## 3. Decisión final — Resumen ejecutivo

### Fuentes aceptadas para Perú MVP

| Fuente | Rol | Campos aportados | Confiabilidad |
|--------|-----|-----------------|---------------|
| **SUNAT Padrón Reducido RUC** | Validación legal oficial | RUC, razón social, estado, condición, ubigeo | ✅ Alta |
| **Inferencia web/IA** | Sector orientativo | sector_inferido, confidence_score | ⚠️ Media |
| **Migo API** (opcional) | Validación RUC puntual en tiempo real | RUC, razón social, estado, condición | ⚠️ Opcional / P2 |

### Fuentes descartadas para CIIU en Perú MVP

| Fuente | Verdict | Razón |
|--------|---------|-------|
| PRODUCE MiPyme por Sector | `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` | CloudFront WAF bloquea acceso programático |
| PRODUCE Grandes Empresas | `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL` | Mismo WAF |
| Migo API (como CIIU) | `MIGO_NOT_USEFUL_FOR_CIIU` | Spike real: no devuelve CIIU en endpoint validado |
| SUNAT e-consultaruc | `REJECT_MASIVO` | Captcha impide automatización |

### Campos oficiales Perú MVP

```
ruc                        ← SUNAT Padrón Reducido (alta confianza)
nombre_o_razon_social      ← SUNAT Padrón Reducido (alta confianza)
estado_del_contribuyente   ← SUNAT Padrón Reducido (alta confianza)
condicion_de_domicilio     ← SUNAT Padrón Reducido (alta confianza)
ubigeo_departamento        ← SUNAT Padrón Reducido (alta confianza, ~60–70% cobertura)
ubigeo_provincia           ← SUNAT Padrón Reducido (alta confianza, ~60–70% cobertura)
ubigeo_distrito            ← SUNAT Padrón Reducido (alta confianza, ~60–70% cobertura)
```

### Campos inferidos Perú MVP

```
sector_inferido            ← inferencia web/IA sobre razón social + dominio
sector_confidence_score    ← score 0–1 de la inferencia
sector_source              ← siempre 'inferred_web_ai' para Perú MVP
confidence_label           ← siempre 'sector_inferred' para Perú MVP
```

### Campos no disponibles Perú MVP

```
ciiu_codigo                ← NOT_AVAILABLE_MVP
ciiu_descripcion           ← NOT_AVAILABLE_MVP
actividad_economica        ← NOT_AVAILABLE_MVP
sector_oficial             ← NOT_AVAILABLE_MVP
representantes_legales     ← NOT_AVAILABLE_MVP
numero_empleados           ← NOT_AVAILABLE_MVP
```

---

## 4. Implicaciones para producto / UX

### Lo que SellUp puede prometer para Perú MVP

- ✅ Universo de 851,883 empresas activas habidas
- ✅ Identidad legal verificada (RUC + estado + condición)
- ✅ Filtro por región geográfica (departamento / provincia / distrito)
- ✅ Sector estimado con indicador de confianza
- ✅ Validación de existencia antes de crear candidato en HubSpot

### Lo que SellUp NO puede prometer para Perú MVP

- ❌ Filtro preciso por sector / industria usando CIIU oficial
- ❌ Segmentación sectorial auditable con fuente citable
- ❌ Representantes legales o contactos
- ❌ Tamaño de empresa (empleados / ingresos)

### Recomendación de comunicación al usuario

Agregar nota visible en la configuración de discovery Perú:

> **Perú — Disponibilidad de sector:** El sector de las empresas peruanas se estima mediante inferencia de IA a partir de la razón social y búsqueda web. No existe una fuente oficial de clasificación sectorial (CIIU) operativa para esta versión. Los candidatos deben ser revisados por un humano antes de su conversión, especialmente si el sector es un criterio crítico del ICP.

---

## 5. Próximo hito recomendado

**Perú.4 — Activar discovery Perú con sector inferido**

**Alcance:**
1. Conectar `pe_sunat_bulk` en `SOURCE_DISCOVERY_REGISTRY` y `source-discovery-preflight`
2. Implementar pipeline de inferencia sectorial con `confidence_label: sector_inferred`
3. Agregar badge "inferido" en UI de ficha de candidato Perú
4. Bloquear o advertir en filtros de sector Perú (no criterio duro)
5. Documentar limitación de sector en la configuración de discovery Perú

**Fuera de alcance de Perú.4:**
- No activar Migo como fuente masiva
- No resolver CIIU oficial
- No evaluar ApiDni.com aún (hito separado)

**Hito post-MVP recomendado (Perú.CIIU.1 o similar):**
- Evaluar ApiDni.com con spike real (10–20 RUCs)
- Si confirma CIIU → implementar enriquecimiento CIIU privado
- Si falla → evaluar siguientes candidatos (Latinfo, otros)

---

## 6. Confirmaciones de seguridad operativa

| Confirmación | Estado |
|---|---|
| No se activó Perú en discovery | ✅ |
| No se tocó `SOURCE_DISCOVERY_REGISTRY` | ✅ |
| No se tocó `source-discovery-preflight` | ✅ |
| No se tocó el wizard | ✅ |
| No se llamó Migo | ✅ |
| No se llamó SUNAT | ✅ |
| No se llamó Tavily | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos | ✅ |
| No se tocó INAPI | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| No se creó código productivo | ✅ |
| No se instalaron dependencias | ✅ |
| Solo documentación creada/actualizada | ✅ |

---

## 7. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `docs/PERU_MVP_SOURCE_STRATEGY.md` | **Creado** — este documento (gate Perú.3O) |
| `AUDITORIA-FUENTES-IA.md` | **Actualizado** — sección Perú.3O agregada |
| `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md` | **Actualizado** — nota MVP strategy en sección Perú §10 |
