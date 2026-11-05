#!/usr/bin/env python3
"""Rebuild the site's data files from the SomaliScan federal_grants table.

Usage: python build_data.py <federal_grants parquet> <output data folder>
Source file (CC0): huggingface.co/datasets/somaliscan/spending-archive
                   federal_grants/_year=2024/data_0.parquet
Needs: pip install duckdb
"""
import collections, json, os, re, sys
import duckdb

PARQUET, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
START, END = '2024-01-01', '2024-09-30'
PUBLIC_MIN = 5_000_000   # personal-looking names stay unlisted below this total
SEARCH_MIN = 250_000     # smallest recipient included in site search
COUNTY_LIST_MAX = 200    # recipients listed per county

L = json.load(open(f'{HERE}/geo_lookup.json'))
shapes = json.load(open(f'{HERE}/shapes.json'))
cmap, names, ST, sn = L['cmap'], L['names'], L['ST'], L['sn']
STATE_NAMES = {ST[k]: sn[k] for k in sn if k in ST}
STATE_NAMES.update({'PR': 'Puerto Rico', 'GU': 'Guam', 'VI': 'U.S. Virgin Islands', 'AS': 'American Samoa',
                    'MP': 'Northern Mariana Islands', 'FM': 'Micronesia', 'MH': 'Marshall Islands', 'PW': 'Palau'})
CT_REGIONS = {'CAPITOL': 'HARTFORD', 'SOUTH CENTRAL CONNECTICUT': 'NEW HAVEN', 'GREATER BRIDGEPORT': 'FAIRFIELD',
              'WESTERN CONNECTICUT': 'FAIRFIELD', 'LOWER CONNECTICUT RIVER VALLEY': 'MIDDLESEX',
              'NAUGATUCK VALLEY': 'NEW HAVEN', 'NORTHEASTERN CONNECTICUT': 'WINDHAM',
              'NORTHWEST HILLS': 'LITCHFIELD', 'SOUTHEASTERN CONNECTICUT': 'NEW LONDON'}
EXCLUDED = "('MULTIPLE RECIPIENTS','REDACTED DUE TO PII','INDIVIDUAL RECIPIENT','MULTIPLE FOREIGN RECIPIENTS')"

def nz(s):
    s = (s or '').upper().replace('.', '').replace("'", '').replace('-', ' ')
    s = re.sub(r'\b(COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPALITY|CITY AND BOROUGH|MUNICIPIO)\b', '', s)
    s = s.replace('SAINT ', 'ST ').replace('STE ', 'ST ')
    return re.sub(r'\s+', ' ', s).strip().replace(' ', '')

CITY = {(ST[f[:2]], nz(n)): f for f, n in names.items() if int(f[2:]) >= 510 and f[:2] in ('51', '24', '29', '32')}

def fips(st, county):
    if not county:
        return None
    u = county.upper().strip()
    if st == 'CT':
        u = CT_REGIONS.get(u, u)
    if u.endswith('(CITY)'):
        b = nz(u[:-6])
        return CITY.get((st, b)) or cmap.get(f'{st}|{b}')
    return cmap.get(f'{st}|{nz(u)}')

ORG = re.compile(r"\b(INC|LLC|L\.?L\.?C|LLP|LP|CORP|CORPORATION|CO|COMPANY|LTD|FOUNDATION|ASSOCIATION|ASSN|ASSOC|SOCIETY|UNIVERSITY|UNIV|COLLEGE|SCHOOL|SCHOOLS|DISTRICT|DIST|BOARD|COUNTY|CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|PARISH|STATE|STATES|DEPARTMENT|DEPT|DIVISION|OFFICE|AUTHORITY|AUTH|AGENCY|COMMISSION|COUNCIL|COMMITTEE|CENTER|CENTERS|CENTRE|HOSPITAL|HEALTH|CLINIC|MEDICAL|CARE|SERVICES|SERVICE|SVCS|TRIBE|TRIBAL|NATION|INDIAN|NATIVE|VILLAGES|CHURCH|MINISTRIES|INSTITUTE|INST|ACADEMY|TRUST|BANK|CREDIT|UNION|FUND|PARTNERS|PARTNERSHIP|GROUP|HOUSING|FARMS|FARM|RANCH|RANCHES|DAIRY|ENTERPRISES|ALLIANCE|NETWORK|PROJECT|PROGRAM|COMMUNITY|COMMUNITIES|ORGANIZATION|ORG|SYSTEM|SYSTEMS|TECHNOLOGIES|ENERGY|ELECTRIC|POWER|WATER|TELEPHONE|TELECOM|COMMUNICATIONS|GOVERNMENT|COMMONWEALTH|REGENTS|TRUSTEES|CONSORTIUM|COOPERATIVE|COOP|AIRPORT|PORT|TRANSIT|TRANSPORTATION|ACTION|CHILDREN|FAMILY|FAMILIES|UNITED|NATIONAL|AMERICAN|INTERNATIONAL)\b")

