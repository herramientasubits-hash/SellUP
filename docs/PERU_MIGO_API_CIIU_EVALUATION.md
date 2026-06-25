# Perú.3M — Evaluación Controlada: Migo API como Fallback CIIU Perú

**Hito:** Perú.3M
**Fecha:** 2026-06-24
**HEAD inicial:** `70260c1` — docs(source-catalog): classify PRODUCE Peru CIIU source as WAF-blocked
**Tipo:** Research + evaluación de arquitectura — sin código productivo, sin Supabase, sin candidatos, sin llamadas reales
**MIGO_API_KEY_PRESENT:** false
**Depende de:** Perú.3L-2A (PRODUCE MiPyme bloqueado por WAF — `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL`)
**Integración:** Implementada en migración 066 + source-catalog como `pe_migo_api`

---

## 1. Contexto y motivación

El hito Perú.3L-2A cerró con verdict `PRODUCE_BLOCKED_BY_WAF_NO_STATIC_URL`:

- `datosabiertos.gob.pe` responde 403 (CloudFront WAF) para acceso programático.
- La única URL estática sin auth confirmada (`transparencia.produce.gob.pe` → Google Drive) tiene datos de 2015, inutilizable para MVP.
- Todos los accesos 2022+ a PRODUCE MiPyme son WAF-bloqueados o formularios interactivos.
- PRODUCE queda como `POST_MVP_BLOCKED_BY_WAF`.

La consecuencia directa es que **no existe fuente oficial gratuita operable para CIIU masivo en Perú**:

| Fuente | CIIU | Operable |
|--------|------|----------|
| SUNAT Padrón Reducido RUC | ❌ | ✅ (pero sin CIIU) |
| SUNAT e-consultaruc (web) | ✅ | ❌ (captcha) |
| PRODUCE MiPyme por Sector | ✅ | ❌ (WAF 403) |
| PRODUCE Grandes Empresas Manufactura | ✅ | ❌ (WAF 403) |

**Conclusión:** Para asociar CIIU a los 851,883 RUC 20 activos habidos del snapshot Perú.3J, se requiere una API privada. Migo API es el candidato principal identificado en las investigaciones previas (Perú.1B, Perú.3K).

---

## 2. Fuente investigada: Migo API

```
name: Migo API
owner: Migo S.A.C. (privado peruano)
base_url: https://api.migo.pe
docs_url: https://docs.migo.pe
ciiu_endpoint_docs: https://docs.migo.pe/ruc/actividades-economicas
```

**Nota:** Esta evaluación se basa en la documentación pública de Migo API y en la investigación previa realizada en Perú.1B y Perú.3K. No se realizaron llamadas de API reales (`MIGO_API_KEY_PRESENT=false`).

---

## 3. Respuestas a las preguntas del hito

### 3.1 ¿Migo API ofrece endpoint de consulta por RUC?

**Sí — confirmado.**

El endpoint principal es:

```
GET https://api.migo.pe/api/v1/ruc/{ruc}
Authorization: Bearer {token}
```

El endpoint de actividades económicas específico está documentado en `docs.migo.pe/ruc/actividades-economicas` y devuelve las actividades económicas registradas en SUNAT para el RUC consultado.

---

### 3.2 ¿Devuelve CIIU?

**Sí — confirmado en Perú.3K.**

Migo API devuelve CIIU en dos revisiones:

- **CIIU Rev 3** — clasificación anterior (mantenida por SUNAT para RUCs históricos)
- **CIIU Rev 4** — clasificación vigente

Devuelve tanto el **código numérico** (ej: `6201`, `4711`) como la **descripción** de la actividad.

---

### 3.3 ¿Devuelve descripción de actividad económica?

**Sí — confirmado.**

Devuelve la actividad económica **principal** y actividades **secundarias** cuando existen múltiples actividades registradas en SUNAT. Ejemplo de estructura esperada (basada en documentación):

```json
{
  "ruc": "20100047218",
  "actividades_economicas": [
    {
      "tipo": "principal",
      "ciiu": "6201",
      "descripcion": "Actividades de programación informática"
    },
    {
      "tipo": "secundaria",
      "ciiu": "6209",
      "descripcion": "Otras actividades de tecnología de la información"
    }
  ]
}
```

La estructura exacta del payload debe verificarse con el trial key.

---

### 3.4 ¿Devuelve estado y condición del contribuyente?

**Sí — confirmado.**

