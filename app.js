// =========================
// ACNH Item DB — app.js (FULL REPLACEMENT)
//
// Uses your index.html IDs:
//  #search, #tagFilter, #sortBy, #diyOnly, #count, #status, #list
//
// OPTIONAL UI (recommended):
//  Add this checkbox anywhere in controls to enable Exclude 100%:
//    <label class="toggle">
//      <input id="exclude100" type="checkbox" />
//      <span>Exclude 100% margin</span>
//    </label>
//
// Loads:
//  ./data.json     (items + materials, has RAW VALUE / PRICE / Recipies)
//  ./recipes.json  (recipe -> materials list; columns: Name, #1..#6, Material 1..6)
//
// Math:
//  - Base (non-recipe) cost = RAW VALUE (number or 0 if "-" / blank)
//  - Sell price = PRICE
//  - Profit = Sell - Cost
//  - Margin = Profit / Sell   (matches your 100% behavior when cost=0)
//  - For recipe items: Cost is sum(qty * RAW VALUE(material)) using data.json lookup
// =========================

let ALL = [];
let VIEW = [];
let RECIPES = new Map(); // key: recipe name (lower) -> [{name, qty}]
let pendingHighlight = null;

const els = {
  search: document.querySelector("#search"),
  tag: document.querySelector("#tagFilter"),
  sort: document.querySelector("#sortBy"),
  diyOnly: document.querySelector("#diyOnly"),
  exclude100: document.querySelector("#exclude100"), // optional
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
const low = (s) => norm(s).toLowerCase();

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

  const cleaned = s
    .replaceAll(",", "")
    .replaceAll("%", "")
    .replaceAll("(", "-")
    .replaceAll(")", "")
    .trim();

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function fmtInt(n) {
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString();
}

function fmtPct(x) {
  if (!Number.isFinite(x)) return "-";
  return `${Math.round(x * 100)}%`;
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

// ---- load JSON ----
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

async function loadData() {
  setStatus("Loading...");

  // Load both files (recipes is optional but expected now)
  const [dataRaw, recipesRaw] = await Promise.all([
    loadJSON("./data.json"),
    loadJSON("./recipes.json").catch(() => null), // don’t hard-fail if missing
  ]);

  if (!Array.isArray(dataRaw)) throw new Error("data.json must be an array of objects");

  ALL = dataRaw.map(normalizeItemRow);

  // Build recipe map if recipes.json exists
  RECIPES = new Map();
  if (Array.isArray(recipesRaw)) {
    for (const r of recipesRaw) {
      const name = norm(r["Name"]);
      if (!name) continue;

      const mats = [];
      for (let i = 1; i <= 6; i++) {
        const qty = toNumber(r[`#${i}`]);
        const mat = norm(r[`Material ${i}`]);
        if (!mat) continue;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        mats.push({ name: mat, qty: qty });
      }

      RECIPES.set(low(name), mats);
    }
  }

  // Build item lookup for cost calculations
  const byName = new Map();
  for (const item of ALL) byName.set(low(item.ITEM), item);

  // Compute derived numbers + recipe materials
  ALL = ALL.map((item) => computeDerived(item, byName));

  buildTagOptions();
  applyFilters();
  setStatus(RECIPES.size ? "" : "recipes.json not found (DIY cost calc limited)");
}

function normalizeItemRow(row) {
  return {
    // keep exact headers
    ITEM: norm(row["ITEM"]),
    RAW_VALUE: row["RAW VALUE"],
    PRICE: row["PRICE"],
    TAG: norm(row["TAG"]),
    DIY: norm(row["DIY"]),
    NOTES: row["NOTES"],
    RECIPES: row["Recipies"],

    // derived fields (filled later)
    _sell: NaN,
    _cost: NaN,
    _profit: NaN,
    _margin: NaN,
    _materials: [], // [{name, qty, unitCost, totalCost, known}]
    _unknownMaterials: false,
    _hasRecipe: false,
  };
}

function computeDerived(item, byName) {
  const sell = toNumber(item.PRICE);
  const baseCost = toNumber(item.RAW_VALUE);
  const hasRecipeRow = RECIPES.has(low(item.ITEM));
  const mats = hasRecipeRow ? RECIPES.get(low(item.ITEM)) : [];

  let cost = Number.isFinite(baseCost) ? baseCost : 0;
  let materialsExpanded = [];
  let unknown = false;

  if (mats.length) {
    item._hasRecipe = true;

    let sum = 0;
    materialsExpanded = mats.map((m) => {
      const matItem = byName.get(low(m.name));
      const unit = matItem ? toNumber(matItem.RAW_VALUE) : NaN;
      const known = Number.isFinite(unit);
      if (!known) unknown = true;

      const total = known ? unit * m.qty : NaN;
      if (Number.isFinite(total)) sum += total;

      return {
        name: m.name,
        qty: m.qty,
        unitCost: unit,
        totalCost: total,
        known,
      };
    });

    // If some materials are unknown, we still show partial cost.
    // If you want unknown -> treat as 0, this already does that by only summing known totals.
    cost = sum;
  }

  const profit = Number.isFinite(sell) ? sell - (Number.isFinite(cost) ? cost : 0) : NaN;
  const margin =
    Number.isFinite(sell) && sell !== 0 && Number.isFinite(profit) ? profit / sell : NaN;

  return {
    ...item,
    _sell: sell,
    _cost: cost,
    _profit: profit,
    _margin: margin,
    _materials: materialsExpanded,
    _unknownMaterials: unknown,
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

// ---- search ranking ----
// When there is a search query, we bump name matches to the top.
// This fixes the “carp is way down the list” issue.
function searchScore(item, q) {
  if (!q) return 0;
  const name = low(item.ITEM);
  const query = low(q);

  if (name === query) return 1000; // exact
  if (name.startsWith(query)) return 900; // prefix
  if (name.includes(query)) return 700; // name contains
  if (includesCI(item.NOTES, q)) return 200;
  if (includesCI(item.RECIPES, q)) return 150;
  if (includesCI(item.TAG, q)) return 100;
  return 0;
}

// ---- filter/sort/render ----
function applyFilters() {
  const q = norm(els.search.value);
  const tag = norm(els.tag.value);
  const diyOnly = !!(els.diyOnly && els.diyOnly.checked);
  const exclude100 = !!(els.exclude100 && els.exclude100.checked);

  VIEW = ALL.filter((x) => {
    if (tag && x.TAG !== tag) return false;
    if (diyOnly && x.DIY.toLowerCase() !== "yes") return false;

    if (exclude100) {
      // Exclude margins that are effectively 100% (profit ~= sell)
      // Use a small epsilon to avoid float weirdness.
      if (Number.isFinite(x._margin) && Math.abs(x._margin - 1) < 1e-9) return false;
    }

    if (!q) return true;

    // Still allow broad search, BUT ranking will put name matches on top.
    return (
      includesCI(x.ITEM, q) ||
      includesCI(x.NOTES, q) ||
      includesCI(x.RECIPES, q) ||
      includesCI(x.TAG, q)
    );
  });

  VIEW = sortView(VIEW, q);
  render(q);
}

function sortView(arr, q) {
  const mode = els.sort.value || "name_asc";
  const out = [...arr];

  const cmpText = (a, b) => a.localeCompare(b);
  const cmpNum = (a, b, dir = "desc") => {
    const av = Number.isFinite(a) ? a : NaN;
    const bv = Number.isFinite(b) ? b : NaN;

    const aBad = !Number.isFinite(av);
    const bBad = !Number.isFinite(bv);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;

    return dir === "asc" ? av - bv : bv - av;
  };

  // If searching, rank by name match first, then apply chosen sort inside that
  if (q) {
    out.sort((A, B) => {
      const sa = searchScore(A, q);
      const sb = searchScore(B, q);
      if (sa !== sb) return sb - sa;

      // tie-breaker: apply selected mode
      switch (mode) {
        case "name_asc":
          return cmpText(A.ITEM, B.ITEM);
        case "name_desc":
          return cmpText(B.ITEM, A.ITEM);

        case "price_desc":
          return cmpNum(A._sell, B._sell, "desc");
        case "price_asc":
          return cmpNum(A._sell, B._sell, "asc");

        case "profit_desc":
          return cmpNum(A._profit, B._profit, "desc");
        case "profit_asc":
          return cmpNum(A._profit, B._profit, "asc");

        case "margin_desc":
          return cmpNum(A._margin, B._margin, "desc");
        case "margin_asc":
          return cmpNum(A._margin, B._margin, "asc");

        default:
          return cmpText(A.ITEM, B.ITEM);
      }
    });

    return out;
  }

  // Normal sorting when no search query
  out.sort((A, B) => {
    switch (mode) {
      case "name_asc":
        return cmpText(A.ITEM, B.ITEM);
      case "name_desc":
        return cmpText(B.ITEM, A.ITEM);

      case "price_desc":
        return cmpNum(A._sell, B._sell, "desc");
      case "price_asc":
        return cmpNum(A._sell, B._sell, "asc");

      case "profit_desc":
        return cmpNum(A._profit, B._profit, "desc");
      case "profit_asc":
        return cmpNum(A._profit, B._profit, "asc");

      case "margin_desc":
        return cmpNum(A._margin, B._margin, "desc");
      case "margin_asc":
        return cmpNum(A._margin, B._margin, "asc");

      default:
        return cmpText(A.ITEM, B.ITEM);
    }
  });

  return out;
}

function render(q) {
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

  // If they typed something and there's an exact name hit, auto-scroll it into view once
  if (q) {
    const exact = VIEW.find((x) => low(x.ITEM) === low(q));
    if (exact) {
      const card = els.list.querySelector(`.item[data-key="${CSS.escape(low(exact.ITEM))}"]`);
      if (card) {
        card.classList.add("flash");
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => card.classList.remove("flash"), 1400);
      }
    }
  }
}

function renderCard(x) {
  const item = x.ITEM || "(unnamed)";
  const key = low(item);

  const tag = x.TAG || "-";
  const diy = x.DIY || "-";
  const notes = norm(x.NOTES);
  const recipesList = norm(x.RECIPES);

  // Derived numbers
  const sell = x._sell;
  const cost = x._cost;
  const profit = x._profit;
  const margin = x._margin;

  const recipeLinks = recipesList
    ? splitCSV(recipesList)
        .map((r) => {
          const safe = escapeHtml(r);
          return `<a href="#" class="recipe-link" data-item="${safe}">${safe}</a>`;
        })
        .join(", ")
    : "";

  const materialsBlock =
    x._materials && x._materials.length
      ? `<div class="materials">
          <strong>Materials:</strong>
          <div class="materials-list">
            ${x._materials
              .map((m) => {
                const label = `${m.qty}× ${m.name}`;
                const safeLabel = escapeHtml(label);
                const safeName = escapeHtml(m.name);
                const unknown = !m.known;
                return `<a href="#"
                          class="material-link ${unknown ? "unknown" : ""}"
                          data-item="${safeName}"
                          title="${unknown ? "Missing RAW VALUE for this material" : ""}">
                          ${safeLabel}
                        </a>`;
              })
              .join(" ")}
          </div>
          ${x._unknownMaterials ? `<div class="warn">Some material costs are unknown (missing RAW VALUE).</div>` : ""}
        </div>`
      : "";

  const notesBlock =
    notes || recipesList || materialsBlock
      ? `<div class="notes">
          ${notes ? `<div><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ""}
          ${recipesList ? `<div><strong>Recipes:</strong> ${recipeLinks}</div>` : ""}
          ${materialsBlock}
        </div>`
      : "";

  return `
    <article class="item" data-key="${escapeHtml(key)}">
      <h3>${escapeHtml(item)}</h3>

      <div class="meta">
        <span class="pill">Tag: ${escapeHtml(tag)}</span>
        <span class="pill">DIY: ${escapeHtml(diy)}</span>
        <span class="pill">Sell: ${escapeHtml(fmtInt(sell))}</span>
        <span class="pill">Cost: ${escapeHtml(fmtInt(cost))}</span>
        <span class="pill">Profit: ${escapeHtml(fmtInt(profit))}</span>
        <span class="pill">Margin: ${escapeHtml(fmtPct(margin))}</span>
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

  if (els.exclude100) els.exclude100.addEventListener("change", applyFilters);

  // Click recipe -> set search to that recipe name and highlight it
  document.addEventListener("click", (e) => {
    const recipe = e.target.closest(".recipe-link");
    if (recipe) {
      e.preventDefault();
      const targetItem = norm(recipe.dataset.item);
      if (!targetItem) return;

      els.search.value = targetItem;
      els.tag.value = ""; // avoid filtering it away
      pendingHighlight = targetItem;
      applyFilters();
      return;
    }

    // Click material -> search to that material item (so you can jump to the ingredient)
    const mat = e.target.closest(".material-link");
    if (mat) {
      e.preventDefault();
      const targetItem = norm(mat.dataset.item);
      if (!targetItem) return;

      els.search.value = targetItem;
      els.tag.value = "";
      pendingHighlight = targetItem;
      applyFilters();
      return;
    }
  });
}

// ---- init ----
(function init() {
  wireEvents();
  loadData().catch((err) => {
    console.error(err);
    setStatus(String(err.message || err), true);
    if (els.list) els.list.innerHTML = `<div class="empty">Failed to load JSON</div>`;
  });
})();
