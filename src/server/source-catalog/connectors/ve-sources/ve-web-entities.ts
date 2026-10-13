/**
 * ve-web-entities.ts — empresas y universidades venezolanas con web propia
 * comprobada, para la capa gratuita (sin RIF publicado, o con el RIF que muestra su
 * propia portada).
 *
 * SOURCES-VE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Origen: Wikidata (entidades con país = Venezuela y web oficial, 13-10-2026). Cada
 * web se abrió una vez (portada, respetando su robots.txt) y sólo entra si responde
 * y es de la empresa: fuera dominios en venta o «en construcción», webs de otro país
 * (farmatodo.com.mx), redes sociales, medios, clubes, ONG, embajadas y gremios. El
 * RIF sólo si la portada muestra UNO con su dígito verificador.
 *
 * La industria de cada empresa está escrita a mano (PENDIENTE DE REVISIÓN DE LA
 * DUEÑA). Universidades: PÚBLICA → Gobierno; PRIVADA → «Compañía de Servicios»
 * (misma decisión que la capa común de listas curadas, 08-10-2026).
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

export type VeWebEntityKind = 'company' | 'public_university' | 'private_university';

export type VeWebEntity = {
  /** Wikidata (Q…). */
  qid: string;
  name: string;
  domain: string;
  kind: VeWebEntityKind;
  macro: MacroIndustryKey;
  /** RIF que muestra la propia portada, o `null`. */
  rif: string | null;
};

const FIN: MacroIndustryKey = 'insurance_financial_services';
const MANU: MacroIndustryKey = 'industry_manufacturing_chemicals_automotive';
const CONS: MacroIndustryKey = 'consumer_goods';
const RETAIL: MacroIndustryKey = 'retail';
const TECH: MacroIndustryKey = 'technology';
const HEALTH: MacroIndustryKey = 'health_pharma';
const PROP: MacroIndustryKey = 'property_construction';
const ENERGY: MacroIndustryKey = 'energy_mining_environment';
const TRANSP: MacroIndustryKey = 'transport_logistics';
const SERV: MacroIndustryKey = 'services_company';
const GOV: MacroIndustryKey = 'government';

