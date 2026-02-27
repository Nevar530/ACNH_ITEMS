let DATA = []; 

const elQ = document.getElementById("q");
const elTag = document.getElementById("tag");
const elDIY = document.getElementById("diy");
const elSort = document.getElementById("sort");
const elList = document.getElementById("list");
const elStats = document.getElementById("stats");

function money(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString();
}

function normalize(s) {
  return (s ?? "").toString().toLowerCase();
}

function buildTagOptions(rows) {
  const tags = Array.from(new Set(rows.map(r => r.tag).filter(Boolean))).sort();
  for (const t of tags) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    elTag.appendChild(opt);
  }
}

function applyFilters() {
  const q = normalize(elQ.value);
  const tag = elTag.value;
  const diyOnly = elDIY.checked;
  const sort = elSort.value;

  let rows = DATA.filter(r => {
    if (tag && r.tag !== tag) return false;
    if (diyOnly && !r.diy) return false;

    if (!q) return true;
    const hay = [
      r.item, r.tag, r.notes, r.recipes
    ].map(normalize).join(" ");
    return hay.includes(q);
  });

  // sort
  rows.sort((a, b) => {
    if (sort === "item_asc") return (a.item ?? "").localeCompare(b.item ?? "");
    if (sort === "price_desc") return (b.price ?? -1) - (a.price ?? -1);
    if (sort === "price_asc") return (a.price ?? 1e18) - (b.price ?? 1e18);
    if (sort === "profit_desc") return (b.profit ?? -1) - (a.profit ?? -1);
    return 0;
  });

  render(rows);
}

function render(rows) {
  elStats.textContent = `${rows.length.toLocaleString()} items shown`;
  elList.innerHTML = "";

  for (const r of rows) {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("h3");
    title.textContent = r.item ?? "(unnamed)";
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span class="pill">Tag: ${r.tag ?? "-"}</span>
      <span class="pill">DIY: ${r.diy ? "Yes" : "No"}</span>
      <span class="pill">Price: ${money(r.price)}</span>
      <span class="pill">Profit: ${money(r.profit)}</span>
      <span class="pill">Margin: ${r.margin != null ? Math.round(r.margin * 100) + "%" : "-"}</span>
    `;
    card.appendChild(meta);

    if (r.notes) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = `Notes: ${r.notes}`;
      card.appendChild(note);
    }

    if (r.recipes) {
      const recipe = document.createElement("div");
      recipe.className = "recipe";
      recipe.textContent = `Recipes: ${r.recipes}`;
      card.appendChild(recipe);
    }

    elList.appendChild(card);
  }
}

async function init() {
  const res = await fetch("data.json");
  DATA = await res.json();

  buildTagOptions(DATA);

  [elQ, elTag, elDIY, elSort].forEach(el =>
    el.addEventListener("input", applyFilters)
  );
  elTag.addEventListener("change", applyFilters);
  elSort.addEventListener("change", applyFilters);

  applyFilters();

  // PWA service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
