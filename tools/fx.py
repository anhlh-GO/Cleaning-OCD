# Export Unity ParticleSystem (+ renderer) params into level JSON comps of kind 'PS'.
# usage: python fx.py <Assets dir> <game assets dir> <guid.pkl>
import sys, os, re, json, pickle, math
import yaml
from PIL import Image
L = getattr(yaml, 'CSafeLoader', yaml.SafeLoader)
A, OUT, GP = sys.argv[1], sys.argv[2], sys.argv[3]
gm = pickle.load(open(GP, 'rb'))
os.makedirs(os.path.join(OUT, 'fx'), exist_ok=True)
DOC = re.compile(r'^--- !u!(\d+) &(-?\d+)', re.M)
TAG = open(os.path.join(A, '..', 'ProjectSettings', 'TagManager.asset'), encoding='utf-8').read()
LAYER = {int(u): i for i, u in enumerate(re.findall(r'uniqueID: (\d+)', TAG.split('m_SortingLayers:')[1]))}

def docs_of(path, want):
    txt = open(path, encoding='utf-8', errors='ignore').read()
    ms = list(DOC.finditer(txt)); out = {}
    for i, m in enumerate(ms):
        t = int(m.group(1))
        if t not in want: continue
        body = txt[m.end():ms[i + 1].start() if i + 1 < len(ms) else len(txt)]
        d = yaml.load(body, Loader=L); out[m.group(2)] = (t, list(d.values())[0])
    return out

def curve(c):
    if not isinstance(c, dict): return [[0, 1], [1, 1]]
    ks = c.get('m_Curve') or []
    pts = [[k['time'], k['value']] for k in ks]
    return pts or [[0, 1], [1, 1]]

def mm(m):  # MinMaxCurve -> {s:state, a, b, c:curve, c2}
    if not isinstance(m, dict): return {'s': 0, 'a': 0}
    s = m.get('minMaxState', 0); sc = m.get('scalar', 0)
    r = {'s': s, 'a': sc, 'b': m.get('minScalar', sc)}
    if s in (1, 2): r['c'] = curve(m.get('maxCurve')); r['c2'] = curve(m.get('minCurve'))
    return r

def col(c): return [round(c.get('r', 1), 3), round(c.get('g', 1), 3), round(c.get('b', 1), 3), round(c.get('a', 1), 3)]

def grad(g):
    if not isinstance(g, dict): return None
    nc, na = g.get('m_NumColorKeys', 2), g.get('m_NumAlphaKeys', 2)
    cs = [[g.get('ctime%d' % i, 0) / 65535, *col(g.get('key%d' % i, {}))[:3]] for i in range(nc)]
    as_ = [[g.get('atime%d' % i, 0) / 65535, g.get('key%d' % i, {}).get('a', 1)] for i in range(na)]
    return {'c': cs, 'a': as_}

def mmg(m):  # MinMaxGradient
    if not isinstance(m, dict): return {'s': 0, 'c': [1, 1, 1, 1]}
    s = m.get('minMaxState', 0)
    if s == 0: return {'s': 0, 'c': col(m.get('maxColor', {}))}
    if s == 2: return {'s': 2, 'c': col(m.get('maxColor', {})), 'c2': col(m.get('minColor', {}))}
    return {'s': 1, 'g': grad(m.get('maxGradient')), 'g2': grad(m.get('minGradient')) if s == 3 else None}

texcache = {}
def export_tex(mat_ref):
    g = mat_ref.get('guid') if isinstance(mat_ref, dict) else None
    if not g or g in texcache: return texcache.get(g)
    p = gm.get(g); res = None
    if p and os.path.exists(p):
        t = open(p, encoding='utf-8', errors='ignore').read()
        sh = re.search(r'm_Shader: \{fileID: (\d+)', t); shid = int(sh.group(1)) if sh else 0
        name = os.path.basename(p)
        add = shid in (200, 10720) or ('Additive' in t and shid not in (10721,))
        m = re.search(r'_MainTex:\s*\n\s*m_Texture: \{fileID: \d+, guid: (\w+)', t)
        tp = gm.get(m.group(1)) if m else None
        if tp and os.path.exists(tp):
            fn = m.group(1)[:16] + '.webp'
            im = Image.open(tp).convert('RGBA')
            if max(im.size) > 256: im.thumbnail((256, 256))
            im.save(os.path.join(OUT, 'fx', fn), 'WEBP', quality=88)
            # tint colour from material (_TintColor/_Color)
            tc = re.search(r'_TintColor: \{r: ([\d.]+), g: ([\d.]+), b: ([\d.]+), a: ([\d.]+)\}', t)
            res = {'f': fn, 'add': 1 if add else 0, 'sh': shid, 'n': name,
                   'tint': [float(x) for x in tc.groups()] if tc else None}
    texcache[g] = res
    return res

