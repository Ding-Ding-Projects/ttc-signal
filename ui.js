export const icons = {
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15",
  vehicles:
    "M5 16V7q0-3 3-3h8q3 0 3 3v9q0 2-2 2H7q-2 0-2-2Z M5 11h14 M8 15h1 M15 15h1 M7 18v2 M17 18v2",
  alerts: "M12 3 2 20h20z M12 9v5 M12 16v1",
  routes: "M4 18h5l5-12h6 M4 6h5l5 12h6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v6l4 2",
  refresh:
    "M20 10a8 8 0 0 0-14-4L3 9 M3 4v5h5 M4 14a8 8 0 0 0 14 4l3-3 M21 20v-5h-5",
  stops:
    "M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  saved: "M6 4h12v17l-6-4-6 4z",
  history: "M4 20h17 M6 16v-5 M12 16V4 M18 16V8",
};
export function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", "icon");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(s.namespaceURI, "path");
  p.setAttribute("d", icons[name]);
  for (const [k, v] of Object.entries({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.7",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    p.setAttribute(k, v);
  s.append(p);
  return s;
}
export function el(tag, cls = "", ...kids) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  x.append(...kids.filter((v) => v != null));
  return x;
}
export function btn(label, fn, cls = "tool") {
  const b = el("button", cls, label);
  b.type = "button";
  b.onclick = fn;
  return b;
}
export function row(badge, title, sub, fn) {
  return btn(
    el(
      "span",
      "row",
      badge,
      el("span", "rowtext", el("b", "", title), el("small", "", sub)),
      el("span", "arrow", "›"),
    ),
    fn,
    "rowbutton",
  );
}
export function field(label, type = "search") {
  const i = el("input", "search");
  i.type = type;
  i.placeholder = label;
  i.setAttribute("aria-label", label);
  return i;
}
export function option(value, label) {
  const o = el("option", "", label);
  o.value = value;
  return o;
}
export const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const torTime = (t) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(t));
export const read = (key, def) => {
  try {
    return JSON.parse(localStorage.getItem("signal." + key)) ?? def;
  } catch {
    return def;
  }
};
export const save = (key, value) => {
  try {
    localStorage.setItem("signal." + key, JSON.stringify(value));
  } catch {}
};
