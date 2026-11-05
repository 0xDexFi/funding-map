#!/usr/bin/env python3
"""Assemble the static site from web/ and the data folder.

Usage: python build_site.py <data folder> <output folder>
"""
import html, json, os, re, shutil, sys

DATA, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, '..', 'web')
CONTACT = os.environ.get('CONTACT', '').strip()   # shown on the About page when set
SITE_URL = os.environ.get('SITE_URL', '').strip().rstrip('/')   # enables the social preview image when set
SITE = 'Recipient Map USA'
DESC = 'See who received US federal grants and similar funding from January to September 2024, by state and county.'

load = lambda p: json.load(open(os.path.join(DATA, p), encoding='utf8'))
esc = html.escape
N = load('nation.json')
programs = load('programs.json')
top = load('top.json')
lookup = json.load(open(os.path.join(HERE, 'geo_lookup.json')))

def money(v):
    n, s = abs(v), '−' if v < 0 else ''
    if n >= 1e12: return f'{s}${n/1e12:.2f}T'
    if n >= 1e9: return f'{s}${n/1e9:.1f}B'
    if n >= 1e6: return f'{s}${n/1e6:.1f}M'
    if n >= 1e3: return f'{s}${n/1e3:.0f}K'
    return f'{s}${n:.0f}'

def page(path, title, body, *, root, active='', desc=DESC, attrs=''):
    full = title if title == SITE else f'{title} | {SITE}'
    nav = ''.join(f'<a href="{root}{h}"{" aria-current=\"page\"" if active == k else ""}>{t}</a>'
                  for k, h, t in [('map', '', 'Map'), ('recipients', 'recipients/', 'Recipients'),
                                  ('programs', 'programs/', 'Programs'), ('about', 'about/', 'About')])
    og = f'<meta property="og:image" content="{SITE_URL}/assets/og.png">\n<meta name="twitter:card" content="summary_large_image">' if SITE_URL else ''
    doc = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{esc(full)}</title>
<meta name="description" content="{esc(desc)}">
<meta property="og:title" content="{esc(full)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:type" content="website">
{og}
<link rel="icon" href="{root}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Libre+Franklin:wght@400;500;600;800&display=swap">
<link rel="stylesheet" href="{root}assets/style.css">
</head>
<body data-root="{root or './'}" {attrs}>
<a class="skip" href="#content">Skip to content</a>
<div class="topbar"><div class="topin">
  <a class="brand" href="{root or './'}">{SITE}</a>
  <nav aria-label="Main">{nav}</nav>
</div></div>
<main class="wrap" id="content">
{body}
</main>
<footer><div class="footin">
  <p>Independent project, not a government site. A listing shows who received money and says nothing about misuse.</p>
  <p>Data: <a href="https://huggingface.co/datasets/somaliscan/spending-archive" rel="noopener">SomaliScan archive</a> (CC0), drawn from <a href="https://www.usaspending.gov/" rel="noopener">USAspending.gov</a>. Map shapes: <a href="https://github.com/topojson/us-atlas" rel="noopener">us-atlas</a>.</p>
</div></footer>
<div id="tip" hidden></div>
<script src="{root}assets/app.js" defer></script>
</body>
</html>
'''
    target = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    open(target, 'w', encoding='utf8').write(doc)

def row_list(list_, prog):
    if not list_:
        return '<p class="empty">No organizations to list here.</p>'
    m = max(1, list_[0][1])
    out = []
    for r in list_:
        meta = ' · '.join(x for x in [r[2], prog(r[3])] if x)
        out.append(f'<li><span class="nm">{esc(r[0])}</span><span class="num">{money(r[1])}</span>'
                   f'<span class="bar"><i style="width:{max(1, r[1]/m*100):.1f}%"></i></span>'
                   + (f'<span class="meta">{esc(meta)}</span>' if meta else '') + '</li>')
    return '<ol class="rows">' + ''.join(out) + '</ol>'

def funders(g, total):
    li = ''.join(f'<li><span class="nm">{esc(x[0])}</span><span class="num">{money(x[1])}</span>'
                 f'<span class="bar"><i style="width:{max(1, x[1]/total*100):.1f}%"></i></span></li>' for x in g)
    return f'<div><h3>Largest funders</h3><ol class="rows">{li}</ol></div>'

def ledger(name, a, c, t, g, prog):
    return (f'<div><h2>{esc(name)}</h2></div><div><div class="big">{money(a)}</div>'
            f'<div class="sub">{c:,} recipients, net total</div></div>'
            f'<div><h3>Top recipients</h3>{row_list(t, prog)}</div>{funders(g, a)}')

def map_body(root, h1, led, crumb):
    terr = sorted([k for k, v in N['states'].items() if not v['map']], key=lambda k: -N['states'][k]['a'])
    links = ''.join(f'<a href="{root}{k.lower()}/" data-t="{k}">{esc(N["states"][k]["n"])}</a>' for k in terr)
    state_links = ' '.join(f'<a href="{root}{k.lower()}/">{esc(v["n"])}</a>'
                           for k, v in sorted(N['states'].items(), key=lambda kv: kv[1]['n']) if v['map'])
    return f'''<header class="hero">
  <h1 id="title">{esc(h1)}</h1>
  <p class="lede">Who received federal grants and similar funding from January to September 2024, shown by the recipient's county. A listing shows who got money. It says nothing about misuse.</p>
  <div class="stats"><span><b>{money(N['a'])}</b> net funding</span><span><b>{N['c']:,}</b> recipients</span><span><b>{N['aw']:,}</b> award actions</span></div>
