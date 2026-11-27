import { btn, el, field, option } from "./ui.js";
import { getNetwork } from "./data/live.js";

const formatTime = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Toronto",
  timeZoneName: "short",
});
const readable = (value) =>
  value ? value.toLowerCase().replaceAll("_", " ") : "unreported";
const timestamp = (seconds) =>
  Number(seconds) > 0
    ? formatTime.format(Number(seconds) * 1000)
    : "Unreported";
const textLine = (label, value) =>
  el("p", "muted", el("strong", "", label + " "), value);
const sharedStatus = ["CANCELED", "DELETED"];
const pageSize = 25;

async function loadSnapshot(kind) {
  const url = new URL("./data/realtime-" + kind + ".json.gz", import.meta.url);
  const response = await fetch(url, {
    cache: "no-cache",
    signal: AbortSignal.timeout(18000),
  });
  if (!response.ok) throw Error("Snapshot returned HTTP " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f) return JSON.parse(new TextDecoder().decode(bytes));
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).json();
}

function detailsForVehicle(record, stopName) {
  const position = record.position || {};
  const details = [
    textLine("Observation", timestamp(record.timestamp)),
    textLine("Passenger load", readable(record.occupancy_status)),
    textLine("Movement", readable(record.current_status)),
    textLine("Stop", record.stop_id ? stopName(record.stop_id) : "Unreported"),
    textLine("Trip", record.trip?.trip_id || "Unassigned"),
  ];
  if (position.speed != null)
    details.push(textLine("Speed", Math.round(position.speed * 3.6) + " km/h"));
  if (position.bearing != null)
    details.push(textLine("Bearing", Math.round(position.bearing) + "°"));
  if (position.latitude != null && position.longitude != null) {
    details.push(
      textLine(
        "Position",
        position.latitude.toFixed(5) + ", " + position.longitude.toFixed(5),
      ),
    );
  }
  return details;
}

function detailsForTrip(record, stopName) {
  const updates = record.stop_time_update || [];
  const content = el(
    "div",
    "",
    textLine("Trip update", timestamp(record.timestamp)),
    textLine("Vehicle", record.vehicle?.id || "Unassigned"),
  );
  if (!updates.length)
    content.append(textLine("Stop updates", "None in this record"));
  for (const stop of updates) {
    const timing = [];
    if (stop.arrival?.time)
      timing.push("Arrives " + timestamp(stop.arrival.time));
    if (stop.departure?.time)
      timing.push("Departs " + timestamp(stop.departure.time));
    const delay = stop.arrival?.delay ?? stop.departure?.delay;
    if (delay != null)
      timing.push("Schedule offset " + (delay > 0 ? "+" : "") + delay + " s");
    if (stop.schedule_relationship)
      timing.push(readable(stop.schedule_relationship));
    content.append(
      el(
        "div",
        "msg",
        el(
          "strong",
          "",
          stop.stop_id
            ? stopName(stop.stop_id)
            : "Stop sequence " + stop.stop_sequence,
        ),
        el("p", "muted", timing.join(" · ") || "Timing unreported"),
      ),
    );
  }
  return [content];
}

