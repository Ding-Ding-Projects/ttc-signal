import { planJourney } from "./data/live.js";
import { el, field, btn, localDate, torTime } from "./ui.js";
export function mountPlanner(container, stops, openTrip) {
  function picker(label) {
    const input = field(label),
      matches = el("div"),
      group = el("div", "", el("label", "smallcaps", label), input, matches);
    let selected = null;
    input.oninput = () => {
      selected = null;
      const term = input.value.trim().toLowerCase();
      const hits = term
        ? stops
            .filter((s) =>
              (s.stop_name + " " + s.stop_code).toLowerCase().includes(term),
            )
            .slice(0, 7)
        : [];
      matches.replaceChildren(
        ...hits.map((s) =>
          btn(
            s.stop_name + " · " + s.stop_code,
            () => {
              selected = s;
              input.value = s.stop_name + " · " + s.stop_code;
              matches.replaceChildren();
            },
            "pickstop",
          ),
        ),
      );
    };
    return { group, get: () => selected };
  }
  const from = picker("Origin stop"),
    to = picker("Destination stop"),
    date = field("Service date", "date"),
    time = field("Departure time", "time"),
    results = el("div");
  date.value = localDate();
  time.value = torTime(Date.now());
  const button = btn(
    "Find journeys",
    async () => {
      if (
        !from.get() ||
        !to.get() ||
        from.get() === to.get() ||
        !date.value ||
        !time.value
      ) {
        results.textContent =
          "Choose two different stops, a service date and a departure time.";
        return;
      }
      button.disabled = true;
      results.textContent = "Searching timetables…";
      try {
        const found = await planJourney(
          from.get(),
          to.get(),
          date.value,
          time.value,
        );
        const byId = new Map(stops.map((s) => [s.stop_id, s.stop_name]));
        results.replaceChildren(
          ...(found.length
            ? found.map((legs) =>
                el(
                  "article",
                  "msg",
                  el("b", "", legs[0].departure + " → " + legs.at(-1).arrival),
                  el(
                    "p",
                    "muted",
                    legs.length === 1
                      ? "Direct service"
                      : "One transfer at " + byId.get(legs[0].to),
                  ),
                  ...legs.map((l) =>
                    btn(
                      l.route + " · " + l.headsign + " · " + l.departure,
                      () => openTrip(l),
                    ),
                  ),
                ),
              )
            : [
                "No direct or same-stop one-transfer journey after this time on the selected service date.",
              ]),
        );
      } catch {
        results.textContent = "The required timetables could not be loaded.";
      } finally {
        button.disabled = false;
      }
    },
    "planbutton",
  );
  results.setAttribute("aria-live", "polite");
  container.append(
    el("span", "eyebrow", "RIDER TOOLS"),
    el("h2", "", "Plan a journey"),
    el(
      "p",
      "viewIntro",
      "Compare scheduled trips between two exact stops, with up to one transfer at the same stop and a two-minute connection allowance.",
    ),
    el(
      "div",
      "planfields",
      from.group,
      to.group,
      el("label", "", "Service date", date),
      el("label", "", "Depart after", time),
    ),
    button,
    results,
  );
}
