import sys, os, re, json, pickle, math
import yaml
from PIL import Image
try:
    Loader = yaml.CSafeLoader
except AttributeError:
    Loader = yaml.SafeLoader

ASSETS = sys.argv[1]
OUT = sys.argv[2]
LEVELS = sys.argv[3].split(',') if len(sys.argv) > 3 else None
HERE = os.path.dirname(os.path.abspath(__file__))
gm = pickle.load(open(os.path.join(HERE, 'guid.pkl'), 'rb'))
os.makedirs(os.path.join(OUT, 'sp'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'spine'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'levels'), exist_ok=True)

DOC = re.compile(r'^--- !u!(\d+) &(-?\d+)( stripped)?', re.M)
_cache = {}

def load_docs(path):
    if path in _cache:
        return _cache[path]
    txt = open(path, encoding='utf-8', errors='ignore').read()
    out = {}
    ms = list(DOC.finditer(txt))
    for i, mm in enumerate(ms):
        body = txt[mm.end():ms[i + 1].start() if i + 1 < len(ms) else len(txt)]
        try:
            d = yaml.load(body, Loader=Loader)
        except Exception as e:
            d = None
        if not d:
            continue
        typ = list(d.keys())[0]
        out[mm.group(2)] = (int(mm.group(1)), typ, d[typ])
    _cache[path] = out
    return out

def load_single(guid):
    p = gm.get(guid)
    if not p or not os.path.exists(p):
        return None
    docs = load_docs(p)
    for k, v in docs.items():
        return v[2]
    return None

# sorting layers
TAG = open(os.path.join(ASSETS, '..', 'ProjectSettings', 'TagManager.asset'), encoding='utf-8').read()
layer_ids = [int(x) for x in re.findall(r'uniqueID: (\d+)', TAG.split('m_SortingLayers:')[1])]
LAYER = {uid: i for i, uid in enumerate(layer_ids)}

def script_name(ref):
    if not isinstance(ref, dict):
        return '?'
    g = ref.get('guid')
    p = gm.get(g, '')
    n = os.path.basename(p)
    if n.endswith('.cs'):
        return n[:-3]
    return 'dll:' + n + ':' + str(ref.get('fileID'))

sprites = {}
SPJ = os.path.join(OUT, 'sprites.json')
if os.path.exists(SPJ):
    sprites = json.load(open(SPJ))
_tex = {}

def get_tex(guid):
    if guid in _tex:
        return _tex[guid]
    p = gm.get(guid)
    im = Image.open(p).convert('RGBA') if p and os.path.exists(p) else None
    _tex[guid] = im
    return im

def export_sprite(ref):
    if not isinstance(ref, dict) or not ref.get('guid'):
        return None
    g = ref['guid']
    if g in sprites:
        return g
    sp = load_single(g)
    if not sp or 'm_Rect' not in sp:
        return None
    r = sp['m_Rect']; rd = sp['m_RD']
    tex = get_tex(rd['texture'].get('guid')) if rd.get('texture') else None
    W = max(1, int(round(r['width']))); H = max(1, int(round(r['height'])))
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if tex is not None:
        tr = rd.get('textureRect') or r
        off = rd.get('textureRectOffset') or {'x': 0, 'y': 0}
        if tr.get('width', 0) <= 0:
            tr = r; off = {'x': 0, 'y': 0}
        TH = tex.height
        x0 = int(round(tr['x'])); w = int(round(tr['width'])); h = int(round(tr['height']))
        y0 = TH - int(round(tr['y'])) - h
        piece = tex.crop((x0, y0, x0 + w, y0 + h))
        ox = int(round(off['x'])); oy = H - int(round(off['y'])) - h
        out.paste(piece, (ox, oy))
    # downscale very large sprites
    scale = 1.0
    if max(W, H) > 2048:
        scale = 2048 / max(W, H)
        out = out.resize((max(1, int(W * scale)), max(1, int(H * scale))), Image.LANCZOS)
    fn = g[:16] + '.webp'
    out.save(os.path.join(OUT, 'sp', fn), 'WEBP', quality=88, method=4)
    piv = sp.get('m_Pivot', {'x': .5, 'y': .5})
    sprites[g] = {'f': fn, 'w': W, 'h': H, 'px': piv['x'], 'py': piv['y'], 'ppu': sp.get('m_PixelsToUnits', 100), 'n': sp.get('m_Name')}
    return g

