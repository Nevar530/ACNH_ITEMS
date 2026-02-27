// =========================
// ACNH Item DB — app.js (FULL REPLACEMENT)
// Works with your index.html IDs:
//  #search, #tagFilter, #sortBy, #diyOnly, #count, #status, #list
//
// Uses your data.json headers exactly:
//  ITEM, RAW VALUE, PRICE, PROFIT, Margin, TAG, DIY, NOTES, Recipies
//
// Adds recipes.json support (crafting materials):
//  Name, #1..#6, Material 1..Material 6
//
// Features:
// - Search prioritizes ITEM name matches first (so "carp" bubbles up)
// - Clicking a "recipe" name filters to that item + highlights it
// - Shows structured Materials from recipes.json when available
// - Clicking a material searches that material (and shows craftables that use it)
// =========================

let ALL = [];
let VIEW = [];
let RECIPES = [];
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

// ---- recipes.json helpers ----
function recipeKey(name) {
  return norm(name).toLowerCase();
}

function getRecipeForItem(itemName) {
  const key = recipeKey(itemName);
  return RECIPES.find((r) => recipeKey(r["Name"]) === key) || null;
}

function recipeMaterials(recipeRow) {
  if (!recipeRow) return [];
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const qty = recipeRow[`#${i}`];
    const mat = norm(recipeRow[`Material ${i}`]);

    const q = typeof qty === "number" ? qty : toNumber(qty);
    if (mat && Number.isFinite(q) && q > 0) {
      out.push({ qty: q, mat });
    }
  }
  return out;
}

// Checks whether an item uses a material (for search)
function itemUsesMaterial(itemName, materialQuery) {
  const r = getRecipeForItem(itemName);
  if (!r) return false;
  const mats = recipeMaterials(r);
  const q = materialQuery.toLowerCase();
  return mats.some((m) => m.mat.toLowerCase().includes(q));
}

// ---- data ----
async function loadData() {
  setStatus("Loading...");

  try {
    const [itemsRes, recipesRes] = await Promise.all([
      fetch("./data.json", { cache: "no-store" }),
      fetch("./recipes.json", { cache: "no-store" }), // ok if present
    ]);

    if (!itemsRes.ok) throw new Error(`Failed to load data.json (${itemsRes.status})`);

    const itemsJson = await itemsRes.json();
    if (!Array.isArray(itemsJson)) throw new Error("data.json must be an array of objects");

    ALL = itemsJson.map((row) => normalizeRow(row));

    // recipes.json is optional — if missing, we just skip materials feature
    if (recipesRes && recipesRes.ok) {
      const recipesJson = await recipesRes.json();
      if (Array.isArray(recipesJson)) {
        RECIPES = recipesJson;
      } else {
        RECIPES = [];
        console.warn("recipes.json exists but is not an array; ignoring.");
      }
    } else {
      RECIPES = [];
    }

    buildTagOptions();
    applyFilters();
    setStatus("");
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err), true);
    if (els.list) els.list.innerHTML = `<div class="empty">Failed to load data.</div>`;
  }
}

