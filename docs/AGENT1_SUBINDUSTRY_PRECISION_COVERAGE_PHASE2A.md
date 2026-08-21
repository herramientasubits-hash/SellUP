# AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2A

## Subindustry key resolution hardening

**Estado:** PR abierto, NO mergeado.
**Alcance:** sólo RESOLUCIÓN de identidad. 0 mappings nuevos, 0 migraciones, 0 escrituras en
Producción, 0 llamadas a proveedor, 0 créditos.
**Cobertura de precisión:** 2/73 antes · **2/73 después**.

---

## 1. Root cause

### Dónde estaba

`src/server/agents/prospecting-toolkit/apollo-subindustry-precision.ts`, función privada
`resolveSubindustryKey`:

```ts
function resolveSubindustryKey(subindustry: string | null | undefined): string | null {
  if (!subindustry?.trim()) return null;
  const normalized = normalize(subindustry);
  for (const key of Object.keys(SUBINDUSTRY_ANCHOR_TERMS)) {
    if (normalized.includes(key) || key.includes(normalized)) return key;
  }
  return null;
}
```

El comentario que la acompañaba declaraba la laxitud como intencional: «coincidencia
bidireccional por inclusión, igual que el gate sectorial, para que “Supermercados e
Hipermercados (Colombia)” resuelva a la misma clave».

### Conducta documentada ANTES de tocar nada

Normalización: `toLowerCase` → `normalize('NFD')` → borrado de `\p{M}` → colapso de `\s+` →
`trim`. La puntuación NO se normaliza.

| Camino | Expresión | Conducta medida |
|---|---|---|
| Exacto canónico | igualdad implícita | resuelve |
| Substring **forward** | `normalized.includes(key)` | resuelve — «supermercados e hipermercados extra», «Supermercados e Hipermercados (Colombia)», «Retail — Supermercados e Hipermercados» |
| Substring **reverse** | `key.includes(normalized)` | resuelve — **cualquier substring de una clave**, incluidas cadenas de UNA letra |
| Alias | no existe | ninguno: la precisión no tenía alias |
| Fallback | ninguno | `null` |

**Medición read-only sobre `origin/main` = `4c9e6168`** (script puro, sin proveedor, sin DB).
Estas 12 etiquetas devolvían `subindustryMapped: true`:

```
"a"  "e"  "s"  "o"  "y"  "de"  "por"
"super"  "mercados"  "moda"  "calzado"  "departamento"
```

`"a"`, `"e"`, `"s"`, `"o"` y `"de"` resolvían a **«Supermercados e Hipermercados»**; `"moda"`,
`"calzado"`, `"departamento"` y `"por"` a **«Tiendas por Departamento, Moda y Calzado»**. El
ganador no lo decidía una regla: lo decidía el orden de `Object.keys`.

### Por qué es inseguro, y por qué corregirlo ANTES de ampliar

`subindustryMapped` no es un campo de diagnóstico. Cambia el desenlace del candidato:

- `confirmed` bajo una política heredada **cuenta hacia el objetivo** (PR #251,
  `evaluateCandidateTargetEligibility`);
- `rejected` por una industria declarada contradictoria de OTRA subindustria **deja de
  persistir** el candidato;
- `foldSubindustryPrecisionIntoSectorState` devuelve `base` sólo mientras
  `!subindustryMapped`, así que mapear mueve además la asignación de los 5 enrichments.

Con 2 claves largas el daño está acotado a etiquetas que hoy nadie envía: el wizard manda
nombres canónicos exactos, y de las 73 subindustrias del catálogo activo exactamente 2
resuelven. Con las claves cortas de la Ola 1 —`banca tradicional`, `agritech`, `insurtech`,
`legaltech`— la colisión pasa a ser la norma: `"banca"`, `"tech"`, `"legal"`, `"a"`
resolverían a subindustrias reales y arbitrarias. Por eso esta corrección va antes de la
Ola 1 y no después.

### Call sites

