#!/usr/bin/env python3
"""Build the site's data files straight from the official USAspending.gov API.

Usage: python fetch_data.py <output data folder> [cache folder]

The API is free and needs no key. Each response is cached in the cache folder
(default: .cache next to this script) so a rerun after an error resumes quickly.
Delete the cache folder to pull fresh numbers.
Needs only the Python standard library (3.10 or later).
"""
import collections, concurrent.futures as cf, hashlib, json, os, re, sys, time, urllib.request, urllib.error

OUT = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '.cache')
API = 'https://api.usaspending.gov/api/v2/'

FY = int(os.environ.get('FY', '2025'))       # fiscal year shown: October of FY-1 to September of FY
PREV = FY - 1                                 # compared against for the change view
GRANTS = ['02', '03', '04', '05']             # block, formula, project grants and cooperative agreements
PUBLIC_MIN = 5_000_000                        # personal-looking names stay unlisted below this total
SEARCH_MIN = 250_000                          # smallest recipient included in site search
LIST_MAX = 100                                # recipients listed per county
AGENCY_COUNT = 8                              # agencies offered as map filters
# Programs offered as map filters, by Assistance Listing number, with a short plain name.
PROGRAMS = {'93.778': 'Medicaid', '20.205': 'Highways', '97.036': 'Disaster recovery (FEMA)',
            '10.555': 'School lunch', '93.767': "Children's health insurance (CHIP)", '84.010': 'Title I schools',
            '93.558': 'Cash assistance (TANF)', '11.035': 'Broadband (BEAD)', '84.027': 'Special education',
            '93.600': 'Head Start', '20.507': 'Public transit', '14.228': 'Community development (CDBG)',
            '93.575': 'Child care', '10.557': 'WIC nutrition', '10.561': 'SNAP administration', '20.106': 'Airports'}

def period(fy):
    return [{'start_date': f'{fy - 1}-10-01', 'end_date': f'{fy}-09-30'}]

L = json.load(open(f'{HERE}/geo_lookup.json'))
shapes = json.load(open(f'{HERE}/shapes.json'))
ST, names, sn = L['ST'], L['names'], L['sn']
STATE_NAMES = {ST[k]: sn[k] for k in sn if k in ST}
STATE_NAMES.update({'PR': 'Puerto Rico', 'GU': 'Guam', 'VI': 'U.S. Virgin Islands', 'AS': 'American Samoa',
                    'MP': 'Northern Mariana Islands', 'FM': 'Micronesia', 'MH': 'Marshall Islands', 'PW': 'Palau'})
FIPS_OF = {v: k for k, v in ST.items()}
# USAspending files Connecticut under its nine planning regions. The map draws the older counties,
# so each region is placed in the county that holds most of it.
CT_REGIONS = {'110': '09003', '120': '09001', '130': '09007', '140': '09009', '150': '09015',
              '160': '09005', '170': '09009', '180': '09011', '190': '09001'}
EXCLUDED = {'MULTIPLE RECIPIENTS', 'REDACTED DUE TO PII', 'INDIVIDUAL RECIPIENT', 'MULTIPLE FOREIGN RECIPIENTS',
            'PRIVATE INDIVIDUAL', 'MISCELLANEOUS FOREIGN AWARDEES'}

# Requests ---------------------------------------------------------------------------------------
os.makedirs(CACHE, exist_ok=True)

