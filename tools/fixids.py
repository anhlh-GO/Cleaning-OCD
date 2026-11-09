import json,os,sys
D=sys.argv[1]
def fx(v):
    if isinstance(v,dict):
        return {k:(str(x) if k=='fileID' and isinstance(x,int) else fx(x)) for k,x in v.items()}
    if isinstance(v,list): return [fx(x) for x in v]
    return v
for f in os.listdir(D):
    p=os.path.join(D,f); d=json.load(open(p)); json.dump(fx(d),open(p,'w'),separators=(',',':'))
print('done')
