// =========================
// ACNH Item DB — app.js (FULL REPLACEMENT)
//
// Uses your index.html IDs:
//  #search, #tagFilter, #sortBy, #diyOnly, #count, #status, #list
//
// OPTIONAL UI:
//  Add this checkbox anywhere in controls to enable Exclude 100%:
//    <label class="toggle">
//      <input id="exclude100" type="checkbox" />
//      <span>Exclude 100% margin</span>
//    </label>
//
// OPTIONAL UI:
//  Add this checkbox anywhere in controls to enable Flick/CJ prices:
//    <label class="toggle">
//      <input id="flickcj" type="checkbox" />
//      <span>Flick/CJ (1.5× Bugs/Fish)</span>
//    </label>
//
// Loads:
//  ./data.json     (items; PRICE is "worth"/sell price)
//  ./recipes.json  (recipe -> materials list; columns: Name, #1..#6, Material 1..6)
//
// MATH (ADAM'S RULES):
//  - PRICE = what the item sells for (Nook). If Flick/CJ toggle is on, Bugs/Fish sell for 1.5× PRICE.
//  - If item has a recipe (exists in recipes.json by Name):
//      RAW VALUE = Σ (qty(material) * PRICE(material))   // opportunity cost (selling mats instead)
//      PROFIT    = PRICE(item) - RAW VALUE
//      MARGIN    = PROFIT / RAW VALUE
//  - If item has NO recipe:
//      RAW VALUE = 0
//      PROFIT    = PRICE(item)
//      MARGIN    = 100%
// =========================

let ALL = [];      // working set (may be visitor-adjusted)
let ALL_BASE = []; // base computed set (no visitor)
let VIEW = [];
let RECIPES = new Map(); // key: recipe name (lower) -> [{name, qty}]
let pendingHighlight = null;

const els = {
  search: document.querySelector("#search"),
  tag: document.querySelector("#tagFilter"),
  sort: document.querySelector("#sortBy"),
  diyOnly: document.querySelector("#diyOnly"),
  exclude100: document.querySelector("#exclude100"), // optional
  flickcj: document.querySelector("#flickcj"), // optional
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

function isBugOrFishTag(tag) {
  const t = low(tag);
  return t === "bugs" || t === "bug" || t === "fish";
}

function applyVisitorPricing(item, useFlickCJ) {
  if (!useFlickCJ) return item;
  if (!isBugOrFishTag(item.TAG)) return item;
  if (!Number.isFinite(item._sell)) return item;

  const boostedSell = item._sell * 1.5;
  // Bugs/Fish are not crafted: raw value should be 0, profit == sell, margin == 100%.
  // (If you later add a crafted bug/fish somehow, this still behaves sanely.)
  const rawValue = Number.isFinite(item._rawValue) ? item._rawValue : NaN;
  const profit = Number.isFinite(rawValue) ? boostedSell - rawValue : NaN;
  const margin = Number.isFinite(rawValue) ? (rawValue !== 0 ? profit / rawValue : 1) : NaN;

  return {
    ...item,
    _sell: boostedSell,
    _profit: profit,
    _margin: margin,
  };
}

// ---- load JSON ----
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

async function loadData() {
  setStatus("Loading...");

  const [dataRaw, recipesRaw] = await Promise.all([
    loadJSON("./data.json"),
    loadJSON("./recipes.json").catch(() => null),
  ]);

  if (!Array.isArray(dataRaw)) throw new Error("data.json must be an array of objects");

  ALL = dataRaw.map(normalizeItemRow);

  // Build recipe map
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
        mats.push({ name: mat, qty });
      }

      RECIPES.set(low(name), mats);
    }
  }

  // Lookup items by name (for material PRICE)
  const byName = new Map();
  for (const item of ALL) byName.set(low(item.ITEM), item);

  // Compute derived numbers (PRICE-based)
  ALL = ALL.map((item) => computeDerived(item, byName));
  ALL_BASE = ALL;

  buildTagOptions();
  applyFilters();
  setStatus(RECIPES.size ? "" : "recipes.json not found (DIY raw value calc limited)");
}

