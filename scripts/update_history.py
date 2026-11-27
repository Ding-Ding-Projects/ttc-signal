"""Refresh monthly incident archives from Toronto Open Data without external dependencies."""
import csv
import io
import json
import re
import tempfile
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

OUT = Path(__file__).resolve().parents[1] / "public" / "data"
API = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-{}-delay-data"


def csv_rows(url):
    with urlopen(url, timeout=120) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def save(root, name, data):
    (root / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def refresh(root):
    manifest = {"modes": {}, "fields": ["date", "time", "line", "location", "code", "delay", "gap", "bound"]}
    for mode in ("subway", "streetcar", "bus"):
        with urlopen(API.format(mode), timeout=40) as response:
            resources = json.load(response)["result"]["resources"]
        dataset = next(r for r in resources if "since 2025" in r["name"].lower() and r["format"].upper() == "CSV")
        codes = next(r for r in resources if r["name"].lower() == "code descriptions.csv")
        descriptions = {r["CODE"]: r["DESCRIPTION"] for r in csv_rows(codes["url"])}
        months = defaultdict(list)
        for r in csv_rows(dataset["url"]):
            date = r["Date"][:10]
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                raise ValueError(f"Unexpected date from {mode}")
            months[date[:7]].append([date, r["Time"], r["Line"], r["Station"], r["Code"],
                                      int(r["Min Delay"]) if r["Min Delay"].strip() else None,
                                      int(r["Min Gap"]) if r["Min Gap"].strip() else None, r["Bound"]])
        if not months:
            raise ValueError(f"No incident records for {mode}")
        manifest["modes"][mode] = {"months": {}, "codes": descriptions,
                                   "source": f"https://open.toronto.ca/dataset/ttc-{mode}-delay-data/"}
        for month, rows in sorted(months.items()):
            rows.sort(key=lambda row: (row[0], row[1]), reverse=True)
            save(root, f"history-{mode}-{month}.json", rows)
            manifest["modes"][mode]["months"][month] = {"count": len(rows), "from": rows[-1][0], "to": rows[0][0]}
        print(mode, min(months), max(months), sum(map(len, months.values())))
    save(root, "history.json", manifest)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        staging = Path(tmp)
        refresh(staging)
        for archive in staging.glob("history-*.json"):
            archive.replace(OUT / archive.name)
        (staging / "history.json").replace(OUT / "history.json")
