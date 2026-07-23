/* =========================================================
   Ledger — application logic
   Vanilla JS, no build step, no external dependencies, so
   the whole app keeps working offline forever from a single
   static folder. IndexedDB (via db.js) is the source of
   truth; `state` below is just an in-memory mirror of it
   that gets refreshed after every write, then re-rendered.
   ========================================================= */

const CATEGORY_PALETTE = [
  "#C4472B", "#3B6FA0", "#3E8E7E", "#B8862B", "#5B4B8A",
  "#A24E86", "#4C7A3B", "#8A5A2B", "#2B7A9B", "#7A6A2B",
  "#6B4C9A", "#2B9B6E"
];

const DEFAULT_EXPENSE_CATEGORIES = [
  "Food & Dining", "Transportation", "Office Supplies", "Utilities",
  "Rent", "Marketing", "Travel", "Software & Subscriptions", "Insurance", "Other"
];
const DEFAULT_INCOME_CATEGORIES = [
  "Sales", "Services", "Freelance", "Consulting", "Investments", "Refunds", "Other"
];

window.state = {
  expenses: [],
  income: [],
  mileage: [],
  categories: [],
  settings: { currency: "$", mileageRate: 0, seeded: false },
  activeTab: "dashboard",
  dashboardPeriod: "month",
  reportsPeriod: "month",
  history: { type: "all", query: "", from: "", to: "" },
  editing: null // { kind: 'expense'|'income'|'mileage'|'category', id: string|null }
};

/* ---------------- date helpers (string-based, no TZ bugs) ---------------- */
function isoToDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function dateToISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function todayISO() { return dateToISO(new Date()); }
function addDays(iso, n) { const d = isoToDate(iso); d.setDate(d.getDate() + n); return dateToISO(d); }
function lastDayOfMonthISO(iso) { const [y, m] = iso.split("-").map(Number); return dateToISO(new Date(y, m, 0)); }
function formatDateLong(iso) { return isoToDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatDateShort(iso) { return isoToDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }

function computeRange(period) {
  const t = todayISO();
  if (period === "today") return { start: t, end: t, label: "Today" };
  if (period === "week") return { start: addDays(t, -6), end: t, label: "Last 7 Days" };
  if (period === "month") return { start: t.slice(0, 8) + "01", end: lastDayOfMonthISO(t), label: isoToDate(t).toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  if (period === "year") return { start: t.slice(0, 4) + "-01-01", end: t.slice(0, 4) + "-12-31", label: t.slice(0, 4) };
  return { start: null, end: null, label: "All Time" };
}
function inRange(date, start, end) {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

/* ---------------- small utilities ---------------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function formatMoney(n) {
  const sym = state.settings.currency || "$";
  const sign = n < 0 ? "-" : "";
  return `${sign}${sym}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function toNumber(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; }
function uidLocal() { return typeof uid === "function" ? uid() : `${Date.now()}-${Math.random()}`; }
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

let toastTimer = null;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  await openDB();
  await loadState();
  await seedIfNeeded();
  wireGlobalEvents();
  render();
  registerServiceWorker();
}

async function loadState() {
  const [expenses, income, mileage, categories, settingsArr] = await Promise.all([
    DB.getAll("expenses"), DB.getAll("income"), DB.getAll("mileage"), DB.getAll("categories"), DB.getAll("settings")
  ]);
  state.expenses = expenses;
  state.income = income;
  state.mileage = mileage;
  state.categories = categories;
  settingsArr.forEach((s) => { state.settings[s.key] = s.value; });
}

async function seedIfNeeded() {
  if (state.settings.seeded) return;
  const cats = [];
  DEFAULT_EXPENSE_CATEGORIES.forEach((name, i) => cats.push({ id: uidLocal(), name, type: "expense", color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }));
  DEFAULT_INCOME_CATEGORIES.forEach((name, i) => cats.push({ id: uidLocal(), name, type: "income", color: CATEGORY_PALETTE[(i + 4) % CATEGORY_PALETTE.length] }));
  await DB.bulkPut("categories", cats);
  await DB.put("settings", { key: "seeded", value: true });
  await DB.put("settings", { key: "currency", value: "$" });
  await DB.put("settings", { key: "mileageRate", value: 0 });
  await loadState();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => { /* offline install still works from cache on next load */ });
    });
  }
}

/* ---------------- global event delegation ---------------- */
function wireGlobalEvents() {
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) { e.preventDefault(); switchTab(tab.dataset.tab); return; }

    const action = e.target.closest("[data-action]");
    if (action) { e.preventDefault(); handleAction(action.dataset.action, action); return; }

    if (e.target.classList.contains("sheet-backdrop")) { closeSheet(); }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "historySearch") { state.history.query = e.target.value; renderHistoryList(); }
    if (e.target.id === "historyFrom") { state.history.from = e.target.value; renderHistoryList(); }
    if (e.target.id === "historyTo") { state.history.to = e.target.value; renderHistoryList(); }
    if (e.target.id === "f_miles") { updateMileagePreview(); }
  });

  $("#importFile").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) importJSONFile(e.target.files[0]);
    e.target.value = "";
  });
}

