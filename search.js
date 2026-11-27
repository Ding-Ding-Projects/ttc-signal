import { el, btn, field, option } from "./ui.js";

/** Run user patterns off the UI thread and bound every search. */
export function searchList(items, key, draw, placeholder) {
  const input = field(placeholder),
    body = el("div"),
    mode = el(
      "select",
      "field",
      option("plain", "Contains text"),
      option("prefix", "Starts with"),
      option("exact", "Exact match"),
      option("regex", "Regular expression"),
    );
  mode.setAttribute("aria-label", "Search mode");
  const flag = el("input");
  flag.type = "checkbox";
  const options = el(
    "details",
    "search-options",
    el("summary", "", "Search options"),
    el("div", "filters", mode, el("label", "", flag, " Case sensitive")),
  );
  let limit = 40,
    hits = items,
    worker = null,
    timer;
  const keys = items.map(key);
  function paint() {
    body.replaceChildren(
      el("div", "resultcount", hits.length.toLocaleString() + " results"),
      ...hits.slice(0, limit).map(draw),
    );
    if (hits.length > limit)
      body.append(
        btn("Show more", () => {
          limit += 40;
          paint();
        }),
      );
  }
  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
  }
  function filter() {
    stop();
    limit = 40;
    const term = input.value.trim();
    if (!term) {
      hits = items;
      paint();
      return;
    }
    if (mode.value === "regex") {
      body.textContent = "Matching pattern…";
      worker = new Worker(new URL("./search-worker.js", import.meta.url));
      worker.onmessage = ({ data }) => {
        stop();
        if (data.error) {
          body.textContent = data.error;
          return;
        }
        hits = data.indices.map((i) => items[i]);
        paint();
      };
      worker.onerror = () => {
        stop();
        body.textContent = "Pattern search unavailable.";
      };
      timer = setTimeout(() => {
        stop();
        body.textContent =
          "Pattern timed out. Narrow the expression and try again.";
      }, 400);
      worker.postMessage({
        keys,
        pattern: term,
        flags: flag.checked ? "" : "i",
      });
      return;
    }
    const query = flag.checked ? term : term.toLowerCase();
    hits = items.filter((_, i) => {
      const value = flag.checked ? keys[i] : keys[i].toLowerCase();
      if (mode.value === "prefix") return value.startsWith(query);
      if (mode.value === "exact") return value === query;
      return value.includes(query);
    });
    paint();
  }
  input.oninput = mode.onchange = flag.onchange = filter;
  paint();
  return el("div", "results", input, options, body);
}
