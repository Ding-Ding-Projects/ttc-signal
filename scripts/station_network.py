"""Reconcile the five operating rail lines against the published TTC schedule."""
import gzip
import json
import re
import unicodedata
from collections import defaultdict

LINES = {1: "Yonge–University", 2: "Bloor–Danforth", 3: "Scarborough RT",
         4: "Sheppard", 5: "Eglinton", 6: "Finch West"}


def slug(name):
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plain.lower().replace("'", "").replace("&", " and ")).strip("-")


def key(name):
    value = slug(name.replace("’", "'")).replace("-", "")
    return {"bloor": "blooryonge", "yonge": "blooryonge", "hwy407": "highway407",
            "janefinch": "janeandfinch"}.get(value, value)


def platform_station(name):
    return re.split(r" (?:Station\b|[-–] (?:North|South|East|West)bound)", name, maxsplit=1)[0]


def load_network(public):
    net = json.loads((public / "data/network.json").read_text())
    stops = {row["stop_id"]: row for row in net["stops"]}
    sequences, platforms, points = {}, defaultdict(dict), {}
    for line in (1, 2, 4, 5, 6):
        with gzip.open(public / f"data/schedule/{line}.json.gz", "rt") as stream:
            data = json.load(stream)
        i = data["fields"].index("stop_id")
        full_trip = max(data["times"].values(), key=len)
        order = [key(platform_station(stops[row[i]]["stop_name"])) for row in full_trip]
        if len(order) != len(set(order)):
            raise ValueError(f"Repeated station on line {line}: review service pattern")
        sequences[line] = order
        for stop in stops.values():
            if str(line) not in stop["routes"]:
                continue
            k = key(platform_station(stop["stop_name"]))
            if k not in order:
                continue
            points[k] = (float(stop["stop_lat"]), float(stop["stop_lon"]))
            platforms[k][stop["stop_id"]] = stop["stop_name"]
    return sequences, platforms, points