lv = os.path.join(A, '_MyGame', 'Addressables', 'Levels', 'Classic')
for f in sorted(os.listdir(lv)):
    if not f.endswith('.prefab'): continue
    name = f[:-7]; jp = os.path.join(OUT, 'levels', name + '.json')
    if not os.path.exists(jp): continue
    J = json.load(open(jp))
    D = docs_of(os.path.join(lv, f), {198, 199})
    rend = {}
    for k, (t, d) in D.items():
        if t == 199:
            mats = d.get('m_Materials') or [{}]
            rend[str(d['m_GameObject']['fileID'])] = {
                'en': d.get('m_Enabled', 1), 'l': LAYER.get(d.get('m_SortingLayerID', 0), 1), 'o': d.get('m_SortingOrder', 0),
                'mode': d.get('m_RenderMode', 0), 'ls': d.get('m_LengthScale', 2), 'vs': d.get('m_VelocityScale', 0),
                'tex': export_tex(mats[0]), 'minS': d.get('m_MinParticleSize', 0), 'maxS': d.get('m_MaxParticleSize', 0.5)}
    n = 0
    for k, (t, d) in D.items():
        if t != 198 or k not in J['comps']: continue
        go = str(d['m_GameObject']['fileID'])
        im, sh, em = d.get('InitialModule', {}), d.get('ShapeModule', {}), d.get('EmissionModule', {})
        co, sz, ro, ve, uv = d.get('ColorModule', {}), d.get('SizeModule', {}), d.get('RotationModule', {}), d.get('VelocityModule', {}), d.get('UVModule', {})
        bursts = [{'t': b.get('time', 0), 'n': mm(b.get('countCurve')) if 'countCurve' in b else {'s': 0, 'a': b.get('minCount', 1)}} for b in em.get('m_Bursts', []) or []]
        shp = None
        if sh.get('enabled'):
            shp = {'type': sh.get('type', 4), 'angle': sh.get('angle', 25), 'radius': (sh.get('radius') or {}).get('value', 1),
                   'arc': (sh.get('arc') or {}).get('value', 360), 'pos': [sh.get('m_Position', {}).get(a, 0) for a in 'xyz'],
                   'rot': [sh.get('m_Rotation', {}).get(a, 0) for a in 'xyz'], 'scl': [sh.get('m_Scale', {}).get(a, 1) for a in 'xyz'],
                   'len': sh.get('length', 5), 'rad': sh.get('radiusThickness', 1), 'box': [sh.get('boxThickness', {}).get(a, 0) for a in 'xyz']}
        ps = {
            'loop': d.get('looping', 1), 'dur': d.get('lengthInSec', 5), 'pre': d.get('prewarm', 0), 'awake': d.get('playOnAwake', 1),
            'world': 1 if d.get('moveWithTransform', 0) == 1 else 0, 'scaling': d.get('scalingMode', 0),
            'delay': mm(d.get('startDelay')),
            'life': mm(im.get('startLifetime')), 'speed': mm(im.get('startSpeed')), 'size': mm(im.get('startSize')),
            'rot': mm(im.get('startRotation')), 'color': mmg(im.get('startColor')), 'grav': mm(im.get('gravityModifier')),
            'max': im.get('maxNumParticles', 1000),
            'rate': mm(em.get('rateOverTime')) if em.get('enabled', 1) else {'s': 0, 'a': 0},
            'rateD': mm(em.get('rateOverDistance')) if em.get('enabled', 1) else {'s': 0, 'a': 0}, 'bursts': bursts if em.get('enabled', 1) else [],
            'shape': shp,
            'col': mmg(co.get('gradient')) if co.get('enabled') else None,
            'sz': mm(sz.get('curve')) if sz.get('enabled') else None,
            'rotL': mm(ro.get('curve')) if ro.get('enabled') else None,
            'vel': {'x': mm(ve.get('x')), 'y': mm(ve.get('y')), 'z': mm(ve.get('z')), 'space': ve.get('inWorldSpace', 0)} if ve.get('enabled') else None,
            'uv': {'tx': uv.get('tilesX', 1), 'ty': uv.get('tilesY', 1), 'fr': mm(uv.get('frameOverTime')), 'cyc': uv.get('cycles', 1)} if uv.get('enabled') else None,
            'r': rend.get(go),
        }
        J['comps'][k].update({'ps': ps}); n += 1
    json.dump(J, open(jp, 'w'), separators=(',', ':'))
    print(name, n, flush=True)
print('textures', len([v for v in texcache.values() if v]))
