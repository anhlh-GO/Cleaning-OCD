import sys,os,re,json,pickle,yaml
L=getattr(yaml,'CSafeLoader',yaml.SafeLoader)
A=sys.argv[1]; OUT=sys.argv[2]
gm=pickle.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'guid.pkl'),'rb'))
inv={os.path.normcase(os.path.normpath(v)):k for k,v in gm.items()}
so={}; defaults={}
d=os.path.join(A,'MonoBehaviour')
for f in os.listdir(d):
    if not f.endswith('.asset'): continue
    p=os.path.join(d,f); t=open(p,encoding='utf-8',errors='ignore').read()
    m=re.search(r'm_Script: \{fileID: \d+, guid: (\w+)',t)
    if not m: continue
    sn=os.path.basename(gm.get(m.group(1),''))
    if not sn.endswith('SO.cs') and 'Config' not in sn: continue
    body=t.split('\n',3)[3]
    try: y=yaml.load(body,Loader=L); y=list(y.values())[0]
    except Exception as e: continue
    data={k:v for k,v in y.items() if not k.startswith('m_')}
    g=inv.get(os.path.normcase(os.path.normpath(p)))
    sn=sn[:-3]
    so[g]={'s':sn,'n':y.get('m_Name'),'d':data}
    defaults.setdefault(sn,[]).append((y.get('m_Name'),g))
dd={}
for sn,lst in defaults.items():
    pick=[g for n,g in lst if 'base' in (n or '').lower()] or [g for n,g in lst]
    dd[sn]=pick[0]
    print(sn,[n for n,g in lst][:8])
json.dump({'so':so,'def':dd},open(OUT,'w'))
