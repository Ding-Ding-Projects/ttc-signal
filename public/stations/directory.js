const form = document.querySelector("[data-filters]");
const fields = ["q", "line", "service"];
const params = new URLSearchParams(location.search);
for (const name of fields) form.elements[name].value = params.get(name) || "";
const cards = Array.from(document.querySelectorAll("[data-station]"));
const normalize = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
function filter() {
  const query = normalize(form.elements.q.value);
  const line = form.elements.line.value;
  const service = form.elements.service.value;
  let visible = 0;
  for (const card of cards) {
    const match =
      normalize(card.dataset.station).includes(query) &&
      (!line || card.dataset.lines.split(" ").includes(line)) &&
      (!service || card.dataset.service === service);
    card.hidden = !match;
    if (match) visible++;
  }
  document.querySelector("[role=status]").textContent = visible
    ? visible + (visible === 1 ? " place" : " places")
    : "No matching stations. Try another name or change the filters.";
  for (const section of document.querySelectorAll("[data-group]"))
    section.hidden = !section.querySelector("li:not([hidden])");
  const url = new URL(location.href);
  for (const name of fields) {
    const value = form.elements[name].value;
    if (value) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  history.replaceState(null, "", url);
}
form.hidden = false;
form.addEventListener("input", filter);
form.addEventListener("submit", (event) => event.preventDefault());
filter();
