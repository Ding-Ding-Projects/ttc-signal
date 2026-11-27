/** Data adapters for the public TTC surface feed and the TTC static GTFS package. */
const endpoint = "https://webservices.nextbus.com/service/publicJSONFeed";
const dataUrl = (name) => new URL(name, import.meta.url);
const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
let networkPromise;
const routeCache = new Map();

async function fetchOK(url, options = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    ...options,
  });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
  return response;
}

async function feed(command, params = {}) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ command, a: "ttc", ...params });
  const result = await (await fetchOK(url, { cache: "no-store" })).json();
  if (result.Error)
    throw new Error(String(result.Error.content || "TTC feed unavailable"));
  return result;
}

export async function getVehicles() {
  const data = await feed("vehicleLocations", { t: "0" });
  const vehicles = list(data.vehicle).filter(
    (v) => Number.isFinite(+v.lat) && Number.isFinite(+v.lon),
  );
  return { time: Number(data.lastTime?.time) || null, vehicles };
}

export async function getMessages() {
  const data = await feed("messages");
  const messages = new Map();
  for (const route of list(data.route)) {
    for (const msg of list(route.message)) {
      const id = String(msg.id || msg.text);
      if (!messages.has(id))
        messages.set(id, {
          id,
          text: msg.text,
          priority: msg.priority,
          routes: new Set(),
        });
      const routes = messages.get(id).routes;
      for (const item of list(msg.routeConfiguredForMessage))
        routes.add(item.tag);
      if (route.tag && route.tag !== "all") routes.add(route.tag);
    }
  }
  return [...messages.values()].map((item) => ({
    ...item,
    routes: [...item.routes],
  }));
}