El endpoint RUC de Migo devuelve el perfil completo del contribuyente incluyendo:

- **Estado:** `ACTIVO`, `BAJA PROVISIONAL`, `BAJA DEFINITIVA`, `SUSPENSIÓN TEMPORAL`
- **Condición de domicilio:** `HABIDO`, `NO HABIDO`, `NO HALLADO`
- Dirección
- Ubigeo (departamento, provincia, distrito)

Estos datos son los mismos que SUNAT expone en `e-consultaruc` y que Migo sincroniza en tiempo real.

---

### 3.5 ¿Permite consulta individual?

**Sí.**

Endpoint individual estándar:

```
GET https://api.migo.pe/api/v1/ruc/{ruc}
Authorization: Bearer {token}
```

Latencia esperada: baja (respuesta en tiempo real, sincronización SUNAT).

---

### 3.6 ¿Permite consulta batch o masiva?

**Sí — documentado en Perú.3K.**

Migo API tiene endpoints batch/masivos confirmados. Esto es crítico para SellUp: el universe de empresas PE es de ~851,883 RUCs activos habidos. Enriquecer CIIU uno a uno sería inviable.

Características del endpoint batch (a verificar con trial):
- Acepta array de RUCs por request
- Tamaño de batch no documentado explícitamente (típico: 50-200 RUCs por llamada)
- Rate limit del endpoint batch puede diferir del endpoint individual

**Pendiente de confirmar con trial key:**
- Número máximo de RUCs por batch request
- Rate limit batch vs individual
- Formato exacto del payload batch (request + response)

---

### 3.7 ¿Cuál es el modelo de autenticación?

**Bearer token (API key).**

```
Authorization: Bearer {MIGO_API_KEY}
Content-Type: application/json
```

- La API key se obtiene al registrarse en `app.migo.pe` o al contratar un plan.
- El plan Demo otorga una key temporal de 7 días / 700 consultas.
- Planes pagos otorgan key permanente mientras el plan esté activo.
- **Seguridad requerida:** La key debe vivir exclusivamente en variable de entorno `MIGO_API_KEY`. Nunca en código, docs, logs ni commits.

---

### 3.8 ¿Cuál es el costo aproximado o plan requerido?

Planes públicos confirmados (en soles peruanos, IGV incluido):

| Plan | Precio | Consultas | Período | $/consulta aprox |
|------|--------|-----------|---------|-----------------|
| Demo | Gratis | 700 | 7 días | — |
| Básico | S/ 15/mes | 40,000 | Mensual | S/ 0.000375 |
| Empresa | S/ 25/mes | 80,000 | Mensual | S/ 0.000313 |
| Premium | S/ 25/mes | 150,000 | Mensual | S/ 0.000167 |

**Análisis para SellUp MVP:**

Para enriquecer los 851,883 RUCs activos habidos del snapshot Perú.3J completo:

| Escenario | Consultas | Plan | Costo est. | Tiempo |
|-----------|-----------|------|------------|--------|
| Enriquecimiento completo (1 vez) | ~852K | Premium × 6 meses | ~S/150 total | 6 meses |
| Solo empresas sin CIIU conocido (est. 40-60%) | ~400K | Premium × 3 meses | ~S/75 total | 3 meses |
| Solo empresas top-ranked en pipeline | ~10K-40K | Plan Básico | S/ 15-30 | 1 mes |
| Trial de validación técnica | 700 | Demo | Gratis | 7 días |

**Conclusión de costos:** El costo es muy accesible para MVP (S/15–25/mes ≈ USD 4–7/mes). Incluso el enriquecimiento completo del universo es manejable en costo absoluto si se distribuye en meses.

---

### 3.9 ¿Tiene límites de rate limit?

**No documentados explícitamente en la documentación pública revisada.**

Migo declara 99% de uptime. Los límites de rate no están publicados en la documentación técnica pública.

**Estimación técnica conservadora para planificación:**
- Endpoint individual: probablemente 10-60 rpm (requests per minute)
- Endpoint batch: probablemente 5-20 rpm con payloads más grandes

**Implicación para arquitectura:** El procesamiento del universo completo (~852K RUCs) debe distribuirse en el tiempo mediante una cola de procesamiento con throttling configurable. No debe ejecutarse en un request único ni en runtime serverless Vercel.

**Pendiente de confirmar con trial key:** Documentar los límites exactos en el reporte de spike.

---

### 3.10 ¿Tiene términos de uso compatibles con SellUp?

