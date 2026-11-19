import re,html,sys
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
out=["-- Tabelas oficiais do eSocial, versão S-1.3 (gerado de \"eSocial versão S-1.3 - Tabelas\").",
"-- 13 parte do corpo atingida, 14 agente causador, 15 situação geradora, 17 natureza da lesão,",
"-- 24 agentes nocivos, 27 procedimentos diagnósticos.",
"INSERT INTO esocial_tabela (tabela, codigo, descricao, grupo, aplicacao, versao) VALUES"]
q=lambda s: "NULL" if s is None or s=='' else "'"+s.replace("'","''")+"'"
vals=[]
cel=lambda r:[re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',c))).strip() for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>',r,re.S)]
for n in [13,14,15,17,24,27]:
    m=re.search(r'<table[^>]*id="%d"[^>]*>(.*?)</table>'%n,t,re.S)
    rows=[cel(r) for r in re.findall(r'<tr[^>]*>(.*?)</tr>',m.group(1),re.S)][2:]
    grupo=None; vistos=set()
    for r in rows:
        if len(r)==1: continue
        cod,desc=r[0],r[1]
        if not cod or cod in vistos: continue
        vistos.add(cod)
        apl=r[2] if len(r)>2 else None
        grupo={'01':'Químicos','02':'Físicos','03':'Biológicos','04':'Associação de agentes','05':'Outros agentes nocivos','09':'Ausência de agente nocivo'}.get(cod[:2]) if n==24 else None
        vals.append(f"({n}, {q(cod)}, {q(desc)}, {q(grupo)}, {q(apl)}, 'S-1.3')")
    print(n,len(vistos),file=sys.stderr)
out.append(",\n".join(vals)+"\nON CONFLICT DO NOTHING;")
print("\n".join(out))
