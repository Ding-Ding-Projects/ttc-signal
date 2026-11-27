import * as L from "./vendor/map/leaflet-src.esm.js";

for (const path of ["./vendor/map/leaflet.css", "./vendor/map/transit.css"]) {
  const href = new URL(path, import.meta.url).href;
  if (!Array.from(document.styleSheets).some((sheet) => sheet.href === href)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }
}

const downtown = [43.653, -79.389];
const modeName = (route) =>
  ({ 0: "streetcar", 1: "subway", 2: "rail", 3: "bus" })[route?.route_type] ||
  "bus";
const lineColors = {
  1: "#e8af1b",
  2: "#18815b",
  4: "#935695",
  5: "#e87933",
  6: "#71869d",
};
const lineColor = (route) =>
  lineColors[route?.route_short_name] ||
  (modeName(route) === "streetcar" ? "#d45045" : "#627f92");
const routeNumber = (route) => String(route?.route_short_name ?? "");
const position = (item) => [
  Number(item.lat ?? item.stop_lat),
  Number(item.lon ?? item.stop_lon),
];
const hasPosition = (point) =>
  point.every(Number.isFinite) &&
  Math.abs(point[0]) <= 90 &&
  Math.abs(point[1]) <= 180;
const clean = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  locate:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  layers: '<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5m-18 5 9 5 9-5"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>',
};
const symbol = (name) =>
  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  icons[name] +
  "</svg>";