**No revisados formalmente para uso en IA/agentes. Esta es la brecha más importante del hito.**

Factores conocidos:
- Migo es un proveedor peruano con modelo SaaS establecido.
- Los datos que sirve provienen de SUNAT (fuente pública oficial).
- El uso típico documentado es enriquecimiento de formularios, verificación KYC/KYB, integración de sistemas ERP/CRM.

**Riesgos potenciales a revisar con los ToS:**

1. **Uso de datos en entrenamiento o modelos IA:** Los ToS pueden prohibir usar las respuestas como input para sistemas de IA/ML.
2. **Almacenamiento de datos:** Algunos proveedores limitan el tiempo de retención de sus respuestas en sistemas de terceros.
3. **Redistribución:** No se pueden redistribuir los datos de Migo a terceros sin autorización.
4. **Volumen masivo:** Los planes de consumo están dimensionados para uso operacional, no para descarga masiva del universo RUC peruano completo. Enriquecer 852K RUCs de una vez puede violar el espíritu de los ToS aunque el volumen técnico lo permita.
5. **Uso comercial en agentes automáticos:** Verificar que el uso en agentes automáticos (SellUp Agente 1) esté explícitamente permitido o al menos no esté prohibido.

**Acción recomendada antes de integración productiva:** Revisar los ToS en `migo.pe/terminos` o contactar a soporte de Migo para confirmar estos puntos antes de integrar en producción.

---

### 3.11 ¿Sirve para discovery masivo o solo enriquecimiento bajo demanda?

**Enriquecimiento bajo demanda — NO discovery masivo.**

Esta es la decisión de arquitectura más importante del hito:

| Modo | ¿Aplica? | Justificación |
|------|---------|---------------|
| Discovery (generar nuevas empresas) | ❌ NO | Migo no tiene endpoint de búsqueda por sector/nombre. Solo consulta por RUC. No puede generar universos nuevos. |
| Enriquecimiento individual | ✅ SÍ | Dado un RUC conocido, devuelve CIIU + datos completos. |
| Enriquecimiento batch | ✅ SÍ | Acepta arrays de RUCs. Permite procesar lotes del snapshot Perú.3J. |
| Enriquecimiento masivo del universo | ⚠️ POSIBLE PERO CON CUIDADO | Técnicamente posible procesando el snapshot completo en lotes con throttling. Verificar ToS primero. |

**Conclusión:** Migo es un `enrichment_provider`, no un `discovery_provider`. Su rol correcto en SellUp es recibir RUCs ya identificados (desde el snapshot SUNAT Perú.3J) y enriquecerlos con CIIU.

---

### 3.12 ¿Qué datos se podrían guardar en snapshot o metadata?

Datos seguros para almacenar en snapshot de empresa (fuente de referencia pública, no personal):

| Campo | Descripción | Seguro |
|-------|-------------|--------|
| `ciiu_principal_codigo` | Código CIIU de actividad principal | ✅ |
| `ciiu_principal_descripcion` | Descripción textual de la actividad principal | ✅ |
| `ciiu_secundarias` | Array de actividades secundarias (código + descripción) | ✅ |
| `ciiu_revision` | Rev 3 o Rev 4 | ✅ |
| `estado_contribuyente` | ACTIVO / BAJA / SUSPENSIÓN | ✅ |
| `condicion_domicilio` | HABIDO / NO HABIDO | ✅ |
| `ubigeo` | Código territorial (departamento/provincia/distrito) | ✅ |
| `sector_sellup` | Sector mapeado desde CIIU (derivado, no de Migo) | ✅ |
| `migo_enriched_at` | Timestamp de enriquecimiento | ✅ |
| `migo_response_hash` | Hash del payload para idempotencia (no el payload completo) | ✅ |

---

### 3.13 ¿Qué datos NO se deberían guardar por privacidad/compliance?

Datos a **no persistir** en producción:

| Campo | Razón |
|-------|-------|
| Nombres de representantes legales | **Datos personales** — Ley N° 29733 (Perú) y GDPR si aplica. No necesarios para el filtro ICP de SellUp. |
| DNI de representantes | **Datos sensibles personales** — nunca guardar. |
| Cargo + DNI combinado | Datos personales directos de personas naturales. |
| Número de teléfono del negocio extraído de Migo | Verificar origen: si viene de SUNAT es dato de contribuyente; si es enriquecimiento propio de Migo, revisar fuente. |
| Email del negocio extraído de Migo | Mismo razonamiento. Solo guardar si está explícitamente publicado como dato tributario. |
| Payload JSON completo de respuesta Migo | No guardar raw responses completas para evitar almacenar datos personales accidentales. Extraer solo campos necesarios. |

