import { searchList } from "./search.js";
import { nearbyStops } from "./nearby.js";
import { createDockview, themeLight } from "./vendor/dockview/dockview.mjs";
import { createTransitMap } from "./map.js";
import {
  getNetwork,
  getVehicles,
  getMessages,
  getPredictions,
  getSchedule,
  getTrip,
} from "./data/live.js";
import { mountFeeds } from "./feeds.js";
import { mountPlanner } from "./planner.js";
import { mountHistory } from "./history.js";
import {
  el,
  icon,
  btn,
  row,
  field,
  option,
  localDate,
  torTime,
  read,
  save,
} from "./ui.js";
const $ = (id) => document.getElementById(id);
const net = await getNetwork().catch(() => ({
  routes: [],
  stops: [],
  calendar: [],
  calendar_dates: [],
}));
const routes = new Map(net.routes.map((r) => [r.route_short_name, r])),
  stops = new Map(net.stops.map((s) => [s.stop_id, s]));
const names = {
  network: ["map", "Live network"],
  directory: ["routes", "Routes & stops"],
  arrivals: ["clock", "Arrivals"],
  planner: ["stops", "Journey planner"],
  alerts: ["alerts", "Service alerts"],
  history: ["history", "Delay history"],
  feeds: ["vehicles", "Feed explorer"],
  saved: ["saved", "Saved"],
};
let active = "network",
  api,
  map,
  shapes = {},
  vehicles = [],
  vehicleTime = 0,
  vehicleError = false,
  messages = [],
  official = [],
  alertTime = 0,
  msgOK = false,
  lastRead = 0,
  refreshing = false,
  summary,
  layoutTimer,
  filterRoute = "",
  alertView,
  detailGeneration = 0;
let favorites = read("favorites", []);
if (!Array.isArray(favorites)) favorites = [];
function badge(id) {
  const r = routes.get(String(id)),
    b = el("span", "routebadge", String(id));
  if (r && /^[a-f\d]{6}$/i.test(r.route_color)) {
    b.style.backgroundColor = "#" + r.route_color;
    b.style.color = "#" + (r.route_text_color || "ffffff");
  }
  return b;
}
const mode = (r) =>
  ({ 0: "Streetcar", 1: "Subway", 3: "Bus" })[r?.route_type] || "Transit";
