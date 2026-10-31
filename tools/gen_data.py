# -*- coding: utf-8 -*-
"""生成 js/data.js：全建筑目录 + 配方 + 物品（含占地/端口/供电与武器范围）"""
import json, os

REF = r'C:\Users\L\Desktop\Dysen\tools\ref'
OUT = r'C:\Users\L\Desktop\Dysen\js\data.js'
CATALOG = json.load(open(os.path.join(REF, '..', 'probe', 'catalog_raw.json'), encoding='utf-8'))
VANILLA = json.load(open(os.path.join(REF, 'dspcalc', 'data__Vanilla.json'), encoding='utf-8-sig'))

# 建筑元数据：cat=分类, speed=速度倍率, power=满速功率MW, ports=(上,右,下,左) 可接分拣器口数,
# powerR=供电半径(格), weaponR=武器射程(格)。半径/功率为参考值，界面里可调。
META = {
    2001: ('belt', 0, 0, (0, 0, 0, 0), 0, 0),
    2002: ('belt', 0, 0, (0, 0, 0, 0), 0, 0),
    2003: ('belt', 0, 0, (0, 0, 0, 0), 0, 0),
    2011: ('sorter', 0, 0, (0, 0, 0, 0), 0, 0),
    2012: ('sorter', 0, 0, (0, 0, 0, 0), 0, 0),
    2013: ('sorter', 0, 0, (0, 0, 0, 0), 0, 0),
    2014: ('sorter', 0, 0, (0, 0, 0, 0), 0, 0),
    2020: ('logistics', 0, 0, (1, 1, 1, 1), 0, 0),
    2030: ('logistics', 0, 0, (0, 0, 0, 0), 0, 0),
    2040: ('logistics', 0, 0, (0, 0, 0, 0), 0, 0),
    2101: ('logistics', 0, 0, (1, 1, 1, 1), 0, 0),
    2102: ('logistics', 0, 0, (1, 1, 1, 1), 0, 0),
    2103: ('logistics', 0, 0.36, (2, 2, 2, 2), 0, 0),
    2104: ('logistics', 0, 1.8, (2, 2, 2, 2), 0, 0),
    2105: ('logistics', 0, 0, (0, 0, 0, 0), 0, 0),
    2106: ('logistics', 0, 0, (1, 1, 1, 1), 0, 0),
    2107: ('logistics', 0, 0, (1, 1, 1, 1), 0, 0),
    2201: ('power', 0, 0, (0, 0, 0, 0), 12, 0),
    2202: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2203: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2204: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2205: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2206: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2207: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2208: ('power', 0, 0, (0, 0, 0, 0), 24, 0),
    2209: ('power', 0, 1.0, (0, 0, 0, 0), 0, 0),
    2210: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2211: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2212: ('power', 0, 0, (0, 0, 0, 0), 34, 0),
    2213: ('power', 0, 0, (0, 0, 0, 0), 0, 0),
    2301: ('miner', 1.0, 0.42, (1, 1, 1, 1), 0, 0),
    2302: ('machine', 1.0, 0.36, (1, 1, 1, 1), 0, 0),
    2303: ('machine', 0.75, 0.27, (1, 1, 1, 1), 0, 0),
    2304: ('machine', 1.0, 0.54, (1, 1, 1, 1), 0, 0),
    2305: ('machine', 1.5, 1.08, (1, 1, 1, 1), 0, 0),
    2306: ('miner', 1.0, 0.3, (1, 1, 1, 1), 0, 0),
    2307: ('miner', 1.0, 0.6, (1, 1, 1, 1), 0, 0),
    2308: ('machine', 1.0, 0.6, (1, 1, 1, 1), 0, 0),
    2309: ('machine', 1.0, 0.6, (2, 1, 1, 1), 0, 0),
    2310: ('machine', 1.0, 1.2, (2, 2, 2, 2), 0, 0),
    2311: ('machine', 0, 1.2, (1, 1, 1, 1), 0, 0),
    2312: ('machine', 0, 2.4, (1, 1, 1, 1), 0, 0),
    2313: ('machine', 0, 0.06, (0, 1, 0, 1), 0, 0),
    2314: ('machine', 1.0, 0.6, (1, 1, 1, 1), 0, 0),
    2315: ('machine', 2.0, 0.72, (1, 1, 1, 1), 0, 0),
    2316: ('miner', 1.0, 1.0, (1, 1, 1, 1), 0, 0),
    2317: ('machine', 2.0, 1.2, (2, 1, 1, 1), 0, 0),
    2318: ('machine', 2.0, 1.62, (1, 1, 1, 1), 0, 0),
    2319: ('machine', 3.0, 1.08, (1, 1, 1, 1), 0, 0),
    2901: ('lab', 1.0, 0.48, (2, 2, 2, 2), 0, 0),
    2902: ('lab', 3.0, 1.2, (2, 2, 2, 2), 0, 0),
    3001: ('defense', 0, 0, (0, 0, 0, 0), 0, 32),
    3002: ('defense', 0, 0, (0, 0, 0, 0), 0, 40),
    3003: ('defense', 0, 0, (0, 0, 0, 0), 0, 45),
    3004: ('defense', 0, 0, (0, 0, 0, 0), 0, 55),
    3005: ('defense', 0, 0, (0, 0, 0, 0), 0, 60),
    3006: ('defense', 0, 0, (0, 0, 0, 0), 0, 30),
    3007: ('defense', 0, 0, (0, 0, 0, 0), 0, 0),
    3008: ('defense', 0, 0, (0, 0, 0, 0), 0, 60),
    3009: ('defense', 0, 0, (0, 0, 0, 0), 0, 0),
    3010: ('defense', 0, 0, (0, 0, 0, 0), 0, 50),
}

