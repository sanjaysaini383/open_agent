import json, glob, os, collections
files = sorted(glob.glob('.hyperframes/artifacts/checks/*.json'), key=os.path.getmtime)
d = json.load(open(files[-1], encoding='utf8'))
print('ok:', d.get('ok'))
def walk(o):
    if isinstance(o, dict):
        if 'severity' in o and ('code' in o or 'rule' in o):
            yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)
items = list(walk(d))
c = collections.Counter((i.get('severity'), i.get('code') or i.get('rule')) for i in items)
for (sev, code), n in sorted(c.items()):
    print(f'{sev:8} {n:3}  {code}')
print('---')
seen = set()
for i in items:
    key = (i.get('severity'), i.get('code') or i.get('rule'))
    if key in seen or i.get('severity') == 'info':
        continue
    seen.add(key)
    print(f"[{i.get('severity')}] {key[1]}: {(i.get('message') or '')[:230]} | {i.get('selector', '')} {os.path.basename(i.get('sourceFile') or '')}")