function setFocus(node) {
  node.tabIndex = -1;
  node.focus();
}
function clock() {
  const now = Date.now();
  $("clock").textContent = torTime(now) + "  TORONTO";
}
clock();
setInterval(clock, 10000);
function statusNote(t) {
  if (!t) return "Awaiting feed";
  const age = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return age <= 2
    ? "Updated moments ago"
    : age < 60
      ? "Reported " + age + " min ago"
      : "Reported " +
        new Date(t).toLocaleDateString("en-CA", {
          timeZone: "America/Toronto",
        }) +
        " · " +
        torTime(t);
}
function metrics() {
  const items = [
    [
      "vehicles",
      "Vehicles reporting",
      vehicleTime ? vehicles.length.toLocaleString() : "—",
      vehicleError ? "Latest refresh unavailable" : statusNote(vehicleTime),
    ],
    [
      "alerts",
      "Service notices",
      official.length || msgOK || alertTime ? String(allAlerts().length) : "—",
      "TTC advisories & disruptions",
    ],
    [
      "routes",
      "Transit routes",
      net.routes.length || "—",
      "Across the TTC schedule",
    ],
    [
      "stops",
      "Transit stops",
      net.stops.length.toLocaleString(),
      "Published stop locations",
    ],
  ];
  $("metrics").replaceChildren(
    ...items.map(([i, l, v, n]) =>
      el(
        "div",
        "metric",
        el(
          "div",
          "statline",
          el("span", "statlabel", l.toUpperCase()),
          icon(i),
        ),
        el("strong", "statvalue", v),
        el("span", "statnote", n),
      ),
    ),
  );
}
function show(title) {
  detailGeneration++;
  const box = $("detail");
  box.replaceChildren(el("h2", "", title));
  if (!$("dialog").open) $("dialog").showModal();
  box.scrollTop = 0;
  return box;
}
$("close").onclick = () => $("dialog").close();
$("dialog").addEventListener("close", () => detailGeneration++);
function favorite(kind, id) {
  const key = kind + ":" + id;
  const b = btn("", () => {
    favorites = favorites.includes(key)
      ? favorites.filter((x) => x !== key)
      : [...favorites, key];
    save("favorites", favorites);
    label();
    if (active === "saved") renderSaved(document.querySelector(".savedpane"));
  });
  function label() {
    b.textContent = favorites.includes(key) ? "★ Saved" : "☆ Save " + kind;
  }
  label();
  return b;
}
function shareLink(kind, id) {
  const link = el("a", "tool", "Link to " + kind);
  link.href = "#" + new URLSearchParams({ [kind]: id });
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(link.href);
      link.textContent = "Link copied";
    } catch {
      const input = field("Share link", "text");
      input.value = link.href;
      input.readOnly = true;
      link.replaceWith(input);
      input.select();
    }
  });
  return link;
}
function openSharedDetail() {
  const target = new URLSearchParams(location.hash.slice(1));
  if (target.has("stop")) stopDetails(target.get("stop"));
  else if (target.has("route")) routeDetails(target.get("route"));
}
function routeDetails(id) {
  id = String(id?.route_short_name ?? id);
  const r = routes.get(id);
  if (!r) return;
  const box = show(r.route_long_name);
  box.append(
    el(
      "div",
      "filters",
      badge(id),
      el("span", "muted", mode(r)),
      favorite("route", id),
      shareLink("route", id),
      btn("Show on map", () => {
        filterRoute = id;
        $("dialog").close();
        go("network");
      }),
    ),
  );
  const group = net.stops.filter((s) => s.routes.includes(id));
  box.append(
    el("h3", "", "Stops on this route"),
    searchList(
      group,
      (s) => s.stop_name + " " + s.stop_code,
      (s) => stopRow(s),
      "Filter route stops",
    ),
  );
}
function stopRow(s) {
  return row(
    el("span", "stopicon", icon("stops")),
    s.stop_name,
    "Stop " + (s.stop_code || s.stop_id) + " · " + s.routes.join(" / "),
    () => stopDetails(s),
  );
}
function routeRow(r) {
  return row(badge(r.route_short_name), r.route_long_name, mode(r), () =>
    routeDetails(r.route_short_name),
  );
}
function stopDetails(s) {
  if (typeof s === "string") s = stops.get(s);
  if (!s) return;
  const box = show(s.stop_name),
    g = detailGeneration;
  box.append(
    el(
      "div",
      "filters",
      el("span", "lineicon", "Stop " + (s.stop_code || s.stop_id)),
      favorite("stop", s.stop_id),
      shareLink("stop", s.stop_id),
      btn("Show on map", () => {
        filterRoute = "";
        $("dialog").close();
        go("network");
        map?.focusStop(s);
      }),
    ),
    el(
      "p",
      "muted",
      s.wheelchair_boarding === "1"
        ? "Wheelchair boarding available"
        : s.wheelchair_boarding === "2"
          ? "Wheelchair boarding unavailable"
          : "Boarding accessibility unspecified",
    ),
  );
  const pred = el("div", "muted", "Requesting arrival predictions…"),
    sched = el("div", "muted"),
    d = field("Service date", "date");
  d.value = localDate();
  box.append(
    el("h3", "", "Predicted arrivals"),
    pred,
    el("h3", "", "Scheduled departures"),
    d,
    sched,
  );
  getPredictions(s.stop_code || s.stop_id)
    .then((p) => {
      if (g !== detailGeneration) return;
      pred.replaceChildren(
        ...(p.length
          ? p
              .slice(0, 15)
              .map((x) =>
                el(
                  "div",
                  "row",
                  badge(x.route),
                  el("span", "rowtext", x.headsign),
                  el("b", "", x.minutes + " min"),
                ),
              )
          : ["No current predictions for this stop."]),
      );
    })
    .catch(() => (pred.textContent = "Arrival predictions are unavailable."));
  async function timetable() {
    const date = d.value;
    if (!date) return;
    sched.textContent = "Loading timetable…";
    try {
      const list = await getSchedule(s.stop_id, date);
      if (g !== detailGeneration || d.value !== date) return;
      const now = torTime(Date.now()) + ":00",
        up = list.findIndex((x) => x.departure >= now);
      let start = date === localDate() && up >= 0 ? up : 0;
      const paint = () => {
        sched.replaceChildren(
          el(
            "div",
            "resultcount",
            list.length + " departures on this service date",
          ),
          ...list
            .slice(start, start + 30)
            .map((x) =>
              row(badge(x.route), x.headsign, x.departure, () =>
                tripDetails(x),
              ),
            ),
          el(
            "div",
            "filters",
            btn("Earlier", () => {
              start = Math.max(0, start - 30);
              paint();
            }),
            btn("Later", () => {
              start = Math.min(Math.max(0, list.length - 1), start + 30);
              paint();
            }),
          ),
        );
      };
      paint();
    } catch {
      sched.textContent = "Timetable unavailable.";
    }
  }
  d.onchange = timetable;
  timetable();
}
async function tripDetails(t) {
  const box = show(t.headsign),
    g = detailGeneration;
  box.append(badge(t.route));
  try {
    const trip = await getTrip(t.route, t.tripId);
    if (g !== detailGeneration || !trip) return;
    box.append(
      el(
        "p",
        "muted",
        "Trip " + t.tripId + " · " + trip.stops.length + " stops",
      ),
      ...trip.stops.map((s) =>
        row(
          el("span", "mono", s.departure_time),
          stops.get(s.stop_id)?.stop_name || s.stop_id,
          "",
          () => stopDetails(s.stop_id),
        ),
      ),
    );
  } catch {
    box.append("Trip unavailable.");
  }
}
function vehicleDetails(v) {
  const box = show("Vehicle " + v.id);
  box.append(
    badge(v.routeTag || "—"),
    el(
      "p",
      "",
      "Reported " +
        (v.secsSinceReport ?? "unknown") +
        " seconds before the feed update.",
    ),
    el(
      "p",
      "muted",
      "Heading " +
        (v.heading ?? "—") +
        "° · Speed " +
        (v.speedKmHr ?? "—") +
        " km/h",
    ),
    btn("Explore route", () => routeDetails(v.routeTag)),
  );
}
const translation = (x) =>
  x?.translation?.find((y) => y.language === "en")?.text ||
  x?.translation?.[0]?.text ||
  "";