export async function getPredictions(stopCode) {
  const data = await feed("predictions", { stopId: stopCode });
  const result = [];
  for (const group of list(data.predictions)) {
    for (const direction of list(group.direction)) {
      for (const p of list(direction.prediction)) {
        result.push({
          route: group.routeTag,
          headsign: direction.title,
          minutes: Number(p.minutes),
          time: Number(p.epochTime),
          vehicle: p.vehicle,
          tripId: p.tripTag,
          stopName: group.stopTitle,
        });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

export function getNetwork() {
  if (!networkPromise)
    networkPromise = fetchOK(dataUrl("network.json"))
      .then((r) => r.json())
      .catch((e) => {
        networkPromise = undefined;
        throw e;
      });
  return networkPromise;
}

async function partition(route) {
  if (!routeCache.has(route)) {
    const promise = fetchOK(
      dataUrl("schedule/" + encodeURIComponent(route) + ".json.gz"),
    )
      .then(async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        // Some static hosts transparently decompress .gz assets.
        if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
          return JSON.parse(new TextDecoder().decode(bytes));
        const stream = new Blob([bytes])
          .stream()
          .pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).json();
      })
      .catch((error) => {
        routeCache.delete(route);
        throw error;
      });
    if (routeCache.size >= 8) routeCache.delete(routeCache.keys().next().value);
    routeCache.set(route, promise);
  }
  return routeCache.get(route);
}

export function serviceIds(network, date) {
  const key = date.replaceAll("-", "");
  const day = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][new Date(date + "T12:00:00Z").getUTCDay()];
  const ids = new Set(
    network.calendar
      .filter((c) => c[day] === "1" && c.start_date <= key && c.end_date >= key)
      .map((c) => c.service_id),
  );
  for (const row of network.calendar_dates.filter((c) => c.date === key)) {
    if (row.exception_type === "1") ids.add(row.service_id);
    if (row.exception_type === "2") ids.delete(row.service_id);
  }
  return ids;
}

export async function getSchedule(stopId, date) {
  const net = await getNetwork();
  const stop = net.stops.find((s) => s.stop_id === String(stopId));
  const active = serviceIds(net, date);
  if (!stop || !active.size) return [];
  const schedules = await Promise.all(
    stop.routes.map(async (route) => {
      const part = await partition(route);
      const f = Object.fromEntries(
        part.fields.map((field, index) => [field, index]),
      );
      const departures = [];
      for (const trip of Object.values(part.trips)) {
        if (!active.has(trip.service_id)) continue;
        for (const row of part.times[trip.trip_id] || []) {
          if (row[f.stop_id] !== stop.stop_id) continue;
          departures.push({
            route,
            tripId: trip.trip_id,
            headsign: row[f.stop_headsign] || trip.trip_headsign,
            arrival: row[f.arrival_time].padStart(8, "0"),
            departure: row[f.departure_time].padStart(8, "0"),
            wheelchair: trip.wheelchair_accessible,
            bikes: trip.bikes_allowed,
            pickup: row[f.pickup_type],
            dropoff: row[f.drop_off_type],
          });
        }
      }
      return departures;
    }),
  );
  return schedules
    .flat()
    .sort((a, b) => a.departure.localeCompare(b.departure));
}

export async function getTrip(route, tripId) {
  const part = await partition(String(route));
  const trip = part.trips[tripId];
  if (!trip) return null;
  const stops = (part.times[tripId] || []).map((row) =>
    Object.fromEntries(part.fields.map((key, i) => [key, row[i]])),
  );
  stops.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  return { ...trip, stops };
}

/** Find scheduled journeys using at most one same-stop transfer. Times use the selected GTFS service day. */
export async function planJourney(from, to, date, departure) {
  const network = await getNetwork();
  const active = serviceIds(network, date);
  if (!active.size) return [];
  const seconds = (time) =>
    time.split(":").reduce((n, part) => n * 60 + Number(part), 0);
  const earliest = seconds(departure + ":00");
  const reached = new Map(),
    journeys = [];
  async function scan(route, visit) {
    const part = await partition(route);
    const field = Object.fromEntries(part.fields.map((k, i) => [k, i]));
    for (const trip of Object.values(part.trips)) {
      if (!active.has(trip.service_id)) continue;
      let boarded;
      for (const row of part.times[trip.trip_id] || []) {
        const stop = row[field.stop_id],
          dep = row[field.departure_time],
          arr = row[field.arrival_time];
        const item = {
          stop,
          dep,
          arr,
          pickup: row[field.pickup_type] !== "1",
          drop: row[field.drop_off_type] !== "1",
        };
        boarded = visit(item, boarded, {
          route,
          tripId: trip.trip_id,
          headsign: trip.trip_headsign,
        });
      }
    }
  }
  for (const route of from.routes) {
    await scan(route, (s, start, trip) => {
      if (start && s.drop) {
        const leg = {
          ...trip,
          from: from.stop_id,
          to: s.stop,
          departure: start,
          arrival: s.arr,
        };
        const prior = reached.get(s.stop);
        if (!prior || prior.arrival > leg.arrival) reached.set(s.stop, leg);
        if (s.stop === to.stop_id) journeys.push([leg]);
      }
      return (
        start ||
        (s.stop === from.stop_id && s.pickup && seconds(s.dep) >= earliest
          ? s.dep
          : null)
      );
    });
  }
  for (const route of to.routes) {
    await scan(route, (s, board, trip) => {
      if (board && s.stop === to.stop_id && s.drop)
        journeys.push([
          board.first,
          {
            ...trip,
            from: board.first.to,
            to: s.stop,
            departure: board.dep,
            arrival: s.arr,
          },
        ]);
      const first = reached.get(s.stop);
      return (
        board ||
        (first &&
        first.tripId !== trip.tripId &&
        s.pickup &&
        seconds(first.arrival) + 120 <= seconds(s.dep)
          ? { first, dep: s.dep }
          : null)
      );
    });
  }
  return journeys
    .sort(
      (a, b) =>
        a.at(-1).arrival.localeCompare(b.at(-1).arrival) ||
        a.length - b.length ||
        b[0].departure.localeCompare(a[0].departure),
    )
    .slice(0, 8);
}
