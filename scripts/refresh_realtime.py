"""Snapshot the TTC's official GTFS-RT protobuf feeds for static-host fallback."""
import gzip
import json
import urllib.request
from pathlib import Path
from google.transit import gtfs_realtime_pb2 as gtfs
from google.protobuf.json_format import MessageToDict

OUT = Path(__file__).resolve().parents[1] / "public/data"


def main():
    for name, field in (("alerts", "alert"), ("trips", "trip_update"), ("vehicles", "vehicle")):
        url = "https://bustime.ttc.ca/gtfsrt/" + name
        with urllib.request.urlopen(url, timeout=45) as response:
            feed = gtfs.FeedMessage.FromString(response.read())
        if not feed.header.timestamp:
            raise ValueError("Source omitted the feed timestamp")
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