spines = {}
SPN = os.path.join(OUT, 'spines.json')
if os.path.exists(SPN):
    spines = json.load(open(SPN))

def export_spine(ref):
    if not isinstance(ref, dict) or not ref.get('guid'):
        return None
    g = ref['guid']
    if g in spines:
        return g
    sd = load_single(g)
    if not sd:
        return None
    name = sd.get('m_Name', g).replace('_SkeletonData', '')
    safe = re.sub(r'[^A-Za-z0-9_\-]', '_', name) + '_' + g[:6]
    d = os.path.join(OUT, 'spine', safe)
    os.makedirs(d, exist_ok=True)
    jp = gm.get(sd['skeletonJSON']['guid'])
    js = open(jp, encoding='utf-8', errors='ignore').read()
    open(os.path.join(d, 'skel.json'), 'w', encoding='utf-8').write(js)
    atlas_txt = ''
    for aref in sd.get('atlasAssets') or []:
        aa = load_single(aref['guid'])
        if not aa:
            continue
        at = open(gm.get(aa['atlasFile']['guid']), encoding='utf-8', errors='ignore').read()
        # pages: map page names to material textures
        mats = aa.get('materials') or []
        pages = [l.strip() for l in at.split('\n') if l.strip().lower().endswith(('.png', '.jpg'))]
        for i, pg in enumerate(pages):
            texp = None
            if i < len(mats):
                mt = load_single(mats[i]['guid'])
                if mt:
                    try:
                        for te in mt['m_SavedProperties']['m_TexEnvs']:
                            if '_MainTex' in te:
                                texp = gm.get(te['_MainTex']['m_Texture'].get('guid'))
                    except Exception:
                        pass
            if not texp:
                base = os.path.splitext(pg)[0]
                cand = os.path.join(ASSETS, 'Texture2D', base + '.png')
                texp = cand if os.path.exists(cand) else None
            if texp and os.path.exists(texp):
                Image.open(texp).save(os.path.join(d, pg))
        atlas_txt += at + '\n'
    open(os.path.join(d, 'skel.atlas'), 'w', encoding='utf-8').write(atlas_txt)
    spines[g] = {'d': safe, 'scale': sd.get('scale', 0.01), 'n': name}
    return g

def clean(v):
    # strip noise
    return v