function handleAction(action, el) {
  const map = {
    "open-add-sheet": openActionSheet,
    "close-sheet": closeSheet,
    "add-expense": () => openEntryForm("expense"),
    "add-income": () => openEntryForm("income"),
    "add-mileage": () => openEntryForm("mileage"),
    "save-entry": saveEntryFromForm,
    "delete-entry": () => deleteEntry(state.editing.kind, state.editing.id),
    "edit-entry": () => openEntryForm(el.dataset.kind, el.dataset.id),
    "set-dash-period": () => { state.dashboardPeriod = el.dataset.period; renderDashboard(); },
    "set-report-period": () => { state.reportsPeriod = el.dataset.period; renderReports(); },
    "set-history-type": () => { state.history.type = el.dataset.type; renderHistoryList(); highlightHistoryChips(); },
    "toggle-history-filters": () => $("#historyFilters").classList.toggle("hidden"),
    "open-categories": () => openCategoryManager(),
    "add-category": () => openCategoryForm(el.dataset.type),
    "save-category": saveCategoryFromForm,
    "delete-category": () => deleteCategory(el.dataset.id),
    "edit-category": () => openCategoryForm(el.dataset.type, el.dataset.id),
    "open-rate": openMileageRateSheet,
    "save-rate": saveMileageRate,
    "open-currency": openCurrencySheet,
    "set-currency": () => { setCurrency(el.dataset.sym); },
    "export-json": exportJSON,
    "export-csv": exportCSV,
    "trigger-import": () => $("#importFile").click(),
    "clear-all": clearAllData
  };
  if (map[action]) map[action]();
}

/* ---------------- tab / render dispatch ---------------- */
function switchTab(tab) {
  if (tab === "add") { openActionSheet(); return; }
  state.activeTab = tab;
  render();
  window.scrollTo(0, 0);
}

function render() {
  $all(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.activeTab));
  const main = $("#main");
  if (state.activeTab === "dashboard") main.innerHTML = dashboardHTML();
  else if (state.activeTab === "history") main.innerHTML = historyHTML();
  else if (state.activeTab === "reports") main.innerHTML = reportsHTML();
  else if (state.activeTab === "settings") main.innerHTML = settingsHTML();

  if (state.activeTab === "dashboard") renderDashboard();
  if (state.activeTab === "history") renderHistoryList();
  if (state.activeTab === "reports") renderReports();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function dashboardHTML() {
  return `
    <div class="topbar">
      <h1>Ledger</h1>
      <div class="sub" id="dashSub"></div>
    </div>
    <div class="view">
      <div class="period-tabs" id="dashPeriodTabs">
        ${["today", "week", "month", "year", "all"].map(p => `<button data-action="set-dash-period" data-period="${p}" class="${state.dashboardPeriod === p ? "active" : ""}">${periodLabel(p)}</button>`).join("")}
      </div>
      <div id="dashHero"></div>
      <div id="dashStats"></div>
      <div class="quick-add">
        <button data-action="add-income"><span class="qi income">↑</span>Income</button>
        <button data-action="add-expense"><span class="qi expense">↓</span>Expense</button>
        <button data-action="add-mileage"><span class="qi mileage">→</span>Mileage</button>
      </div>
      <div class="section-head"><h2>Recent Activity</h2><a href="#" data-tab="history">See all</a></div>
      <div id="dashRecent"></div>
    </div>`;
}

function periodLabel(p) {
  return { today: "Day", week: "Week", month: "Month", year: "Year", all: "All" }[p];
}

function renderDashboard() {
  const { start, end, label } = computeRange(state.dashboardPeriod);
  $("#dashSub").textContent = label;
  const stats = statsForRange(start, end);
  const profitClass = stats.profit < 0 ? "neg" : "";

  $("#dashHero").innerHTML = `
    <div class="hero">
      <div class="eyebrow">Net Profit</div>
      <div class="profit tabular ${profitClass}">${formatMoney(stats.profit)}</div>
      <div class="period">${label}</div>
      <hr class="tear" />
      <div class="split">
        <div class="col">
          <div class="label"><span class="dot" style="background:var(--income)"></span>Income</div>
          <div class="amt tabular">${formatMoney(stats.income)}</div>
        </div>
        <div class="col">
          <div class="label"><span class="dot" style="background:var(--expense)"></span>Expenses</div>
          <div class="amt tabular">${formatMoney(stats.expense)}</div>
        </div>
      </div>
    </div>`;

  $("#dashStats").innerHTML = `
    <div class="stat-grid">
      <div class="stat">
        <div class="label">Mileage</div>
        <div class="value mileage tabular">${stats.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi</div>
      </div>
      <div class="stat">
        <div class="label">Mileage Deduction${state.settings.mileageRate ? "" : " (set rate)"}</div>
        <div class="value tabular">${formatMoney(stats.deduction)}</div>
      </div>
    </div>`;

  const recent = combinedEntries().slice(0, 6);
  $("#dashRecent").innerHTML = recent.length
    ? `<div class="row-list">${recent.map(entryRowHTML).join("")}</div>`
    : emptyState("📋", "No activity yet", "Tap + below to add your first entry.");
}