</header>
<div class="tools">
  <div class="search">
    <input id="q" type="search" placeholder="Search a recipient, such as Mayo Clinic" aria-label="Search recipients" autocomplete="off">
    <div class="results" id="results" hidden></div>
  </div>
  <nav class="crumbs" id="crumbs" aria-label="Map location">{crumb}</nav>
</div>
<div class="main">
  <section class="plate" aria-label="Map of funding by location">
    <svg id="map" viewBox="0 0 975 610" role="group" aria-label="Map of the United States shaded by federal funding received"></svg>
    <div class="legend" id="legend"></div>
    <p class="caveat" id="hint">Money is placed at the recipient's address, and state agencies pass much of it on, so capital counties look large.</p>
    <div class="terr" id="terr"><span>Not drawn on the map:</span>{links}</div>
  </section>
  <aside class="ledger" id="ledger" aria-live="polite">{led}</aside>
</div>
<nav class="allstates" aria-label="All states"><h2>Browse by state</h2><p>{state_links}</p></nav>'''

# Assets
if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, 'assets'))
shutil.copytree(DATA, os.path.join(OUT, 'data'))
counties = dict(lookup['names'])
json.dump(counties, open(os.path.join(OUT, 'data', 'counties.json'), 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)
for f in ('app.js', 'style.css', 'favicon.svg'):
    shutil.copy(os.path.join(WEB, f), os.path.join(OUT, 'assets', f))
if os.path.exists(os.path.join(WEB, 'og.png')):
    shutil.copy(os.path.join(WEB, 'og.png'), os.path.join(OUT, 'assets', 'og.png'))
open(os.path.join(OUT, '_headers'), 'w').write('''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
/data/*
  Cache-Control: public, max-age=86400
/assets/*
  Cache-Control: public, max-age=3600
''')
open(os.path.join(OUT, 'robots.txt'), 'w').write('User-agent: *\nAllow: /\n')

# Map pages
same = lambda p: p
page('index.html', SITE, map_body('', SITE, ledger('United States', N['a'], N['c'], N['t'], N['g'], same), '<b>United States</b>'),
     root='', active='map', attrs='data-page="map"')
for st, v in N['states'].items():
    S = load(f'st/{st}.json')
    prog = lambda i: S['p'][i]
    t = S['t'][:10]
    crumb = f'<a href="../">United States</a><span>/</span><b>{esc(S["n"])}</b>'
    d = f'Federal funding recipients in {S["n"]}: {money(S["a"])} to {S["c"]:,} recipients from January to September 2024.'
    page(f'{st.lower()}/index.html', S['n'], map_body('../', f'{S["n"]} recipients', ledger(S['n'], S['a'], S['c'], t, S['g'], prog), crumb),
         root='../', active='map', desc=d, attrs=f'data-page="map" data-st="{st}"')

# Recipients
opts = ''.join(f'<option value="{k}">{esc(v["n"])}</option>' for k, v in sorted(N['states'].items(), key=lambda kv: kv[1]['n']))
trs = []
for i, r in enumerate(top, 1):
    place = r[3]
    href = f'../{r[2].lower()}/' + (f'?county={place}' if place[0].isdigit() else '')
    where = (counties.get(place, '') + ', ' if place in counties else '') + N['states'][r[2]]['n']
    trs.append(f'<tr><td class="num">{i}</td><td>{esc(r[0])}</td><td><a href="{href}">{esc(where)}</a></td><td class="prog">{esc(r[5])}</td><td class="num r">{money(r[1])}</td></tr>')
page('recipients/index.html', 'Recipients', f'''<header class="hero"><h1>Recipients</h1>
<p class="lede">Search organizations that received $250K or more, or browse the largest 500. Totals are net from January to September 2024.</p></header>
<div class="filters">
  <input id="rq" type="search" placeholder="Search by name" aria-label="Search by name" autocomplete="off">
  <select id="rs" aria-label="Filter by state"><option value="">All states</option>{opts}</select>
</div>
<p class="sub" id="rnote">The largest 500 recipients.</p>
<div class="tablewrap"><table class="data"><thead><tr><th>#</th><th>Recipient</th><th>Location</th><th>Main program</th><th class="r">Net amount</th></tr></thead>
<tbody id="rbody">{''.join(trs)}</tbody></table></div>''', root='../', active='recipients', attrs='data-page="recipients"')

# Programs
trs = ''.join(f'<tr><td class="num">{i}</td><td class="num">{esc(p[0])}</td><td>{esc(p[1])}</td><td>{esc(p[2])}</td><td class="num r">{p[4]:,}</td><td class="num r">{money(p[3])}</td></tr>'
              for i, p in enumerate(programs, 1))
page('programs/index.html', 'Programs', f'''<header class="hero"><h1>Programs</h1>
<p class="lede">The 150 largest federal programs by net funding from January to September 2024. Each program has an Assistance Listing number, shown here so you can look it up.</p></header>
<div class="tablewrap"><table class="data"><thead><tr><th>#</th><th>Listing</th><th>Program</th><th>Agency</th><th class="r">Recipients</th><th class="r">Net amount</th></tr></thead>
<tbody>{trs}</tbody></table></div>''', root='../', active='programs', attrs='data-page="programs"')

# About
fun = ''.join(f'<tr><td>{esc(a)}</td><td class="num r">${b/1e9:,.1f}B</td></tr>' for a, b in N['funnel'])
contact = (f'<section><h2>Corrections</h2><p>If a listing looks wrong, contact {esc(CONTACT)}. Include the recipient name and the county.</p></section>' if CONTACT else '')
page('about/index.html', 'About', f'''<header class="hero"><h1>About this map</h1>
<p class="lede">This site shows where federal grants and similar funding went, based on public records. It shows who received money. It does not show fraud, waste or misuse.</p></header>
<div class="prose">
<section><h2>How the total was built</h2><table class="data funnel"><tbody>{fun}</tbody></table></section>
<section><h2>What to keep in mind</h2><ul>
<li>Figures are net obligations reported to the government, including reductions. They are not audited and they are not cash spent.</li>
<li>Money is placed at the recipient's address. A state agency may pass funds to local groups in other counties.</li>
<li>The source table repeated many award actions, once with a transaction ID and once without. This site counts each action once.</li>
<li>Ohio, Minnesota and Washington also have whole-award totals that overlap their award actions, so those rows are removed. October to December is left out for every state because those three have only such rows for that period.</li>
<li>People are not listed by name. Payments reported as individuals or redacted are excluded, and names that look personal stay out of the lists unless they total $5M or more. This filter is automatic and may make mistakes.</li>
<li>Connecticut planning regions are matched to the nearest older county. About $19B has no county on the map, mostly U.S. territories.</li>
<li>Recipients are grouped by their federal ID where one exists. An organization with several IDs, such as a university with several campuses, appears more than once.</li>
</ul></section>
{contact}
<section><h2>Sources</h2><p>Funding data comes from the <a href="https://huggingface.co/datasets/somaliscan/spending-archive" rel="noopener">SomaliScan archive</a> (CC0), which draws on <a href="https://www.usaspending.gov/" rel="noopener">USAspending.gov</a>. This site is independent and is not connected to any government agency or to SomaliScan.</p></section>
</div>''', root='../', active='about', attrs='data-page="about"')

open(os.path.join(OUT, '404.html'), 'w', encoding='utf8').write(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | {SITE}</title>
<style>body{{font:16px/1.5 Arial,sans-serif;margin:0;padding:15vh 24px;background:#f4f7f5;color:#15231e;text-align:center}}a{{color:#0d6a4c}}@media(prefers-color-scheme:dark){{body{{background:#101715;color:#e8efec}}a{{color:#6fd3a8}}}}</style></head>
<body><h1>Page not found</h1><p>This page doesn't exist. <a href="/">Go to the map</a>.</p></body></html>''')

files = sum(len(fs) for _, _, fs in os.walk(OUT))
size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
big = max((os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs))
print(f'{files} files, {size/1e6:.1f} MB, largest {big/1e6:.1f} MB')