def person_like(n):
    if ORG.search(n) or re.search(r'\d', n):
        return False
    t = re.findall(r"[A-Z'\-]+", n.upper())
    return 1 < len(t) <= 5

def listed(name, amount):
    return amount > 0 and (not person_like(name) or amount >= PUBLIC_MIN)

SMALL = {'And': 'and', 'Of': 'of', 'For': 'for', 'To': 'to', 'The': 'the', 'In': 'in', 'On': 'on'}
def title(p):
    if not p:
        return 'Program not specified'
    w = p.strip().title().split(' ')
    return ' '.join(SMALL.get(x, x) if i else x for i, x in enumerate(w))

def agency(g):
    return (g or 'Not specified').replace('Department of the ', '').replace('Department of ', '')

c = duckdb.connect()
c.execute(f"""CREATE TABLE raw AS SELECT row_number() over () rid,
  coalesce(assistance_type, award_type, '(blank)') t, award_id, transaction_id, recipient_name, recipient_uei,
  recipient_state, recipient_county, recipient_city, recipient_country, award_amount::DOUBLE amt, award_date,
  cfda_number, cfda_title, awarding_agency, raw_data IS NOT NULL has_raw
  FROM read_parquet('{PARQUET}')""")

# 1. Count each award action once. The source repeats many actions with and without a transaction ID.
c.execute("""CREATE TABLE d AS
WITH a AS (SELECT *, row_number() over (partition by award_id, award_date, amt, coalesce(transaction_id,'') order by rid) rn FROM raw),
b AS (SELECT * EXCLUDE rn FROM a WHERE rn=1),
n AS (SELECT award_id, award_date, amt, count(*) c FROM b WHERE transaction_id IS NOT NULL GROUP BY 1,2,3),
nul AS (SELECT b.*, row_number() over (partition by b.award_id, b.award_date, b.amt order by rid) k FROM b WHERE transaction_id IS NULL)
SELECT * FROM b WHERE transaction_id IS NOT NULL
UNION ALL SELECT nul.* EXCLUDE k FROM nul LEFT JOIN n
  ON nul.award_id=n.award_id AND nul.award_date=n.award_date AND nul.amt=n.amt WHERE nul.k > coalesce(n.c,0)""")

# 2. Drop whole-award totals, keep one comparable period, and keep organizations in the US.
c.execute(f"""CREATE TABLE s AS SELECT *, coalesce(nullif(recipient_uei,''), recipient_name) k FROM d
  WHERE NOT has_raw AND award_date BETWEEN '{START}' AND '{END}' AND recipient_name NOT IN {EXCLUDED}
  AND t NOT LIKE 'DIRECT PAYMENT WITH UNRESTRICTED%' AND t NOT LIKE 'INSURANCE%' AND t NOT LIKE '%LOAN%'
  AND coalesce(recipient_country,'USA')='USA'""")

one = lambda q: c.execute(q).fetchone()[0]
funnel = [
    ['Rows in the archive for 2024', one('select sum(amt) from raw')],
    ['After removing repeated award actions', one('select sum(amt) from d')],
    ['January to September only, without whole-award totals',
     one(f"select sum(amt) from d where not has_raw and award_date between '{START}' and '{END}'")],
    ['Without records grouped as multiple recipients, redacted or individual',
     one(f"select sum(amt) from d where not has_raw and award_date between '{START}' and '{END}' and recipient_name not in {EXCLUDED}")],
    ['Without pensions, insurance, loans and foreign recipients', one('select sum(amt) from s')],
]

prog = {(r[0], r[1]): r[2] for r in c.execute(
    """SELECT k, recipient_state, cfda_title FROM (SELECT k, recipient_state, cfda_title, sum(amt) x FROM s GROUP BY 1,2,3)
       QUALIFY row_number() over (partition by k, recipient_state order by x desc)=1""").fetchall()}
rows = c.execute("""SELECT recipient_state, recipient_county, k, mode(recipient_name), mode(recipient_city), sum(amt), count(*)
                    FROM s GROUP BY 1,2,3""").fetchall()

county = collections.defaultdict(lambda: {'a': 0.0, 'r': []})
state = collections.defaultdict(lambda: {'a': 0.0, 'n': 0, 'u': 0.0, 'by': {}})
for st, cn, k, nm, cy, a, n in rows:
    f = fips(st, cn)
    S = state[st]
    S['a'] += a; S['n'] += n
    x = S['by'].setdefault(k, [0.0, nm, cy, 0])
    x[0] += a; x[3] += n
    if f:
        county[f]['a'] += a
        county[f]['r'].append((nm, a, cy, k, n))
    else:
        S['u'] += a

ags = collections.defaultdict(list)
nat_ag = collections.Counter()
for st, g, a in c.execute('SELECT recipient_state, awarding_agency, sum(amt) FROM s GROUP BY 1,2').fetchall():
    ags[st].append((agency(g), a)); nat_ag[agency(g)] += a

