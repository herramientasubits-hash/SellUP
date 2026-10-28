-- =============================================================================
-- Empresas con país y código de país que no coinciden (read-only)
-- =============================================================================
--
-- Propósito
--   Encontrar empresas como Sencia: `country = 'Colombia'` pero `country_code = 'IN'`.
--   La lista de Empresas pinta la bandera con `country_code` y la ficha muestra
--   `country`, así que la misma empresa aparece con dos países.
--
-- Causa (ya corregida en el código)
--   mapHubSpotCompanyProfile tomaba el nombre del «País» de UBITS (`pais`) y el
--   código de `hs_country_code`, que llena HubSpot por su cuenta. Ahora el código
--   sale del mismo nombre. Las empresas ya creadas conservan el dato viejo.
--
-- Cómo usar
--   Correr cada bloque por separado en el Supabase SQL Editor. NO corrige nada:
--   revisar la lista y decidir caso por caso (el país correcto puede ser el del
--   nombre o el del código).
--
-- Seguridad
--   100% read-only. Ningún INSERT/UPDATE/DELETE/DDL.
-- =============================================================================

-- A. Nombre de país → código esperado (los países que usa SellUp).
with expected(country_norm, code) as (
  values
    ('colombia', 'CO'), ('mexico', 'MX'), ('peru', 'PE'), ('chile', 'CL'),
    ('argentina', 'AR'), ('ecuador', 'EC'), ('brasil', 'BR'), ('brazil', 'BR'),
    ('uruguay', 'UY'), ('paraguay', 'PY'), ('bolivia', 'BO'), ('venezuela', 'VE'),
    ('panama', 'PA'), ('costa rica', 'CR'), ('guatemala', 'GT'), ('honduras', 'HN'),
    ('el salvador', 'SV'), ('nicaragua', 'NI'), ('republica dominicana', 'DO'),
    ('puerto rico', 'PR'), ('espana', 'ES'), ('spain', 'ES'),
    ('estados unidos', 'US'), ('united states', 'US')
),
accounts_norm as (
  select
    a.id,
    a.name,
    a.country,
    a.country_code,
    a.source,
    a.hubspot_company_id,
    a.created_at,
    a.metadata -> 'hubspot_profile_sync' -> 'filled_columns' as filled_columns,
    lower(translate(trim(a.country),
      'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) as country_norm
  from accounts a
  where a.country is not null and a.country_code is not null
)
-- B. Empresas cuyo código no es el del país que dice su nombre.
select
  n.id,
  n.name,
  n.country,
  n.country_code,
  e.code as code_esperado,
  n.source,
  n.hubspot_company_id,
  n.filled_columns,
  n.created_at
from accounts_norm n
join expected e on e.country_norm = n.country_norm
where upper(n.country_code) <> e.code
order by n.created_at desc;

-- C. Países que el bloque A no conoce (para revisarlos a mano).
select country, country_code, count(*) as empresas
from accounts
where country is not null
  and lower(translate(trim(country), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) not in (
    'colombia', 'mexico', 'peru', 'chile', 'argentina', 'ecuador', 'brasil', 'brazil',
    'uruguay', 'paraguay', 'bolivia', 'venezuela', 'panama', 'costa rica', 'guatemala',
    'honduras', 'el salvador', 'nicaragua', 'republica dominicana', 'puerto rico',
    'espana', 'spain', 'estados unidos', 'united states'
  )
group by country, country_code
order by empresas desc;
