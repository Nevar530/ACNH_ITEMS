// =========================
// ACNH Item DB — app.js (FULL REPLACEMENT)
// Works with your index.html IDs:
//  #search, #tagFilter, #sortBy, #diyOnly, #count, #status, #list
//
// Uses your data.json headers exactly:
//  ITEM, RAW VALUE, PRICE, PROFIT, Margin, TAG, DIY, NOTES, Recipies
//
// Feature: clicking a recipe name auto-filters search to that item + highlights it.
// =========================

let ALL = [];
let VIEW = [];
let pendingHighlight = null;

const els = {
  search: document.querySelector("#search"),
  tag: document.querySelector("#tagFilter"),
  sort: document.querySelector("#sortBy"),
  diyOnly: document.querySelector("#diyOnly"),
  count: document.querySelector("#count"),
  status: document.querySelector("#status"),
  list: document.querySelector("#list"),
};

function setStatus(msg = "", isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.classList.toggle("error", !!isError);
}

// ---- helpers ----
const norm = (s) => String(s ?? "").trim();

const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function toNumber(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;

  const s = String(v).trim();
  if (!s || s === "-") return NaN;

  // remove commas + % + parentheses (for negatives like (130))
  const cleaned = s
    .replaceAll(",", "")
    .replaceAll("%", "")
    .replaceAll("(", "-")
    .replaceAll(")", "")
    .trim();

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

const includesCI = (hay, needle) =>
  String(hay ?? "").toLowerCase().includes(String(needle ?? "").toLowerCase());

const splitCSV = (s) =>
  norm(s)
    ? String(s)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

// ---- data ----
async function loadData() {
  setStatus("Loading...");
  const res = await fetch("./data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("data.json must be an array of objects");

  ALL = data.map((row) => normalizeRow(row));
  buildTagOptions();
  applyFilters();
  setStatus("");
}

function normalizeRow(row) {
  return {
    // Keep exact headers (case + spaces)
    ITEM: norm(row["ITEM"]),
    RAW_VALUE: row["RAW VALUE"],
    PRICE: row["PRICE"],
    PROFIT: row["PROFIT"],
    MARGIN: row["Margin"],
    TAG: norm(row["TAG"]),
    DIY: norm(row["DIY"]),
    NOTES: row["NOTES"],
    RECIPES: row["Recipies"], // (spelling per your sheet/json)
  };
}

// ---- UI: tags ----
function buildTagOptions() {
  const tags = Array.from(new Set(ALL.map((x) => x.TAG).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  const current = els.tag.value;

  els.tag.innerHTML =
    `<option value="">All tags</option>` +
    tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  if (tags.includes(current)) els.tag.value = current;
}

// ---- filter/sort/render ----
function applyFilters() {
  const qRaw = norm(els.search.value);
  const q = qRaw.toLowerCase();
  const tag = norm(els.tag.value);
  const diyOnly = !!(els.diyOnly && els.diyOnly.checked);

  VIEW = ALL.filter((x) => {
    if (tag && x.TAG !== tag) return false;
    if (diyOnly && x.DIY.toLowerCase() !== "yes") return false;

    if (!q) return true;

    // keep matching across item + notes + recipes + tag
    return (
      includesCI(x.ITEM, q) ||
      includesCI(x.NOTES, q) ||
      includesCI(x.RECIPES, q) ||
      includesCI(x.TAG, q)
    );
  });

  // If searching, rank results so ITEM name hits come first
  if (q) {
    const score = (x) => {
      const item = norm(x.ITEM).toLowerCase();
      const notes = norm(x.NOTES).toLowerCase();
      const rec = norm(x.RECIPES).toLowerCase();

      if (item === q) return 1000;         // exact item match
      if (item.startsWith(q)) return 800;  // item prefix
      if (item.includes(` ${q}`) || item.includes(`-${q}`)) return 700; // boundary-ish
      if (item.includes(q)) return 600;    // item contains

      if (notes.includes(q)) return 200;   // notes match
      if (rec.includes(q)) return 100;     // recipes match

      return 0;
    };

    VIEW.sort((a, b) => {
      const sb = score(b);
      const sa = score(a);
      if (sb !== sa) return sb - sa;
      // stable tie-breaker
      return norm(a.ITEM).localeCompare(norm(b.ITEM));
    });
  } else {
    // No search text -> use normal sort dropdown
    VIEW = sortView(VIEW);
  }

  render();
}

function sortView(arr) {
  const mode = els.sort.value || "name_asc";
  const out = [...arr];

  const cmpText = (a, b) => a.localeCompare(b);
  const cmpNum = (a, b, dir = "desc") => {
    const av = toNumber(a);
    const bv = toNumber(b);

    // push NaN to bottom
    const aBad = !Number.isFinite(av);
    const bBad = !Number.isFinite(bv);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;

    return dir === "asc" ? av - bv : bv - av;
  };

  out.sort((A, B) => {
    switch (mode) {
      case "name_asc":
        return cmpText(A.ITEM, B.ITEM);
      case "name_desc":
        return cmpText(B.ITEM, A.ITEM);

      case "price_desc":
        return cmpNum(A.PRICE, B.PRICE, "desc");
      case "price_asc":
        return cmpNum(A.PRICE, B.PRICE, "asc");

      case "profit_desc":
        return cmpNum(A.PROFIT, B.PROFIT, "desc");
      case "profit_asc":
        return cmpNum(A.PROFIT, B.PROFIT, "asc");

      case "margin_desc":
        return cmpNum(A.MARGIN, B.MARGIN, "desc");
      case "margin_asc":
        return cmpNum(A.MARGIN, B.MARGIN, "asc");

      default:
        return cmpText(A.ITEM, B.ITEM);
    }
  });

  return out;
}

function render() {
  if (els.count) els.count.textContent = `${VIEW.length.toLocaleString()} items shown`;

  if (!VIEW.length) {
    els.list.innerHTML = `<div class="empty">No results</div>`;
    return;
  }

  els.list.innerHTML = VIEW.map(renderCard).join("");

  // highlight exact item match if requested
  if (pendingHighlight) {
    const key = pendingHighlight.toLowerCase();
    pendingHighlight = null;

    const card = els.list.querySelector(`.item[data-key="${CSS.escape(key)}"]`);
    if (card) {
      card.classList.add("flash");
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => card.classList.remove("flash"), 1400);
    }
  }
}

function renderCard(x) {
  const item = x.ITEM || "(unnamed)";
  const key = item.toLowerCase();

  const tag = x.TAG || "-";
  const diy = x.DIY || "-";

  const price = x.PRICE ?? "-";
  const profit = x.PROFIT ?? "-";
  const margin = x.MARGIN ?? "-";
  const raw = x.RAW_VALUE ?? "-";

  const notes = norm(x.NOTES);
  const recipes = norm(x.RECIPES);

  const recipeLinks = recipes
    ? splitCSV(recipes)
        .map((r) => {
          const safe = escapeHtml(r);
          return `<a href="#" class="recipe-link" data-item="${safe}">${safe}</a>`;
        })
        .join(", ")
    : "";

  const notesBlock =
    notes || recipes
      ? `<div class="notes">
          ${notes ? `<div><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ""}
          ${recipes ? `<div><strong>Recipes:</strong> ${recipeLinks}</div>` : ""}
        </div>`
      : "";

  return `
    <article class="item" data-key="${escapeHtml(key)}">
      <h3>${escapeHtml(item)}</h3>

      <div class="meta">
        <span class="pill">Tag: ${escapeHtml(tag)}</span>
        <span class="pill">DIY: ${escapeHtml(diy)}</span>
        <span class="pill">Raw: ${escapeHtml(raw)}</span>
        <span class="pill">Price: ${escapeHtml(price)}</span>
        <span class="pill">Profit: ${escapeHtml(profit)}</span>
        <span class="pill">Margin: ${escapeHtml(margin)}</span>
      </div>

      ${notesBlock}
    </article>
  `;
}

// ---- events ----
function wireEvents() {
  els.search.addEventListener("input", applyFilters);
  els.tag.addEventListener("change", applyFilters);
  els.sort.addEventListener("change", applyFilters);
  els.diyOnly.addEventListener("change", applyFilters);

  // Click recipe -> set search to that recipe name and highlight it
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".recipe-link");
    if (!link) return;

    e.preventDefault();

    const targetItem = norm(link.dataset.item);
    if (!targetItem) return;

    // Set search to exact item name
    els.search.value = targetItem;

    // Clear tag filter so you don't "filter away" the target by accident
    els.tag.value = "";

    pendingHighlight = targetItem;
    applyFilters();
  });
}

// ---- init ----
(function init() {
  wireEvents();
  loadData().catch((err) => {
    console.error(err);
    setStatus(String(err.message || err), true);
    if (els.list) els.list.innerHTML = `<div class="empty">Failed to load data.json</div>`;
  });
})();