/* ============================================================
   DATA HELPERS
   ============================================================ */
function combinedEntries() {
  const exp = state.expenses.map((e) => ({ ...e, kind: "expense" }));
  const inc = state.income.map((e) => ({ ...e, kind: "income" }));
  const mil = state.mileage.map((e) => ({ ...e, kind: "mileage" }));
  return [...exp, ...inc, ...mil].sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)));
}

function statsForRange(start, end) {
  const income = state.income.filter((e) => inRange(e.date, start, end)).reduce((s, e) => s + e.amount, 0);
  const expense = state.expenses.filter((e) => inRange(e.date, start, end)).reduce((s, e) => s + e.amount, 0);
  const miles = state.mileage.filter((e) => inRange(e.date, start, end)).reduce((s, e) => s + e.miles, 0);
  const rate = toNumber(state.settings.mileageRate) || 0;
  return { income, expense, profit: income - expense, miles, deduction: miles * rate };
}

function categoryName(id, type) {
  const c = state.categories.find((c) => c.id === id);
  return c ? c.name : "Uncategorized";
}
function categoryColor(id) {
  const c = state.categories.find((c) => c.id === id);
  return c ? c.color : "#8A93A3";
}

function entryRowHTML(e) {
  if (e.kind === "expense") {
    return `<button class="entry-row expense" data-action="edit-entry" data-kind="expense" data-id="${e.id}">
      <div class="entry-icon">↓</div>
      <div class="entry-main">
        <div class="entry-title">${esc(e.description)}</div>
        <div class="entry-meta">${esc(categoryName(e.categoryId))} · ${formatDateShort(e.date)}</div>
      </div>
      <div class="entry-amt tabular">-${formatMoney(e.amount)}</div>
    </button>`;
  }
  if (e.kind === "income") {
    return `<button class="entry-row income" data-action="edit-entry" data-kind="income" data-id="${e.id}">
      <div class="entry-icon">↑</div>
      <div class="entry-main">
        <div class="entry-title">${esc(e.description)}</div>
        <div class="entry-meta">${esc(categoryName(e.categoryId))} · ${formatDateShort(e.date)}</div>
      </div>
      <div class="entry-amt tabular">+${formatMoney(e.amount)}</div>
    </button>`;
  }
  return `<button class="entry-row mileage" data-action="edit-entry" data-kind="mileage" data-id="${e.id}">
    <div class="entry-icon">→</div>
    <div class="entry-main">
      <div class="entry-title">${esc(e.purpose)}</div>
      <div class="entry-meta">${esc(e.start)} → ${esc(e.destination)} · ${formatDateShort(e.date)}</div>
    </div>
    <div class="entry-amt tabular">${e.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi</div>
  </button>`;
}

function emptyState(glyph, title, hint) {
  return `<div class="empty-state"><div class="glyph">${glyph}</div><div class="title">${esc(title)}</div><div class="hint">${esc(hint)}</div></div>`;
}

/* ============================================================
   HISTORY
   ============================================================ */