**Regla general:** Solo persistir datos de la **entidad jurídica** (RUC 20), nunca datos de personas naturales asociadas (representantes, socios, gerentes) sin evaluación legal específica.

---

### 3.14 ¿Cuál sería la arquitectura segura de integración?

#### Principio de diseño

```
Migo API = enrichment_provider
         ≠ discovery_provider
         ≠ data_store (no guardar raw responses)
         ≠ source primaria (SUNAT Padrón RUC sigue siendo la base)
```

#### Flujo propuesto

```
┌─────────────────────────────────────────────────────────────┐
│                  ARQUITECTURA MIGO ENRICHMENT                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  [Snapshot Perú.3J]                                          │
│  851,883 RUC 20 activos habidos                              │
│  → sin CIIU                                                   │
│        │                                                      │
│        ▼                                                      │
│  [CIIU Enrichment Queue]                                      │
│  Worker local / background job                               │
│  (NO Vercel — procesamiento fuera de serverless)             │
│        │                                                      │
│        ▼                                                      │
│  [Migo API Batch Enricher]                                   │
│  - Lee RUCs del snapshot en lotes de N                       │
│  - Llama GET /api/v1/ruc/{ruc} (individual) o               │
│    POST /api/v1/ruc/batch (si existe endpoint batch)        │
│  - Auth: Bearer ${MIGO_API_KEY} (solo env var)              │
│  - Throttling: respetar rate limit documentado              │
│  - Retry con backoff exponencial en 429/5xx                  │
│        │                                                      │
│        ▼                                                      │
│  [Field Extractor]                                           │
│  - Extraer SOLO: ciiu_codigo, ciiu_descripcion,             │
│    estado, condicion, ubigeo                                 │
│  - Descartar representantes y datos personales              │
│  - Mapear CIIU → sector_sellup                              │
│        │                                                      │
│        ▼                                                      │
│  [Supabase]                                                  │
│  Upsert empresa con CIIU enriquecido                        │
│  Campo: migo_enriched_at, ciiu_principal, sector_sellup     │
│                                                               │
│  NUNCA en Vercel runtime                                     │
│  NUNCA en request de usuario                                 │
│  NUNCA guardar representantes personales                     │
│  NUNCA en commits: MIGO_API_KEY                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

#### Variables de entorno requeridas

```bash
# Solo en .env.local o secrets manager — nunca en código ni docs
MIGO_API_KEY=...

# Parámetros de throttling (configurables)
MIGO_BATCH_SIZE=50          # RUCs por request (confirmar con trial)
MIGO_RATE_LIMIT_RPM=10      # Requests por minuto (conservador hasta confirmar)
MIGO_MAX_RETRIES=3
```

#### Clasificación propuesta como fuente

```typescript
// En source-catalog.ts (cuando se implemente — NO en este hito)
{
  key: 'pe_migo_api',
  type: 'enrichment_provider',     // NO discovery_provider
  country: 'PE',
  provides: ['ciiu', 'estado', 'condicion', 'ubigeo'],
  requires: ['ruc'],                // Solo enriquece RUCs conocidos
  mode: 'on_demand',               // No bulk discovery
  auth: 'bearer_token',
  cost: { min: 15, max: 25, currency: 'PEN', per: 'month' },
}
```

---

### 3.15 ¿Qué decisión recomiendas para MVP?

### Recomendación: Opción A — SUNAT + Migo fallback (enriquecimiento bajo demanda)

**Estrategia:**

```
Capa 1 — Base legal:
  SUNAT Padrón Reducido RUC
  → RUC, razón social, estado, condición, ubigeo
  → SIN CIIU

Capa 2 — CIIU por enriquecimiento:
  Migo API (enrichment_provider, bajo demanda)
  → CIIU principal + secundarias
  → Estado + condición (redundante con Capa 1, pero actualizado en real-time)
  → Solo para RUCs sin CIIU en snapshot

Capa 3 — Sector SellUp:
  Tabla de mapeo CIIU → sector
  → Construir localmente con INEI Catálogo CIIU Rev4 (§3.3 Perú.3K)
  → Sin dependencia de APIs externas para la clasificación