`resolveSubindustryKey` es privada y tiene un único llamador:
`assessSingleRequestedSubindustry`, que a su vez sólo se alcanza por
`assessApolloSubindustryPrecisionForRequest` (ANY-OF) y por la firma histórica de una sola
subindustria `assessApolloSubindustryPrecision`. Consumidores de esos dos:

- `apollo-two-round/production-runner.server.ts` (el runner que decide gasto y admisión);
- las suites de PR #234/#238/#241/#245/#246/#251/#256/#262.

No hay ningún otro punto del repositorio que resuelva identidad de subindustria para
PRECISIÓN.

---

## 2. Contrato nuevo

`src/server/agents/prospecting-toolkit/apollo-subindustry-key-resolution.ts`.

La identidad se resuelve **sólo** por, en este orden:

1. `subindustryId` exacto;
2. nombre canónico normalizado **exacto**;
3. alias **explícito** normalizado **exacto**, y sólo si no es ambiguo;
4. `null`.

Prohibido: substring implícito, prefijo, sufijo, contención bidireccional, token parcial
como identidad, fuzzy matching.

| Camino | Antes | Después |
|---|---|---|
| `subindustry_id` exacto | no soportado | resuelve (`matchedBy: 'subindustry_id'`) |
| Canónico exacto | resuelve | resuelve |
| Alias explícito exacto | no soportado | resuelve si es inequívoco |
| Substring forward | **resuelve** | **no resuelve** |
| Substring reverse | **resuelve** | **no resuelve** |
| Fuzzy / tipeo / plural | no | no |
| Sin coincidencia | `null` | `null`, fail-closed |

Dos decisiones que merecen nombre propio:

- **un `subindustryId` desconocido NO degrada a búsqueda por etiqueta.** El id es la
  identidad fuerte; aceptar la etiqueta después de que el id falle sería dejar que la forma
  débil contradiga a la fuerte.
- **un alias declarado por dos entradas no resuelve.** No se escoge ganador (§ 5).

---

## 3. Normalización

Se reutiliza la existente, extraída a `normalizeSubindustryIdentity` y consumida también por
`apollo-subindustry-precision.ts`, para que exista **una sola**: case folding, Unicode NFD,
borrado de marcas diacríticas, colapso y recorte de espacios.

La **puntuación no se normaliza**, y es deliberado: el contrato vigente tampoco lo hacía, y
quitar la coma de «Tiendas por Departamento, Moda y Calzado» sería introducir una
equivalencia nueva — justo la laxitud que esta fase elimina.

El espacio de no separación (U+00A0) entra en `\s` y por tanto colapsa como cualquier otro
espacio. No es una equivalencia nueva: es la normalización de espacios que el contrato ya
declaraba.

---

## 4. Aliases — auditoría y decisión

**Fuente de verdad:** `public.subindustry_aliases`, expuesta como
`public.active_subindustry_aliases` con `catalog_version_id`. Lectura de solo lectura del
2026-08-11: **127 alias sobre 39 de las 73 subindustrias**, catálogo `1.0.0`,
`catalog_version_id` `e4675daf-65a2-5e26-8640-58f1aeaee5ed` (única versión publicada).

**Cómo se consumen hoy:** por nadie, para precisión. La precisión recibe una **etiqueta de
texto** y nada más — no sabe qué versión del catálogo resolvió la selección del wizard.

**Decisión de Phase 2A: NO se conectan.** Motivos, en orden de peso:

1. **Versionado.** Los alias se publican con `catalog_version_id` y pueden cambiar sin
   despliegue. Conectarlos sin esa versión crearía una segunda fuente de verdad —
   exactamente lo que el CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 eliminó del lado de
   discovery— y un snapshot estático duplicado, que está prohibido.
2. **Cambio de arquitectura.** Haría falta un loader versionado y propagar la resolución
   hasta el evaluador de precisión. Eso es Phase 2B, no resolución.