function normalizeRow(row) {
  return {
    // Keep exact headers (case + spaces) from your sheet/json
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

  const current = els.tag?.value || "";

  els.tag.innerHTML =
    `<option value="">All tags</option>` +
    tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

  if (tags.includes(current)) els.tag.value = current;
}

// ---- filter/sort/render ----
function applyFilters() {
  const q = norm(els.search.value);
  const tag = norm(els.tag.value);
  const diyOnly = !!(els.diyOnly && els.diyOnly.checked);

  const qLower = q.toLowerCase();

  // Build results with a relevance score so ITEM matches float to top
  // Score rules (bigger = higher):
  // - Exact ITEM match: 1000
  // - ITEM startsWith: 800
  // - ITEM includes: 600
  // - Material match (crafting): 450
  // - NOTES includes: 300
  // - Recipies text includes: 250
  // - TAG includes: 200
  const scored = [];

  for (const x of ALL) {
    if (tag && x.TAG !== tag) continue;
    if (diyOnly && x.DIY.toLowerCase() !== "yes") continue;

    if (!q) {
      scored.push({ x, score: 0 });
      continue;
    }

    let score = 0;
    const itemLower = x.ITEM.toLowerCase();

    if (itemLower === qLower) score = Math.max(score, 1000);
    else if (itemLower.startsWith(qLower)) score = Math.max(score, 800);
    else if (itemLower.includes(qLower)) score = Math.max(score, 600);

    // Structured materials search
    if (RECIPES.length && itemUsesMaterial(x.ITEM, qLower)) {
      score = Math.max(score, 450);
    }

    if (includesCI(x.NOTES, q)) score = Math.max(score, 300);
    if (includesCI(x.RECIPES, q)) score = Math.max(score, 250);
    if (includesCI(x.TAG, q)) score = Math.max(score, 200);

    if (score > 0) scored.push({ x, score });
  }

  VIEW = scored.map((s) => s.x);

  // If searching, sort by relevance first, then by selected sort mode
  if (q) {
    const mode = els.sort.value || "name_asc";
    const secondarySorted = sortView([...VIEW], mode);

    // We need relevance ordering primarily; keep stable secondary where possible
    // We'll sort scored by score desc, and for ties use index in secondarySorted
    const secondaryIndex = new Map(secondarySorted.map((it, idx) => [it, idx]));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (secondaryIndex.get(a.x) ?? 0) - (secondaryIndex.get(b.x) ?? 0);
    });

    VIEW = scored.map((s) => s.x);
  } else {
    VIEW = sortView(VIEW, els.sort.value || "name_asc");
  }

  render();
}

function sortView(arr, mode) {
  const out = [...arr];

  const cmpText = (a, b) => a.localeCompare(b);
  const cmpNum = (a, b, dir = "desc") => {
    const av = toNumber(a);
    const bv = toNumber(b);

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
  const recipesText = norm(x.RECIPES);

  // Old "Recipies" column: clickable links (auto search item)
  const recipeLinks = recipesText
    ? splitCSV(recipesText)
        .map((r) => {
          const safe = escapeHtml(r);
          return `<a href="#" class="recipe-link" data-item="${safe}">${safe}</a>`;
        })
        .join(", ")
    : "";

  // Structured recipe from recipes.json (materials list)
  const structuredRecipe = getRecipeForItem(item);
  const mats = recipeMaterials(structuredRecipe);

  const materialsBlock = mats.length
    ? `<div class="materials">
        <strong>Materials:</strong>
        ${mats
          .map(
            (m) =>
              `<a href="#" class="material-link" data-material="${escapeHtml(m.mat)}">${m.qty} × ${escapeHtml(
                m.mat
              )}</a>`
          )
          .join(", ")}
      </div>`
    : "";

  const notesBlock =
    notes || recipesText || mats.length
      ? `<div class="notes">
          ${notes ? `<div><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ""}
          ${recipesText ? `<div><strong>Recipes:</strong> ${recipeLinks}</div>` : ""}
          ${materialsBlock}
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

  // Click recipe (from Recipies column) -> set search to that item + highlight it
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".recipe-link");
    if (!link) return;

    e.preventDefault();

    const targetItem = norm(link.dataset.item);
    if (!targetItem) return;

    els.search.value = targetItem;
    els.tag.value = "";
    pendingHighlight = targetItem;
    applyFilters();
  });

  // Click material -> search by that material
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".material-link");
    if (!link) return;

    e.preventDefault();

    const mat = norm(link.dataset.material);
    if (!mat) return;

    els.search.value = mat;
    // Don't clear tag; user might want "Furniture" etc + material search.
    pendingHighlight = null;
    applyFilters();
  });
}

// ---- init ----
(function init() {
  wireEvents();
  loadData();
})();