function historyHTML() {
  return `
    <div class="topbar">
      <h1>History</h1>
      <div class="sub">Every entry, all in one place</div>
    </div>
    <div class="view">
      <div class="search-wrap">
        <span class="ic">🔍</span>
        <input id="historySearch" type="text" placeholder="Search description, category, location…" value="${esc(state.history.query)}" />
      </div>
      <div class="filter-row">
        ${["all", "income", "expense", "mileage"].map(t => `<button class="chip ${state.history.type === t ? "active" : ""}" data-action="set-history-type" data-type="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
        <button class="chip" data-action="toggle-history-filters">📅 Dates</button>
      </div>
      <div id="historyFilters" class="field-row hidden" style="margin-bottom:12px;">
        <div class="field mt-0"><label>From</label><input id="historyFrom" type="date" value="${esc(state.history.from)}" /></div>
        <div class="field mt-0"><label>To</label><input id="historyTo" type="date" value="${esc(state.history.to)}" /></div>
      </div>
      <div id="historyResults"></div>
    </div>`;
}

function highlightHistoryChips() {
  $all(".filter-row .chip[data-type]").forEach((c) => c.classList.toggle("active", c.dataset.type === state.history.type));
}

function renderHistoryList() {
  const { type, query, from, to } = state.history;
  let items = combinedEntries();
  if (type !== "all") items = items.filter((e) => e.kind === type);
  if (from) items = items.filter((e) => e.date >= from);
  if (to) items = items.filter((e) => e.date <= to);
  if (query.trim()) {
    const q = query.trim().toLowerCase();
    items = items.filter((e) => {
      const hay = e.kind === "mileage"
        ? [e.purpose, e.start, e.destination, e.notes].join(" ")
        : [e.description, e.notes, categoryName(e.categoryId)].join(" ");
      return hay.toLowerCase().includes(q);
    });
  }
  const box = $("#historyResults");
  if (!box) return;
  box.innerHTML = items.length
    ? `<div class="row-list">${items.map(entryRowHTML).join("")}</div>`
    : emptyState("🔍", "No matching entries", "Try a different search or filter.");
}

/* ============================================================
   ENTRY FORM (add / edit expense, income, mileage)
   ============================================================ */
function openEntryForm(kind, id = null) {
  const existing = id ? findEntry(kind, id) : null;
  state.editing = { kind, id: id || null };

  const title = existing ? `Edit ${kindLabel(kind)}` : `Add ${kindLabel(kind)}`;
  const body = kind === "mileage" ? mileageFormHTML(existing) : moneyFormHTML(kind, existing);

  openSheet(title, body, existing);
  if (kind === "mileage") updateMileagePreview();
}

function findEntry(kind, id) {
  const store = kind === "expense" ? state.expenses : kind === "income" ? state.income : state.mileage;
  return store.find((e) => e.id === id) || null;
}
function kindLabel(kind) { return kind === "expense" ? "Expense" : kind === "income" ? "Income" : "Mileage"; }

function moneyFormHTML(kind, e) {
  const cats = state.categories.filter((c) => c.type === kind);
  const catLabel = kind === "expense" ? "Category" : "Source";
  return `
    <div class="field">
      <label>Amount <span class="required">*</span></label>
      <div class="amount-input-wrap">
        <span class="cur">${state.settings.currency}</span>
        <input id="f_amount" class="amount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00" value="${e ? e.amount : ""}" />
      </div>
      <div class="err" id="err_amount">Enter an amount greater than 0.</div>
    </div>
    <div class="field">
      <label>Date <span class="required">*</span></label>
      <input id="f_date" type="date" value="${e ? e.date : todayISO()}" />
      <div class="err" id="err_date">Please choose a date.</div>
    </div>
    <div class="field">
      <label>${catLabel} <span class="required">*</span></label>
      <select id="f_category">
        <option value="">Select ${catLabel.toLowerCase()}…</option>
        ${cats.map((c) => `<option value="${c.id}" ${e && e.categoryId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
      <div class="err" id="err_category">Please choose a ${catLabel.toLowerCase()}.</div>
    </div>
    <div class="field">
      <label>Description <span class="required">*</span></label>
      <input id="f_description" type="text" placeholder="e.g. ${kind === "expense" ? "Client lunch" : "Website project"}" value="${e ? esc(e.description) : ""}" />
      <div class="err" id="err_description">Add a short description.</div>
    </div>
    <div class="field mt-0">
      <label>Notes <span class="muted">(optional)</span></label>
      <textarea id="f_notes" placeholder="Anything else worth remembering…">${e ? esc(e.notes || "") : ""}</textarea>
    </div>
    ${sheetFooter(!!e)}`;
}

function mileageFormHTML(e) {
  return `
    <div class="field">
      <label>Miles Driven <span class="required">*</span></label>
      <input id="f_miles" class="amount" type="number" inputmode="decimal" step="0.1" min="0.1" placeholder="0.0" value="${e ? e.miles : ""}" />
      <div class="err" id="err_miles">Enter miles greater than 0.</div>
      <div class="small muted" id="milePreview" style="margin-top:6px;"></div>
    </div>
    <div class="field">
      <label>Date <span class="required">*</span></label>
      <input id="f_date" type="date" value="${e ? e.date : todayISO()}" />
      <div class="err" id="err_date">Please choose a date.</div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Starting Location <span class="required">*</span></label>
        <input id="f_start" type="text" placeholder="Office" value="${e ? esc(e.start) : ""}" />
        <div class="err" id="err_start">Required.</div>
      </div>
      <div class="field">
        <label>Destination <span class="required">*</span></label>
        <input id="f_destination" type="text" placeholder="Client site" value="${e ? esc(e.destination) : ""}" />
        <div class="err" id="err_destination">Required.</div>
      </div>
    </div>
    <div class="field">
      <label>Purpose of Trip <span class="required">*</span></label>
      <input id="f_purpose" type="text" placeholder="e.g. Client meeting" value="${e ? esc(e.purpose) : ""}" />
      <div class="err" id="err_purpose">Add a purpose for this trip.</div>
    </div>
    <div class="field mt-0">
      <label>Notes <span class="muted">(optional)</span></label>
      <textarea id="f_notes" placeholder="Anything else worth remembering…">${e ? esc(e.notes || "") : ""}</textarea>
    </div>
    ${sheetFooter(!!e)}`;
}

function sheetFooter(isEditing) {
  return `
    <button class="btn btn-primary btn-block" data-action="save-entry">${isEditing ? "Save Changes" : "Save"}</button>
    ${isEditing ? `<button class="btn btn-danger btn-block" style="margin-top:10px;" data-action="delete-entry">Delete</button>` : ""}`;
}

function updateMileagePreview() {
  const el = $("#milePreview");
  if (!el) return;
  const miles = toNumber($("#f_miles")?.value);
  const rate = toNumber(state.settings.mileageRate) || 0;
  if (rate > 0 && Number.isFinite(miles) && miles > 0) {
    el.textContent = `Estimated deduction: ${formatMoney(miles * rate)} (at ${state.settings.currency}${rate}/mi)`;
  } else {
    el.textContent = "";
  }
}

function clearFieldErrors() { $all(".field .err").forEach((e) => e.classList.remove("show")); $all(".field input, .field select").forEach((e) => e.classList.remove("invalid")); }
function showFieldError(id) { const err = $(`#err_${id}`); const field = $(`#f_${id}`); if (err) err.classList.add("show"); if (field) field.classList.add("invalid"); }

async function saveEntryFromForm() {
  clearFieldErrors();
  const { kind, id } = state.editing;
  let valid = true;
  const check = (cond, field) => { if (!cond) { showFieldError(field); valid = false; } };

  if (kind === "mileage") {
    const miles = toNumber($("#f_miles").value);
    const date = $("#f_date").value;
    const start = $("#f_start").value.trim();
    const destination = $("#f_destination").value.trim();
    const purpose = $("#f_purpose").value.trim();
    const notes = $("#f_notes").value.trim();

    check(Number.isFinite(miles) && miles > 0, "miles");
    check(!!date, "date");
    check(!!start, "start");
    check(!!destination, "destination");
    check(!!purpose, "purpose");
    if (!valid) return;

    const now = Date.now();
    const obj = id ? { ...findEntry("mileage", id) } : { id: uidLocal(), createdAt: now };
    Object.assign(obj, { miles, date, start, destination, purpose, notes, updatedAt: now });
    await DB.put("mileage", obj);
    const idx = state.mileage.findIndex((m) => m.id === obj.id);
    if (idx >= 0) state.mileage[idx] = obj; else state.mileage.push(obj);
    toast(id ? "Trip updated" : "Trip added");
  } else {
    const amount = toNumber($("#f_amount").value);
    const date = $("#f_date").value;
    const categoryId = $("#f_category").value;
    const description = $("#f_description").value.trim();
    const notes = $("#f_notes").value.trim();

    check(Number.isFinite(amount) && amount > 0, "amount");
    check(!!date, "date");
    check(!!categoryId, "category");
    check(!!description, "description");
    if (!valid) return;

    const now = Date.now();
    const store = kind === "expense" ? "expenses" : "income";
    const obj = id ? { ...findEntry(kind, id) } : { id: uidLocal(), createdAt: now };
    Object.assign(obj, { amount, date, categoryId, description, notes, updatedAt: now });
    await DB.put(store, obj);
    const arr = kind === "expense" ? state.expenses : state.income;
    const idx = arr.findIndex((m) => m.id === obj.id);
    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
    toast(id ? `${kindLabel(kind)} updated` : `${kindLabel(kind)} added`);
  }

  closeSheet();
  render();
}

async function deleteEntry(kind, id) {
  if (!confirm(`Delete this ${kindLabel(kind).toLowerCase()} entry? This can't be undone.`)) return;
  const store = kind === "expense" ? "expenses" : kind === "income" ? "income" : "mileage";
  await DB.delete(store, id);
  state[store] = state[store].filter((e) => e.id !== id);
  toast(`${kindLabel(kind)} deleted`);
  closeSheet();
  render();
}

/* ============================================================
   ACTION SHEET (the center + tab)
   ============================================================ */
function openActionSheet() {
  const body = `
    <div class="action-sheet">
      <button class="opt" data-action="add-income"><span class="qi income">↑</span>Add Income</button>
      <button class="opt" data-action="add-expense"><span class="qi expense">↓</span>Add Expense</button>
      <button class="opt" data-action="add-mileage"><span class="qi mileage">→</span>Log Mileage</button>
    </div>`;
  openSheet("New Entry", body);
}

/* ============================================================
   REPORTS
   ============================================================ */
function reportsHTML() {
  return `
    <div class="topbar">
      <h1>Reports</h1>
      <div class="sub" id="reportsSub"></div>
    </div>
    <div class="view">
      <div class="period-tabs">
        ${["today", "week", "month", "year", "all"].map(p => `<button data-action="set-report-period" data-period="${p}" class="${state.reportsPeriod === p ? "active" : ""}">${periodLabel(p)}</button>`).join("")}
      </div>
      <div id="reportsHero"></div>
      <div id="reportsStats"></div>
      <div class="section-head"><h2>Expenses by Category</h2></div>
      <div class="card mt-0" id="expenseBreakdown"></div>
      <div class="section-head"><h2>Income by Source</h2></div>
      <div class="card mt-0" id="incomeBreakdown"></div>
    </div>`;
}

function renderReports() {
  const { start, end, label } = computeRange(state.reportsPeriod);
  $("#reportsSub").textContent = label;
  const stats = statsForRange(start, end);
  const profitClass = stats.profit < 0 ? "neg" : "";

  $("#reportsHero").innerHTML = `
    <div class="hero">
      <div class="eyebrow">Net Profit</div>
      <div class="profit tabular ${profitClass}">${formatMoney(stats.profit)}</div>
      <div class="period">${label}</div>
      <hr class="tear" />
      <div class="split">
        <div class="col"><div class="label"><span class="dot" style="background:var(--income)"></span>Income</div><div class="amt tabular">${formatMoney(stats.income)}</div></div>
        <div class="col"><div class="label"><span class="dot" style="background:var(--expense)"></span>Expenses</div><div class="amt tabular">${formatMoney(stats.expense)}</div></div>
      </div>
    </div>`;

  $("#reportsStats").innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="label">Total Mileage</div><div class="value mileage tabular">${stats.miles.toLocaleString("en-US", { maximumFractionDigits: 1 })} mi</div></div>
      <div class="stat"><div class="label">Mileage Deduction</div><div class="value tabular">${formatMoney(stats.deduction)}</div></div>
    </div>`;

  $("#expenseBreakdown").innerHTML = breakdownHTML("expense", start, end, stats.expense);
  $("#incomeBreakdown").innerHTML = breakdownHTML("income", start, end, stats.income);
}

function breakdownHTML(type, start, end, total) {
  const arr = (type === "expense" ? state.expenses : state.income).filter((e) => inRange(e.date, start, end));
  if (!arr.length) return emptyState("📊", `No ${type} data`, `${type === "expense" ? "Expenses" : "Income"} in this period will appear here.`);
  const byCategory = {};
  arr.forEach((e) => { byCategory[e.categoryId] = (byCategory[e.categoryId] || 0) + e.amount; });
  const rows = Object.entries(byCategory)
    .map(([catId, amount]) => ({ catId, amount, name: categoryName(catId), color: categoryColor(catId) }))
    .sort((a, b) => b.amount - a.amount);
  return rows.map((r) => `
    <div class="breakdown-row" style="flex-direction:column; align-items:stretch;">
      <div style="display:flex; justify-content:space-between;">
        <div class="name">${esc(r.name)}</div>
        <div class="amt tabular">${formatMoney(r.amount)}</div>
      </div>
      <div class="bkbar-wrap"><div class="bkbar" style="width:${total > 0 ? Math.round((r.amount / total) * 100) : 0}%; background:${r.color}"></div></div>
    </div>`).join("");
}

/* ============================================================
   SETTINGS
   ============================================================ */
function settingsHTML() {
  const isStandalone = window.navigator.standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `
    <div class="topbar">
      <h1>Settings</h1>
      <div class="sub">Categories, mileage rate, backups</div>
    </div>
    <div class="view">
      ${(!isStandalone && isiOS) ? `
      <div class="card">
        <strong>Install Ledger on your iPhone</strong>
        <p class="small muted" style="margin-top:6px;">Tap the Share icon in Safari, then "Add to Home Screen." Ledger will open full-screen like a native app, and all your data stays right where you left it.</p>
      </div>` : ""}

      <div class="section-head"><h2>Preferences</h2></div>
      <div class="list-menu">
        <button class="item" data-action="open-categories"><span class="ic">🏷️</span>Categories<span class="chev">›</span></button>
        <button class="item" data-action="open-rate"><span class="ic">🚗</span>Mileage Rate<span class="val">${state.settings.currency}${(toNumber(state.settings.mileageRate) || 0).toFixed(3)}/mi</span><span class="chev">›</span></button>
        <button class="item" data-action="open-currency"><span class="ic">💱</span>Currency<span class="val">${state.settings.currency}</span><span class="chev">›</span></button>
      </div>

      <div class="section-head"><h2>Backup & Restore</h2></div>
      <div class="list-menu">
        <button class="item" data-action="export-json"><span class="ic">⬇️</span>Export as JSON<span class="chev">›</span></button>
        <button class="item" data-action="export-csv"><span class="ic">⬇️</span>Export as CSV<span class="chev">›</span></button>
        <button class="item" data-action="trigger-import"><span class="ic">⬆️</span>Import from JSON<span class="chev">›</span></button>
      </div>

      <div class="section-head"><h2>Data</h2></div>
      <div class="list-menu">
        <button class="item" data-action="clear-all" style="color:var(--danger);"><span class="ic">🗑️</span>Clear All Data<span class="chev">›</span></button>
      </div>
      <p class="small muted text-center" style="margin-top:18px;">All data is stored only on this device, in your browser's local database. Export a backup regularly if you'd like a copy elsewhere.</p>
    </div>`;
}

/* ----- categories manager ----- */
function openCategoryManager() {
  openSheet("Categories", categoryManagerBody());
}
function categoryManagerBody() {
  const expense = state.categories.filter((c) => c.type === "expense");
  const income = state.categories.filter((c) => c.type === "income");
  return `
    <div>
      <div class="section-head mt-0"><h2>Expense Categories</h2><a data-action="add-category" data-type="expense">+ Add</a></div>
      <div class="card mt-0">${expense.map(categoryRow).join("") || `<p class="muted small">No categories yet.</p>`}</div>
      <div class="section-head"><h2>Income Sources</h2><a data-action="add-category" data-type="income">+ Add</a></div>
      <div class="card mt-0">${income.map(categoryRow).join("") || `<p class="muted small">No sources yet.</p>`}</div>
    </div>`;
}
function categoryRow(c) {
  return `<div class="cat-edit-row">
    <span class="swatch" style="background:${c.color}"></span>
    <span class="nm">${esc(c.name)}</span>
    <button data-action="edit-category" data-id="${c.id}" data-type="${c.type}">✎</button>
    <button data-action="delete-category" data-id="${c.id}">🗑</button>
  </div>`;
}

function openCategoryForm(type, id = null) {
  const existing = id ? state.categories.find((c) => c.id === id) : null;
  state.editing = { kind: "category", id: id || null, type };
  const body = `
    <div class="field">
      <label>Name <span class="required">*</span></label>
      <input id="f_catname" type="text" placeholder="e.g. ${type === "expense" ? "Equipment" : "Royalties"}" value="${existing ? esc(existing.name) : ""}" />
      <div class="err" id="err_catname">Enter a category name.</div>
    </div>
    <div class="field mt-0">
      <label>Color</label>
      <div class="swatch-picker" id="swatchPicker">
        ${CATEGORY_PALETTE.map((color) => `<span class="sw ${existing && existing.color === color ? "active" : ""}" data-color="${color}" style="background:${color}" onclick="selectSwatch('${color}')"></span>`).join("")}
      </div>
      <input type="hidden" id="f_catcolor" value="${existing ? existing.color : CATEGORY_PALETTE[0]}" />
    </div>
    <button class="btn btn-primary btn-block" style="margin-top:8px;" data-action="save-category">${existing ? "Save Changes" : "Add Category"}</button>
    ${existing ? `<button class="btn btn-danger btn-block" style="margin-top:10px;" data-action="delete-category" data-id="${existing.id}">Delete</button>` : ""}`;
  openSheet(existing ? "Edit Category" : `New ${type === "expense" ? "Expense" : "Income"} Category`, body);
}
function selectSwatch(color) {
  $("#f_catcolor").value = color;
  $all("#swatchPicker .sw").forEach((s) => s.classList.toggle("active", s.dataset.color === color));
}

async function saveCategoryFromForm() {
  clearFieldErrors();
  const name = $("#f_catname").value.trim();
  if (!name) { showFieldError("catname"); return; }
  const color = $("#f_catcolor").value;
  const { id, type } = state.editing;
  const now = Date.now();
  const obj = id ? { ...state.categories.find((c) => c.id === id) } : { id: uidLocal(), type };
  Object.assign(obj, { name, color, updatedAt: now });
  await DB.put("categories", obj);
  const idx = state.categories.findIndex((c) => c.id === obj.id);
  if (idx >= 0) state.categories[idx] = obj; else state.categories.push(obj);
  toast(id ? "Category updated" : "Category added");
  openCategoryManager(); // refresh back to the list within the same sheet
  render();
}

async function deleteCategory(id) {
  const usedCount = state.expenses.filter((e) => e.categoryId === id).length + state.income.filter((e) => e.categoryId === id).length;
  const msg = usedCount > 0
    ? `This category is used by ${usedCount} entr${usedCount === 1 ? "y" : "ies"}. Deleting it will leave those entries marked "Uncategorized." Continue?`
    : "Delete this category?";
  if (!confirm(msg)) return;
  await DB.delete("categories", id);
  state.categories = state.categories.filter((c) => c.id !== id);
  toast("Category deleted");
  openCategoryManager();
  render();
}

/* ----- mileage rate ----- */
function openMileageRateSheet() {
  const body = `
    <div class="field">
      <label>Rate per mile</label>
      <div class="amount-input-wrap">
        <span class="cur">${state.settings.currency}</span>
        <input id="f_rate" class="amount" type="number" inputmode="decimal" step="0.001" min="0" value="${toNumber(state.settings.mileageRate) || 0}" />
      </div>
      <p class="small muted" style="margin-top:8px;">Used to estimate a mileage deduction on your dashboard and reports. Set this to whatever rate applies to you — for example, your organization's reimbursement rate or the current standard mileage rate.</p>
    </div>
    <button class="btn btn-primary btn-block" data-action="save-rate">Save Rate</button>`;
  openSheet("Mileage Rate", body);
}
async function saveMileageRate() {
  const rate = Math.max(0, toNumber($("#f_rate").value) || 0);
  await DB.put("settings", { key: "mileageRate", value: rate });
  state.settings.mileageRate = rate;
  toast("Mileage rate saved");
  closeSheet();
  render();
}

/* ----- currency ----- */
function openCurrencySheet() {
  const options = [
    { sym: "$", label: "US Dollar ($)" }, { sym: "€", label: "Euro (€)" }, { sym: "£", label: "British Pound (£)" },
    { sym: "¥", label: "Yen / Yuan (¥)" }, { sym: "₹", label: "Indian Rupee (₹)" }, { sym: "C$", label: "Canadian Dollar (C$)" },
    { sym: "A$", label: "Australian Dollar (A$)" }
  ];
  const body = `<div class="list-menu">${options.map((o) => `<button class="item" data-action="set-currency" data-sym="${o.sym}"><span class="ic">${o.sym}</span>${o.label}${state.settings.currency === o.sym ? '<span class="chev">✓</span>' : ""}</button>`).join("")}</div>`;
  openSheet("Currency", body);
}
async function setCurrency(sym) {
  await DB.put("settings", { key: "currency", value: sym });
  state.settings.currency = sym;
  toast("Currency updated");
  closeSheet();
  render();
}

/* ============================================================
   BACKUP / RESTORE
   ============================================================ */
function triggerDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportJSON() {
  const payload = {
    app: "Ledger", version: 1, exportedAt: new Date().toISOString(),
    expenses: state.expenses, income: state.income, mileage: state.mileage,
    categories: state.categories,
    settings: { currency: state.settings.currency, mileageRate: state.settings.mileageRate }
  };
  triggerDownload(`ledger-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
  toast("Backup exported");
}

function csvField(v) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function exportCSV() {
  const rows = [["Type", "Date", "Amount", "Category / Source / Purpose", "Description", "From", "To", "Miles", "Notes"]];
  combinedEntries().forEach((e) => {
    if (e.kind === "mileage") {
      rows.push(["Mileage", e.date, "", e.purpose, "", e.start, e.destination, e.miles, e.notes || ""]);
    } else {
      rows.push([e.kind === "expense" ? "Expense" : "Income", e.date, e.amount, categoryName(e.categoryId), e.description, "", "", "", e.notes || ""]);
    }
  });
  const csv = rows.map((r) => r.map(csvField).join(",")).join("\r\n");
  triggerDownload(`ledger-export-${todayISO()}.csv`, csv, "text/csv");
  toast("CSV exported");
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.income) || !Array.isArray(data.mileage) || !Array.isArray(data.categories)) {
        throw new Error("This file doesn't look like a Ledger backup.");
      }
      if (!confirm("Importing will replace all current data on this device with the contents of this backup. Continue?")) return;

      await Promise.all(["expenses", "income", "mileage", "categories"].map((s) => DB.clear(s)));
      await DB.bulkPut("expenses", data.expenses);
      await DB.bulkPut("income", data.income);
      await DB.bulkPut("mileage", data.mileage);
      await DB.bulkPut("categories", data.categories);
      if (data.settings) {
        for (const [key, value] of Object.entries(data.settings)) await DB.put("settings", { key, value });
      }
      await DB.put("settings", { key: "seeded", value: true });
      await loadState();
      toast("Backup restored");
      switchTab("dashboard");
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

async function clearAllData() {
  if (!confirm("This will permanently delete every expense, income, and mileage entry on this device. This cannot be undone. Continue?")) return;
  if (!confirm("Are you absolutely sure? Consider exporting a backup first.")) return;
  await Promise.all(["expenses", "income", "mileage"].map((s) => DB.clear(s)));
  state.expenses = []; state.income = []; state.mileage = [];
  toast("All entries cleared");
  render();
}

/* ============================================================
   SHEET (bottom modal) plumbing
   ============================================================ */
function openSheet(title, bodyHTML, existing) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = bodyHTML;
  $("#sheetBackdrop").classList.add("open");
  $("#sheet").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheetBackdrop").classList.remove("open");
  $("#sheet").classList.remove("open");
  document.body.style.overflow = "";
  state.editing = null;
}