export function createTransitMap(container, options = {}) {
  const data = { routes: [], stops: [], shapes: {}, vehicles: [], ...options };
  container.classList.add("transit-map");
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
    minZoom: 9,
    maxZoom: 18,
    scrollWheelZoom: false,
  }).setView(downtown, 13);
  container.setAttribute(
    "aria-label",
    "Toronto transit map. Use arrow keys to pan and plus or minus to zoom.",
  );
  map.attributionControl.setPrefix(false);
  const cartography = map.createPane("localGeography");
  cartography.style.zIndex = "190";
  L.imageOverlay(
    new URL("./vendor/map/toronto-base.svg", import.meta.url).href,
    [
      [43.55, -79.66],
      [43.87, -79.08],
    ],
    {
      pane: "localGeography",
      attribution:
        '<a href="https://open.toronto.ca/open-data-licence/">City of Toronto</a>',
    },
  ).addTo(map);
  const streetTiles = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  );
  const paths = L.layerGroup().addTo(map);
  const labels = L.layerGroup().addTo(map);
  const stops = L.layerGroup().addTo(map);
  const fleet = L.layerGroup().addTo(map);
  let filter = { routeId: "", mode: "all" };
  let byNumber = new Map();
  let byId = new Map();
  let active = true;
  let locationMarker;
  let locationNotice;
  let noticeTimer;
  const redrawControls = [];
  const addControl = (name, commands) => {
    const control = L.control({ position: "topright" });
    control.onAdd = () => {
      const box = L.DomUtil.create("div", "signal-map-control");
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", name);
      for (const [label, icon, action] of commands) {
        const button = document.createElement("button");
        button.type = "button";
        button.title = label;
        button.setAttribute("aria-label", label);
        button.innerHTML = symbol(icon);
        button.addEventListener("click", action);
        if (icon === "plus" || icon === "minus")
          redrawControls.push(() => {
            button.disabled =
              icon === "plus"
                ? map.getZoom() >= map.getMaxZoom()
                : map.getZoom() <= map.getMinZoom();
          });
        box.append(button);
      }
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      return box;
    };
    control.addTo(map);
  };
  function notice(message) {
    if (!locationNotice) {
      locationNotice = document.createElement("div");
      locationNotice.className = "signal-map-notice";
      locationNotice.setAttribute("role", "status");
      container.append(locationNotice);
    }
    locationNotice.textContent = message;
    locationNotice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      locationNotice.hidden = true;
    }, 6500);
  }
  function locate() {
    if (!navigator.geolocation)
      return notice("Location is unavailable in this browser.");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!active) return;
        const point = [coords.latitude, coords.longitude];
        if (!L.latLngBounds([43.45, -80], [44, -78.8]).contains(point))
          return notice("Your location is outside the Toronto transit area.");
        locationMarker?.remove();
        locationMarker = L.circleMarker(point, {
          color: "#fff",
          weight: 3,
          fillColor: "#3966cd",
          fillOpacity: 1,
          radius: 8,
        })
          .bindTooltip("Your location")
          .addTo(map);
        map.setView(point, 15);
      },
      () => {
        if (active)
          notice(
            "Location unavailable. Check your browser’s location permission.",
          );
      },
      { timeout: 9000, maximumAge: 30000 },
    );
  }
  addControl("Map zoom", [
    ["Zoom in", "plus", () => map.zoomIn()],
    ["Zoom out", "minus", () => map.zoomOut()],
  ]);
  addControl("Map position", [
    [
      "Toggle detailed street map",
      "layers",
      () => {
        if (map.hasLayer(streetTiles)) streetTiles.remove();
        else streetTiles.addTo(map);
        container
          .querySelector('[aria-label="Toggle detailed street map"]')
          .setAttribute("aria-pressed", String(map.hasLayer(streetTiles)));
      },
    ],
    ["Find my location", "locate", locate],
    [
      "Fit network",
      "fit",
      () =>
        map.fitBounds(
          [
            [43.59, -79.6],
            [43.84, -79.15],
          ],
          { padding: [12, 12] },
        ),
    ],
  ]);
  container
    .querySelector('[aria-label="Toggle detailed street map"]')
    .setAttribute("aria-pressed", "false");
  function accepts(route) {
    const mode = String(filter.mode || "all").toLowerCase();
    return (
      (!filter.routeId ||
        [routeNumber(route), String(route?.route_id)].includes(
          String(filter.routeId),
        )) &&
      (mode === "all" ||
        mode === modeName(route) ||
        mode === String(route?.route_type))
    );
  }
  function selectLine(route) {
    if (route) data.onSelectRoute?.(route);
  }
  function drawPaths() {
    paths.clearLayers();
    const sorted = [...data.routes].sort(
      (a, b) => (modeName(a) === "subway") - (modeName(b) === "subway"),
    );
    for (const route of sorted) {
      if (!accepts(route)) continue;
      const lines = data.shapes?.[routeNumber(route)];
      if (!lines?.length) continue;
      const selected = Boolean(filter.routeId);
      const subway = modeName(route) === "subway";
      const streetcar = modeName(route) === "streetcar";
      const weight = selected ? 5.5 : subway ? 5 : streetcar ? 2 : 1.15;
      if (selected || subway)
        L.polyline(lines, {
          color: "#fff",
          opacity: 0.95,
          weight: weight + 2.8,
          interactive: false,
        }).addTo(paths);
      L.polyline(lines, {
        color: lineColor(route),
        opacity: selected || subway ? 0.98 : streetcar ? 0.66 : 0.28,
        weight,
        smoothFactor: 1.6,
      })
        .bindTooltip(
          clean(routeNumber(route) + " · " + route.route_long_name),
          { sticky: true },
        )
        .on("click", () => selectLine(route))
        .addTo(paths);
    }
  }
  function showDetail(point, heading, description) {
    const popup = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = heading;
    const detail = document.createElement("div");
    detail.textContent = description;
    popup.append(title, detail);
    L.popup({ className: "signal-map-popup" })
      .setLatLng(point)
      .setContent(popup)
      .openOn(map);
  }
  function focusStop(stop) {
    const point = position(stop);
    if (!hasPosition(point)) return;
    map.setView(point, Math.max(16, map.getZoom()));
    showDetail(
      point,
      stop.stop_name,
      "Stop " + (stop.stop_code || stop.stop_id),
    );
  }
  function focusVehicle(vehicle) {
    const point = position(vehicle);
    if (!hasPosition(point)) return;
    map.setView(point, Math.max(15, map.getZoom()));
    const speed = Number(vehicle.speedKmHr);
    showDetail(
      point,
      "Route " + vehicle.routeTag + " · Vehicle " + vehicle.id,
      Number.isFinite(speed) && speed >= 0
        ? speed + " km/h"
        : "Speed unavailable",
    );
  }
  function drawPoints() {
    labels.clearLayers();
    stops.clearLayers();
    fleet.clearLayers();
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const size = map.getSize();
    if (!size.x || !size.y) return;
    if (zoom >= 15 || filter.routeId) {
      for (const stop of data.stops) {
        const point = position(stop);
        const numbers = stop.routes || [];
        if (
          !hasPosition(point) ||
          !bounds.contains(point) ||
          !numbers.some((number) => accepts(byNumber.get(String(number))))
        )
          continue;
        L.circleMarker(point, {
          color: "#fff",
          fillColor: "#273938",
          fillOpacity: 1,
          radius: 3.4,
          weight: 1.3,
        })
          .bindTooltip(clean(stop.stop_name))
          .on("click", () => {
            focusStop(stop);
            data.onSelectStop?.(stop);
          })
          .addTo(stops);
      }
    }
    // Label a geographically spaced set of lines while keeping every filtered line visible.
    const occupied = [];
    const inView = map.getBounds().pad(-0.07);
    for (const route of [...data.routes].sort(
      (a, b) => (modeName(b) === "subway") - (modeName(a) === "subway"),
    )) {
      if (
        !accepts(route) ||
        (!filter.routeId &&
          (modeName(route) === "bus" || /^3[0-9]{2}$/.test(routeNumber(route))))
      )
        continue;
      const candidates = data.shapes?.[routeNumber(route)]?.[0] || [];
      for (
        let i = Math.floor(candidates.length * 0.13);
        i < candidates.length;
        i += Math.max(1, Math.floor(candidates.length / 40))
      ) {
        const point = candidates[i];
        if (!inView.contains(point)) continue;
        const pix = map.latLngToContainerPoint(point);
        if (occupied.some((p) => p.distanceTo(pix) < 100)) continue;
        occupied.push(pix);
        const icon = L.divIcon({
          className: "signal-map-line-icon",
          html:
            '<span style="--route-color:' +
            lineColor(route) +
            '">' +
            clean(routeNumber(route)) +
            "</span>",
          iconSize: [27, 16],
          iconAnchor: [13, 8],
        });
        L.marker(point, {
          icon,
          title: route.route_long_name,
          alt: "Route " + routeNumber(route),
        })
          .on("click", () => selectLine(route))
          .addTo(labels);
        break;
      }
    }
    for (const vehicle of data.vehicles) {
      const point = position(vehicle);
      const route =
        byNumber.get(String(vehicle.routeTag)) ||
        byId.get(String(vehicle.routeTag));
      if (!hasPosition(point) || !bounds.contains(point) || !accepts(route))
        continue;
      const speed = Number(vehicle.speedKmHr);
      const info =
        "Vehicle " +
        vehicle.id +
        " · Route " +
        vehicle.routeTag +
        (Number.isFinite(speed) && speed >= 0 ? " · " + speed + " km/h" : "");
      const icon = L.divIcon({
        className: "signal-vehicle-icon",
        html: "<span>" + clean(vehicle.routeTag) + "</span>",
        iconSize: [28, 20],
        iconAnchor: [14, 10],
      });
      L.marker(point, { icon, title: info, alt: info, zIndexOffset: 300 })
        .bindTooltip(clean(info))
        .on("click", () => {
          focusVehicle(vehicle);
          data.onSelectVehicle?.(vehicle);
        })
        .addTo(fleet);
    }
  }
  function setData(changes) {
    Object.assign(data, changes);
    if ("routes" in changes || "shapes" in changes) {
      byNumber = new Map(
        data.routes.map((route) => [routeNumber(route), route]),
      );
      byId = new Map(
        data.routes.map((route) => [String(route.route_id), route]),
      );
      drawPaths();
    }
    drawPoints();
  }
  function setFilter(changes) {
    filter = { ...filter, ...changes };
    drawPaths();
    drawPoints();
    if (changes.routeId) {
      const route =
        byNumber.get(String(changes.routeId)) ||
        byId.get(String(changes.routeId));
      const lines = data.shapes?.[routeNumber(route)];
      if (lines?.length)
        map.fitBounds(L.polyline(lines).getBounds(), {
          padding: [24, 24],
          maxZoom: 15,
        });
    }
  }
  const resize = () => map.invalidateSize({ pan: true, animate: false });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  map.on("moveend", drawPoints);
  map.on("zoomend", () => redrawControls.forEach((fn) => fn()));
  setData({ routes: data.routes, shapes: data.shapes });
  return {
    setData,
    setFilter,
    focusStop,
    focusVehicle,
    resize,
    destroy() {
      active = false;
      observer.disconnect();
      clearTimeout(noticeTimer);
      locationNotice?.remove();
      map.remove();
    },
  };
}