os.makedirs(f'{OUT}/st', exist_ok=True)
def dump(path, obj):
    with open(f'{OUT}/{path}', 'w', encoding='utf8') as fh:
        json.dump(obj, fh, separators=(',', ':'), ensure_ascii=False)

search = []
summary = {}
pages = {}
for st, v in sorted(state.items()):
    pids, plist = {}, []
    def pid(p):
        p = title(p)
        if p not in pids:
            pids[p] = len(plist); plist.append(p)
        return pids[p]
    out_c = {}
    for f in [f for f in county if ST[f[:2]] == st]:
        cv = county[f]
        pub = sorted([r for r in cv['r'] if listed(r[0], r[1])], key=lambda r: -r[1])
        hidden = sum(1 for r in cv['r'] if r[1] > 0 and not listed(r[0], r[1]))
        out_c[f] = {'n': names[f], 'a': round(cv['a']), 'c': len(cv['r']), 'h': hidden, 'l': len(pub),
                    'r': [[r[0], round(r[1]), (r[2] or '').title(), pid(prog.get((r[3], st))), r[4]] for r in pub[:COUNTY_LIST_MAX]]}
        search += [[r[0], f, round(r[1])] for r in pub if r[1] >= SEARCH_MIN]
    ranked = sorted(v['by'].items(), key=lambda kv: -kv[1][0])
    pub = [(k, x) for k, x in ranked if listed(x[1], x[0])]
    top = [[x[1], round(x[0]), (x[2] or '').title(), pid(prog.get((k, st))), x[3]] for k, x in pub[:COUNTY_LIST_MAX if st not in shapes['s'] else 10]]
    if st not in shapes['s']:
        search += [[x[1], st, round(x[0])] for k, x in pub if x[0] >= SEARCH_MIN]
    g = [[n, round(a)] for n, a in sorted(ags[st], key=lambda z: -z[1])[:5]]
    rec = {'st': st, 'n': STATE_NAMES.get(st, st), 'a': round(v['a']), 'c': len(v['by']), 'aw': v['n'], 'u': round(v['u']),
           'g': g, 't': top, 'p': plist, 'co': out_c,
           's': {f: shapes['c'][f] for f in shapes['c'] if ST[f[:2]] == st} if st in shapes['s'] else {},
           'b': shapes['s'][st][1] if st in shapes['s'] else None}
    dump(f'st/{st}.json', rec)
    summary[st] = {'n': rec['n'], 'a': rec['a'], 'c': rec['c'], 'map': st in shapes['s']}
    pages[st] = rec

def nat_top(limit):
    q = f"""WITH a AS (SELECT k, mode(recipient_name) nm, sum(amt) x, count(*) n, mode(recipient_state) st, mode(recipient_county) cn, mode(recipient_city) cy FROM s GROUP BY 1)
            SELECT nm, x, st, cn, cy, n, k FROM a WHERE x>0 ORDER BY x DESC LIMIT {limit*2}"""
    p = {r[0]: r[1] for r in c.execute("""SELECT k, cfda_title FROM (SELECT k, cfda_title, sum(amt) x FROM s GROUP BY 1,2)
                                          QUALIFY row_number() over (partition by k order by x desc)=1""").fetchall()}
    res = []
    for nm, x, st, cn, cy, n, k in c.execute(q).fetchall():
        if listed(nm, x):
            res.append([nm, round(x), st, fips(st, cn) or st, (cy or '').title(), title(p.get(k)), n])
    return res[:limit]

top500 = nat_top(500)
programs = [[r[0] or '', title(r[1]), agency(r[2]), round(r[3]), r[4], r[5]] for r in c.execute(
    """SELECT cfda_number, mode(cfda_title), mode(awarding_agency), sum(amt) a, count(distinct k), count(*) FROM s
       WHERE cfda_number IS NOT NULL GROUP BY 1 HAVING sum(amt)>0 ORDER BY a DESC LIMIT 150""").fetchall()]
total = sum(v['a'] for v in state.values())
nation = {'a': round(total), 'c': one('select count(distinct k) from s'), 'aw': sum(v['n'] for v in state.values()),
          'g': [[n, round(a)] for n, a in nat_ag.most_common(5)],
          't': [[r[0], r[1], r[4], r[5], r[6]] for r in top500[:10]],
          'states': summary, 'funnel': [[a, round(b)] for a, b in funnel], 'period': 'January to September 2024'}
search.sort(key=lambda r: -r[2])
dump('nation.json', nation)
dump('shapes.json', {'s': {k: v for k, v in shapes['s'].items()}, 'm': shapes['m']})
dump('search.json', search)
dump('top.json', top500)
dump('programs.json', programs)
print(json.dumps({'total': round(total), 'recipients': nation['c'], 'actions': nation['aw'], 'funnel': nation['funnel'],
                  'county_sum': round(sum(v['a'] for v in county.values())), 'unmapped': round(sum(v['u'] for v in state.values())),
                  'search': len(search), 'top': len(top500), 'programs': len(programs), 'states': len(summary)}))
