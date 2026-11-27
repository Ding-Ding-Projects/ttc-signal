"""Build linkable TTC station histories and validate the current station inventory."""
import json
from collections import defaultdict
from datetime import date
from html import escape
from pathlib import Path
from urllib.parse import urlparse

from station_network import LINES, key, load_network, slug

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
DATA = ROOT / "scripts/station-data"
OUT = PUBLIC / "stations"
POSTCARD = "https://commons.wikimedia.org/wiki/File:Toronto_Subway_Postcard_1950s_(P10174).jpg"
ALIASES = {"TMU": "Dundas", "Cedarvale": "Eglinton West", "Sheppard West": "Downsview",
           "Sheppard-Yonge": "Sheppard", "Bloor-Yonge": "Bloor Yonge"}
RELATED = {"Kennedy": "Kennedy (former Line 3 platforms)", "Bay": "Bay Lower (Lower Bay)"}


def read(name):
    return json.loads((DATA / (name + ".json")).read_text())


def load_records():
    records = {}
    for dataset in ("yonge", "bloor-sheppard", "surface", "archive"):
        for row in read(dataset):
            k = key(row["name"])
            existing = records.setdefault(k, {**row, "lines": [], "events": []})
            existing["lines"] = sorted(set(existing["lines"] + row["lines"]))
            # An interchange can appear in multiple line histories. Credit complementary
            # sources for the same dated opening without telling the same story twice.
            previous_dates = {str(e["date"]): e for e in existing["events"]}
            for event in row["events"]:
                if not event["text"].strip() or not event["source"].startswith("https://"):
                    raise ValueError(f"Missing source or history for {k}")
                previous = previous_dates.get(str(event["date"]))
                if previous and len(str(event["date"])) == 10:
                    sources = previous.setdefault("also", [])
                    for url in (event["source"], event.get("dateSource")):
                        if url and url not in [previous["source"], previous.get("dateSource"), *sources]:
                            sources.append(url)
                elif event not in existing["events"]:
                    existing["events"].append(dict(event))
    for row in records.values():
        row["events"].sort(key=lambda e: str(e["date"]))
        if not row["events"]:
            raise ValueError(row["name"])
    return records


def station_slug(row):
    return slug(row["name"].replace("’", "'"))


def link(url, label, cls=""):
    return f'<a class="{cls}" href="{escape(url, quote=True)}">{escape(label)}</a>'


def page(title, description, content, depth=1, script=""):
    root = "../" * depth
    atlas = root + "stations/"
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} · Signal Toronto</title><meta name="description" content="{escape(description, quote=True)}">
<link rel="icon" href="{root}signal.svg"><link rel="stylesheet" href="{atlas}atlas.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="{root}"><img src="{root}signal.svg" alt=""><b>Signal<span>Toronto</span></b></a>
<a class="back" href="{root}">← Transit dashboard</a></header><div class="bound"><main id="main">{content}</main>
<footer>{link(atlas, 'Station atlas')}{link(root+'guide.html','Rider guide')}{link(root, 'Live TTC dashboard')}<span>Independent transit history · Toronto</span></footer></div>{script}</body></html>'''


def badge(line):
    return f'<span class="badge l{line}" aria-label="Line {line}">{line}</span>'


def line_labels(lines):
    return ''.join(f'<span class="lineLabel">{badge(i)} {LINES[i]}</span>' for i in lines)


def event_list(row):
    entries = []
    for e in row["events"]:
        raw = str(e["date"])
        try:
            pretty = date.fromisoformat(raw).strftime("%B %d, %Y").replace(" 0", " ")
        except ValueError:
            pretty = raw
        source = urlparse(e["source"]).netloc.removeprefix("www.")
        extra = link(e["dateSource"], "Opening date source", "extra-source") if e.get("dateSource") and e["dateSource"] != e["source"] else ""
        extra += ''.join(link(url, 'Additional source', 'extra-source') for url in e.get("also", []))
        entries.append(f'<li><time datetime="{escape(raw)}">{escape(pretty)}</time><p>{escape(e["text"])}</p><div class="source">{link(e["source"],source,"extra-source")}{extra}</div></li>')
    return '<ol class="events">' + ''.join(entries) + '</ol>'


def map_figure(k, order, points):
    def project(point):
        lat, lon = point
        return (lon + 79.63) * 1000 + 12, (43.86 - lat) * 1450 + 8
    paths = []
    for line, seq in order.items():
        coords = ' '.join('%.1f,%.1f' % project(points[x]) for x in seq)
        paths.append(f'<polyline class="l{line}" points="{coords}" fill="none" style="stroke:var(--line)" stroke-linejoin="round" stroke-width="3.5"/>')
    x, y = project(points[k])
    return f'<div class="routemap"><svg viewBox="0 0 440 350" role="img" aria-label="Station location on Toronto’s five operating rapid-transit lines">{"".join(paths)}<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#102c22" stroke="white" stroke-width="4"/></svg><small>Station location · TTC scheduled network</small></div>'


def hero_media(k, row, photos, order, points):
    photo = photos.get(k)
    if photo:
        filename = photo["file"]
        if not (PUBLIC / "station-photos" / filename).is_file():
            raise ValueError(filename)
        title = photo["caption"]
        license_link = link(photo["licenseUrl"], photo["license"]) if photo.get("licenseUrl") else escape(photo["license"])
        return f'<figure><img src="../../station-photos/{escape(filename)}" alt="{escape(title, quote=True)}"><figcaption>{link(photo["source"],title)} · {escape(photo["credit"])} · {license_link} · WebP rendition</figcaption></figure>'
    if k in points:
        return map_figure(k, order, points)
    return '<div class="routemap archive-mark" aria-hidden="true"><b>TTC</b><span>HISTORICAL RECORD</span></div>'


def station_page(k, row, rows, order, platforms, points, photos):
    name = row["name"]
    former = row.get("status") == "Former"
    title = escape(name)
    context = "Former station or platform" if former else "Station history"
    hero = f'<div class="crumbs">{link("../", "Station atlas")} <span>/</span> {title}</div><section class="hero"><div class="heroText"><span class="stamp">{context}</span><h1>{title}</h1><div class="tags">{line_labels(row["lines"])}</div></div>{hero_media(k,row,photos,order,points)}</section>'
    rail = []
    for line in row["lines"]:
        seq = order.get(line, [])
        if k not in seq:
            continue
        i = seq.index(k)
        rail.append(f'<h3>{badge(line)} {escape(LINES[line])}</h3><ul class="neighbors">')
        for j in (i - 1, i + 1):
            if 0 <= j < len(seq):
                other = rows[seq[j]]
                rail.append('<li>' + link('../'+station_slug(other)+'/', other["name"]+' →', "neighbor") + '</li>')
        rail.append('</ul>')
    related = {**RELATED, **{v:k for k,v in RELATED.items()}}.get(name)
    if related:
        rail.append('<h3>Related station history</h3>' + link('../'+station_slug(rows[key(related)])+'/', related, 'neighbor'))
    boards = ''.join('<li>'+link('../../#stop='+stop_id,label)+'</li>' for stop_id,label in sorted(platforms.get(k,{}).items(), key=lambda p:p[1]))
    if boards:
        rail.append('<h3>Platform departures</h3><ul class="plinks">'+boards+'</ul>')
    rail.append('<p class="more">'+link(row["source"], "Historical reference ↗" if former else "Official station information ↗")+'</p>')
    aside = '<aside class="connections"><h2>'+('Related information' if former else 'At this station')+'</h2>'+''.join(rail)+'</aside>'
    content = hero + '<div class="textcols"><section><h2>Station history</h2>'+event_list(row)+'</section>'+aside+'</div>'
    return page(name+' station history', row["events"][0]["text"], content, 2)


def directory(rows):
    groups = defaultdict(list)
    for row in sorted(rows.values(), key=lambda r:slug(r["name"])):
        status = "former" if row.get("status") == "Former" else "operating"
        name = row["name"]
        search = escape(name+' '+ALIASES.get(name,''),quote=True)
        lines = ' '.join(str(i) for i in row["lines"])
        tags = ''.join(badge(i) for i in row["lines"])
        groups[status].append(f'<li data-station="{search}" data-lines="{lines}" data-service="{status}"><a href="{station_slug(row)}/"><span class="cname">{escape(name)}</span><span class="tags">{tags}</span></a></li>')
    hero = f'''<div class="crumbs">{link('../','Transit dashboard')} / Station atlas</div>