def post(path, body):
    key = hashlib.sha1((path + json.dumps(body, sort_keys=True)).encode()).hexdigest()
    fn = os.path.join(CACHE, key + '.json')
    if os.path.exists(fn):
        return json.load(open(fn))
    data = json.dumps(body).encode()
    for attempt in range(7):
        try:
            req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json',
                                                                         'User-Agent': 'recipient-map-usa'})
            with urllib.request.urlopen(req, timeout=180) as r:
                out = json.load(r)
            with open(fn + '.tmp', 'w') as fh:
                json.dump(out, fh)
            os.replace(fn + '.tmp', fn)
            return out
        except (urllib.error.URLError, ConnectionError, TimeoutError, json.JSONDecodeError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code in (400, 422):
                raise RuntimeError(f'{path} rejected: {e.read()[:300]}')
            time.sleep(2 ** attempt)
    raise RuntimeError(f'{path} failed after retries')

def filters(fy, **extra):
    f = {'time_period': period(fy), 'award_type_codes': GRANTS}
    f.update(extra)
    return f

def geography(layer, fy, **extra):
    r = post('search/spending_by_geography/', {'scope': 'recipient_location', 'geo_layer': layer, 'filters': filters(fy, **extra)})
    return {x['shape_code']: x for x in r['results'] if x['shape_code']}

def category(cat, fy, limit=100, page=1, **extra):
    return post(f'search/spending_by_category/{cat}/', {'limit': limit, 'page': page, 'filters': filters(fy, **extra)})

def recipients(fy, loc, pages=1, **extra):
    out, page = [], 1
    while True:
        r = category('recipient', fy, 100, page, recipient_locations=[loc], **extra)
        out += r['results']
        if not r['page_metadata']['hasNext'] or page >= pages:
            return out, r['page_metadata']['hasNext']
        page += 1

def pmap(fn, items, workers=8):
    items = list(items)
    res, done = {}, 0
    with cf.ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(fn, i): i for i in items}
        for f in cf.as_completed(futs):
            res[futs[f]] = f.result()
            done += 1
            if done % 200 == 0 or done == len(items):
                print(f'  {done}/{len(items)}', flush=True)
    return res

# Cleanup helpers --------------------------------------------------------------------------------
ORG = re.compile(r"\b(INC|LLC|L\.?L\.?C|LLP|LP|CORP|CORPORATION|CO|COMPANY|LTD|FOUNDATION|ASSOCIATION|ASSN|ASSOC|SOCIETY|UNIVERSITY|UNIV|COLLEGE|SCHOOL|SCHOOLS|DISTRICT|DIST|BOARD|COUNTY|CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|PARISH|STATE|STATES|DEPARTMENT|DEPT|DIVISION|OFFICE|AUTHORITY|AUTH|AGENCY|COMMISSION|COUNCIL|COMMITTEE|CENTER|CENTERS|CENTRE|HOSPITAL|HEALTH|CLINIC|MEDICAL|CARE|SERVICES|SERVICE|SVCS|TRIBE|TRIBAL|NATION|INDIAN|NATIVE|VILLAGES|CHURCH|MINISTRIES|INSTITUTE|INST|ACADEMY|TRUST|BANK|CREDIT|UNION|FUND|PARTNERS|PARTNERSHIP|GROUP|HOUSING|FARMS|FARM|RANCH|RANCHES|DAIRY|ENTERPRISES|ALLIANCE|NETWORK|PROJECT|PROGRAM|COMMUNITY|COMMUNITIES|ORGANIZATION|ORG|SYSTEM|SYSTEMS|TECHNOLOGIES|ENERGY|ELECTRIC|POWER|WATER|TELEPHONE|TELECOM|COMMUNICATIONS|GOVERNMENT|COMMONWEALTH|REGENTS|TRUSTEES|CONSORTIUM|COOPERATIVE|COOP|AIRPORT|PORT|TRANSIT|TRANSPORTATION|ACTION|CHILDREN|FAMILY|FAMILIES|UNITED|NATIONAL|AMERICAN|INTERNATIONAL)\b")

def person_like(n):
    if ORG.search(n) or re.search(r'\d', n):
        return False
    t = re.findall(r"[A-Z'\-]+", n.upper())
    return 1 < len(t) <= 5

def listed(name, amount):
    return amount > 0 and name and name.upper() not in EXCLUDED and (not person_like(name) or amount >= PUBLIC_MIN)

def agency_short(n):
    return (n or 'Not specified').replace('Department of the ', '').replace('Department of ', '')