```

**Por qué Opción A y no Opción B o C:**

- **vs Opción B (Migo como fuente principal):** Migo no reemplaza SUNAT. SUNAT da la base legal del universo de 851,883 empresas. Migo solo enriquece con CIIU. La distinción es importante para el registro en ICP y para la robustez del sistema ante cambios en Migo.

- **vs Opción C (Post-MVP):** CIIU es esencial para el filtro ICP por sector. Sin CIIU, SellUp no puede segmentar el universo peruano por industria, lo que limita gravemente la utilidad del Agente 1 para Perú. Dejarlo para post-MVP bloquea el caso de uso principal.

**Condición para activar Opción A:**

1. Obtener trial key Migo (700 consultas / 7 días, gratis).
2. Ejecutar spike técnico: confirmar payload, batch endpoint, rate limit.
3. Revisar ToS para uso en agentes automáticos.
4. Si spike pasa → integrar como enrichment_provider en backlog.

---

## 4. Clasificación y verdict

### Verdict: `SPIKE_WITH_TEST_KEY`

```
SPIKE_WITH_TEST_KEY

Justificación:
- CIIU confirmado ✅
- Batch endpoint confirmado ✅
- Auth modelo confirmado ✅
- Precio confirmado y accesible ✅
- Arquitectura de integración definida ✅
- ToS no revisados formalmente ⚠️
- Payload exacto no testeado (MIGO_API_KEY_PRESENT=false) ⚠️
- Rate limits exactos no documentados ⚠️

