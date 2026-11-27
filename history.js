const dataURL = (name) => new URL("./data/" + name, import.meta.url);
const count = new Intl.NumberFormat("en-CA");
const rowsPerPage = 25;

async function loadJSON(name) {
  const res = await fetch(dataURL(name));
  if (!res.ok) throw new Error("Archive unavailable");
  return res.json();
}

function option(value, label) {
  return new Option(label, value);
}

function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function installStyles() {
  if (document.getElementById("ttc-history-style")) return;
  const el = document.createElement("style");
  el.id = "ttc-history-style";
  el.textContent = `
  .delay-archive{box-sizing:border-box;color:#123e37;background:#fff;height:100%;overflow:auto;padding:clamp(16px,3vw,36px);font:14px/1.5 system-ui,sans-serif;container-type:inline-size}
  .delay-archive h2{margin:0;font-size:clamp(25px,5cqw,38px);letter-spacing:-.05em;line-height:1.2}
  .delay-archive .hist-note,.delay-archive small{color:#526964}
  .delay-archive .hist-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:12px}
  .delay-archive label{display:grid;gap:4px;font-size:12px;font-weight:650}
  .delay-archive select,.delay-archive input,.delay-archive button{border:1px solid #afc4bb;border-radius:6px;background:#fff;color:#143c35;min-width:0;padding:8px;font:inherit}
  .delay-archive button{cursor:pointer}.delay-archive button:disabled{opacity:.45;cursor:default}
  .delay-archive :focus-visible{outline:3px solid #d76a21;outline-offset:2px}
  .delay-archive dl{display:flex;gap:clamp(16px,5cqw,50px);flex-wrap:wrap;border-block:1px solid #ccd9d3;padding:15px 0;margin:20px 0}
  .delay-archive dt{font-size:12px;color:#526964}.delay-archive dd{font-size:26px;font-weight:700;letter-spacing:-.04em;margin:0}
  .delay-archive .hist-table{overflow:auto;max-width:100%}.delay-archive table{width:100%;text-align:left;border-collapse:collapse;font-size:13px}
  .delay-archive th,.delay-archive td{border-bottom:1px solid #e0e7e3;padding:9px;vertical-align:top}.delay-archive th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#526964;background:#f0f5f1}
  .delay-archive .hist-min{font-weight:700;color:#9e430e;white-space:nowrap}.delay-archive .hist-paging{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0}
  .delay-archive .hist-source{font-size:12px;color:#526964}.delay-archive a{color:#145348;text-decoration:underline}
  `;
  document.head.append(el);
}

