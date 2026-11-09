# minimal unity yaml parsing helpers
import os, re, sys, json, pickle
ROOT = sys.argv[1] if len(sys.argv)>1 else None
def build_guid_map(root):
    m={}
    for dp,dn,fn in os.walk(root):
        for f in fn:
            if f.endswith('.meta'):
                p=os.path.join(dp,f)
                with open(p,encoding='utf-8',errors='ignore') as fh:
                    for line in fh:
                        if line.startswith('guid:'):
                            m[line.split()[1]]=p[:-5]; break
    return m
DOC=re.compile(r'^--- !u!(\d+) &(-?\d+)( stripped)?',re.M)
def parse_docs(path):
    txt=open(path,encoding='utf-8',errors='ignore').read()
    out={}
    ms=list(DOC.finditer(txt))
    for i,mm in enumerate(ms):
        body=txt[mm.end():ms[i+1].start() if i+1<len(ms) else len(txt)]
        lines=body.split('\n')
        typ=lines[1].rstrip(':') if len(lines)>1 else ''
        out[mm.group(2)]=(int(mm.group(1)),typ,body)
    return out
