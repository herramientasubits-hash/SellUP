#!/usr/bin/env python3
"""
download-pa-panamacompra.py — SOURCES-PA-CLOSE-1. Baja (SÓLO LECTURA, con pausas)
lo que el ETL de Panamá necesita de PanamaCompraEnCifras (DGCP, datos públicos de
la Ley 22 de contratación pública) a la carpeta actual:

  api      api/estado4_<año>.jsonl (actos adjudicados 2022-2026),
           api/estado11_<año>.jsonl (órdenes de Convenio Marco 2024-2026) y
           api/proveedores.jsonl (buscador de proveedores: del correo del
           representante legal SÓLO se guarda el dominio; nunca el correo, el
           nombre ni el teléfono).
  v2       v2_suppliers.jsonl (servicio v2: RUC, razón social y nombre comercial).
  ocds     ocds_by_ruc.json: lo adjudicado por familia UNSPSC por RUC, a partir de
           los CSV anuales OCDS 2022-2024 de data.open-contracting.org
           (publicación 120, licencia PDDL) ya descomprimidos en ocds<año>/<año>/.

Uso:  python3 download-pa-panamacompra.py api|v2|ocds
Nada de captchas ni controles de acceso: si un servicio responde error, se
reintenta con calma y se para.
"""
import sys


def run_api():
    import json, time, urllib.request, os, sys
    BASE='https://www.panamacompraencifras.gob.pa/api/Indicadores/'
    def get(path):
        for attempt in range(4):
            try:
                req=urllib.request.Request(BASE+path, headers={'Accept':'application/json','User-Agent':'SellUp-research/1.0 (lectura de datos publicos)'})
                with urllib.request.urlopen(req, timeout=90) as r: return json.loads(r.read().decode('utf-8'))
            except Exception as e:
                print('retry',path,e,flush=True); time.sleep(10*(attempt+1))
        return None
    def items_of(d):
        if isinstance(d,list): return d
        if isinstance(d,dict):
            for k in ('data','items','result','results','lista'):
                if isinstance(d.get(k),list): return d[k]
            for v in d.values():
                if isinstance(v,list): return v
        return []
    os.makedirs('api',exist_ok=True)
    jobs=[(4,y) for y in (2022,2023,2024,2025,2026)]+[(11,y) for y in (2024,2025,2026)]
    for est,y in jobs:
        out=f'api/estado{est}_{y}.jsonl'
        if os.path.exists(out+'.done'): continue
        n=0
        with open(out,'w') as f:
            for page in range(1,400):
                d=get(f'BusquedaPorEstado?Estado={est}&Anio={y}&pageNumber={page}&pageSize=1000')
                it=items_of(d)
                for r in it: f.write(json.dumps(r,ensure_ascii=False)+'\n')
                n+=len(it); print(est,y,page,len(it),n,flush=True); time.sleep(1.5)
                if len(it)<1000: break
        open(out+'.done','w').write(str(n))
    # proveedores: sin datos personales; sólo dominio del correo
    out='api/proveedores.jsonl'
    if not os.path.exists(out+'.done'):
        n=0
        with open(out,'w') as f:
            for page in range(1,200):
                d=get(f'BusquedaProveedor?pageNumber={page}&pageSize=1000&search=')
                it=items_of(d)
                for r in it:
                    email=(r.get('emailRl') or r.get('email') or '').strip().lower()
                    dom=email.split('@',1)[1] if '@' in email else None
                    keep={k:r.get(k) for k in ('ruc','razonSocial','nombreComercial','isAmpyme','proveedorAnios','providerDimId','businessKey','idStatusProvider','idStatusOrgv','dateCreated','dateUpdated') if k in r}
                    keep['email_domain']=dom
                    f.write(json.dumps(keep,ensure_ascii=False)+'\n')
                n+=len(it); print('prov',page,len(it),n,flush=True); time.sleep(1.5)
                if len(it)<1000: break
        open(out+'.done','w').write(str(n))
    print('FIN',flush=True)


