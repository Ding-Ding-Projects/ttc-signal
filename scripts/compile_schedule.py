"""Build browser-sized TTC GTFS schedule partitions. Uses only Python's standard library."""
import argparse
import csv
import gzip
import io
import json
import math
import tempfile
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

CATALOG = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-routes-and-schedules"
OUT = Path(__file__).resolve().parents[1] / "public/data"


def dump(path, value):
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    if path.suffix == ".gz":
        encoded = gzip.compress(encoded, compresslevel=6, mtime=0)
    path.write_bytes(encoded)


def rows(archive, table):
    with archive.open(table + ".txt") as source:
        yield from csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig"))


def map_path(points):
    """Simplify for display within eight metres, using a Toronto-local projection."""
    points = sorted(points)
    if len(points) < 3:
        return [[p[1], p[2]] for p in points]
    xscale = 111_320 * math.cos(math.radians(43.7))
    projected = [(point[2] * xscale, point[1] * 111_320) for point in points]
    last = len(points) - 1
    keep = {0, last}
    spans = [(0, last)]
    while spans:
        start, end = spans.pop()
        ax, ay = projected[start]
        dx = projected[end][0] - ax
        dy = projected[end][1] - ay
        length2 = dx * dx + dy * dy
        threshold, split = 8 ** 2, None
        for i in range(start + 1, end):
            x, y = projected[i][0] - ax, projected[i][1] - ay
            t = max(0, min(1, (x * dx + y * dy) / length2)) if length2 else 0
            error = (x - t * dx) ** 2 + (y - t * dy) ** 2
            if error > threshold:
                threshold, split = error, i
        if split is not None:
            keep.add(split)
            spans.extend(((start, split), (split, end)))
    return [[points[i][1], points[i][2]] for i in sorted(keep)]


def compile_schedule(archive, directory):
    network = {name: list(rows(archive, name)) for name in
               ("agency", "routes", "stops", "calendar", "calendar_dates")}
    names = {r["route_id"]: r["route_short_name"] for r in network["routes"]}
    routes_for_stop = defaultdict(set)
    shapes_by_route = defaultdict(set)
    trips = defaultdict(dict)
    trip_routes = {}
    for trip in rows(archive, "trips"):
        route = names[trip["route_id"]]
        trips[route][trip["trip_id"]] = trip
        trip_routes[trip["trip_id"]] = route
        if trip["shape_id"]:
            shapes_by_route[route].add(trip["shape_id"])

    shapes = defaultdict(list)
    for row in rows(archive, "shapes"):
        shapes[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                                        float(row["shape_pt_lat"]), float(row["shape_pt_lon"])))
    # Overlapping trip variants share shape IDs. Keep every unique route geometry.
    dump(OUT / "shapes.json", {route: [map_path(shapes[k])
                                       for k in sorted(ids)] for route, ids in shapes_by_route.items()})

    writers = {r: (directory / (r + ".csv")).open("w", newline="") for r in trips}
    try:
        for row in rows(archive, "stop_times"):
            route = trip_routes[row["trip_id"]]
            routes_for_stop[row["stop_id"]].add(route)
            writers[route].write(json.dumps(row, separators=(",", ":")) + "\n")
    finally:
        for writer in writers.values():
            writer.close()
    schedule_dir = OUT / "schedule"
    schedule_dir.mkdir(exist_ok=True)
    for route, route_trips in trips.items():
        # Store stop-time column names once per partition. Keep optional fields.
        times = defaultdict(list)
        with (directory / (route + ".csv")).open() as f:
            fields = None
            for line in f:
                stop = json.loads(line)
                trip = stop.pop("trip_id")
                if fields is None:
                    fields = list(stop)
                times[trip].append(list(stop.values()))
        dump(schedule_dir / (route + ".json.gz"),
             {"trips": route_trips, "fields": fields or [], "times": times})
    for stop in network["stops"]:
        stop["routes"] = sorted(routes_for_stop[stop["stop_id"]])
    dump(OUT / "network.json", network)
    for obsolete in schedule_dir.glob("*.json.gz"):
        if obsolete.name.removesuffix(".json.gz") not in trips:
            obsolete.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, help="Use an existing official GTFS ZIP")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        directory = Path(tmp)
        archive_path = args.zip
        if archive_path is None:
            with urllib.request.urlopen(CATALOG, timeout=30) as response:
                resources = json.load(response)["result"]["resources"]
            url = next(r["url"] for r in resources if r["url"].lower().endswith(".zip"))
            archive_path = directory / "schedule.zip"
            urllib.request.urlretrieve(url, archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            compile_schedule(archive, directory)


if __name__ == "__main__":
    main()
