"""Snapshot the TTC's official GTFS-RT protobuf feeds for static-host fallback."""
import gzip
import json
import subprocess
from pathlib import Path
from google.transit import gtfs_realtime_pb2 as gtfs
from google.protobuf.json_format import MessageToDict

OUT = Path(__file__).resolve().parents[1] / "public/data"


def fetch_feed(name, path):
    sources = [f"https://gtfsrt.ttc.ca/{path}?format=binary",
               f"https://bustime.ttc.ca/gtfsrt/{name}"]
    for url in sources:
        try:
            data = subprocess.check_output(["curl", "--fail", "--silent", "--show-error",
                                            "--location", "--connect-timeout", "8",
                                            "--max-time", "25", url])
            feed = gtfs.FeedMessage.FromString(data)
            if not feed.header.timestamp:
                raise ValueError("Source omitted the feed timestamp")
            return url, feed
        except (subprocess.CalledProcessError, ValueError) as exc:
            print(f"Could not read {url}: {exc}", flush=True)
    raise RuntimeError(f"Both official TTC sources failed for {name}")


def main():
    feeds = (("alerts", "alert", "alerts/all"), ("trips", "trip_update", "trips/update"),
             ("vehicles", "vehicle", "vehicles/position"))
    for name, field, path in feeds:
        url, feed = fetch_feed(name, path)
        items = [{**MessageToDict(getattr(entity, field), preserving_proto_field_name=True), "id": entity.id}
                 for entity in feed.entity if entity.HasField(field)]
        data = json.dumps({"source": url, "time": feed.header.timestamp * 1000, "entries": items},
                          ensure_ascii=False, separators=(",", ":")).encode()
        filename = OUT / ("realtime-" + name + ".json")
        if name != "alerts":
            filename = filename.with_suffix(".json.gz")
            data = gzip.compress(data, compresslevel=6, mtime=0)
        pending = filename.with_suffix(".tmp")
        pending.write_bytes(data)
        pending.replace(filename)
        print(name, len(items), "records")


if __name__ == "__main__":
    main()