SMALL = {'And': 'and', 'Of': 'of', 'For': 'for', 'To': 'to', 'The': 'the', 'In': 'in', 'On': 'on', 'Or': 'or'}
def title(p):
    w = (p or 'Program not specified').strip().split(' ')
    return ' '.join(SMALL.get(x, x) if i else x for i, x in enumerate(w))

# Assistance Listing numbers start with a code for the agency that runs the program.
LISTING_AGENCY = {'10': 'Agriculture', '11': 'Commerce', '12': 'Defense', '14': 'Housing and Urban Development',
                  '15': 'Interior', '16': 'Justice', '17': 'Labor', '19': 'State', '20': 'Transportation',
                  '21': 'Treasury', '23': 'Appalachian Regional Commission', '43': 'NASA', '45': 'Arts and Humanities',
                  '47': 'National Science Foundation', '59': 'Small Business Administration', '64': 'Veterans Affairs',
                  '66': 'Environmental Protection Agency', '81': 'Energy', '84': 'Education', '93': 'Health and Human Services',
                  '94': 'AmeriCorps', '97': 'Homeland Security', '98': 'USAID'}

def rnd(x):
    return round(x or 0)

# 1. Totals by state and county, this year and last ---------------------------------------------
print('Totals by state and county')
st_now, st_prev = geography('state', FY), geography('state', PREV)
co_now, co_prev = geography('county', FY), geography('county', PREV)

# Connecticut: add up its planning regions and file them under the older counties.
ct_regions = list(CT_REGIONS)
def ct_total(args):
    fy, region, extra = args
    rows, _ = recipients(fy, {'country': 'USA', 'state': 'CT', 'county': region}, pages=100, **json.loads(extra))
    return sum(r['amount'] or 0 for r in rows)
def add_ct(target, fy, extra=None):
    totals = pmap(ct_total, [(fy, r, json.dumps(extra or {})) for r in ct_regions], 4)
    for (fy_, region, _), a in totals.items():
        f = CT_REGIONS[region]
        target.setdefault(f, {'shape_code': f, 'aggregated_amount': 0, 'population': None})
        target[f]['aggregated_amount'] += a
add_ct(co_now, FY)
add_ct(co_prev, PREV)

# 2. Map filters: the largest agencies and a set of well-known programs -------------------------
print('Map filters')
ag_rows = category('awarding_agency', FY, 20)['results']
agencies = [r for r in ag_rows if r['name']][:AGENCY_COUNT]
FILTERS = []      # [key, label, kind, api filter]
for r in agencies:
    FILTERS.append(['a:' + (r['code'] or str(r['id'])), agency_short(r['name']), 'agency',
                    {'agencies': [{'type': 'awarding', 'tier': 'toptier', 'name': r['name']}]}])
for code, label in PROGRAMS.items():
    FILTERS.append(['p:' + code, label, 'program', {'program_numbers': [code]}])
flt_state, flt_county = {}, {}
for key, label, kind, flt in FILTERS:
    print(' ', label, flush=True)
    for fy in (FY, PREV):
        flt_state[key, fy] = {k: v['aggregated_amount'] or 0 for k, v in geography('state', fy, **flt).items()}
        cc = geography('county', fy, **flt)
        add_ct(cc, fy, flt)
        flt_county[key, fy] = {k: v['aggregated_amount'] or 0 for k, v in cc.items()}
# Drop programs with no money this year.
FILTERS = [f for f in FILTERS if sum(flt_state[f[0], FY].values()) > 0]

def filter_values(lookup):
    out = {}
    for key, *_ in FILTERS:
        now, prev = rnd(flt_county_or_state(lookup, key, FY)), rnd(flt_county_or_state(lookup, key, PREV))
        if now or prev:
            out[key] = [now, prev]
    return out

def flt_county_or_state(lookup, key, fy):
    kind, code = lookup
    return (flt_county if kind == 'c' else flt_state)[key, fy].get(code, 0)