# 占地（格）。来自游戏常识 + 蓝图回归校验，可在界面里逐个调整。
SIZE = {
    2001: (1, 1), 2002: (1, 1), 2003: (1, 1),
    2011: (1, 1), 2012: (1, 1), 2013: (1, 1), 2014: (1, 1),
    2020: (1, 1), 2030: (1, 1), 2040: (2, 2),
    2101: (1, 1), 2102: (2, 2), 2103: (3, 3), 2104: (3, 3), 2105: (4, 4), 2106: (2, 2), 2107: (1, 1),
    2201: (1, 1), 2202: (1, 1), 2203: (1, 1), 2204: (2, 2), 2205: (2, 2), 2206: (2, 2), 2207: (2, 2),
    2208: (1, 1), 2209: (2, 2), 2210: (4, 4), 2211: (4, 4), 2212: (2, 2), 2213: (4, 4),
    2301: (3, 3), 2302: (3, 3), 2303: (3, 3), 2304: (3, 3), 2305: (3, 3), 2306: (1, 1), 2307: (2, 2),
    2308: (4, 2), 2309: (5, 3), 2310: (5, 5), 2311: (3, 3), 2312: (3, 3), 2313: (2, 1),
    2314: (2, 2), 2315: (3, 3), 2316: (5, 5), 2317: (5, 3), 2318: (3, 3), 2319: (3, 3),
    2901: (3, 3), 2902: (3, 3),
    3001: (2, 2), 3002: (2, 2), 3003: (2, 2), 3004: (2, 2), 3005: (2, 2), 3006: (2, 2),
    3007: (2, 2), 3008: (3, 3), 3009: (3, 3), 3010: (2, 2),
}

PORTS_BORDER = {
    2302: (1, 1), 2303: (1, 1), 2304: (1, 1), 2305: (1, 1),
    2308: (1, 1), 2309: (2, 1), 2310: (2, 2),
    2315: (1, 1), 2317: (2, 1), 2318: (1, 1), 2319: (1, 1),
    2901: (2, 2), 2902: (2, 2),
}
NO_PORT = {2001, 2002, 2003, 2011, 2012, 2013, 2014, 2313}


def ports_for(iid, w, h):
    if iid in NO_PORT:
        return (0, 0, 0, 0)
    if iid in PORTS_BORDER:
        t, b = PORTS_BORDER[iid]
        lr = max(1, min(t, b))
        return (min(t, w), min(lr, h), min(b, w), min(lr, h))
    return (w, h, w, h)


items = []
seen = set()
for it in VANILLA['items']:
    items.append({'id': it['ID'], 'name': it['Name'], 'icon': it.get('IconName', ''), 'type': it.get('Type', 0)})
    seen.add(it['ID'])

recipes = []
for r in VANILLA['recipes']:
    recipes.append({
        'id': r['ID'], 'name': r['Name'], 'time': r['TimeSpend'],
        'ins': [[a, b] for a, b in zip(r['Items'], r['ItemCounts'])],
        'outs': [[a, b] for a, b in zip(r['Results'], r['ResultCounts'])],
        'factories': r['Factories'], 'prolif': r.get('Proliferator', 0), 'type': r.get('Type', 0),
    })

buildings = []
for row in CATALOG:
    iid = row['id']
    if not (2000 <= iid < 4000):
        continue
    if iid not in META:
        continue
    cat, speed, power, ports, powerR, weaponR = META[iid]
    w, h = SIZE.get(iid, (2, 2))
    buildings.append({
        'id': iid, 'name': row['name'].replace('\xa0', ' '),
        'model': row['models'][0] if row['models'] else 0,
        'w': w, 'h': h, 'cat': cat, 'speed': speed, 'power': power,
        'ports': {'t': ports_for(iid, w, h)[0], 'r': ports_for(iid, w, h)[1],
                  'b': ports_for(iid, w, h)[2], 'l': ports_for(iid, w, h)[3]},
        'powerR': powerR, 'weaponR': weaponR,
        'alias': row.get('alias') or ''
    })
    if iid not in seen:
        items.append({'id': iid, 'name': row['name'].replace('\xa0', ' '), 'icon': row.get('icon', ''), 'type': 0})
        seen.add(iid)

buildings.sort(key=lambda b: (b['cat'], -b['w'] * b['h'], b['id']))
items.sort(key=lambda i: i['id'])
recipes.sort(key=lambda r: r['id'])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// 自动生成：物品 / 配方 / 建筑（全建筑目录）\n')
    f.write('window.DSP_DATA = {\n')
    f.write('  items: ' + json.dumps(items, ensure_ascii=False, separators=(',', ':')) + ',\n')
    f.write('  recipes: ' + json.dumps(recipes, ensure_ascii=False, separators=(',', ':')) + ',\n')
    f.write('  buildings: ' + json.dumps(buildings, ensure_ascii=False, separators=(',', ':')) + ',\n')
    f.write('};\n')

print('items', len(items), 'recipes', len(recipes), 'buildings', len(buildings))
print('cats:', sorted(set(b['cat'] for b in buildings)))