def export_level(path, name):
    docs = load_docs(path)
    gos = {}; comps = {}
    tr2go = {}
    for k, (t, typ, d) in docs.items():
        if t == 4:
            tr2go[k] = str(d['m_GameObject']['fileID'])
    for k, (t, typ, d) in docs.items():
        if t == 1:
            gos[k] = {'n': d.get('m_Name'), 'a': d.get('m_IsActive', 1), 'c': [], 'k': [str(c['component']['fileID']) for c in d.get('m_Component', [])]}
    for k, (t, typ, d) in docs.items():
        go = str(d.get('m_GameObject', {}).get('fileID', 0)) if isinstance(d, dict) else '0'
        if t == 4:
            g = gos[go]
            q = d['m_LocalRotation']; p = d['m_LocalPosition']; s = d['m_LocalScale']
            g['t'] = [p['x'], p['y'], p['z'], q['x'], q['y'], q['z'], q['w'], s['x'], s['y'], s['z']]
            fa = str(d['m_Father']['fileID'])
            g['p'] = tr2go.get(fa)
            g['c'] = [tr2go.get(str(c['fileID'])) for c in d.get('m_Children', []) if str(c['fileID']) in tr2go]
            comps[k] = {'k': 'TR', 'go': go}
        elif t == 212:
            col = d.get('m_Color', {'r': 1, 'g': 1, 'b': 1, 'a': 1})
            comps[k] = {'k': 'SR', 'go': go, 'en': d.get('m_Enabled', 1), 'sp': export_sprite(d.get('m_Sprite')),
                        'o': d.get('m_SortingOrder', 0), 'l': LAYER.get(d.get('m_SortingLayerID', 0), 1),
                        'mi': d.get('m_MaskInteraction', 0), 'col': [col['r'], col['g'], col['b'], col['a']],
                        'fx': d.get('m_FlipX', 0), 'fy': d.get('m_FlipY', 0), 'dm': d.get('m_DrawMode', 0),
                        'sz': [d.get('m_Size', {}).get('x', 1), d.get('m_Size', {}).get('y', 1)],
                        'mat': os.path.basename(gm.get((d.get('m_Materials') or [{}])[0].get('guid', ''), ''))}
        elif t == 331:
            comps[k] = {'k': 'SM', 'go': go, 'en': d.get('m_Enabled', 1), 'sp': export_sprite(d.get('m_Sprite')),
                        'cut': d.get('m_MaskAlphaCutoff', 0.2), 'cr': d.get('m_IsCustomRangeActive', 0),
                        'fo': d.get('m_FrontSortingOrder', 0), 'bo': d.get('m_BackSortingOrder', 0),
                        'fl': LAYER.get(d.get('m_FrontSortingLayerID', 0), 1), 'bl': LAYER.get(d.get('m_BackSortingLayerID', 0), 1)}
        elif t == 210:
            comps[k] = {'k': 'SG', 'go': go, 'en': d.get('m_Enabled', 1), 'o': d.get('m_SortingOrder', 0), 'l': LAYER.get(d.get('m_SortingLayerID', 0), 1)}
        elif t == 60:
            paths = d.get('m_Points', {}).get('m_Paths', [])
            comps[k] = {'k': 'POLY', 'go': go, 'en': d.get('m_Enabled', 1), 'off': [d['m_Offset']['x'], d['m_Offset']['y']],
                        'pts': [[[p['x'], p['y']] for p in path] for path in paths]}
        elif t == 61:
            comps[k] = {'k': 'BOX', 'go': go, 'en': d.get('m_Enabled', 1), 'off': [d['m_Offset']['x'], d['m_Offset']['y']], 'sz': [d['m_Size']['x'], d['m_Size']['y']]}
        elif t == 58:
            comps[k] = {'k': 'CIRC', 'go': go, 'en': d.get('m_Enabled', 1), 'off': [d['m_Offset']['x'], d['m_Offset']['y']], 'r': d.get('m_Radius', 0.5)}
        elif t == 23:
            comps[k] = {'k': 'MR', 'go': go, 'en': d.get('m_Enabled', 1), 'o': d.get('m_SortingOrder', 0), 'l': LAYER.get(d.get('m_SortingLayerID', 0), 1)}
        elif t == 198:
            comps[k] = {'k': 'PS', 'go': go}
        elif t == 114:
            sn = script_name(d.get('m_Script'))
            if 'skeletonDataAsset' in d:
                comps[k] = {'k': 'SPINE', 'go': go, 'en': d.get('m_Enabled', 1), 'skel': export_spine(d['skeletonDataAsset']),
                            'anim': d.get('_animationName') or '', 'loop': d.get('loop', 0), 'skin': d.get('initialSkinName') or '',
                            'ts': d.get('timeScale', 1), 'fx': d.get('initialFlipX', 0), 'fy': d.get('initialFlipY', 0)}
            else:
                data = {kk: vv for kk, vv in d.items() if not kk.startswith('m_')}
                comps[k] = {'k': 'MB', 'go': go, 'en': d.get('m_Enabled', 1), 's': sn, 'd': data}
                # export any sprite refs inside MB data
                def walk(v):
                    if isinstance(v, dict):
                        if 'guid' in v and v.get('fileID') == 21300000:
                            export_sprite(v)
                        for x in v.values():
                            walk(x)
                    elif isinstance(v, list):
                        for x in v:
                            walk(x)
                walk(data)
    root = [g for g, v in gos.items() if not v.get('p')]
    def fx(v):
        if isinstance(v, dict): return {k: (str(x) if k == 'fileID' and isinstance(x, int) else fx(x)) for k, x in v.items()}
        if isinstance(v, list): return [fx(x) for x in v]
        return v
    comps = fx(comps)
    lvl = {'name': name, 'root': root[0] if root else None, 'gos': gos, 'comps': comps}
    json.dump(lvl, open(os.path.join(OUT, 'levels', name + '.json'), 'w'), separators=(',', ':'))
    print('exported', name, len(gos), 'gos', len(comps), 'comps', flush=True)

lv = os.path.join(ASSETS, '_MyGame', 'Addressables', 'Levels', 'Classic')
names = LEVELS or [f[:-7] for f in os.listdir(lv) if f.endswith('.prefab')]
for n in names:
    export_level(os.path.join(lv, n + '.prefab'), n)
    _cache.clear()
json.dump(sprites, open(SPJ, 'w'), separators=(',', ':'))
json.dump(spines, open(SPN, 'w'), separators=(',', ':'))
print('sprites', len(sprites), 'spines', len(spines))
