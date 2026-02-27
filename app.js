// =========================
// ACNH Item DB — app.js
// - Works with headers: ITEM, RAW VALUE, PRICE, PROFIT, Margin, TAG, DIY, NOTES, Recipies
// - Click recipe -> auto-filter search to that item + highlight
// =========================

let ALL = [];
let VIEW = [];

const els = {
  q: document.querySelector("#q"),                 // search input
  tag: document.querySelector("#tag"),             // tag select
  sort: document.querySelector("#sort"),           // sort select
  diyOnly: document.querySelector("#diyOnly"),     // checkbox (optional)
  list: document.querySelector("#list"),           // items container
  count: document.querySelector("#count"),         // count label
};

// If your IDs differ, change them above. Fails loudly if missing critical nodes:
if (!els.q || !els.tag || !els.sort || !els.list) {
  console.error("Missing one or more required elements (#q, #tag, #sort, #list). Check your HTML IDs.");
}

// ---------- utils ----------
const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const norm = (s) => String(s ?? "").trim();

const toNumber = (v) => {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  // remove commas and percent signs etc.
  const cleaned = String(v).replaceAll(",", "").replaceAll("%", "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

const includesCI = (hay, needle) =>
  String(hay ?? "").toLowerCase().includes(String(needle ?? "").toLowerCase());

const splitCSV = (s) =>
  norm(s)
    ? String(s)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

// ---------- data loading ----------
async function loadData() {
  const res = await fetch("./data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("data.json is not an array");
  ALL = data.map((row) => normalizeRow(row));
  buildTagOptions();
  applyFilters();
}

function normalizeRow(row) {
  // Keep original fields but normalize access via getters below
  return {
    raw: row,
    ITEM: norm(row["ITEM"]),
    RAW_VALUE: row["RAW VALUE"],
    PRICE: row["PRICE"],
    PROFIT: row["PROFIT"],
    MARGIN: row["Margin"],
    TAG: norm(row["TAG"]),
    DIY: norm(row["DIY"]),
    NOTES: row["NOTES"],
    RECIPES: row["Recipies"], // note spelling per your dataset
  };
}

// ---------- UI setup ----------
function buildTagOptions() {
  const tags = Array.from(new Set(ALL.map((x) => x.TAG).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

  // preserve current selection if any
  const current = els.tag.value;

  els.tag.innerHTML = `
    <option value="">All tags</option>
    ${tags.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
  `;

  // restore if possible
  if (tags.includes(current)) els.tag.value = current;
}

function applyFilters() {
  const q = norm(els.q.value);
  const tag = norm(els.tag.value);
  const diyOnly = !!(els.diyOnly && els.diyOnly.checked);

  VIEW = ALL.filter((x) => {
    if (tag && x.TAG !== tag) return false;
    if (diyOnly && String(x.DIY).toLowerCase() !== "yes") return false;

    if (!q) return true;

    // search in item name + notes + recipes
    return (
      includesCI(x.ITEM, q) ||
      includesCI(x.NOTES, q) ||
      includesCI(x.RECIPES, q) ||
      includesCI(x.TAG, q)
    );
  });

  VIEW = sortView(VIEW);
  render();
}

function sortView(arr) {
  const mode = els.sort.value || "name-az";

  const copy = [...arr];

  if (mode === "name-az") {
    copy.sort((a, b) => a.ITEM.localeCompare(b.ITEM));
  } else if (mode === "name-za") {
    copy.sort((a, b) => b.ITEM.localeCompare(a.ITEM));
  } else if (mode === "price-desc") {
    copy.sort((a, b) => (toNumber(b.PRICE) || -Infinity) - (toNumber(a.PRICE) || -Infinity));
  } else if (mode === "price-asc") {
    copy.sort((a, b) => (toNumber(a.PRICE) || Infinity) - (toNumber(b.PRICE) || Infinity));
  } else {
    // default
    copy.sort((a, b) => a.ITEM.localeCompare(b.ITEM));
  }

  return copy;
}

// ---------- rendering ----------
let pendingHighlightName = null;

function render() {
  if (els.count) els.count.textContent = `${VIEW.length.toLocaleString()} items shown`;

  const html = VIEW.map((x) => {
    const itemName = escapeHtml(x.ITEM || "(unnamed)");
    const tag = escapeHtml(x.TAG || "-");
    const diy = escapeHtml(x.DIY || "-");

    const price = escapeHtml(x.PRICE ?? "-");
    const profit = escapeHtml(x.PROFIT ?? "-");
    const margin = escapeHtml(x.MARGIN ?? "-");

    const notes = norm(x.NOTES);
    const recipes = norm(x.RECIPES);

    const recipeLinks = recipes
      ? splitCSV(recipes)
          .map((r) => {
            const safe = escapeHtml(r);
            // data-item should be the raw name we want to search for
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

    // store normalized item name for highlighting
    const dataName = escapeHtml((x.ITEM || "").toLowerCase());

    return `
      <article class="item" data-name="${dataName}">
        <h3>${itemName}</h3>

        <div class="meta">
          <span class="pill">Tag: ${tag}</span>
          <span class="pill">DIY: ${diy}</span>
          <span class="pill">Price: ${price}</span>
          <span class="pill">Profit: ${profit}</span>
          <span class="pill">Margin: ${margin}</span>
        </div>

        ${notesBlock}
      </article>
    `;
  }).join("");

  els.list.innerHTML = html || `<div class="empty">No results</div>`;

  // if we filtered to something specific, highlight first exact match card
  if (pendingHighlightName) {
    const target = pendingHighlightName.toLowerCase();
    pendingHighlightName = null;

    const card = els.list.querySelector(`.item[data-name="${CSS.escape(target)}"]`);
    if (card) {
      card.classList.add("flash");
      // remove after a moment so it can flash again later
      setTimeout(() => card.classList.remove("flash"), 1400);
      // bring it into view (optional but nice)
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// ---------- events ----------
function wireEvents() {
  els.q.addEventListener("input", applyFilters);
  els.tag.addEventListener("change", applyFilters);
  els.sort.addEventListener("change", applyFilters);

  if (els.diyOnly) els.diyOnly.addEventListener("change", applyFilters);

  // Click recipe -> auto-filter search to that exact item
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".recipe-link");
    if (!link) return;

    e.preventDefault();

    const item = norm(link.dataset.item);
    if (!item) return;

    // Put exact item name into search
    els.q.value = item;

    // OPTIONAL: reset tag filter so it doesn't block the target
    els.tag.value = "";

    // OPTIONAL: ensure sorting A-Z
    // els.sort.value = "name-az";

    pendingHighlightName = item; // for flash after render
    applyFilters();
  });
}

// ---------- init ----------
wireEvents();
loadData().catch((err) => {
  console.error(err);
  els.list.innerHTML = `<div class="empty">Failed to load data.json</div>`;
});