# 3. Recipients in every county with money ------------------------------------------------------
print('Recipients by county')
mapped = {f for f in shapes['c']}
targets = []
for f in mapped:
    st = ST.get(f[:2])
    if not st or st == 'CT':
        continue
    if f in co_now and (co_now[f]['aggregated_amount'] or 0) > 0:
        targets.append((st, f[2:]))
targets += [('CT', r) for r in ct_regions]
county_rows = pmap(lambda t: recipients(FY, {'country': 'USA', 'state': t[0], 'county': t[1]}), targets)

lists = collections.defaultdict(lambda: {'rows': [], 'more': False})
for (st, code), (rows, more) in county_rows.items():
    f = CT_REGIONS[code] if st == 'CT' else FIPS_OF[st] + code
    lists[f]['rows'] += rows
    lists[f]['more'] |= more

# 4. State and national lists -------------------------------------------------------------------
print('State and national lists')
all_states = sorted(set(st_now) | set(st_prev))
def state_lists(st):
    loc = {'country': 'USA', 'state': st}
    top, _ = recipients(FY, loc, pages=1 if st in shapes['s'] else 2)
    ag = category('awarding_agency', FY, 5, recipient_locations=[loc])['results']
    count = post('search/spending_by_award_count/', {'filters': filters(FY, recipient_locations=[loc])})['results']['grants']
    return top, ag, count
st_lists = pmap(state_lists, all_states, 6)

nat_top = []
for p in range(1, 7):
    nat_top += category('recipient', FY, 100, p)['results']
nat_ag = category('awarding_agency', FY, 5)['results']
programs = category('cfda', FY, 100, 1)['results'] + category('cfda', FY, 100, 2)['results']
award_count = post('search/spending_by_award_count/', {'filters': filters(FY)})['results']['grants']

# 5. Write files --------------------------------------------------------------------------------
os.makedirs(f'{OUT}/st', exist_ok=True)
def dump(path, obj):
    with open(f'{OUT}/{path}', 'w', encoding='utf8') as fh:
        json.dump(obj, fh, separators=(',', ':'), ensure_ascii=False)

def rec_row(r):
    return [r['name'], rnd(r['amount']), r['recipient_id'] or '']

where = {}       # recipient id -> county FIPS, for the national lists
recs = {}
search, summary = [], {}
for st in all_states:
    fips = FIPS_OF.get(st)
    sv, pv = st_now.get(st, {}), st_prev.get(st, {})
    top, ag, count = st_lists[st]
    co = {}
    if st in shapes['s']:
        for f in [f for f in shapes['c'] if f[:2] == fips]:
            now, prev = co_now.get(f, {}), co_prev.get(f, {})
            rows = sorted(lists[f]['rows'], key=lambda r: -(r['amount'] or 0)) if f in lists else []
            pub = [r for r in rows if listed(r['name'], r['amount'] or 0)]
            hidden = sum(1 for r in rows if (r['amount'] or 0) > 0 and (r['name'] or '').upper() not in EXCLUDED
                         and not listed(r['name'], r['amount']))
            for r in pub:
                if r['recipient_id']:
                    where.setdefault(r['recipient_id'], f)
                if r['amount'] >= SEARCH_MIN:
                    search.append([r['name'], f, rnd(r['amount'])])
            co[f] = {'n': names[f], 'a': rnd(now.get('aggregated_amount')), 'p': rnd(prev.get('aggregated_amount')),
                     'pop': now.get('population') or prev.get('population') or 0,
                     'f': filter_values(('c', f)),
                     'top': next(([r['name'], rnd(r['amount'])] for r in rows if r['name'] and r['name'].upper() not in EXCLUDED), None),
                     'h': hidden, 'more': lists[f]['more'] if f in lists else False,
                     'r': [rec_row(r) for r in pub[:LIST_MAX]]}
    pub = [r for r in top if listed(r['name'], r['amount'] or 0)]
    if st not in shapes['s']:
        search += [[r['name'], st, rnd(r['amount'])] for r in pub if r['amount'] >= SEARCH_MIN]
    a = rnd(sv.get('aggregated_amount'))
    unplaced = a - sum(c['a'] for c in co.values()) if co else 0
    rec = {'st': st, 'n': STATE_NAMES.get(st, st), 'a': a, 'p': rnd(pv.get('aggregated_amount')),
           'pop': sv.get('population') or pv.get('population') or 0, 'aw': count, 'u': unplaced,
           'g': [[agency_short(x['name']), rnd(x['amount'])] for x in ag if x['name']],
           't': [rec_row(r) for r in pub[:10 if co else LIST_MAX]], 'co': co,
           's': {f: shapes['c'][f] for f in shapes['c'] if f[:2] == fips} if st in shapes['s'] else {},
           'b': shapes['s'][st][1] if st in shapes['s'] else None}
    recs[st] = rec
    summary[st] = {'n': rec['n'], 'a': rec['a'], 'p': rec['p'], 'pop': rec['pop'], 'map': st in shapes['s'],
                   'f': filter_values(('s', st))}