function allAlerts() {
  const sec = Date.now() / 1000;
  return [
    ...official
      .filter(
        (a) =>
          !a.active_period?.length ||
          a.active_period.some(
            (p) => (!p.start || +p.start <= sec) && (!p.end || +p.end >= sec),
          ),
      )
      .map((a) => ({
        title: translation(a.header_text),
        body: translation(a.description_text),
        routes: (a.informed_entity || [])
          .map(
            (e) =>
              net.routes.find((r) => r.route_id === e.route_id)
                ?.route_short_name || e.route_id,
          )
          .filter(Boolean),
        source: "GTFS service advisory",
      })),
    ...messages.map((m) => ({
      title: String(m.text || "Service message").replace(/<[^>]*>/g, " "),
      body: "",
      routes: m.routes,
      source: "Surface service message",
    })),
  ];
}
function notice(a) {
  return el(
    "article",
    "msg",
    el("span", "eyebrow", a.source.toUpperCase()),
    el("b", "", a.title),
    a.body && a.body !== a.title ? el("p", "muted", a.body) : null,
    el(
      "div",
      "filters",
      ...Array.from(new Set(a.routes))
        .slice(0, 12)
        .map((id) => btn(id, () => routeDetails(id))),
    ),
  );
}
function renderAlerts(n) {
  if (!n) return;
  const previous = n.querySelector(".search");
  const query = previous?.value || "",
    focused = previous === document.activeElement;
  const mode = n.querySelector("select")?.value || "plain",
    sensitive = n.querySelector("input[type=checkbox]")?.checked || false,
    expanded = n.querySelector("details")?.open || false;
  const list = allAlerts();
  n.replaceChildren(
    el("span", "eyebrow", "SERVICE BULLETIN"),
    el("h2", "", "Service alerts"),
    el(
      "p",
      "muted",
      "Advisory snapshot: " +
        statusNote(alertTime) +
        ". Surface messages: " +
        (msgOK ? "checked " + torTime(lastRead) : "unavailable") +
        ".",
    ),
    searchList(
      list,
      (a) => a.title + " " + a.body + " " + a.routes.join(" "),
      notice,
      "Search alerts or route numbers",
    ),
  );
  const search = n.querySelector(".search");
  n.querySelector("select").value = mode;
  n.querySelector("input[type=checkbox]").checked = sensitive;
  n.querySelector("details").open = expanded;
  if (query) {
    search.value = query;
    search.dispatchEvent(new Event("input"));
  }
  if (focused) search.focus({ preventScroll: true });
  if (!list.length)
    n.append(
      el(
        "p",
        "empty",
        msgOK || alertTime
          ? "No active notices in the available feeds."
          : "Service alert feeds unavailable.",
      ),
    );
}
function updateSummary() {
  if (!summary) return;
  const list = allAlerts(),
    a =
      list.find((x) =>
        /detour|closure|suspend|no service|delay/i.test(x.title),
      ) || list[0];
  summary.replaceChildren(
    el("span", "eyebrow", "SERVICE DESK"),
    el("h2", "", "Network pulse"),
    el(
      "div",
      "service",
      el("span", "eyebrow", "SERVICE ADVISORY"),
      el(
        "b",
        "",
        a?.body ||
          a?.title ||
          (msgOK || alertTime
            ? "No active notices reported"
            : "Checking TTC advisories…"),
      ),
      el(
        "div",
        "filters",
        btn("View service alerts →", () => go("alerts")),
      ),
    ),
    el("h3", "sectiontitle", "Rapid transit lines"),
    ...net.routes
      .filter(
        (r) => r.route_type === "1" || ["5", "6"].includes(r.route_short_name),
      )
      .map(routeRow),
    btn("Explore all routes →", () => go("directory")),
  );
}
function renderDirectory(n, arrivals = false) {
  let kind = arrivals ? "Stops" : "Routes";
  const group = el("div"),
    buttons = el("div", "filters");
  function paint() {
    buttons.replaceChildren(
      ...(arrivals
        ? []
        : ["Routes", "Stops", "Subway", "Streetcar", "Bus"].map((k) =>
            btn(
              k,
              () => {
                kind = k;
                paint();
              },
              "pill " + (k === kind ? "on" : ""),
            ),
          )),
    );
    group.replaceChildren(
      kind === "Stops"
        ? searchList(
            net.stops,
            (s) => s.stop_name + " " + s.stop_code,
            stopRow,
            "Find a stop by name or number",
          )
        : searchList(
            net.routes.filter((r) => kind === "Routes" || kind === mode(r)),
            (r) => r.route_short_name + " " + r.route_long_name,
            routeRow,
            "Find a route by name or number",
          ),
    );
  }
  n.append(
    el("span", "eyebrow", "RIDER TOOLS"),
    el("h2", "", arrivals ? "Stop arrivals" : "Routes & stops"),
    el(
      "p",
      "viewIntro",
      arrivals
        ? "Choose a stop for live predictions, dated timetables and trip details."
        : "Explore TTC routes, stop locations and boarding accessibility.",
    ),
    arrivals ? nearbyStops(net.stops, stopRow) : null,
    buttons,
    group,
  );
  paint();
}
function renderSaved(n) {
  if (!n) return;
  const items = favorites
    .map((k) => {
      const [kind, id] = k.split(":");
      return kind === "route" && routes.has(id)
        ? routeRow(routes.get(id))
        : stops.has(id)
          ? stopRow(stops.get(id))
          : null;
    })
    .filter(Boolean);
  n.replaceChildren(
    el("span", "eyebrow", "YOUR NETWORK"),
    el("h2", "", "Saved routes & stops"),
    ...(items.length
      ? items
      : [
          el(
            "p",
            "empty",
            "Save a route or stop to find it here on this device.",
          ),
          btn("Browse routes & stops", () => go("directory")),
        ]),
  );
}
function mapPanel(n) {
  n.classList.add("mapbox");
  const stage = el("div", "mapstage"),
    sel = el(
      "select",
      "field",
      option("", "All routes"),
      ...net.routes.map((r) =>
        option(
          r.route_short_name,
          r.route_short_name + " · " + r.route_long_name,
        ),
      ),
    );
  sel.setAttribute("aria-label", "Map route filter");
  sel.value = filterRoute;
  sel.onchange = () => {
    filterRoute = sel.value;
    map?.setFilter({ routeId: filterRoute });
  };
  n.append(
    el(
      "div",
      "maphead",
      el(
        "div",
        "",
        el("span", "eyebrow", "NETWORK OPERATIONS"),
        el("h2", "", "Live network map"),
      ),
      sel,
    ),
    stage,
    el(
      "div",
      "mapfoot",
      el("span", "", el("i", "legendline"), "Transit route"),
      el("span", "", "Vehicle labels show route numbers"),
    ),
  );
  map = createTransitMap(stage, {
    routes: net.routes,
    stops: net.stops,
    shapes,
    vehicles,
    onSelectStop: stopDetails,
    onSelectRoute: routeDetails,
    onSelectVehicle: vehicleDetails,
  });
  if (filterRoute) map.setFilter({ routeId: filterRoute });
}
function createComponent({ name }) {
  const element = el("div", name === "map" ? "panel" : "panel panecontent");
  let localMap, unmount;
  return {
    element,
    init() {
      if (name === "map") {
        mapPanel(element);
        localMap = map;
      } else if (name === "pulse") {
        summary = element;
        updateSummary();
      } else if (name === "alerts") {
        alertView = element;
        renderAlerts(element);
      } else if (name === "feeds") {
        unmount = mountFeeds(element);
      } else if (name === "planner") {
        mountPlanner(element, net.stops, tripDetails);
      } else if (name === "history") {
        unmount = mountHistory(element);
      } else if (name === "saved") {
        element.classList.add("savedpane");
        renderSaved(element);
      } else renderDirectory(element, name === "arrivals");
    },
    layout() {
      localMap?.resize();
    },
    dispose() {
      if (localMap) {
        localMap.destroy();
        if (map === localMap) map = null;
      }
      if (summary === element) summary = null;
      if (alertView === element) alertView = null;
      if (typeof unmount === "function") unmount();
    },
  };
}
api = createDockview($("workspace"), {
  theme: themeLight,
  createComponent,
  disableFloatingGroups: true,
});
const layoutKey = () => active + (innerWidth < 720 ? ".small" : ".wide");
function go(view, reset = false) {
  clearTimeout(layoutTimer);
  active = view;
  for (const b of $("nav").children)
    b.setAttribute("aria-selected", b.dataset.view === view);
  api.clear();
  const layout = read("layout." + layoutKey(), null);
  if (!reset && layout) {
    try {
      api.fromJSON(layout);
      if (api.panels.some((p) => p.id === (view === "network" ? "map" : view)))
        return;
    } catch {}
    api.clear();
  }
  if (view === "network") {
    const m = api.addPanel({
      id: "map",
      title: "Network map",
      component: "map",
    });
    const p = api.addPanel({
      id: "pulse",
      title: "Service desk",
      component: "pulse",
      position: {
        referencePanel: "map",
        direction: innerWidth < 720 ? "within" : "right",
      },
    });
    if (innerWidth >= 720)
      p.api.setSize({ width: Math.round($("workspace").clientWidth * 0.3) });
    m.api.setActive();
  } else api.addPanel({ id: view, title: names[view][1], component: view });
}
api.onDidLayoutChange(() => {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    if (api.panels.length) save("layout." + layoutKey(), api.toJSON());
  }, 350);
});
for (const [k, [i, l]] of Object.entries(names)) {
  const b = btn(l, () => go(k), "");
  b.prepend(icon(i));
  b.dataset.view = k;
  $("nav").append(b);
}
$("reset").onclick = () => go(active, true);
$("guide").onclick = () => {
  const box = show("Rider guide");
  for (const [h, p] of [
    [
      "Track your ride",
      "Use the live network map to select a route or vehicle. Surface vehicle positions come from the TTC public feed. Subway tracks are scheduled geography.",
    ],
    [
      "Check a departure",
      "Open Arrivals, search for a stop and select it. Predictions use Toronto local time. Choose a service date for the scheduled timetable. Select a departure to see its full trip. Times above 24:00 belong to the previous service day.",
    ],
    [
      "Understand delays",
      "Service alerts describe reported disruptions. Delay history covers published incident reports. An absent vehicle or alert does not confirm normal service.",
    ],
    [
      "Arrange your workspace",
      "Drag a panel tab to dock it beside another panel. Your browser remembers layouts and saved stops. Reset layout restores the selected view.",
    ],
  ])
    box.append(el("h3", "", h), el("p", "", p));
  const a = el(
    "a",
    "link",
    "Data sources, accessibility and rider documentation",
  );
  a.href = "guide.html";
  box.append(a);
};
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  $("refresh").disabled = true;
  $("refresh").replaceChildren(icon("refresh"), "Refreshing");
  const req = [
    getVehicles()
      .then((d) => {
        vehicles = d.vehicles;
        vehicleTime = d.time;
        vehicleError = false;
        map?.setData({ vehicles });
        metrics();
      })
      .catch(() => {
        vehicleError = true;
      }),
    getMessages()
      .then((d) => {
        messages = d;
        msgOK = true;
        lastRead = Date.now();
      })
      .catch(() => {
        msgOK = false;
        messages = [];
      }),
    fetch("./data/realtime-alerts.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((d) => {
        official = d.entries;
        alertTime = d.time;
        metrics();
        updateSummary();
      })
      .catch(() => {}),
  ];
  await Promise.all(req);
  metrics();
  updateSummary();
  renderAlerts(alertView);
  refreshing = false;
  $("refresh").disabled = false;
  $("refresh").replaceChildren(icon("refresh"), "Refresh");
}
$("refresh").onclick = refresh;
metrics();
go("network");
openSharedDetail();
addEventListener("hashchange", openSharedDetail);
refresh();
fetch("./data/shapes.json")
  .then((r) => r.json())
  .then((d) => {
    shapes = d;
    map?.setData({ shapes });
  })
  .catch(() => {});
setInterval(() => {
  if (!document.hidden) refresh();
}, 60000);
