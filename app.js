// ===============================
// ACNH Item DB — Full Replacement
// Works with your existing data.json headers (spaces + "Recipies" spelling)
// ===============================

// Your dataset headers (do NOT change the dataset)
const FIELDS = {
  item: "ITEM",
  rawValue: "RAW VALUE",
  price: "PRICE",
  profit: "PROFIT",
  margin: "Margin",
  tag: "TAG",
  diy: "DIY",
  notes: "NOTES",
  recipes: "Recipies", // keep misspelling because data uses it
};

const $ = (id) => document.getElementById(id);

const els = {
  search: $("search"),
  tagFilter: $("tagFilter"),
  sortBy: $("sortBy"),
  diyOnly: $("diyOnly"),
  count: $("count"),
  status: $("status"),
  list: $("list"),
};

let RAW = [];
let VIEW = [];

// Safe getter for weird keys (spaces, caps, etc.)
const get = (row, fieldKey, fallback = "") => {
  const k = FIELDS[fieldKey];
  const v = row?.[k];
  return (v === undefined || v === null || v === "") ? fallback : v;
};

const norm = (v) => String(v ?? "").toLowerCase().trim();

const parseNumber = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "-" || s === "") return null;
  const cleaned = s.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const parsePercent = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "-" || s === "") return null;
  const cleaned = s.replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

function setStatus(msg = "", isError = false) {
  els.status.textContent = msg;
  els.status.className = "status" + (isError ? " error" : "");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildTagOptions(items) {
  const tags = new Set();
  for (const row of items) {
    const t = String(get(row, "tag", "")).trim();
    if (t) tags.add(t);
  }

  const sorted = [...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  els.tagFilter.innerHTML = `<option value="">All tags</option>` + sorted.map(t => {
    const safe = escapeHtml(t);
    return `<option value="${safe}">${safe}</option>`;
  }).join("");
}

function applyFilters() {
  const q = norm(els.search.value);
  const tag = els.tagFilter.value;
  const diyOnly = els.diyOnly.checked;
  const sortBy = els.sortBy.value;

  // Filter
  let out = RAW.filter(row => {
    const item = norm(get(row, "item", ""));
    const notes = norm(get(row, "notes", ""));
    const recipes = norm(get(row, "recipes", ""));
    const rowTag = String(get(row, "tag", "")).trim();
    const diy = norm(get(row, "diy", "")); // "Yes"/"No"

    if (tag && rowTag !== tag) return false;
    if (diyOnly && diy !== "yes") return false;

    if (!q) return true;
    return (
      item.includes(q) ||
      notes.includes(q) ||
      recipes.includes(q) ||
      norm(rowTag).includes(q)
    );
  });

  // Sort
  const byName = (a, b) => {
    const A = String(get(a, "item", "")).toLowerCase();
    const B = String(get(b, "item", "")).toLowerCase();
    return A.localeCompare(B);
  };

  const byNum = (fieldKey, dir) => (a, b) => {
    const A = parseNumber(get(a, fieldKey, null));
    const B = parseNumber(get(b, fieldKey, null));
    // nulls last
    if (A === null && B === null) return 0;
    if (A === null) return 1;
    if (B === null) return -1;
    return dir * (A - B);
  };

  const byPct = (dir) => (a, b) => {
    const A = parsePercent(get(a, "margin", null));
    const B = parsePercent(get(b, "margin", null));
    if (A === null && B === null) return 0;
    if (A === null) return 1;
    if (B === null) return -1;
    return dir * (A - B);
  };

  switch (sortBy) {
    case "name_asc": out.sort(byName); break;
    case "name_desc": out.sort((a, b) => -byName(a, b)); break;
    case "price_desc": out.sort(byNum("price", -1)); break;
    case "price_asc": out.sort(byNum("price", 1)); break;
    case "profit_desc": out.sort(byNum("profit", -1)); break;
    case "profit_asc": out.sort(byNum("profit", 1)); break;
    case "margin_desc": out.sort(byPct(-1)); break;
    case "margin_asc": out.sort(byPct(1)); break;
    default: out.sort(byName);
  }

  VIEW = out;
  render();
}

function render() {
  els.count.textContent = `${VIEW.length.toLocaleString()} items shown`;

  if (!VIEW.length) {
    els.list.innerHTML = `<div class="item"><h3>(no results)</h3><div class="notes">Try clearing filters or searching a different term.</div></div>`;
    return;
  }

  els.list.innerHTML = VIEW.map(row => {
    const name = get(row, "item", "(unnamed)");
    const tag = get(row, "tag", "-");
    const diy = String(get(row, "diy", "-")).trim();
    const rawValue = get(row, "rawValue", "-");
    const price = get(row, "price", "-");
    const profit = get(row, "profit", "-");
    const margin = get(row, "margin", "-");
    const notes = get(row, "notes", "");
    const recipes = get(row, "recipes", "");

    const diyClass = norm(diy) === "yes" ? "badge" : "badge no";

    const notesBlock = (notes || recipes)
      ? `<div class="notes">
          ${notes ? `<div><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ""}
          ${recipes ? `<div><strong>Recipes:</strong> ${escapeHtml(recipes)}</div>` : ""}
        </div>`
      : "";

    return `
      <article class="item">
        <h3>${escapeHtml(name)}</h3>
        <div class="pills">
          <span class="pill">Tag: ${escapeHtml(tag)}</span>
          <span class="pill ${diyClass}">DIY: ${escapeHtml(diy || "-")}</span>
          <span class="pill">Raw Value: ${escapeHtml(rawValue)}</span>
          <span class="pill">Price: ${escapeHtml(price)}</span>
          <span class="pill">Profit: ${escapeHtml(profit)}</span>
          <span class="pill">Margin: ${escapeHtml(margin)}</span>
        </div>
        ${notesBlock}
      </article>
    `;
  }).join("");
}

async function loadData() {
  setStatus("Loading data.json…");

  try {
    // Must be served via GitHub Pages / local server (not file://)
    const res = await fetch("./data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("data.json is not an array");

    RAW = data;

    // sanity check: if headers don't match, you’ll see "(unnamed)" a lot
    const sample = RAW[0] || {};
    const hasItemKey = Object.prototype.hasOwnProperty.call(sample, FIELDS.item);
    if (!hasItemKey) {
      setStatus(`Loaded, but missing expected key "${FIELDS.item}". Check JSON headers.`, true);
    } else {
      setStatus(`Loaded ${RAW.length.toLocaleString()} items.`);
    }

    buildTagOptions(RAW);
    applyFilters();
  } catch (err) {
    console.error(err);
    setStatus(`ERROR: ${err.message}`, true);
    els.list.innerHTML = `
      <div class="item error">
        <h3>Could not load data.json</h3>
        <div class="notes">
          <div><strong>Common causes:</strong></div>
          <ul>
            <li>You opened the page via <code>file://</code> instead of GitHub Pages / a local server.</li>
            <li><code>data.json</code> is not in the same folder as <code>index.html</code>.</li>
            <li>The JSON is invalid (trailing commas, unescaped quotes, etc.).</li>
          </ul>
          <div><strong>Error:</strong> ${escapeHtml(err.message)}</div>
        </div>
      </div>
    `;
  }
}

function wireUI() {
  els.search.addEventListener("input", applyFilters);
  els.tagFilter.addEventListener("change", applyFilters);
  els.sortBy.addEventListener("change", applyFilters);
  els.diyOnly.addEventListener("change", applyFilters);
}

wireUI();
loadData();