# 5b. Unusual patterns ---------------------------------------------------------------------------
# Flags point to places worth a closer look. They describe the numbers only; an unusual pattern is
# often explained by a state agency, a university or a one-off project, and is never proof of a problem.
STATE_WORDS = re.compile(r"\b(STATE OF|COMMONWEALTH OF|DEPARTMENT|DEPT|DIVISION|OFFICE OF|EXECUTIVE OFFICE|CABINET|COMMISSION|COMMN|AGENCY|STATE BOARD|COMPTROLLER|TREASURER|GOVERNOR|HOMELAND SECURITY)\b")
NOT_STATE = re.compile(r"\b(UNIVERSITY|UNIV|COLLEGE|COUNTY|CITY|TOWN|VILLAGE|DISTRICT|TRIBE|TRIBAL|NATION|NATIONAL|INC|LLC|FOUNDATION|HOSPITAL|REDEVELOPMENT|COMMUNITY ACTION|HOUSING AUTHORITY OF|TRANSIT|ASSOCIATION|ASSN|COUNCIL|SOCIETY|CHURCH|CENTER)\b")
def state_agency(name, st):
    """A recipient that looks like part of the state government."""
    u = (name or '').upper()
    if NOT_STATE.search(u):
        return False
    named = STATE_NAMES.get(st, '#').upper() in u or re.search(r'\b' + st + r'S?\b', u)
    return bool(STATE_WORDS.search(u) or named)

def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0

# State agencies pass most of their money on to the rest of the state, so per-person comparisons
# leave them out ("local" grants).
def local(c, st):
    return c['a'] - sum(r[1] for r in c['r'] if state_agency(r[0], st))
counties = [(st, f, c) for st, r in recs.items() for f, c in r['co'].items() if c['a'] > 0 and c['pop'] >= 1000]
pops = sorted(c['pop'] for _, _, c in counties)
bands = [pops[int(len(pops) * i / 10)] for i in range(1, 10)]
def band(pop):
    return sum(1 for b in bands if pop >= b)
peer_pp = collections.defaultdict(list)
for st, _, c in counties:
    peer_pp[band(c['pop'])].append(max(0, local(c, st)) / c['pop'])
peer_med = {k: median(v) for k, v in peer_pp.items()}

# The county in each state where state agencies get the most money is treated as the seat of
# state government; its flags are marked as likely explained by that.
seat = {}
for st, r in recs.items():
    best = max(r['co'].items(), key=lambda kv: kv[1]['a'] - local(kv[1], st), default=None)
    if best and best[1]['a'] - local(best[1], st) > 0:
        seat[st] = best[0]