export async function mountHistory(container) {
  installStyles();
  const root = document.createElement("section");
  root.className = "delay-archive";
  root.innerHTML = `
  <h2>Delay archive</h2>
  <p class="hist-note">Explore incident reports published by the TTC. Times are local to Toronto.</p>
  <div class="hist-controls">
    <label>Transit mode<select data-h="mode"><option value="subway">Subway</option><option value="streetcar">Streetcar</option><option value="bus">Bus</option></select></label>
    <label>Report month<select data-h="month"></select></label>
    <label>Line or location<input data-h="query" type="search" placeholder="Search the records"></label>
    <label>Incident cause<select data-h="cause"><option value="">All causes</option></select></label>
  </div>
  <p data-h="status" role="status">Loading incident archive…</p>
  <dl><div><dt>Incident reports</dt><dd data-h="total">—</dd></div><div><dt>Reported delay minutes</dt><dd data-h="minutes">—</dd></div><div><dt>Longest delay</dt><dd data-h="longest">—</dd></div></dl>
  <div class="hist-table" tabindex="0" aria-label="Incident records, scroll horizontally">
  <table><thead><tr><th>Date &amp; time</th><th>Line</th><th>Location</th><th>Cause</th><th>Delay</th><th>Gap</th></tr></thead><tbody data-h="body"></tbody></table></div>
  <div class="hist-paging"><button data-h="prev" disabled>Previous</button><span data-h="page"></span><button data-h="next" disabled>Next</button></div>
  <p class="hist-source">Zero-minute reports are included. Gap is the TTC’s recorded service gap. Delay totals add incident minutes and do not measure passenger travel time.
  Contains information licensed under the <a href="https://open.toronto.ca/open-data-licence/">Open Government Licence – Toronto</a>. <a data-h="source">View source records</a>.</p>`;
  container.replaceChildren(root);
  const ui = Object.fromEntries(
    [...root.querySelectorAll("[data-h]")].map((el) => [el.dataset.h, el]),
  );
  let manifest,
    records = [],
    filtered = [],
    codes = {},
    page = 0,
    generation = 0;
  const monthName = (month) =>
    new Intl.DateTimeFormat("en-CA", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(month + "-15T12:00:00Z"));

  function displayPage() {
    const pages = Math.ceil(filtered.length / rowsPerPage);
    ui.prev.disabled = page === 0;
    ui.next.disabled = page + 1 >= pages;
    ui.page.textContent = pages ? "Page " + (page + 1) + " of " + pages : "";
    const slice = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
    ui.body.replaceChildren(
      ...slice.map(([date, time, line, station, code, delay, gap, bound]) => {
        const tr = document.createElement("tr");
        for (const value of [
          date + " " + time,
          [line, bound].filter(Boolean).join(" · "),
          titleCase(station),
          titleCase(codes[code]) || code,
          delay == null ? "—" : delay + " min",
          gap == null ? "—" : gap + " min",
        ]) {
          const td = tr.insertCell();
          td.textContent = value;
        }
        tr.cells[4].className = "hist-min";
        return tr;
      }),
    );
  }

  function filter() {
    const q = ui.query.value.trim().toLowerCase();
    filtered = records.filter(
      (r) =>
        (!ui.cause.value || ui.cause.value === r[4]) &&
        (!q || (r[2] + " " + r[3]).toLowerCase().includes(q)),
    );
    ui.total.textContent = count.format(filtered.length);
    const measured = filtered.map((r) => r[5]).filter(Number.isFinite);
    ui.minutes.textContent = measured.length
      ? count.format(measured.reduce((a, b) => a + b, 0))
      : "—";
    ui.longest.textContent = measured.length
      ? Math.max(...measured) + " min"
      : "—";
    const coverage = manifest.modes[ui.mode.value].months[ui.month.value];
    ui.status.textContent =
      count.format(filtered.length) +
      " matching reports · Source dates " +
      coverage.from +
      " through " +
      coverage.to;
    page = 0;
    displayPage();
  }

  async function changeMonth() {
    const request = ++generation;
    const { mode, month } = ui;
    const meta = manifest.modes[mode.value];
    records = [];
    filtered = [];
    page = 0;
    displayPage();
    ui.total.textContent =
      ui.minutes.textContent =
      ui.longest.textContent =
        "—";
    ui.query.disabled = ui.cause.disabled = true;
    ui.status.textContent = "Loading " + monthName(month.value) + " records…";
    ui.source.href = meta.source;
    try {
      const rows = await loadJSON(
        "history-" + mode.value + "-" + month.value + ".json",
      );
      if (request !== generation) return;
      records = rows;
      codes = meta.codes;
      const present = [
        ...new Set(records.map((r) => r[4]).filter(Boolean)),
      ].sort((a, b) => (codes[a] || a).localeCompare(codes[b] || b));
      ui.cause.replaceChildren(
        option("", "All causes"),
        ...present.map((code) =>
          option(code, (titleCase(codes[code]) || code) + " (" + code + ")"),
        ),
      );
      ui.query.disabled = ui.cause.disabled = false;
      filter();
    } catch {
      if (request === generation)
        ui.status.textContent =
          "This month could not be loaded. Select another month or reopen the archive to retry.";
    }
  }

  function changeMode() {
    const months = Object.keys(manifest.modes[ui.mode.value].months)
      .sort()
      .reverse();
    const selected = ui.month.value;
    ui.month.replaceChildren(
      ...months.map((key) => option(key, monthName(key))),
    );
    if (months.includes(selected)) ui.month.value = selected;
    return changeMonth();
  }

  try {
    manifest = await loadJSON("history.json");
    ui.mode.onchange = changeMode;
    ui.month.onchange = changeMonth;
    ui.cause.onchange = ui.query.oninput = filter;
    ui.prev.onclick = () => {
      page--;
      displayPage();
    };
    ui.next.onclick = () => {
      page++;
      displayPage();
    };
    await changeMode();
  } catch {
    ui.status.textContent =
      "The incident archive could not be loaded. Reopen the archive to retry.";
  }
}