3. **No es neutro.** `Banca Tradicional` declara los alias `banco` y `bank`;
   `Fintech: Infraestructura y Pagos` declara `fintech`; `Institutos Técnicos y
   Vocacionales` declara `SENA`, `OTEC`, `SENATI`, `CONALEP`. Admitirlos como identidad es
   admitir etiquetas de una sola palabra genérica — la misma clase de entrada que esta fase
   acaba de dejar fuera. La promoción debe decidirse **alias por alias**.

Phase 2A resuelve por tanto **únicamente claves canónicas exactas**. El registro de identidad
declara `explicitAliases: []` para las dos subindustrias mapeadas, y eso no es un pendiente:
es la declaración de que hoy sólo el canónico resuelve. El fixture congelado
`__tests__/fixtures/sellup-subindustry-catalog-aliases.ts` existe **sólo** para la auditoría
de colisiones; ningún módulo de `src/` lo importa.

---

## 5. Auditoría de colisiones (read-only)

`auditSubindustryIdentityCollisions` — pura, sin DB. Sobre las 73 etiquetas canónicas + los
127 alias, tras normalizar:

| Clase | Resultado |
|---|---|
| `canonical_collisions` | **0** |
| `alias_canonical_collisions` | **0** |
| `alias_alias_collisions` | **0** |
| `ambiguous_aliases` | **0** |

Es un **hecho sobre esta lectura del catálogo `1.0.0`**, no una promesa sobre el catálogo
futuro — por eso la auditoría existe como función y corre en CI, y por eso el resolver trata
cualquier alias ambiguo como «no resuelve» en vez de confiar en que no habrá ninguno.

Un alias igual al canónico de **su propia** subindustria es redundancia inofensiva, no
colisión. Un alias igual al canónico de **otra**, o compartido por dos, es ambiguo y no puede
identificar nada.

---

## 6. Los dos mappings existentes

Preservados exactamente. **No se tocaron**: anchors, `SUBINDUSTRY_ANCHOR_FAMILIES`, negative
signals (`EXCLUSIVE_BUSINESS_MODEL`), conflict signals, broad signals, contradictions,
precedencia del ANY-OF (`confirmed > ambiguous > rejected`), semántica ANY-OF, folding
(`foldSubindustryPrecisionIntoSectorState`), caps 2/5/25.

Este PR cambia **sólo** resolución. Verificado por las 8 suites de contrato listadas en
§ 15, todas verdes sin editar una sola aserción existente.

---

## 7. Ámbito NO tocado, y por qué se declara

`matchesApolloSubindustryAlias` (`apollo-subindustry-search-mapping.ts`) resuelve
**DISCOVERY**, no precisión: decide qué términos de búsqueda viajan a Apollo y si existe algo
que buscar. Ya fue endurecido por QUERY-QUALITY-2-FIX § 8 y **no** usa substring: empareja por
igualdad normalizada o por alias de dos o más palabras presente como **secuencia completa de
tokens**, y un alias de una sola palabra sólo empareja por igualdad.

Esa contención por secuencia de tokens **sigue en pie** en este PR, deliberadamente:

- no decide admisión ni objetivo — un candidato hallado así sigue con
  `subindustryMapped: false` y `countsTowardTarget: false` salvo que la precisión lo reconozca
  por separado;
- endurecerla haría que «Grocery Retail B2B» dejara de resolver y el gate de cobertura
  bloquearía antes de gastar. Es la dirección segura, pero es un cambio de conducta de
  DISCOVERY con fixtures propios que lo declaran intencional, y queda fuera del alcance
  declarado de esta fase (§ 16, no scope creep).

**Registrado para decisión del owner**, no resuelto aquí: si Phase 2B promueve alias del
catálogo a identidad de precisión, conviene revisar a la vez si discovery debe pasar también a
igualdad exacta, para que las dos capas usen el mismo contrato de identidad.

---

## 8. Interfaz para Phase 2B

`SubindustryPrecisionPhase2BInput` — tipo, sin consumidor. Ni loader, ni esquema nuevo, ni
lectura de reglas de precisión en runtime.