flags = []
for st, r in recs.items():
    for f, c in r['co'].items():
        fl, a, p = [], c['a'], c['p']
        top = c.get('top')
        sa = 1 if top and state_agency(top[0], st) else 0
        if top and not sa and a >= 10_000_000 and top[1] / a >= 0.8:
            shown = top[0] if listed(top[0], top[1]) else ''
            fl.append(['conc', round(top[1] / a, 3), shown, sa])
        loc = local(c, st)
        if loc >= 5_000_000 and c['pop'] >= 1000:
            med = peer_med.get(band(c['pop']), 0)
            if med and loc / c['pop'] >= 5 * med:
                fl.append(['pp', round(loc / c['pop'] / med, 1), round(med), 1 if seat.get(st) == f else 0])
        if a >= 5_000_000 and p >= 0 and a >= 2 * max(p, 1):
            fl.append(['up', round((a - p) / p, 2) if p >= 500_000 else -1])
        if p >= 5_000_000 and a <= 0.5 * p:
            fl.append(['down', round((a - p) / p, 2)])
        if fl:
            c['fl'] = fl
            if seat.get(st) == f:
                c['seat'] = 1
            flags.append([f, c['n'], st, a, fl, 1 if seat.get(st) == f else 0])
    # States: compared with the other states.
st_pp = median([v['a'] / v['pop'] for v in summary.values() if v['map'] and v['pop']])
for st, v in summary.items():
    fl = []
    if v['map'] and v['pop'] and v['a'] / v['pop'] >= 1.75 * st_pp:
        fl.append(['pp', round(v['a'] / v['pop'] / st_pp, 1), round(st_pp), 0])
    if v['p'] >= 1e8 and v['a'] >= 1.25 * v['p']:
        fl.append(['up', round((v['a'] - v['p']) / v['p'], 2)])
    if v['p'] >= 1e8 and v['a'] <= 0.8 * v['p']:
        fl.append(['down', round((v['a'] - v['p']) / v['p'], 2)])
    if fl:
        v['fl'] = recs[st]['fl'] = fl
flags.sort(key=lambda x: (x[5], -x[3]))
for st, rec in recs.items():
    dump(f'st/{st}.json', rec)

def place_of(r):
    return where.get(r['recipient_id'], '')

top500 = []
for r in nat_top:
    if listed(r['name'], r['amount'] or 0) and len(top500) < 500:
        f = place_of(r)
        top500.append([r['name'], rnd(r['amount']), ST.get(f[:2], ''), f, r['recipient_id'] or ''])
prog_out = [[p['code'] or '', title(p['name']), LISTING_AGENCY.get((p['code'] or '')[:2], ''), rnd(p['amount'])]
            for p in programs if (p['amount'] or 0) > 0][:150]
total = sum(v['a'] for v in summary.values())
nation = {'fy': FY, 'period': f'October {FY - 1} to September {FY}', 'prev_period': f'October {PREV - 1} to September {PREV}',
          'a': total, 'p': sum(v['p'] for v in summary.values()), 'aw': award_count,
          'pop': sum(v['pop'] for v in summary.values()),
          'g': [[agency_short(x['name']), rnd(x['amount'])] for x in nat_ag if x['name']],
          't': [[r[0], r[1], r[4], r[3] or r[2]] for r in top500[:10]],
          'filters': [[k, l, kind] for k, l, kind, _ in FILTERS], 'states': summary,
          'flag_rules': {'conc': 0.8, 'pp': 5, 'up': 2, 'down': 0.5, 'st_pp': 1.75, 'st_up': 0.25, 'st_down': 0.2}, 'built': time.strftime('%Y-%m-%d')}
search.sort(key=lambda r: -r[2])
dump('nation.json', nation)
dump('shapes.json', {'s': shapes['s'], 'm': shapes['m']})
dump('search.json', search)
dump('top.json', top500)
dump('programs.json', prog_out)
dump('flags.json', flags)
print(json.dumps({'fy': FY, 'total': total, 'prev': nation['p'], 'awards': award_count, 'search': len(search),
                  'top': len(top500), 'programs': len(prog_out), 'states': len(summary), 'flags': len(flags),
                  'flag_types': collections.Counter(x[0] for fl in flags for x in fl[4]),
                  'unplaced': sum(json.load(open(f'{OUT}/st/{s}.json'))['u'] for s in summary if summary[s]['map'])}))