export const VE_WEB_ENTITIES: readonly VeWebEntity[] = Object.freeze([
  // ── Empresas ──
  { qid: 'Q548133', name: 'LASER Airlines', domain: 'laserairlines.com', kind: 'company', macro: TRANSP, rif: 'J-00364445-5' },
  { qid: 'Q677606', name: 'Conviasa', domain: 'conviasa.aero', kind: 'company', macro: TRANSP, rif: 'G-20007774-3' },
  { qid: 'Q791117', name: 'Avior Airlines', domain: 'aviorair.com', kind: 'company', macro: TRANSP, rif: null },
  { qid: 'Q891563', name: 'Bolsa de Valores de Caracas', domain: 'bolsadecaracas.com', kind: 'company', macro: FIN, rif: 'J-00004114-8' },
  { qid: 'Q1409875', name: 'RUTACA Airlines', domain: 'flyrutaca.com', kind: 'company', macro: TRANSP, rif: 'J-09500396-5' },
  { qid: 'Q1531524', name: 'Rutas Aéreas de Venezuela (RAVSA)', domain: 'ravsa.com.ve', kind: 'company', macro: TRANSP, rif: null },
  { qid: 'Q2894459', name: 'Central Madeirense', domain: 'tucentralonline.com', kind: 'company', macro: RETAIL, rif: null },
  { qid: 'Q3483363', name: 'Siderúrgica del Orinoco Alfredo Maneiro (SIDOR)', domain: 'sidor.com', kind: 'company', macro: MANU, rif: 'G-20010626-3' },
  { qid: 'Q3773091', name: 'Centro San Ignacio', domain: 'centrosanignacio.com', kind: 'company', macro: PROP, rif: null },
  { qid: 'Q4688249', name: 'Aeroexpresos Ejecutivos', domain: 'aeroexpresos.com', kind: 'company', macro: TRANSP, rif: null },
  { qid: 'Q4854101', name: 'Mercantil Banco', domain: 'mercantilbanco.com', kind: 'company', macro: FIN, rif: null },
  { qid: 'Q4854115', name: 'Banco Venezolano de Crédito', domain: 'venezolano.com', kind: 'company', macro: FIN, rif: 'J-00002970-9' },
  { qid: 'Q4854841', name: 'Banesco Banco Universal', domain: 'banesco.com', kind: 'company', macro: FIN, rif: 'J-07013380-5' },
  { qid: 'Q5062868', name: 'Centro Sambil', domain: 'tusambil.com', kind: 'company', macro: PROP, rif: null },
  { qid: 'Q5142829', name: 'Colegio Internacional de Caracas', domain: 'cic-caracas.org', kind: 'company', macro: SERV, rif: null },
  { qid: 'Q5172366', name: 'Corporación Eléctrica Nacional (CORPOELEC)', domain: 'corpoelec.gob.ve', kind: 'company', macro: ENERGY, rif: 'G-20010014-1' },
  { qid: 'Q5276240', name: 'Corporación Digitel', domain: 'digitel.com.ve', kind: 'company', macro: TECH, rif: 'J-30468971-3' },
  { qid: 'Q5291403', name: 'Domínguez & Cía.', domain: 'domcia.com', kind: 'company', macro: MANU, rif: null },
  { qid: 'Q5380905', name: 'Envases Venezolanos', domain: 'envasesvenezolanos.com.ve', kind: 'company', macro: MANU, rif: 'J-00012768-9' },
  { qid: 'Q5465007', name: 'Banco Fondo Común', domain: 'bfc.com.ve', kind: 'company', macro: FIN, rif: 'J-00072306-0' },
  { qid: 'Q5681607', name: 'Banco Exterior', domain: 'bancoexterior.com', kind: 'company', macro: FIN, rif: 'J-00002950-4' },
  { qid: 'Q5717827', name: 'Bancaribe', domain: 'bancaribe.com.ve', kind: 'company', macro: FIN, rif: 'J-00002949-0' },
  { qid: 'Q5718031', name: 'Banco Sofitasa', domain: 'sofitasa.com', kind: 'company', macro: FIN, rif: 'J-09028384-6' },
  { qid: 'Q5856074', name: 'Farmacia SAAS', domain: 'farmaciasaas.com', kind: 'company', macro: HEALTH, rif: null },
  { qid: 'Q5871166', name: 'Fundación Centro de Estudios Latinoamericanos Rómulo Gallegos (CELARG)', domain: 'celarg.org.ve', kind: 'company', macro: GOV, rif: 'G-20008198-8' },
  { qid: 'Q6041215', name: 'NetUno', domain: 'netuno.net.ve', kind: 'company', macro: TECH, rif: null },
  { qid: 'Q6714312', name: 'Manufacturas de Papel (MANPA)', domain: 'manpa.com.ve', kind: 'company', macro: MANU, rif: null },
  { qid: 'Q7529899', name: 'Síragon', domain: 'siragon.com', kind: 'company', macro: TECH, rif: null },
  { qid: 'Q7532458', name: 'Siderúrgica Venezolana (SIVENSA)', domain: 'sivensa.com.ve', kind: 'company', macro: MANU, rif: null },
  { qid: 'Q7643963', name: 'De Candido', domain: 'decandido.com', kind: 'company', macro: RETAIL, rif: null },
  { qid: 'Q11693811', name: 'Movilnet', domain: 'movilnet.com.ve', kind: 'company', macro: TECH, rif: 'G-20016137-0' },
  { qid: 'Q20015002', name: 'Farmahorro', domain: 'farmahorro.com.ve', kind: 'company', macro: HEALTH, rif: null },
  { qid: 'Q21007004', name: 'Banplus Banco Universal', domain: 'banplus.com', kind: 'company', macro: FIN, rif: 'J-00042303-2' },
  { qid: 'Q26268368', name: 'Solar Cargo', domain: 'solarcargo.com', kind: 'company', macro: TRANSP, rif: null },
  { qid: 'Q27510595', name: 'Servibus de Venezuela', domain: 'servibus.co', kind: 'company', macro: TRANSP, rif: 'J-30311202-1' },
  { qid: 'Q29054164', name: 'Cervecería Regional', domain: 'cerveceriaregional.com', kind: 'company', macro: CONS, rif: null },
  { qid: 'Q29389430', name: 'Turpial Airlines', domain: 'turpialairlines.com', kind: 'company', macro: TRANSP, rif: 'J-40491921-0' },
  { qid: 'Q37910146', name: 'Datanalisis', domain: 'datanalisis.com', kind: 'company', macro: SERV, rif: null },
  { qid: 'Q48781284', name: 'Telefónica Venezolana (Movistar)', domain: 'movistar.com.ve', kind: 'company', macro: TECH, rif: null },
  { qid: 'Q48790955', name: 'Destilería Carúpano', domain: 'roncarupano.com', kind: 'company', macro: CONS, rif: 'J-00010791-2' },
  { qid: 'Q52448558', name: 'Centro Comercial El Recreo', domain: 'ccelrecreo.com', kind: 'company', macro: PROP, rif: null },
  { qid: 'Q98509397', name: 'Simple TV', domain: 'simple.com.ve', kind: 'company', macro: TECH, rif: 'J-30259700-5' },
  { qid: 'Q109598019', name: 'Locatel', domain: 'locatel.com.ve', kind: 'company', macro: HEALTH, rif: null },
  { qid: 'Q109608214', name: 'Supermercados Santo Tomé', domain: 'supermercadosantotome.com', kind: 'company', macro: RETAIL, rif: 'J-09512461-4' },
  { qid: 'Q141514937', name: 'Nayma Consultores', domain: 'naymaconsultores.com', kind: 'company', macro: SERV, rif: null },
  { qid: 'Q141546741', name: 'Soluciones Integrales en Metrología y Calidad (SIMCLAB)', domain: 'simclab.com', kind: 'company', macro: SERV, rif: null },
  { qid: 'Q126048447', name: 'Bancamiga Banco Universal', domain: 'bancamiga.com', kind: 'company', macro: FIN, rif: 'J-31628759-9' },
  { qid: 'Q131521153', name: 'FOSPUCA', domain: 'fospuca.com', kind: 'company', macro: ENERGY, rif: null },
  { qid: 'Q135485135', name: 'BRND Consulting', domain: 'brndconsulting.com', kind: 'company', macro: SERV, rif: null },
  { qid: 'Q137204500', name: 'PepsiCo Alimentos', domain: 'pepsico.co.ve', kind: 'company', macro: CONS, rif: 'J-00074653-2' },
  { qid: 'Q137382010', name: 'Orinokia Mall', domain: 'orinokiamall.com', kind: 'company', macro: PROP, rif: null },
  { qid: 'Q138630984', name: 'Tiendas Daka', domain: 'tiendasdaka.com', kind: 'company', macro: RETAIL, rif: null },
  { qid: 'Q139921757', name: 'PlatiniumHost', domain: 'platiniumhost.com', kind: 'company', macro: TECH, rif: null },
  { qid: 'Q140290246', name: 'Quarks Data', domain: 'quarksdata.com', kind: 'company', macro: TECH, rif: null },
  // ── Universidades ──
  { qid: 'Q542248', name: 'Universidad Santa María', domain: 'usm.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q935378', name: 'Universidad José María Vargas', domain: 'ujmv.edu', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156612', name: 'Universidad Pedagógica Experimental Libertador (UPEL)', domain: 'upel.edu.ve', kind: 'public_university', macro: GOV, rif: null },
  { qid: 'Q2885018', name: 'Instituto de Estudios Superiores de Administración (IESA)', domain: 'iesa.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-00067547-3' },
  { qid: 'Q4801770', name: 'Universidad Arturo Michelena', domain: 'uam.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q5841184', name: 'Universidad Nacional Experimental Rafael María Baralt', domain: 'unermb.web.ve', kind: 'public_university', macro: GOV, rif: null },
  { qid: 'Q5941668', name: 'Universidad Nacional Experimental Rómulo Gallegos (UNERG)', domain: 'unerg.edu.ve', kind: 'public_university', macro: GOV, rif: 'G-20003225-1' },
  { qid: 'Q6156331', name: 'Universidad Alonso de Ojeda', domain: 'uniojeda.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156372', name: 'Universidad Bicentenaria de Aragua', domain: 'uba.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156379', name: 'Universidad Católica Cecilio Acosta', domain: 'unica.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156385', name: 'Universidad Católica Santa Rosa', domain: 'ucsar.net.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156457', name: 'Universidad Fermín Toro', domain: 'uft.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156556', name: 'Universidad Nacional Experimental de Guayana (UNEG)', domain: 'uneg.edu.ve', kind: 'public_university', macro: GOV, rif: 'G-20003343-6' },
  { qid: 'Q6156560', name: 'Universidad Nacional Experimental del Táchira (UNET)', domain: 'unet.edu.ve', kind: 'public_university', macro: GOV, rif: 'G-20004886-7' },
  { qid: 'Q6156629', name: 'Universidad Politécnica Territorial Andrés Eloy Blanco (UPTAEB)', domain: 'uptaeb.edu.ve', kind: 'public_university', macro: GOV, rif: null },
  { qid: 'Q6156630', name: 'Universidad Politécnica Territorial del Estado Mérida Kléber Ramírez (UPTM)', domain: 'uptm.edu.ve', kind: 'public_university', macro: GOV, rif: 'G-20010201-2' },
  { qid: 'Q6156664', name: 'Universidad Rafael Belloso Chacín (URBE)', domain: 'urbe.edu', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156666', name: 'Universidad Rafael Urdaneta', domain: 'uru.edu', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q6156692', name: 'Universidad Tecnológica del Centro (UNITEC)', domain: 'portal.unitec.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-07546986-0' },
  { qid: 'Q6972526', name: 'Universidad Nacional Experimental Politécnica de la Fuerza Armada Nacional (UNEFA)', domain: 'unefa.edu.ve', kind: 'public_university', macro: GOV, rif: null },
  { qid: 'Q7894230', name: 'Universidad Alejandro de Humboldt', domain: 'unihumboldt.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q7894281', name: 'Universidad José Antonio Páez', domain: 'ujap.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-30400858-9' },
  { qid: 'Q7894286', name: 'Universidad Metropolitana', domain: 'unimet.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q7894290', name: 'Universidad Monteávila', domain: 'uma.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-30647247-9' },
  { qid: 'Q7894301', name: 'Universidad Nueva Esparta', domain: 'une.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q16550254', name: 'Colegio Universitario Monseñor de Talavera', domain: 'cumt.edu', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q16644505', name: 'Universidad Nacional Experimental de las Artes (UNEARTE)', domain: 'unearte.edu.ve', kind: 'public_university', macro: GOV, rif: null },
  { qid: 'Q17632365', name: 'Universidad Tecnológica Sucre', domain: 'uts.edu.ve', kind: 'private_university', macro: SERV, rif: null },
  { qid: 'Q29052446', name: 'Universidad Yacambú', domain: 'uny.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-08515699-2' },
  { qid: 'Q30294100', name: 'Universidad de Margarita', domain: 'unimar.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-30660040-0' },
  { qid: 'Q38239134', name: 'Instituto Universitario de Tecnología Antonio Ricaurte (IUTAR)', domain: 'iutar.edu.ve', kind: 'private_university', macro: SERV, rif: 'J-30119015-7' },
  { qid: 'Q65093814', name: 'Instituto Universitario de Tecnología READIC (UNIR)', domain: 'unir.edu.ve', kind: 'private_university', macro: SERV, rif: null },
]);

const BY_QID: ReadonlyMap<string, VeWebEntity> = new Map(VE_WEB_ENTITIES.map((entity) => [entity.qid, entity]));

/** La entidad con web de un Q de Wikidata, o `null`. */
export function veWebEntityByQid(qid: string | null | undefined): VeWebEntity | null {
  return typeof qid === 'string' ? (BY_QID.get(qid) ?? null) : null;
}