<section class="hero"><div class="heroText"><span class="stamp">Toronto transit history</span><h1>Station atlas.</h1>
<p>Follow Toronto’s rail network from the first Yonge subway to the Eglinton and Finch West lines. Choose a station to explore its history.</p>
<div class="stats"><span><strong>{len(groups['operating'])}</strong> operating locations</span><span><strong>{len(groups['former'])}</strong> historical records</span></div></div>
<figure><img src="union-postcard.webp" alt="Red Gloucester subway train at Union Station in a 1950s colour postcard"><figcaption>{link(POSTCARD,'Union Station, 1950s · Royal Specialty / Plastichrome · public domain')}</figcaption></figure></section>'''
    options = ''.join(f'<option value="{line}">{line} · {name}</option>' for line,name in LINES.items())
    form = f'''<div class="section"><h2>Find a station</h2><form data-filters hidden><div class="tools"><label>Station name<input type="search" name="q" placeholder="Current or former name"></label><label>Line<select name="line"><option value="">All lines</option>{options}</select></label><label>Service<select name="service"><option value="">Current and former</option><option value="operating">Operating</option><option value="former">Former</option></select></label></div></form><p class="count" role="status" aria-live="polite"></p></div>'''
    sections = ''.join(f'<section class="section" data-group><h2>{title}</h2><ul class="cards">{"".join(groups[value])}</ul></section>' for value,title in (("operating","Operating stations and stops"),("former","Former stations and platforms")))
    sections += '<p class="more">'+link('station-atlas.pdf','Download the phone-size station history atlas (PDF)')+'</p>'
    return page("Station atlas","Explore the history of Toronto’s TTC rapid-transit stations and stops.",hero+form+sections,script='<script type="module" src="directory.js"></script>')


def main():
    rows = load_records()
    order, platforms, points = load_network(PUBLIC)
    expected = {k for seq in order.values() for k in seq}
    active = {k for k,r in rows.items() if r.get("status") != "Former"}
    if expected != active:
        raise ValueError(f"Review station roster. Missing {expected-active}; unexpected {active-expected}")
    photos = {key(k):v for k,v in read("photos").items()} if (DATA / "photos.json").exists() else {}
    for k,row in rows.items():
        if k in active and set(row["lines"]) != {line for line,seq in order.items() if k in seq}:
            raise ValueError("Review transfer lines for "+row["name"])
        path = OUT / station_slug(row)
        path.mkdir(parents=True, exist_ok=True)
        (path / 'index.html').write_text(station_page(k,row,rows,order,platforms,points,photos))
    (OUT / "index.html").write_text(directory(rows))
    by_stop = {i:station_slug(rows[k]) for k,ids in platforms.items() for i in ids}
    (OUT / "platforms.json").write_text(json.dumps(by_stop, sort_keys=True,indent=2)+'\n')
    print(f"{len(active)} operating locations, {len(rows)-len(active)} historical records, {len(by_stop)} platform links")


if __name__ == "__main__":
    main()