```ts
type SubindustryPrecisionPhase2BInput = {
  subindustryId: string | null;      // public.subindustries.id — identidad fuerte
  canonicalName: string;
  explicitAliases: readonly string[]; // APROBADOS uno a uno, no el volcado del catálogo
  catalogVersionId: string | null;    // sin ella no hay alias runtime
};
```

El resolver ya consume esa forma: `resolveSubindustryPrecisionIdentity` acepta
`{ subindustryId, label }` y un registro con `explicitAliases`, así que Phase 2B añade datos y
un loader versionado, no una firma nueva.

---

## 9. CONFIRM_ONLY — contrato de diseño para Phase 2C

**Documentado, NO implementado.** No hay tipo, no hay flag y no hay caller: los mappings
actuales no cambian de conducta en ningún punto.

Para un mapping NUEVO declarado con `mode='confirm_only'` en su primera ventana:

| Veredicto | Efecto operativo | Efecto diagnóstico |
|---|---|---|
| `confirmed` | **CONFIRMED operativo** — cuenta hacia el objetivo si el resto del contrato de completitud pasa | sí |
| `ambiguous` | **ninguno** — no produce ambigüedad operativa, no altera la prioridad de enrichment | sólo diagnóstico |
| `rejected` | **ninguno** — no produce rechazo operativo, no impide persistir | sólo diagnóstico |
| `unmapped` / `unavailable` | sin cambios | sin cambios |

**Por qué.** Mapear una subindustria nueva no es neutro (Phase 1 § 6): al mapear,
`foldSubindustryPrecisionIntoSectorState` deja de devolver `base`, así que `rejected` pasa a
impedir la persistencia y `ambiguous` mete al candidato a competir por uno de los 5
enrichments. Los topes 2/5/10/20/25 no se mueven, pero la **asignación** sí.
`confirm_only` deja entrar el beneficio —confirmaciones nuevas que cuentan— sin exponer una
subindustria recién escrita a decidir exclusiones con vocabulario sin calibrar.

---

## 10. Formación Corporativa — decisión comercial

**Fuera de la Ola 1 de auto-confirm, por ahora.**

**Motivo:** el catálogo la identifica como **competencia / referente de UBITS**. Promoverla a
auto-confirm haría que Agente 1 empujara competidores hacia el objetivo por diseño.

Nombre canónico real en el catálogo activo: **«Formación Corporativa y Corporate Training»**
(alias publicados: `capacitación empresarial`, `corporate training`, `formación in-company`).
Es, además, la segunda subindustria más pedida en la telemetría read-only de Phase 1
(13 menciones en `provider_usage_logs`) y no tiene mapping — de ahí la tentación de ponerla
primera.

Se mantiene:

| Capacidad | Estado |
|---|---|
| `searchable` | **sí** — sin cambios |
| `reviewable` | **sí** — sin cambios |
| precision auto-confirm de mapping nuevo | **no** |
| promoción a objetivo desde mapping nuevo | **no** |

**No** se cambia el catálogo, **no** se cambia la UI y **no** se sustituye artificialmente por
otra subindustria para conservar una ola de 10: **la Ola 1 propuesta pasa de 10 a 9.**

Ola 1 (9): Banca Tradicional · Farmacias Cadena y Retail de Salud · Medicina Prepagada y EPS ·
Universidades e Institutos Privados · Ciberseguridad · Redes Hospitalarias y Clínicas ·
Laboratorios Clínicos y Diagnóstico · Fabricantes de Alimentos y Bebidas (FMCG) · Escuelas de
Negocios y Formación Ejecutiva ⇒ **11/73**.

---

## 11. Seguridad

| Superficie | Este PR |
|---|---|
| Llamadas Apollo | 0 |
| Llamadas Tavily | 0 |
| Llamadas Lusha | 0 |
| Escrituras en Producción | 0 |
| Escrituras HubSpot | 0 |
| Migraciones | 0 |
| Créditos consumidos | 0 |
| Flags activados | 0 |
| Lecturas de Prod | solo `SELECT` (catálogo de alias, para congelar el fixture) |
| Agente 2A | intacto |
