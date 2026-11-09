# 地図データ生成：python3 tools/build_data.py <NaturalEarth geojson dir> <OpenAIP geojson dir> <出力 data/>
# - 陸地：Natural Earth 10m land + minor islands を日本周辺で切り抜き、Douglas-Peucker で簡略化
# - 空域・空港・NAVAID・障害物：OpenAIP の GeoJSON から必要な項目だけ残す
import json, math, os, sys

NE_DIR, AIP_DIR, OUT = sys.argv[1:4]
BBOX = (118.0, 18.0, 156.0, 50.0)          # lon_min, lat_min, lon_max, lat_max
SIMPLIFY_DEG = 0.004                       # 約0.2nm。地図用途で十分
ROUND = 4                                  # 小数4桁 ≒ 11m

def clip_ring(ring, bbox):
    """Sutherland–Hodgman で矩形に切り抜く（塗り用。矩形は凸なので成立）"""
    x0, y0, x1, y1 = bbox
    def clip(points, inside, cross):
        out = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev): out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out
    def ix(a, b, x): t = (x - a[0]) / (b[0] - a[0]); return (x, a[1] + t * (b[1] - a[1]))
    def iy(a, b, y): t = (y - a[1]) / (b[1] - a[1]); return (a[0] + t * (b[0] - a[0]), y)
    pts = [tuple(p[:2]) for p in ring]
    for inside, cross in (
        (lambda p: p[0] >= x0, lambda a, b: ix(a, b, x0)),
        (lambda p: p[0] <= x1, lambda a, b: ix(a, b, x1)),
        (lambda p: p[1] >= y0, lambda a, b: iy(a, b, y0)),
        (lambda p: p[1] <= y1, lambda a, b: iy(a, b, y1)),
    ):
        if not pts: break
        pts = clip(pts, inside, cross)
    return pts

def simplify(points, tol):
    """Douglas-Peucker（反復版）"""
    if len(points) < 4: return points
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]; bx, by = points[b]
        dx, dy = bx - ax, by - ay; norm = math.hypot(dx, dy)
        best, idx = 0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            # 閉じたリング（始点＝終点）は線分が潰れるので点との距離で測る
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm if norm > 1e-12 else math.hypot(px - ax, py - ay)
            if d > best: best, idx = d, i
        if best > tol:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]

def simplify_keep(points, tol):
    """簡略化して形が潰れる（4点未満）なら元のまま"""
    s = simplify(points, tol)
    return s if len(s) >= 4 else points

def bbox_hit(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return not (max(xs) < BBOX[0] or min(xs) > BBOX[2] or max(ys) < BBOX[1] or min(ys) > BBOX[3])

def rnd(p): return [round(p[0], ROUND), round(p[1], ROUND)]

# --- 陸地
rings = []
for name in ('ne_10m_land.geojson', 'ne_10m_minor_islands.geojson'):
    for f in json.load(open(os.path.join(NE_DIR, name)))['features']:
        g = f['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            outer = poly[0]                      # 湖などの穴は省略（地図用途）
            if not bbox_hit(outer): continue
            clipped = clip_ring(outer, BBOX)
            if len(clipped) < 3: continue
            s = simplify(clipped, SIMPLIFY_DEG)
            if len(s) >= 3: rings.append([rnd(p) for p in s])
json.dump({'source': 'Natural Earth 10m (public domain)', 'rings': rings},
          open(os.path.join(OUT, 'land.json'), 'w'), separators=(',', ':'))

# --- OpenAIP
def load(name): return json.load(open(os.path.join(AIP_DIR, name)))['features']
def limit(l):
    unit = {0: 'm', 1: 'ft', 6: 'FL'}.get(l['unit'], '?'); datum = {0: 'GND', 1: 'MSL', 2: 'STD'}.get(l['referenceDatum'], '?')
    return {'v': l['value'], 'u': unit, 'd': datum}

def airspace_class(p):
    name, t = p['name'].upper(), p['type']
    if t == 4: return 'ctr'
    if t == 1: return 'restricted'
    if t == 2: return 'danger'
    if t == 21: return 'glider'
    for key, cls in ((' TCA', 'tca'), (' ACA', 'aca'), (' PCA', 'pca'), ('INFO ZONE', 'info'), ('HELI', 'heli')):
        if key in name: return cls
    return 'other'

air = []
for f in load('jp_asp.geojson'):
    p = f['properties']; ring = f['geometry']['coordinates'][0]
    air.append({'id': p['_id'], 'n': p['name'], 'c': airspace_class(p), 'up': limit(p['upperLimit']), 'lo': limit(p['lowerLimit']),
                'g': [rnd(q) for q in simplify_keep([tuple(q[:2]) for q in ring], SIMPLIFY_DEG / 4)]})

APT = {0: 'airport', 1: 'glider', 2: 'airfield', 3: 'intl', 4: 'heli-mil', 5: 'mil', 7: 'heli', 9: 'ifr'}
def elev_ft(e):
    return round(e.get('value', 0) * (3.28084 if e.get('unit', 0) == 0 else 1))

# 標高は ft に統一
apt = [{'id': f['properties']['_id'], 'n': f['properties']['name'], 'icao': f['properties'].get('icaoCode', ''),
        't': APT.get(f['properties']['type'], 'other'), 'elev': elev_ft(f['properties']['elevation']),
        'p': rnd(f['geometry']['coordinates'])} for f in load('jp_apt.geojson')]

NAV = {0: 'DME', 1: 'TACAN', 2: 'NDB', 3: 'VOR', 4: 'VOR-DME', 5: 'VORTAC', 6: 'DVOR', 7: 'DVOR-DME', 8: 'DVORTAC'}
nav = []
for f in load('jp_nav.geojson'):
    p = f['properties']; fr = p.get('frequency') or {}
    # dec：局の公表偏差（E=正/W=負）。ラジアルはこの値で磁方位⇔真方位を換算する
    nav.append({'id': p['_id'], 'n': p['name'], 'ident': p.get('identifier', ''), 't': NAV.get(p['type'], '?'),
                'f': fr.get('value', ''), 'dec': p.get('magneticDeclination'), 'p': rnd(f['geometry']['coordinates'])})

M_TO_FT = 3.28084
obs = []
for f in load('jp_obs.geojson'):
    p = f['properties']; e = p.get('elevation') or {}
    ft = e.get('value', 0) * (M_TO_FT if e.get('unit', 0) == 0 else 1)
    obs.append({'e': round(ft), 'p': rnd(f['geometry']['coordinates'])})

credit = 'OpenAIP (CC BY-NC 4.0) openaip.net'
for name, items in (('airspace', air), ('airports', apt), ('navaids', nav), ('obstacles', obs)):
    json.dump({'source': credit, 'items': items}, open(os.path.join(OUT, f'{name}.json'), 'w'),
              ensure_ascii=False, separators=(',', ':'))

for name in ('land', 'airspace', 'airports', 'navaids', 'obstacles'):
    print(name, os.path.getsize(os.path.join(OUT, f'{name}.json')))
print('land rings', len(rings), 'points', sum(map(len, rings)))