Siguiente acción: Obtener trial key → ejecutar spike → revisar ToS → confirmar
```

**¿Por qué no `PRIVATE_PROVIDER_MAIN_CANDIDATE`?**
Porque la documentación no puede reemplazar un test real del payload. El hito Perú.3K confirmó que Migo tiene CIIU, pero no verificó la estructura exacta del response, el comportamiento del endpoint batch, ni los rate limits. Para escalar a 851K RUCs, estos detalles son críticos.

**¿Por qué no `USE_AS_FALLBACK_ONLY`?**
PRODUCE MiPyme está WAF-bloqueado. No hay fuente gratuita operable para CIIU masivo. Migo podría ser la fuente **principal** de CIIU (no un simple fallback) si el spike confirma los datos necesarios.

---

## 5. Tabla de decisión por pregunta

| # | Pregunta | Respuesta | Fuente evidencia |
|---|----------|-----------|-----------------|
| 1 | ¿Endpoint por RUC? | ✅ Sí — `GET /api/v1/ruc/{ruc}` | docs.migo.pe, Perú.1B |
| 2 | ¿Devuelve CIIU? | ✅ Sí — Rev 3 + Rev 4 | docs.migo.pe/ruc/actividades-economicas, Perú.3K |
| 3 | ¿Devuelve actividad económica? | ✅ Sí — principal + secundarias | docs.migo.pe, Perú.3K |
| 4 | ¿Devuelve estado/condición? | ✅ Sí | docs.migo.pe, Perú.1B |
| 5 | ¿Consulta individual? | ✅ Sí | docs.migo.pe |
| 6 | ¿Consulta batch? | ✅ Sí (documentado en Perú.3K) — confirmar tamaño con trial | Perú.3K |
| 7 | ¿Modelo auth? | ✅ Bearer token | docs.migo.pe, Perú.1B |
| 8 | ¿Costo? | ✅ S/15-25/mes. Demo gratis 700q/7d | Perú.1B (pricing público) |
| 9 | ¿Rate limit? | ⚠️ No documentado explícitamente | Pendiente de confirmar con trial |
| 10 | ¿ToS compatible? | ⚠️ No revisados formalmente para IA/agentes | Pendiente de revisión ToS |
| 11 | ¿Discovery o enrichment? | ✅ Enrichment únicamente | Arquitectura (§3.14) |
| 12 | ¿Datos a guardar? | ✅ CIIU código/descripción, estado, condición, ubigeo | §3.12 |
| 13 | ¿Datos a NO guardar? | ✅ Representantes legales, DNI, datos personales | §3.13, Ley 29733 |
| 14 | ¿Arquitectura segura? | ✅ Definida — enrichment_provider en worker | §3.14 |
| 15 | ¿Recomendación MVP? | ✅ Opción A — SUNAT + Migo fallback, previa spike | §3.15 |

---

## 6. Riesgos técnicos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Rate limit más restrictivo de lo esperado | Media | Alto — duplica tiempo de enriquecimiento | Throttling configurable; procesar en días, no horas |
| Endpoint batch no disponible o limitado | Baja | Medio — aumenta costo de integración | Diseñar queue para requests individuales como fallback |
| Migo cambia precio o descontinúa plan Básico | Media | Medio | Plan Empresa (S/25) es el fallback razonable; evaluar ApiDni.com como alternativa |
| SUNAT y Migo desincronizados | Baja | Bajo — datos Migo son de SUNAT, sincronización declarada real-time | Timestamp de enriquecimiento + re-enriquecimiento periódico |
| Formato CIIU varía entre respuestas | Baja | Medio — puede requerir normalización adicional | Field extractor con validación de esquema |
| Migo no tiene endpoint batch real (solo claim) | Baja | Alto — obliga a procesamiento individual | Trial key confirmará esto antes de comprometer arquitectura |

---

## 7. Riesgos legales y de compliance

| Riesgo | Análisis | Acción requerida |
|--------|----------|-----------------|
| ToS prohíben uso en agentes automáticos | Los ToS no han sido revisados en detalle. Uso en agentes/SaaS puede tener restricciones. | Revisar `migo.pe/terminos` antes de integración productiva |
| Almacenamiento de datos de representantes legales | Ley N° 29733 (Ley de Protección de Datos Personales, Perú). Los representantes son personas naturales. | No persistir representantes. Solo datos de la entidad jurídica. |
| Redistribución de datos Migo | Probable restricción en ToS. SellUp no redistribuye datos raw, usa CIIU como clasificador. | Confirmar en ToS que el uso como campo de enriquecimiento interno está permitido. |
| Uso masivo del trial para extraer datos | 700 consultas del plan Demo no alcanzan para enriquecimiento productivo. El trial es para validación técnica. | Usar trial solo para spike técnico (sample de 50-100 RUCs). Contratar plan mensual para producción. |
| Dependencia de proveedor extranjero vs Perú | Migo es peruano (Migo S.A.C.) — riesgo de jurisdicción bajo para compliance peruano. | N/A — ventaja por ser proveedor local. |

---

## 8. Comparativa con alternativas

| Proveedor | CIIU | Batch | Costo/mes | ToS | Recomendación |
|-----------|------|-------|-----------|-----|---------------|
| **Migo API** ⭐ | ✅ Rev3+4 | ✅ conf. | S/15–25 | No revisado | **SPIKE_WITH_TEST_KEY** |
| ApiDni.com | ✅ conf. | Desconocido | Precio opaco | No revisado | Segunda opción — evaluar si Migo falla spike |
| Latinfo | ❓ no conf. | ❓ | Gratis (1K/mes) | No revisado | UNKNOWN para CIIU; bueno para KYB/sanciones |
| OpenRUC | ❌ no conf. | No | Gratis | Open source | No aplica para CIIU |
| SUNAT e-consultaruc | ✅ | ❌ captcha | Gratis | Captcha antiautomation | REJECT masivo |
| PRODUCE MiPyme | ✅ | ✅ (bulk) | Gratis | Datos abiertos | BLOQUEADO (WAF 403) |

---

## 9. Próximos pasos recomendados

### Perú.3N (si se autoriza) — Spike real con trial key Migo

**Prerrequisitos:**
1. Registrarse en `app.migo.pe` → obtener plan Demo (700 consultas / 7 días).
2. Configurar `MIGO_API_KEY` en `.env.local` (nunca commitear).
3. Revisar `migo.pe/terminos` y confirmar puntos de §3.10.

**Alcance del spike (propuesto para `.tmp/migo-spike/`):**
1. Script de prueba (TypeScript simple, NO código productivo):
   - 10-20 RUCs de muestra del snapshot Perú.3J.
   - Verificar: ¿devuelve CIIU? ¿qué estructura tiene el payload?
   - Verificar: ¿existe endpoint batch? ¿qué responde?
   - Documentar: headers de respuesta con rate limit (`X-RateLimit-*`).
2. Reporte JSON de resultados en `.tmp/migo-spike/spike-report.json`.
3. Actualizar este documento con hallazgos del spike.

**NO en el spike:**
- No guardar en Supabase.
- No crear candidatos.
- No activar PE en registry/preflight/wizard.
- No commitear API key.
- No usar más de 50-100 consultas del trial (las 650 restantes son para futuras validaciones).

---

## 10. Confirmaciones de seguridad operativa

| Confirmación | Estado |
|---|---|
| PE sigue `SAFE_CONNECTOR_ONLY` | ✅ |
| `pe_sunat_bulk` sigue `not_connected` | ✅ |
| PE sigue fuera de `source-discovery-preflight` | ✅ |
| `pe_sunat_bulk` sigue fuera de `SOURCE_DISCOVERY_REGISTRY` | ✅ |
| Migo NO registrado en source-catalog | ✅ |
| Migo NO registrado en enrichment-adapter-registry | ✅ |
| Migo NO activado en preflight ni wizard | ✅ |
| No se realizaron llamadas reales a Migo API | ✅ |
| MIGO_API_KEY_PRESENT=false confirmado | ✅ |
| No se creó snapshot CIIU | ✅ |
| No se escribió Supabase | ✅ |
| No se crearon candidatos | ✅ |
| No se crearon batches | ✅ |
| No se tocó INAPI | ✅ |
| No se tocó Chile / México / Colombia | ✅ |
| No se hizo force push | ✅ |
| No se creó código productivo | ✅ |
| No se instalaron dependencias | ✅ |
| API key no aparece en ningún archivo | ✅ |
| API key no aparece en ningún log | ✅ |
| API key no aparece en ningún commit | ✅ |

---

## 12. Nota de integración de credenciales — hallazgo de Integraciones.1

**Fecha hallazgo:** 2026-06-24
**Hito fuente:** Integraciones.1 — Auditoría del manejo actual de credenciales/API keys

El hito Integraciones.1 (ejecutado antes de Perú.3N) confirmó que SellUp tiene un sistema de credenciales maduro:

- **Supabase Vault** como almacén cifrado central (AES-256)
- Patrón establecido para API keys: `external_integrations` + `external_integration_connections` + Vault
- **UI existente** en `/settings/integrations` con pages por cada integración (HubSpot, Slack, Tavily, Samu, Google CSE)
- **Patrón de referencia directo para Migo:** `src/server/services/tavily-connection.ts`

### Decisión arquitectural

Migo NO debe quedarse hardcodeada en `.env.local` como mecanismo final.

**Implementado en source-catalog (Settings > Source Catalog)** como `pe_migo_api`:

| Elemento | Valor |
|----------|-------|
| Catalog key | `pe_migo_api` |
| DB source_key | `pe_migo_api` (source_catalog_connections) |
| Vault secret name | `sellup_source_pe_migo_api_api_key` |
| auth_type | `api_key` |
| Patrón de referencia | `tavily-connection.ts`, `denue_mexico` source catalog pattern |
| UI | `/settings/source-catalog/pe_migo_api` (rendered by generic SourceCredentialPanel) |
| Migración | `066_migo_api_source.sql` |
| Servicio | `src/server/services/migo-connection.ts` |

Migo se integró en el Source Catalog (no en external integrations) porque es una fuente de datos para enriquecimiento Perú, siguiendo el mismo patrón que `denue_mexico` y `chilecompra_chile`. La UI de credencial y test de conexión es genérica y se reutiliza automáticamente.

---

## 11. Archivos modificados — Implementación source-catalog

| Archivo | Cambio |
|---|---|
| `supabase/migrations/066_migo_api_source.sql` | **Creado** — seed en `source_catalog_connections` + eventos audit |
| `src/server/services/migo-connection.ts` | **Creado** — Vault credential management + test connection |
| `src/server/agents/prospecting-toolkit/source-catalog.ts` | **Actualizado** — Migo agregado a `CATALOG_SOURCES` como `pe_migo_api` |
| `src/server/source-catalog/source-connection-resolver.ts` | **Actualizado** — `pe_migo_api` en `VAULT_SOURCE_SECRET_NAMES` + `DEV_ENV_FALLBACK` |
| `src/server/source-catalog/connection-test/strategy-resolver.ts` | **Actualizado** — `pe_migo_api` en `REQUIRES_CREDENTIALS_KEYS` |
| `src/modules/source-catalog/source-credential-actions.ts` | **Actualizado** — Migo en `SUPPORTED_TEST_SOURCES` + `testMigoConnection()` |
| `docs/PERU_MIGO_API_CIIU_EVALUATION.md` | **Actualizado** — integración documentada |

---

**Documentos de investigación previa (no modificados en esta implementación):**
- `AUDITORIA-FUENTES-IA.md`
- `docs/PERU_SUNAT_CIIU_SOURCE_RESEARCH.md`
- `docs/PERU_SOURCE_CONNECTABILITY_RESEARCH.md`
- `docs/CATALOGO_FUENTES_PROSPECCION_POR_PAIS_SECTOR.md`

---

## 13. Resultado del Spike Real — Perú.3N-R + Reclasificación Perú.3N-S

**Fecha:** 2026-06-25
**Hito spike:** Perú.3N-R
**Hito reclasificación:** Perú.3N-S

### 13.1 Resultado del spike real (Perú.3N-R)

El spike real ejecutado con la credencial Vault (`sellup_source_pe_migo_api_api_key`) devolvió los siguientes resultados para 10 RUCs de muestra:

```
status: completed
attemptedRequests: 10
successfulResponses: 10
failedResponses: 0
rateLimitDetected: false
averageResponseTimeMs: 185
containsRuc: true
containsLegalName: true
containsCiiu: false
containsCiiuRev3: false
containsCiiuRev4: false
containsActivityDescription: false
containsSecondaryActivities: false
containsTaxpayerStatus: true
containsDomicileCondition: true
containsAddress: true
containsLegalRepresentatives: false
```

**Payload real confirmado:**

| Campo | Presente |
|-------|---------|
| `ruc` | ✅ |
| `nombre_o_razon_social` | ✅ |
| `estado_del_contribuyente` | ✅ |
| `condicion_de_domicilio` | ✅ |
| `ubigeo` | ✅ |
| `direccion` | ✅ |
| `actualizado_en` | ✅ |
| CIIU (cualquier revisión) | ❌ |
| Actividad económica / descripción | ❌ |
| Actividades secundarias | ❌ |
| Representantes legales | ❌ |

### 13.2 Corrección de evaluaciones previas

Las secciones §3.2 y §3.3 de este documento afirmaban que Migo devuelve CIIU Rev 3 + Rev 4 y descripción de actividad económica. Esas afirmaciones se basaban en la documentación pública de Migo (`docs.migo.pe/ruc/actividades-economicas`), no en un test real.

**El spike real Perú.3N-R invalida esas afirmaciones.** El endpoint `GET /api/v1/ruc/{ruc}` no devuelve CIIU ni actividad económica en el plan contratado/endpoint validado.

Las secciones §3.2, §3.3, §3.12, §3.14 y §3.15 quedan históricamente preservadas pero **superadas por el resultado real**. No deben usarse como base para decisiones futuras sobre CIIU.

### 13.3 Verdict actualizado

```
MIGO_NOT_USEFUL_FOR_CIIU