def run_v2():
    import json, time, urllib.request
    URL='https://v2.panamacompraencifras.gob.pa/backend/suppliers?format=json'
    FILTERS=['', 'S.A', 'INC', 'CORP', 'LTD', 'S. DE R', 'SOCIEDAD', 'GRUPO', 'PANAMA']
    seen=set(); n=0
    with open('v2_suppliers.jsonl','w') as out:
        for flt in FILTERS:
            for page in range(1,21):
                body=json.dumps({'supplier':flt,'page':page,'paginateBy':500}).encode()
                data=None
                for attempt in range(3):
                    try:
                        req=urllib.request.Request(URL,data=body,headers={'Content-Type':'application/json','Accept':'application/json'})
                        with urllib.request.urlopen(req,timeout=90) as r: data=json.loads(r.read().decode()); break
                    except Exception as e:
                        print('retry',flt,page,e,flush=True); time.sleep(10*(attempt+1))
                time.sleep(2)
                if not data or not isinstance(data.get('results'),list): break
                for res in data['results']:
                    party=res.get('party') or {}; ident=party.get('identifier') or {}
                    rid=ident.get('id') or (res.get('supplier') or {}).get('id')
                    if not rid or rid in seen: continue
                    seen.add(rid)
                    out.write(json.dumps({'ruc':rid,'scheme':ident.get('scheme'),'name':ident.get('legalName') or party.get('name'),
                      'trade_names':[a.get('legalName') for a in (party.get('additionalIdentifiers') or []) if a.get('legalName')],
                      'total_awards':res.get('total_awards'),'last_process':res.get('last_process')},ensure_ascii=False)+'\n'); n+=1
                print(flt or '(todos)',page,len(data['results']),n,flush=True)
                if not (data.get('pagination') or {}).get('has_next'): break
    print('FIN',n,flush=True)


def run_ocds():
    import csv, json, collections, re, sys
    csv.field_size_limit(10**9)
    out=collections.defaultdict(lambda: {'names':collections.Counter(),'fam':collections.Counter(),'total':0.0,'years':set(),'awards':0})
    unmatched=0; matched=0
    for y in (2022,2023,2024):
        d=f'ocds{y}/{y}'
        sup_by=collections.defaultdict(dict)
        for r in csv.DictReader(open(f'{d}/parties.csv',encoding='utf-8')):
            if 'supplier' in (r['roles'] or ''):
                sup_by[r['_link_main']][(r['name'] or '').strip().upper()]=r['id'].strip()
        award_val={}; award_date={}
        for r in csv.DictReader(open(f'{d}/awards.csv',encoding='utf-8')):
            if (r['status'] or '')  in ('cancelled','unsuccessful'): continue
            try: award_val[r['_link']]=float(r['value_amount'] or 0)
            except: award_val[r['_link']]=0.0
            award_date[r['_link']]=(r['date'] or str(y))[:4]
        award_sup=collections.defaultdict(list)
        for r in csv.DictReader(open(f'{d}/awards_suppliers.csv',encoding='utf-8')):
            rid=sup_by[r['_link_main']].get((r['name'] or '').strip().upper())
            if rid is None: unmatched+=1; continue
            matched+=1; award_sup[r['_link_awards']].append((rid,(r['name'] or '').strip()))
        items=collections.defaultdict(list)
        for r in csv.DictReader(open(f'{d}/awards_items.csv',encoding='utf-8')):
            try: amt=float(r['unit_value_amount'] or 0)*float(r['quantity'] or 1)
            except: amt=0.0
            items[r['_link_awards']].append(((r['classification_id'] or '').strip(),amt))
        for aw,sups in award_sup.items():
            if aw not in award_val: continue
            val=award_val[aw]; its=items.get(aw,[])
            tot_items=sum(a for _,a in its) or 0
            share=1/len(sups)
            for rid,name in sups:
                o=out[rid]; o['names'][name]+=1; o['total']+=val*share; o['years'].add(award_date[aw]); o['awards']+=1
                for code,a in its:
                    if not re.fullmatch(r'\d{8}',code): continue
                    w=(a/tot_items*val) if tot_items>0 else (val/len(its))
                    o['fam'][code[:4]]+=w*share
    print('matched',matched,'unmatched',unmatched,'suppliers',len(out),file=sys.stderr)
    with open('ocds_by_ruc.json','w') as f:
        json.dump({k:{'name':v['names'].most_common(1)[0][0],'fam':dict(v['fam']),'total':round(v['total'],2),'years':sorted(v['years']),'awards':v['awards']} for k,v in out.items()},f,ensure_ascii=False)


if __name__ == "__main__":
    {"api": run_api, "v2": run_v2, "ocds": run_ocds}[sys.argv[1]]()