function normalizeItemRow(row) {
  return {
    ITEM: norm(row["ITEM"]),
    RAW_VALUE: row["RAW VALUE"], // kept for legacy/reference; not used in calc
    PRICE: row["PRICE"],
    TAG: norm(row["TAG"]),
    DIY: norm(row["DIY"]),
    NOTES: row["NOTES"],
    RECIPES: row["Recipies"],

    // derived
    _sell: NaN,
    _rawValue: 0,
    _profit: NaN,
    _margin: NaN,
    _materials: [],
    _unknownMaterials: false,
    _hasRecipe: false,
  };
}

function computeDerived(item, byName) {
  const sell = toNumber(item.PRICE);

  const recipe = RECIPES.get(low(item.ITEM));
  const hasRecipe = Array.isArray(recipe) && recipe.length > 0;

  let rawValue = 0;
  let materialsExpanded = [];
  let unknown = false;

  if (hasRecipe) {
    item._hasRecipe = true;

    let sum = 0;
    materialsExpanded = recipe.map((m) => {
      const matItem = byName.get(low(m.name));
      const unitPrice = matItem ? toNumber(matItem.PRICE) : NaN;
      const known = Number.isFinite(unitPrice);
      if (!known) unknown = true;

      const total = known ? unitPrice * m.qty : NaN;
      if (Number.isFinite(total)) sum += total;

      return {
        name: m.name,
        qty: m.qty,
        unitPrice,
        totalCost: total,
        known,
      };
    });

    rawValue = sum;
  } else {
    rawValue = 0;
  }

  let profit = NaN;
  let margin = NaN;

  if (Number.isFinite(sell)) {
    if (unknown && hasRecipe) {
      // Don't lie with partial math if we don't know all material prices.
      rawValue = NaN;
      profit = NaN;
      margin = NaN;
    } else {
      profit = sell - rawValue;
      margin = rawValue !== 0 ? profit / rawValue : 1;
    }
  }

  return {
    ...item,
    _sell: sell,
    _rawValue: rawValue,
    _profit: profit,
    _margin: margin,
    _materials: materialsExpanded,
    _unknownMaterials: unknown,
    _hasRecipe: hasRecipe,
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
function searchScore(item, q) {
  if (!q) return 0;
  const name = low(item.ITEM);
  const query = low(q);

  if (name === query) return 1000;
  if (name.startsWith(query)) return 900;
  if (name.includes(query)) return 700;
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
  const useFlickCJ = !!(els.flickcj && els.flickcj.checked);

  // Create the working set (base or visitor-adjusted).
  ALL = useFlickCJ ? ALL_BASE.map((x) => applyVisitorPricing(x, true)) : ALL_BASE;

  VIEW = ALL.filter((x) => {
    if (tag && x.TAG !== tag) return false;
    if (diyOnly && x.DIY.toLowerCase() !== "yes") return false;

    if (exclude100) {
      if (Number.isFinite(x._margin) && Math.abs(x._margin - 1) < 1e-9) return false;
    }

    if (!q) return true;

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

  if (q) {
    out.sort((A, B) => {
      const sa = searchScore(A, q);
      const sb = searchScore(B, q);
      if (sa !== sb) return sb - sa;

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

  const sell = x._sell;
  const rawValue = x._rawValue;
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
                          title="${unknown ? "Missing PRICE for this material in data.json" : ""}">
                          ${safeLabel}
                        </a>`;
              })
              .join(" ")}
          </div>
          ${x._unknownMaterials ? `<div class="warn">Some material prices are unknown (missing PRICE).</div>` : ""}
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
        <span class="pill">Price: ${escapeHtml(fmtInt(sell))}</span>
        <span class="pill">Raw Value: ${escapeHtml(fmtInt(rawValue))}</span>
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
  if (els.flickcj) els.flickcj.addEventListener("change", applyFilters);

  document.addEventListener("click", (e) => {
    const recipe = e.target.closest(".recipe-link");
    if (recipe) {
      e.preventDefault();
      const targetItem = norm(recipe.dataset.item);
      if (!targetItem) return;

      els.search.value = targetItem;
      els.tag.value = "";
      pendingHighlight = targetItem;
      applyFilters();
      return;
    }

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