export function mountFeeds(container) {
  const title = el("h2", "", "Vehicle & trip reports");
  const type = el(
    "select",
    "field",
    option("vehicles", "Vehicle positions"),
    option("trips", "Trip updates"),
    option("cancellations", "Canceled or deleted trips"),
  );
  type.setAttribute("aria-label", "Report type");
  const status = el("select", "field");
  status.setAttribute("aria-label", "Reported status");
  const search = field("Search route, vehicle, trip or stop ID");
  const source = el("div", "service");
  const counter = el("div", "resultcount");
  counter.setAttribute("aria-live", "polite");
  const body = el("div");
  const nav = el("div", "filters");
  const reload = btn("Refresh snapshot", () => {
    delete snapshots[currentKind()];
    load();
  });
  const panel = el(
    "section",
    "panecontent",
    el("div", "section", title, reload),
    el("div", "filters", type, status),
    search,
    source,
    counter,
    body,
    nav,
  );
  container.replaceChildren(panel);
  const snapshots = {};
  let ticket = 0,
    page = 0,
    records = [],
    networkStops = new Map();
  const currentKind = () => (type.value === "vehicles" ? "vehicles" : "trips");
  const stopName = (id) => networkStops.get(String(id)) || "Stop " + id;
  getNetwork()
    .then((network) => {
      networkStops = new Map(
        network.stops.map((stop) => [
          stop.stop_id,
          stop.stop_name + " (#" + stop.stop_id + ")",
        ]),
      );
    })
    .catch(() => {});
  const statusOf = (r) =>
    currentKind() === "vehicles"
      ? r.occupancy_status
      : r.trip?.schedule_relationship;
  const rowFor = (record) => {
    const vehicle = currentKind() === "vehicles";
    const detail = el(
      "details",
      "msg",
      el(
        "summary",
        "",
        vehicle
          ? "Vehicle " + (record.vehicle?.id || "unassigned")
          : "Trip " + (record.trip?.trip_id || "unassigned"),
        el(
          "span",
          "muted",
          " · " +
            (record.trip?.route_id
              ? "Route " + record.trip.route_id
              : "Route unreported") +
            " · " +
            readable(statusOf(record)),
        ),
      ),
    );
    detail.addEventListener("toggle", () => {
      if (detail.open && detail.childElementCount === 1) {
        detail.append(
          ...(vehicle
            ? detailsForVehicle(record, stopName)
            : detailsForTrip(record, stopName)),
        );
      }
    });
    return detail;
  };

  function render() {
    const words = search.value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const matches = records.filter((r) => {
      if (status.value && (statusOf(r) || "UNREPORTED") !== status.value)
        return false;
      if (!words.length) return true;
      const ids = [
        r.vehicle?.id,
        r.trip?.trip_id,
        r.trip?.route_id,
        r.stop_id,
        ...(r.stop_time_update || []).map((s) => s.stop_id),
      ];
      return words.every((word) =>
        ids.some((id) =>
          String(id || "")
            .toLowerCase()
            .includes(word),
        ),
      );
    });
    const first = page * pageSize;
    const shown = matches.slice(first, first + pageSize);
    counter.textContent = matches.length
      ? first +
        1 +
        "–" +
        (first + shown.length) +
        " of " +
        matches.length.toLocaleString() +
        " records"
      : "0 matching records";
    body.replaceChildren(...shown.map(rowFor));
    if (!shown.length)
      body.append(
        el(
          "p",
          "empty",
          type.value === "cancellations" && !records.length
            ? "The source reported no canceled or deleted trips in this snapshot."
            : "No records match these filters.",
        ),
      );
    nav.replaceChildren();
    if (page > 0)
      nav.append(
        btn("Previous reports", () => {
          page--;
          render();
          title.scrollIntoView({ block: "nearest" });
        }),
      );
    if (first + shown.length < matches.length)
      nav.append(
        btn("Next reports", () => {
          page++;
          render();
          title.scrollIntoView({ block: "nearest" });
        }),
      );
    if (words.length || status.value)
      nav.append(
        btn("Clear filters", () => {
          page = 0;
          search.value = "";
          status.value = "";
          render();
          search.focus();
        }),
      );
  }

  async function load() {
    const id = ++ticket;
    const kind = currentKind();
    page = 0;
    source.textContent = "Loading the TTC " + kind + " snapshot…";
    status.replaceChildren(option("", "All reported statuses"));
    body.replaceChildren();
    nav.replaceChildren();
    counter.textContent = "";
    records = [];
    try {
      const snapshot = snapshots[kind] || (await loadSnapshot(kind));
      if (id !== ticket) return;
      snapshots[kind] = snapshot;
      const age = Math.floor((Date.now() - snapshot.time) / 60000);
      const label =
        age < 0
          ? "Source clock ahead"
          : age <= 2
            ? "Recently reported"
            : age < 60
              ? age + " min old"
              : age < 1440
                ? Math.floor(age / 60) + " h old"
                : Math.floor(age / 1440) + " days old";
      const link = el("a", "link", "TTC protobuf source");
      link.href = "https://bustime.ttc.ca/gtfsrt/" + kind;
      source.replaceChildren(
        el("span", "eyebrow", "PUBLISHED SNAPSHOT"),
        el("b", "", label),
        el("p", "muted", formatTime.format(snapshot.time) + " · ", link),
      );
      records =
        type.value === "cancellations"
          ? snapshot.entries.filter((r) =>
              sharedStatus.includes(r.trip?.schedule_relationship),
            )
          : snapshot.entries;
      const statuses = [
        ...new Set(records.map((r) => statusOf(r) || "UNREPORTED")),
      ].sort();
      status.append(...statuses.map((value) => option(value, readable(value))));
      render();
    } catch {
      if (id !== ticket) return;
      source.textContent =
        "The published snapshot could not be loaded. Use Refresh snapshot to retry.";
    }
  }
  type.onchange = load;
  status.onchange = search.oninput = () => {
    page = 0;
    render();
  };
  load();
}