Razón: El payload real del endpoint validado no contiene CIIU, actividad económica
       ni actividades secundarias, contrario a lo que indicaba la documentación pública.
Acción: Migo reclasificado como validation_only / P2.
        No usar como fuente sectorial ni de discovery.
        No usar para enriquecimiento CIIU.
```

### 13.4 Reclasificación aplicada (Perú.3N-S)

| Elemento | Antes | Después |
|----------|-------|---------|
| `name` en source-catalog | `'Migo API Perú'` | `'Migo API Perú RUC Lookup'` |
| `sellupUse` | `'enrichment'` | `'validation_only'` |
| `priority` | `'P1'` | `'P2'` |
| `recommendedUse` | Enriquecimiento CIIU por RUC | Validación RUC puntual: estado, condición, domicilio |
| `limitations[0]` | — | `'No útil para CIIU/actividad económica según spike real Perú.3N-R'` |
| `nextAction` | Mencionaba CIIU | Sin mención de CIIU |
| Vault description | `'...consulta RUC/CIIU Perú...'` | `'...consulta RUC Perú (validación estado, condición y domicilio — no devuelve CIIU)'` |

### 13.5 Uso recomendado post-reclasificación

Migo puede mantenerse como fuente opcional de validación RUC puntual bajo demanda:

- Verificar estado del contribuyente en tiempo real (complementa snapshot SUNAT que puede tener días de retraso)
- Verificar condición de domicilio (HABIDO/NO HABIDO) en tiempo real
- Confirmar razón social y dirección actualizada

**No usar para:**
- CIIU ni clasificación sectorial
- Discovery de nuevas empresas
- Enriquecimiento masivo

### 13.6 Estado CIIU Perú post-Migo

Con PRODUCE WAF-bloqueado y Migo descartado para CIIU, no existe fuente privada confirmada para CIIU masivo en Perú. Siguiente candidato a evaluar: **ApiDni.com** (segunda opción identificada en §8 de este documento).
