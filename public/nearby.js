import { btn, el } from "./ui.js";

export function nearbyStops(stops, renderStop) {
  const results = el("div");
  results.setAttribute("aria-live", "polite");
  const filter = el("input");
  filter.type = "checkbox";
  const label = el("label", "", filter, " Wheelchair boarding confirmed");
  let distances = [];
  function paint() {
    const closest = distances
      .filter((x) => !filter.checked || x.stop.wheelchair_boarding === "1")
      .slice(0, 8);
    results.replaceChildren(
      ...closest.map((x) =>
        el(
          "div",
          "nearby-row",
          renderStop(x.stop),
          el(
            "small",
            "muted",
            x.distance < 1
              ? Math.round(x.distance * 1000) + " m"
              : x.distance.toFixed(1) + " km",
          ),
        ),
      ),
    );
  }
  filter.onchange = paint;
  const button = btn("Find nearby stops", () => {
    if (!navigator.geolocation) {
      results.textContent = "Location is unavailable in this browser.";
      return;
    }
    results.textContent = "Locating nearby stops…";
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const rad = Math.PI / 180;
        distances = stops
          .map((stop) => {
            const a =
              Math.sin(((Number(stop.stop_lat) - coords.latitude) * rad) / 2) **
                2 +
              Math.cos(coords.latitude * rad) *
                Math.cos(Number(stop.stop_lat) * rad) *
                Math.sin(
                  ((Number(stop.stop_lon) - coords.longitude) * rad) / 2,
                ) **
                  2;
            return {
              stop,
              distance: 12742 * Math.asin(Math.min(1, Math.sqrt(a))),
            };
          })
          .sort((a, b) => a.distance - b.distance);
        button.disabled = false;
        paint();
      },
      () => {
        button.disabled = false;
        results.textContent =
          "Location unavailable. Search by stop name or number below.";
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  });
  return el("div", "", el("div", "filters", button, label), results);
}
