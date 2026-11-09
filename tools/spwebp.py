import os,sys,re
import numpy as np
from PIL import Image
D=sys.argv[1]
for sd in os.listdir(D):
    p=os.path.join(D,sd); ap=os.path.join(p,'skel.atlas')
    if not os.path.exists(ap): continue
    at=open(ap,encoding='utf-8').read()
    pma='pma:true' in at
    for f in os.listdir(p):
        if f.lower().endswith('.png'):
            im=np.array(Image.open(os.path.join(p,f)).convert('RGBA')).astype(np.float32)
            if pma:
                a=im[...,3:4]/255.0
                im[...,:3]=np.where(a>0, np.clip(im[...,:3]/np.maximum(a,1e-3),0,255), 0)
            Image.fromarray(im.astype(np.uint8),'RGBA').save(os.path.join(p,f[:-4]+'.webp'),'WEBP',quality=90)
            os.remove(os.path.join(p,f))
            at=at.replace(f,f[:-4]+'.webp')
    at=at.replace('pma:true','pma:false')
    open(ap,'w',encoding='utf-8').write(at)
print('ok')
