// js/app.js - Pure Payroll & Fast Ledger Controller (Full CRUD, Debits & Credits, Full Month Ledger)

import { 
  db, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  writeBatch,
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  APP_CONFIG 
} from "./config.js";

// --- GLOBAL APPLICATION STATE ---
let staffList = [];
let activeStaffId = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1; // 1-12
let currentFromDate = "";
let currentToDate = "";
let ledgerMap = {}; // Key: "YYYY-MM-DD" -> { staffId, dateStr, inTime, outTime, credit, creditNote, debit, debitNote }
let activeDayModalDate = null;
let saveDebounceTimer = null;

// --- TOAST NOTIFICATIONS ---
export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast px-4 py-3 rounded-xl shadow-lg flex items-center space-x-2.5 text-xs font-semibold text-white ${
    type === "success" ? "bg-emerald-600 border border-emerald-500" :
    type === "error" ? "bg-rose-600 border border-rose-500" :
    type === "warning" ? "bg-amber-600 border border-amber-500" : "bg-slate-800 border border-slate-700"
  }`;

  const icon = type === "success" ? "fa-circle-check" :
               type === "error" ? "fa-circle-exclamation" :
               type === "warning" ? "fa-triangle-exclamation" : "fa-circle-info";

  toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i><span class="flex-1">${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

// --- DATE HELPERS ---
function formatDateLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDayDetails(dateStr) {
  const date = parseDateLocal(dateStr);
  const dayName = date.toLocaleDateString("en-IN", { weekday: "short" });
  const dayNum = date.getDate();
  const monthName = date.toLocaleDateString("en-IN", { month: "short" });
  const year = date.getFullYear();
  const isToday = dateStr === formatDateLocal();
  const isSunday = date.getDay() === 0;
  return { dayName, dayNum, monthName, year, isToday, isSunday };
}

// Generate Every Day in Selected Month (from 1st to 28th/29th/30th/31st)
function generateMonthDays(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates = [];
  const mStr = String(month).padStart(2, "0");

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = String(d).padStart(2, "0");
    dates.push(`${year}-${mStr}-${dStr}`);
  }
  return dates;
}

function generateDateRangeArray(fromStr, toStr) {
  if (!fromStr || !toStr) return [];
  const start = parseDateLocal(fromStr);
  const end = parseDateLocal(toStr);
  const dates = [];

  const curr = new Date(start);
  while (curr <= end) {
    dates.push(formatDateLocal(curr));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

// --- SMART TIME PARSING & 12-HOUR MASKING ---
// Supports flexible keyboard entry: "09:00 AM", "9:30pm", "21:00", "9", "930", etc.
export function parseTimeToMinutes(raw) {
  if (!raw) return null;
  const str = raw.trim().toUpperCase();
  if (!str) return null;

  // Check 12-hour AM/PM format (e.g. "09:00 AM" or "9:30 PM")
  const match12 = str.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    let minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const modifier = match12[3];

    if (modifier === "PM" && hours < 12) hours += 12;
    if (modifier === "AM" && hours === 12) hours = 0;

    // If no modifier but hours > 12, assume 24-hour format
    if (!modifier && hours >= 8 && hours <= 11) {
      // e.g. "9" or "9:30" defaults to AM in retail morning shift
    }

    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      return hours * 60 + minutes;
    }
  }

  // Fallback direct 4-digit input (e.g. "0900" -> 9am, "2100" -> 9pm)
  if (/^\d{3,4}$/.test(str)) {
    const padded = str.padStart(4, "0");
    const h = parseInt(padded.slice(0, 2), 10);
    const m = parseInt(padded.slice(2, 4), 10);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return h * 60 + m;
    }
  }

  return null;
}

export function formatMinutesToTime12(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes)) return "";
  let hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = Math.floor(totalMinutes % 60);
  const modifier = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  if (hours === 0) hours = 12;

  const hStr = String(hours).padStart(2, "0");
  const mStr = String(minutes).padStart(2, "0");
  return `${hStr}:${mStr} ${modifier}`;
}

export function normalizeTimeString(raw) {
  const mins = parseTimeToMinutes(raw);
  if (mins === null) return raw;
  return formatMinutesToTime12(mins);
}

// Split any valid time string into 12-hour components { hour, min, ampm }
export function splitTimeString(timeStr) {
  if (!timeStr) return { hour: "", min: "", ampm: "" };
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return { hour: "", min: "", ampm: "" };
  let h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return {
    hour: String(h).padStart(2, "0"),
    min: String(m).padStart(2, "0"),
    ampm: ampm
  };
}

// --- DURATION FORMATTING HELPER ---
// Converts total elapsed minutes into clean "Xh Ym" string (e.g., 730 mins -> "12h 10m", 480 mins -> "8h 0m")
export function formatMinutesToDuration(totalMinutes) {
  if (typeof totalMinutes !== "number" || isNaN(totalMinutes) || totalMinutes < 0) {
    return "0h 0m";
  }
  const rounded = Math.round(totalMinutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${h}h ${m}m`;
}

// --- SHIFT MATH CALCULATION ---
// Calculates total worked minutes and splits into Regular & Flat OT
function calculateShiftHours(inTimeStr, outTimeStr, standardHours = 8) {
  const inMinutes = parseTimeToMinutes(inTimeStr);
  const outMinutes = parseTimeToMinutes(outTimeStr);

  if (inMinutes === null || outMinutes === null) return null;

  let totalMinutes = outMinutes - inMinutes;
  // Handle overnight shift crossing midnight
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60;
  }

  const standardMinutes = Math.round(standardHours * 60);
  const regMinutes = Math.min(totalMinutes, standardMinutes);
  const otMinutes = Math.max(0, totalMinutes - standardMinutes);

  const totalHours = totalMinutes / 60;
  const regHours = regMinutes / 60;
  const otHours = otMinutes / 60;

  return {
    totalHours: Number(totalHours.toFixed(2)),
    regHours: Number(regHours.toFixed(2)),
    otHours: Number(otHours.toFixed(2)),
    totalMinutes,
    regMinutes,
    otMinutes
  };
}

// --- SHIFT BADGES HTML GENERATOR ---
// Generates both Duration Math Pill and Daily Wage Breakdown Badges
function getShiftBadgesHTML(shift, hourlyWage) {
  if (!shift) {
    return { mathPillHTML: "", dailyWageHTML: "" };
  }

  const regWage = Math.round((shift.regMinutes / 60) * hourlyWage);
  const otWage = Math.round((shift.otMinutes / 60) * hourlyWage);
  const dailyWage = regWage + otWage;

  const totalDurationStr = formatMinutesToDuration(shift.totalMinutes);
  const regDurationStr = formatMinutesToDuration(shift.regMinutes);
  const otDurationStr = formatMinutesToDuration(shift.otMinutes);

  let mathPillHTML = "";
  let dailyWageHTML = "";

  if (shift.otMinutes > 0) {
    mathPillHTML = `
      <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-mono-numbers font-bold text-xs">
        <span>${totalDurationStr}</span>
        <span class="text-indigo-400 font-normal">(${regDurationStr} Reg + <b class="text-indigo-700">${otDurationStr} OT</b>)</span>
      </span>
    `;
    dailyWageHTML = `
      <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono-numbers text-xs font-bold" title="Daily Wage Breakdown">
        <span class="text-slate-600 font-normal">(${APP_CONFIG.currency}${regWage.toLocaleString("en-IN")} Reg + <b class="text-indigo-700 font-bold">${APP_CONFIG.currency}${otWage.toLocaleString("en-IN")} OT</b>)</span>
        <span class="mx-1 text-slate-400 font-normal">=</span>
        <span class="text-emerald-700 font-black">${APP_CONFIG.currency}${dailyWage.toLocaleString("en-IN")} Total</span>
      </span>
    `;
  } else {
    mathPillHTML = `
      <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono-numbers font-bold text-xs">
        <span>${totalDurationStr}</span>
        <span class="text-emerald-500 font-normal">(${regDurationStr} Reg)</span>
      </span>
    `;
    dailyWageHTML = `
      <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono-numbers text-xs font-bold" title="Daily Wage Breakdown">
        <span class="text-slate-600 font-normal">(${APP_CONFIG.currency}${regWage.toLocaleString("en-IN")} Reg)</span>
        <span class="mx-1 text-slate-400 font-normal">=</span>
        <span class="text-emerald-700 font-black">${APP_CONFIG.currency}${dailyWage.toLocaleString("en-IN")} Total</span>
      </span>
    `;
  }

  return { mathPillHTML, dailyWageHTML };
}

// --- INITIALIZE APPLICATION ---
export function initApp() {
  setupMonthYearDefaults();
  initCustomTimePicker();
  bindGlobalEvents();
  listenToStaffProfiles();
}

function setupMonthYearDefaults() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1; // 1-12

  const monthSelect = document.getElementById("ledger-month-select");
  const yearSelect = document.getElementById("ledger-year-select");

  if (monthSelect) monthSelect.value = String(currentMonth);
  if (yearSelect) yearSelect.value = String(currentYear);

  updateDateRangeFromMonthYear(currentYear, currentMonth);
}

function updateDateRangeFromMonthYear(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const mStr = String(month).padStart(2, "0");

  currentFromDate = `${year}-${mStr}-01`;
  currentToDate = `${year}-${mStr}-${String(daysInMonth).padStart(2, "0")}`;

  const fromInput = document.getElementById("filter-from-date");
  const toInput = document.getElementById("filter-to-date");

  if (fromInput) fromInput.value = currentFromDate;
  if (toInput) toInput.value = currentToDate;
}

function bindGlobalEvents() {
  // Month & Year Selector
  const monthSelect = document.getElementById("ledger-month-select");
  const yearSelect = document.getElementById("ledger-year-select");

  monthSelect?.addEventListener("change", () => {
    currentMonth = Number(monthSelect.value);
    updateDateRangeFromMonthYear(currentYear, currentMonth);
    renderLedgerDayCards();
    updateLiveSummary();
  });

  yearSelect?.addEventListener("change", () => {
    currentYear = Number(yearSelect.value);
    updateDateRangeFromMonthYear(currentYear, currentMonth);
    renderLedgerDayCards();
    updateLiveSummary();
  });

  document.getElementById("ledger-prev-month-btn")?.addEventListener("click", () => {
    currentMonth--;
    if (currentMonth < 1) {
      currentMonth = 12;
      currentYear--;
    }
    if (monthSelect) monthSelect.value = String(currentMonth);
    if (yearSelect) yearSelect.value = String(currentYear);
    updateDateRangeFromMonthYear(currentYear, currentMonth);
    renderLedgerDayCards();
    updateLiveSummary();
  });

  document.getElementById("ledger-next-month-btn")?.addEventListener("click", () => {
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
    if (monthSelect) monthSelect.value = String(currentMonth);
    if (yearSelect) yearSelect.value = String(currentYear);
    updateDateRangeFromMonthYear(currentYear, currentMonth);
    renderLedgerDayCards();
    updateLiveSummary();
  });

  document.getElementById("ledger-today-month-btn")?.addEventListener("click", () => {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth() + 1;
    if (monthSelect) monthSelect.value = String(currentMonth);
    if (yearSelect) yearSelect.value = String(currentYear);
    updateDateRangeFromMonthYear(currentYear, currentMonth);
    renderLedgerDayCards();
    updateLiveSummary();
  });

  // Sidebar Date Filter Inputs
  const fromInput = document.getElementById("filter-from-date");
  const toInput = document.getElementById("filter-to-date");

  fromInput?.addEventListener("change", () => {
    currentFromDate = fromInput.value;
    renderLedgerDayCards();
    updateLiveSummary();
  });

  toInput?.addEventListener("change", () => {
    currentToDate = toInput.value;
    renderLedgerDayCards();
    updateLiveSummary();
  });

  // Preset Date Range Chips
  document.getElementById("preset-this-month")?.addEventListener("click", () => {
    setupMonthYearDefaults();
    renderLedgerDayCards();
    updateLiveSummary();
  });

  document.getElementById("preset-last-15")?.addEventListener("click", () => {
    const today = new Date();
    const past15 = new Date();
    past15.setDate(today.getDate() - 14);
    currentFromDate = formatDateLocal(past15);
    currentToDate = formatDateLocal(today);
    if (fromInput) fromInput.value = currentFromDate;
    if (toInput) toInput.value = currentToDate;
    renderLedgerDayCards();
    updateLiveSummary();
  });

  document.getElementById("preset-last-30")?.addEventListener("click", () => {
    const today = new Date();
    const past30 = new Date();
    past30.setDate(today.getDate() - 29);
    currentFromDate = formatDateLocal(past30);
    currentToDate = formatDateLocal(today);
    if (fromInput) fromInput.value = currentFromDate;
    if (toInput) toInput.value = currentToDate;
    renderLedgerDayCards();
    updateLiveSummary();
  });

  // Staff Modal Events
  document.getElementById("add-staff-btn")?.addEventListener("click", openAddStaffModal);
  document.getElementById("edit-active-staff-btn")?.addEventListener("click", openEditActiveStaffModal);
  document.getElementById("staff-modal-close-btn")?.addEventListener("click", closeStaffModal);
  document.getElementById("staff-form-save-btn")?.addEventListener("click", saveStaffProfile);
  document.getElementById("staff-delete-btn")?.addEventListener("click", deleteActiveStaffProfile);

  // Day Financial Adjustment Modal Events (Credits & Debits)
  document.getElementById("day-modal-close-btn")?.addEventListener("click", closeDayModal);
  document.getElementById("day-modal-save-btn")?.addEventListener("click", saveDayFinancials);
  document.getElementById("day-modal-clear-credit-btn")?.addEventListener("click", clearDayCredit);
  document.getElementById("day-modal-clear-debit-btn")?.addEventListener("click", clearDayDebit);
  document.getElementById("day-modal-clear-all-btn")?.addEventListener("click", clearAllDayFinancials);

  // Status & Notes Modal Events (Attendance Toggle & Notepad)
  document.getElementById("status-notes-modal-close-btn")?.addEventListener("click", closeStatusNotesModal);
  document.getElementById("status-notes-modal-cancel-btn")?.addEventListener("click", closeStatusNotesModal);
  document.getElementById("status-notes-modal-save-btn")?.addEventListener("click", saveStatusNotes);
  document.getElementById("status-notes-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "status-notes-modal") closeStatusNotesModal();
  });

  // Breakdown Modal Events (Credits & Debits)
  document.getElementById("summary-credit-btn")?.addEventListener("click", () => openBreakdownModal("credit"));
  document.getElementById("summary-debit-btn")?.addEventListener("click", () => openBreakdownModal("debit"));
  document.getElementById("breakdown-modal-close-btn")?.addEventListener("click", closeBreakdownModal);
}

// =========================================================================
// 1. FULL STAFF CRUD
// =========================================================================

function listenToStaffProfiles() {
  const q = query(collection(db, "staff"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    staffList = [];
    snapshot.forEach((d) => staffList.push({ id: d.id, ...d.data() }));

    renderStaffSelector();

    const storedId = localStorage.getItem("nalam_selected_staff");
    if (storedId && staffList.some(s => s.id === storedId)) {
      selectStaff(storedId);
    } else if (staffList.length > 0) {
      if (!activeStaffId || !staffList.some(s => s.id === activeStaffId)) {
        selectStaff(staffList[0].id);
      }
    } else {
      activeStaffId = null;
      renderEmptyState();
    }
  }, (err) => {
    console.error("Staff profiles listener error:", err);
    showToast("Error connecting to staff database.", "error");
  });
}

function renderStaffSelector() {
  const container = document.getElementById("staff-pills-container");
  if (!container) return;

  if (staffList.length === 0) {
    container.innerHTML = `
      <div class="text-xs text-slate-500 font-medium py-1">No staff members created yet.</div>
    `;
    return;
  }

  container.innerHTML = staffList.map((s) => {
    const isActive = s.id === activeStaffId;
    return `
      <button 
        data-staff-id="${s.id}" 
        class="staff-pill px-4 py-2 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all tap-active ${
          isActive 
            ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-2 ring-emerald-500" 
            : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-sm"
        }"
      >
        <span class="w-5 h-5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'} flex items-center justify-center font-bold text-[10px]">
          ${s.name.charAt(0).toUpperCase()}
        </span>
        <span>${s.name}</span>
        <span class="${isActive ? 'text-emerald-100' : 'text-slate-400'} font-normal text-[11px] font-mono-numbers">
          ${APP_CONFIG.currency}${s.hourlyWage}/h
        </span>
      </button>
    `;
  }).join("");

  container.querySelectorAll(".staff-pill").forEach((btn) => {
    btn.onclick = () => selectStaff(btn.dataset.staffId);
  });
}

function selectStaff(staffId) {
  activeStaffId = staffId;
  localStorage.setItem("nalam_selected_staff", staffId);
  renderStaffSelector();

  const staff = staffList.find(s => s.id === staffId);
  if (staff) {
    document.getElementById("active-staff-title").textContent = staff.name;
    document.getElementById("active-staff-subtitle").textContent = `${APP_CONFIG.currency}${staff.hourlyWage}/hr • ${staff.standardHours}h Fixed Standard`;
    document.getElementById("active-staff-badge-container")?.classList.remove("hidden");
  }

  loadStaffLedger(staffId);
}

function openAddStaffModal() {
  document.getElementById("staff-modal-title").textContent = "Add New Staff Member";
  document.getElementById("staff-input-id").value = "";
  document.getElementById("staff-input-name").value = "";
  document.getElementById("staff-input-hours").value = "8";
  document.getElementById("staff-input-wage").value = "30";
  document.getElementById("staff-delete-btn")?.classList.add("hidden");
  document.getElementById("staff-modal").classList.add("active");
  document.getElementById("staff-input-name")?.focus();
}

function openEditActiveStaffModal() {
  const staff = staffList.find(s => s.id === activeStaffId);
  if (!staff) return;

  document.getElementById("staff-modal-title").textContent = `Edit Staff Profile: ${staff.name}`;
  document.getElementById("staff-input-id").value = staff.id;
  document.getElementById("staff-input-name").value = staff.name;
  document.getElementById("staff-input-hours").value = staff.standardHours || 8;
  document.getElementById("staff-input-wage").value = staff.hourlyWage || 30;
  document.getElementById("staff-delete-btn")?.classList.remove("hidden");
  document.getElementById("staff-modal").classList.add("active");
}

function closeStaffModal() {
  document.getElementById("staff-modal").classList.remove("active");
}

async function saveStaffProfile() {
  const id = document.getElementById("staff-input-id").value;
  const name = document.getElementById("staff-input-name").value.trim();
  const standardHours = Number(document.getElementById("staff-input-hours").value) || 8;
  const hourlyWage = Number(document.getElementById("staff-input-wage").value) || 0;

  if (!name) {
    showToast("Please enter employee name.", "warning");
    return;
  }

  try {
    if (!id) {
      const newRef = doc(collection(db, "staff"));
      await setDoc(newRef, {
        name,
        standardHours,
        hourlyWage,
        createdAt: serverTimestamp()
      });
      showToast(`Added staff profile for ${name}!`, "success");
      activeStaffId = newRef.id;
    } else {
      await setDoc(doc(db, "staff", id), {
        name,
        standardHours,
        hourlyWage,
        updatedAt: serverTimestamp()
      }, { merge: true });
      showToast(`Updated profile for ${name}!`, "success");
    }

    closeStaffModal();
    if (activeStaffId) loadStaffLedger(activeStaffId);
  } catch (err) {
    console.error("Save staff error:", err);
    showToast("Failed to save staff profile: " + err.message, "error");
  }
}

async function deleteActiveStaffProfile() {
  const staff = staffList.find(s => s.id === activeStaffId);
  if (!staff) return;

  if (!window.confirm(`Are you sure you want to delete this staff member (${staff.name})?\n\nThis will permanently delete all attendance and financial records for this employee.`)) {
    return;
  }

  try {
    showToast(`Cascade deleting all records for ${staff.name}...`, "info");

    const q = query(collection(db, "ledger"), where("staffId", "==", staff.id));
    const snap = await getDocs(q);

    const batch = writeBatch(db);
    snap.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "staff", staff.id));
    await batch.commit();

    showToast(`Staff ${staff.name} and all associated ledger entries deleted.`, "success");
    closeStaffModal();

    activeStaffId = null;
    localStorage.removeItem("nalam_selected_staff");
  } catch (err) {
    console.error("Delete staff cascade error:", err);
    showToast("Failed to delete staff: " + err.message, "error");
  }
}

// =========================================================================
// 2. THE LEDGER (Full Month View, Daily Wage, Confirm Delete & Fast Inputs)
// =========================================================================

async function loadStaffLedger(staffId) {
  const cardsContainer = document.getElementById("ledger-cards-container");
  if (!cardsContainer) return;

  cardsContainer.innerHTML = `
    <div class="py-16 text-center text-slate-400 space-y-3 bg-white rounded-2xl border border-slate-200">
      <div class="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
      <p class="text-xs font-semibold">Loading Ledger Records...</p>
    </div>
  `;

  try {
    // Fetch all records for this staff member (no index restrictions)
    const q = query(
      collection(db, "ledger"),
      where("staffId", "==", staffId)
    );

    const snap = await getDocs(q);
    ledgerMap = {};

    snap.forEach((d) => {
      const data = d.data();
      // Support backward compatibility: credit || allowance, debit || deduction, status, notes
      const credit = Number(data.credit ?? data.allowance ?? 0);
      const creditNote = data.creditNote || data.allowanceNote || "";
      const debit = Number(data.debit ?? data.deduction ?? 0);
      const debitNote = data.debitNote || data.deductionNote || "";
      const status = data.status || "working";
      const notes = data.notes || "";

      ledgerMap[data.dateStr] = {
        ...data,
        credit,
        creditNote,
        debit,
        debitNote,
        status,
        notes
      };
    });

    renderLedgerDayCards();
    updateLiveSummary();
  } catch (err) {
    console.error("Load ledger error:", err);
    cardsContainer.innerHTML = `
      <div class="p-6 text-center text-xs text-rose-500 font-medium bg-white rounded-2xl border border-rose-200">
        Error loading ledger records: ${err.message}
      </div>
    `;
  }
}

function renderLedgerDayCards() {
  const cardsContainer = document.getElementById("ledger-cards-container");
  if (!cardsContainer) return;

  // Generate all consecutive dates in the currently selected month or date range
  const dates = generateDateRangeArray(currentFromDate, currentToDate);
  const staff = staffList.find(s => s.id === activeStaffId);
  const standardHours = staff ? (staff.standardHours || 8) : 8;
  const hourlyWage = staff ? Number(staff.hourlyWage || 0) : 0;

  if (dates.length === 0) {
    cardsContainer.innerHTML = `
      <div class="p-8 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
        Please select a valid month or date range above.
      </div>
    `;
    return;
  }

  cardsContainer.innerHTML = dates.map((dateStr, index) => {
    const entry = ledgerMap[dateStr] || {};
    const inTime = entry.inTime || "";
    const outTime = entry.outTime || "";
    const inParts = splitTimeString(inTime);
    const outParts = splitTimeString(outTime);
    const credit = Number(entry.credit || 0);
    const creditNote = entry.creditNote || "";
    const debit = Number(entry.debit || 0);
    const debitNote = entry.debitNote || "";
    const status = entry.status || "working";
    const notes = entry.notes || "";

    const { dayName, dayNum, monthName, year, isToday, isSunday } = formatDayDetails(dateStr);

    // Instant Math Pill & Daily Wage Display based on Attendance Status
    let mathPillHTML = "";
    let dailyWageHTML = "";

    if (status === "leave") {
      mathPillHTML = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold text-xs">
          <span>0h 0m</span>
          <span class="text-rose-400 font-normal">(Leave)</span>
        </span>
      `;
      dailyWageHTML = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 font-mono-numbers text-xs font-bold" title="Daily Wage (Leave: ₹0)">
          <span class="text-slate-500 font-normal">(${APP_CONFIG.currency}0 Reg)</span>
          <span class="mx-1 text-slate-400 font-normal">=</span>
          <span class="text-slate-700 font-black">${APP_CONFIG.currency}0 Total</span>
        </span>
      `;
    } else if (status === "weekoff") {
      const weekOffWage = Math.round(standardHours * hourlyWage);
      const weekOffDuration = formatMinutesToDuration(standardHours * 60);
      mathPillHTML = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 font-mono-numbers font-bold text-xs">
          <span>${weekOffDuration}</span>
          <span class="text-blue-400 font-normal">(${weekOffDuration} Reg - Week Off)</span>
        </span>
      `;
      dailyWageHTML = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono-numbers text-xs font-bold" title="Daily Wage (Paid Week Off)">
          <span class="text-slate-600 font-normal">(${APP_CONFIG.currency}${weekOffWage.toLocaleString("en-IN")} Reg)</span>
          <span class="mx-1 text-slate-400 font-normal">=</span>
          <span class="text-emerald-700 font-black">${APP_CONFIG.currency}${weekOffWage.toLocaleString("en-IN")} Total</span>
        </span>
      `;
    } else if (status === "holiday") {
      const holidayWage = Math.round(standardHours * hourlyWage);
      const holidayDuration = formatMinutesToDuration(standardHours * 60);
      mathPillHTML = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-mono-numbers font-bold text-xs">
          <span>${holidayDuration}</span>
          <span class="text-amber-500 font-normal">(${holidayDuration} Reg - Holiday)</span>
        </span>
      `;
      dailyWageHTML = `
        <span class="inline-flex items-center px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono-numbers text-xs font-bold" title="Daily Wage (Paid Holiday)">
          <span class="text-slate-600 font-normal">(${APP_CONFIG.currency}${holidayWage.toLocaleString("en-IN")} Reg)</span>
          <span class="mx-1 text-slate-400 font-normal">=</span>
          <span class="text-emerald-700 font-black">${APP_CONFIG.currency}${holidayWage.toLocaleString("en-IN")} Total</span>
        </span>
      `;
    } else {
      // Default: Working Status
      const shift = calculateShiftHours(inTime, outTime, standardHours);
      if (shift) {
        const badges = getShiftBadgesHTML(shift, hourlyWage);
        mathPillHTML = badges.mathPillHTML;
        dailyWageHTML = badges.dailyWageHTML;
      } else if (inTime && !outTime) {
        mathPillHTML = `
          <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-xs animate-pulse">
            <i class="fa-solid fa-clock text-[10px]"></i>
            <span>Shift in progress...</span>
          </span>
        `;
      }
    }

    // Daily Financial Labels (Credits & Debits)
    let finLabelsHTML = "";
    if (credit > 0 || debit > 0) {
      finLabelsHTML = `
        <div class="flex items-center space-x-1.5 flex-wrap gap-1">
          ${credit > 0 ? `
            <button onclick="window.openDayModal('${dateStr}')" class="px-2 py-0.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-800 text-xs font-bold transition-colors tap-active max-w-[180px] sm:max-w-[220px] truncate" title="${creditNote ? `Credit: ₹${credit} (${creditNote})` : `Credit: ₹${credit}`}">
              +${APP_CONFIG.currency}${credit} ${creditNote ? `<span class="font-normal text-[10px] text-emerald-700">(${creditNote})</span>` : ''}
            </button>
          ` : ''}
          ${debit > 0 ? `
            <button onclick="window.openDayModal('${dateStr}')" class="px-2 py-0.5 rounded-lg bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-800 text-xs font-bold transition-colors tap-active max-w-[180px] sm:max-w-[220px] truncate" title="${debitNote ? `Debit: ₹${debit} (${debitNote})` : `Debit: ₹${debit}`}">
              -${APP_CONFIG.currency}${debit} ${debitNote ? `<span class="font-normal text-[10px] text-rose-700">(${debitNote})</span>` : ''}
            </button>
          ` : ''}
        </div>
      `;
    }

    const hasShiftLogged = !!(inTime || outTime);
    const sunLabelClass = isSunday 
      ? (isToday ? 'text-red-200 font-black' : 'text-red-500 font-bold') 
      : (isToday ? 'text-emerald-100 font-bold' : 'text-slate-400 font-bold');

    return `
      <div 
        id="card-${dateStr}" 
        class="bg-white rounded-2xl p-3.5 sm:p-4 card-shadow border ${isToday ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-slate-200'} transition-all w-full min-w-0"
      >
        <div class="flex flex-wrap items-center justify-between gap-3 w-full min-w-0">
          
          <!-- GROUP 1: Date & Hours / Daily Wage + Red Sunday + Note snippet -->
          <div class="flex items-center space-x-3 shrink-0 min-w-0">
            <div class="w-12 h-12 rounded-xl ${isToday ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-800'} flex flex-col items-center justify-center font-extrabold leading-none shrink-0 shadow-sm">
              <span class="text-base font-mono-numbers">${dayNum}</span>
              <span class="text-[9px] uppercase tracking-tight ${sunLabelClass}">${dayName}</span>
            </div>
            <div>
              <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                <span class="text-sm font-extrabold text-slate-900">${dayName}, ${dayNum} ${monthName}</span>
                ${isToday ? '<span class="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wider">Today</span>' : ''}
                ${notes ? `
                  <button 
                    onclick="window.openStatusNotesModal('${dateStr}')" 
                    class="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-[11px] font-bold transition-colors tap-active max-w-[170px] sm:max-w-[220px] truncate"
                    title="Daily Note: ${escapeHtml(notes)}"
                  >
                    <i class="fa-solid fa-note-sticky text-amber-500 text-[10px] shrink-0"></i>
                    <span class="truncate">${escapeHtml(notes)}</span>
                  </button>
                ` : ''}
              </div>
              <div class="flex items-center space-x-2 mt-1 flex-wrap gap-1">
                <div id="math-pill-${dateStr}">
                  ${mathPillHTML}
                </div>
                <div id="daily-wage-${dateStr}">
                  ${dailyWageHTML}
                </div>
              </div>
            </div>
          </div>

          <!-- GROUP 2: In / Out Time Pickers OR Leave / Week Off Status Card -->
          ${status === "leave" ? `
            <div class="flex items-center space-x-2.5 py-2 px-3.5 rounded-2xl bg-rose-50/80 border border-rose-200 text-rose-800 shadow-sm shrink-0">
              <div class="w-7 h-7 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                <i class="fa-solid fa-user-slash text-xs"></i>
              </div>
              <div class="leading-tight">
                <div class="flex items-center space-x-1.5">
                  <span class="text-xs font-black uppercase tracking-wider text-rose-700">LEAVE</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                  <span class="text-[11px] text-rose-600 font-bold">${APP_CONFIG.currency}0 Daily Wage</span>
                </div>
                <div class="text-[10px] text-rose-400 font-medium">Time pickers disabled for this day</div>
              </div>
            </div>
          ` : status === "weekoff" ? `
            <div class="flex items-center space-x-2.5 py-2 px-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 text-blue-800 shadow-sm shrink-0">
              <div class="w-7 h-7 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <i class="fa-solid fa-calendar-check text-xs"></i>
              </div>
              <div class="leading-tight">
                <div class="flex items-center space-x-1.5">
                  <span class="text-xs font-black uppercase tracking-wider text-blue-700">WEEK OFF</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                  <span class="text-[11px] text-blue-700 font-bold">${standardHours}h Paid Std (${APP_CONFIG.currency}${Math.round(standardHours * hourlyWage)})</span>
                </div>
                <div class="text-[10px] text-blue-400 font-medium">Auto-calculated standard daily wage</div>
              </div>
            </div>
          ` : status === "holiday" ? `
            <div class="flex items-center space-x-2.5 py-2 px-3.5 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-800 shadow-sm shrink-0">
              <div class="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                <i class="fa-solid fa-umbrella-beach text-xs"></i>
              </div>
              <div class="leading-tight">
                <div class="flex items-center space-x-1.5">
                  <span class="text-xs font-black uppercase tracking-wider text-amber-700">HOLIDAY</span>
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span class="text-[11px] text-amber-700 font-bold">${standardHours}h Paid Std (${APP_CONFIG.currency}${Math.round(standardHours * hourlyWage)})</span>
                </div>
                <div class="text-[10px] text-amber-500 font-medium">Auto-calculated standard daily wage</div>
              </div>
            </div>
          ` : `
          <div class="flex items-center space-x-2 shrink-0">
            
            <!-- In Time Custom Picker -->
            <div class="w-36 sm:w-40">
              <label class="block text-[10px] font-bold uppercase text-slate-400 mb-0.5 flex items-center justify-between">
                <span>In Time</span>
                <span class="text-[9px] text-slate-400 font-medium">12-hr</span>
              </label>
              <div 
                id="picker-in-${dateStr}"
                class="custom-time-picker bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 flex items-center justify-between focus-within:ring-2 focus-within:ring-emerald-500 focus-within:bg-white focus-within:border-emerald-400 transition-all cursor-pointer shadow-sm"
                data-date="${dateStr}"
                data-field="in"
                data-index="${index}"
              >
                <div class="flex items-center space-x-0.5 font-mono-numbers">
                  <input 
                    type="text" 
                    inputmode="numeric" 
                    maxlength="2" 
                    placeholder="HH" 
                    value="${inParts.hour}" 
                    class="time-seg-input time-seg-hour w-6 text-center bg-transparent font-extrabold text-xs text-slate-800 focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="in"
                    data-seg="hour"
                    data-index="${index}"
                    aria-label="In Time Hour"
                  >
                  <span class="text-slate-400 font-black text-xs select-none">:</span>
                  <input 
                    type="text" 
                    inputmode="numeric" 
                    maxlength="2" 
                    placeholder="MM" 
                    value="${inParts.min}" 
                    class="time-seg-input time-seg-min w-6 text-center bg-transparent font-extrabold text-xs text-slate-800 focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="in"
                    data-seg="min"
                    data-index="${index}"
                    aria-label="In Time Minute"
                  >
                  <input 
                    type="text" 
                    maxlength="2" 
                    placeholder="AM" 
                    value="${inParts.ampm}" 
                    class="time-seg-input time-seg-ampm w-7 text-center bg-transparent font-black text-[11px] text-slate-700 uppercase focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="in"
                    data-seg="ampm"
                    data-index="${index}"
                    aria-label="In Time AM or PM"
                  >
                </div>
                <button 
                  type="button" 
                  tabindex="-1"
                  class="picker-toggle-btn text-slate-400 hover:text-emerald-600 p-0.5 text-xs transition-colors shrink-0"
                  title="Open Time Picker"
                >
                  <i class="fa-regular fa-clock"></i>
                </button>
              </div>
            </div>

            <!-- Out Time Custom Picker -->
            <div class="w-36 sm:w-40">
              <label class="block text-[10px] font-bold uppercase text-slate-400 mb-0.5 flex items-center justify-between">
                <span>Out Time</span>
                <span class="text-[9px] text-slate-400 font-medium">12-hr</span>
              </label>
              <div 
                id="picker-out-${dateStr}"
                class="custom-time-picker bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between focus-within:ring-2 focus-within:ring-emerald-500 focus-within:bg-white focus-within:border-emerald-400 transition-all cursor-pointer shadow-sm"
                data-date="${dateStr}"
                data-field="out"
                data-index="${index}"
              >
                <div class="flex items-center space-x-0.5 font-mono-numbers">
                  <input 
                    type="text" 
                    inputmode="numeric" 
                    maxlength="2" 
                    placeholder="HH" 
                    value="${outParts.hour}" 
                    class="time-seg-input time-seg-hour w-6 text-center bg-transparent font-extrabold text-xs text-slate-800 focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="out"
                    data-seg="hour"
                    data-index="${index}"
                    aria-label="Out Time Hour"
                  >
                  <span class="text-slate-400 font-black text-xs select-none">:</span>
                  <input 
                    type="text" 
                    inputmode="numeric" 
                    maxlength="2" 
                    placeholder="MM" 
                    value="${outParts.min}" 
                    class="time-seg-input time-seg-min w-6 text-center bg-transparent font-extrabold text-xs text-slate-800 focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="out"
                    data-seg="min"
                    data-index="${index}"
                    aria-label="Out Time Minute"
                  >
                  <input 
                    type="text" 
                    maxlength="2" 
                    placeholder="PM" 
                    value="${outParts.ampm}" 
                    class="time-seg-input time-seg-ampm w-7 text-center bg-transparent font-black text-[11px] text-slate-700 uppercase focus:outline-none focus:bg-emerald-100/80 focus:text-emerald-900 rounded select-all"
                    data-date="${dateStr}"
                    data-field="out"
                    data-seg="ampm"
                    data-index="${index}"
                    aria-label="Out Time AM or PM"
                  >
                </div>
                <button 
                  type="button" 
                  tabindex="-1"
                  class="picker-toggle-btn text-slate-400 hover:text-emerald-600 p-0.5 text-xs transition-colors shrink-0"
                  title="Open Time Picker"
                >
                  <i class="fa-regular fa-clock"></i>
                </button>
              </div>
            </div>

          </div>
          `}

          <!-- GROUP 3: Credit/Debit Badges + Action Buttons (Status, Adjust & Delete) -->
          <div class="flex items-center space-x-2 flex-wrap gap-y-1.5 shrink-0">
            ${finLabelsHTML}

            <div class="flex items-center space-x-1.5 shrink-0">
              <button 
                onclick="window.openStatusNotesModal('${dateStr}')" 
                class="px-2.5 py-1.5 rounded-xl ${status !== 'working' || notes ? 'bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold'} text-xs flex items-center space-x-1.5 transition-colors tap-active shrink-0"
                title="Edit Attendance Status & Daily Notes"
              >
                <i class="fa-solid fa-clipboard-list ${status !== 'working' || notes ? 'text-indigo-600' : 'text-slate-500'} text-[11px]"></i>
                <span class="inline">Status</span>
                ${notes ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Has daily note"></span>' : ''}
              </button>

              <button 
                onclick="window.openDayModal('${dateStr}')" 
                class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center space-x-1 transition-colors tap-active shrink-0"
                title="Add or Edit Credits & Debits"
              >
                <i class="fa-solid fa-coins text-amber-500 text-[11px]"></i>
                <span class="inline">Adjust (₹)</span>
              </button>

              <button 
                onclick="window.clearDayShift('${dateStr}')" 
                class="w-8 h-8 rounded-xl ${hasShiftLogged || status !== 'working' ? 'bg-rose-50 hover:bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'} flex items-center justify-center text-xs transition-colors tap-active shrink-0"
                title="Clear In/Out shift hours for this day"
              >
                <i class="fa-solid fa-trash-can text-[11px]"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  bindCustomTimePickerEvents();
}

// Clear specific day shift hours with mandatory Confirmation
window.clearDayShift = async (dateStr) => {
  if (!ledgerMap[dateStr]) return;
  
  const currentStatus = ledgerMap[dateStr].status || "working";
  if (!ledgerMap[dateStr].inTime && !ledgerMap[dateStr].outTime && currentStatus === "working") {
    showToast("Shift is already empty.", "info");
    return;
  }

  const confirmClear = window.confirm(`Are you sure you want to clear this day's entry (${dateStr})?`);
  if (!confirmClear) return;

  ledgerMap[dateStr].inTime = "";
  ledgerMap[dateStr].outTime = "";
  ledgerMap[dateStr].status = "working";

  closeTimePickerDropdown();
  renderLedgerDayCards();
  updateLiveSummary();
  await saveLedgerDayToFirestore(dateStr);
  showToast(`Cleared shift hours for ${dateStr}.`, "success");
};

// =========================================================================
// CUSTOM HYBRID TIME PICKER CONTROLLER (12-Hour Format, Touch & Keyboard)
// =========================================================================

let activeTimePicker = null; // { dateStr, field, seg, anchorEl }
let recentDigitBuffer = "";
let recentDigitTimer = null;

// Initialize popover dropdown columns once
export function initCustomTimePicker() {
  const hourList = document.getElementById("popover-list-hour");
  const minList = document.getElementById("popover-list-min");
  const ampmList = document.getElementById("popover-list-ampm");
  if (!hourList || !minList || !ampmList) return;

  // 1 to 12 Hours
  let hourHTML = "";
  for (let i = 1; i <= 12; i++) {
    const val = String(i).padStart(2, "0");
    hourHTML += `<button type="button" class="time-picker-item time-item-hour w-full py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 font-mono-numbers text-center" data-val="${val}">${val}</button>`;
  }
  hourList.innerHTML = hourHTML;

  // 00 to 59 Minutes
  let minHTML = "";
  for (let i = 0; i < 60; i++) {
    const val = String(i).padStart(2, "0");
    minHTML += `<button type="button" class="time-picker-item time-item-min w-full py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 font-mono-numbers text-center" data-val="${val}">${val}</button>`;
  }
  minList.innerHTML = minHTML;

  // AM and PM
  ampmList.innerHTML = `
    <button type="button" class="time-picker-item time-item-ampm w-full py-2.5 rounded-xl text-xs font-black text-slate-800 hover:bg-emerald-50 hover:text-emerald-700 uppercase text-center" data-val="AM">AM</button>
    <button type="button" class="time-picker-item time-item-ampm w-full py-2.5 rounded-xl text-xs font-black text-slate-800 hover:bg-emerald-50 hover:text-emerald-700 uppercase text-center" data-val="PM">PM</button>
  `;

  // Item click/tap listeners inside popover
  hourList.addEventListener("click", (e) => {
    const btn = e.target.closest(".time-item-hour");
    if (!btn || !activeTimePicker) return;
    setTimeSegmentValue("hour", btn.dataset.val, true);
  });

  minList.addEventListener("click", (e) => {
    const btn = e.target.closest(".time-item-min");
    if (!btn || !activeTimePicker) return;
    setTimeSegmentValue("min", btn.dataset.val, true);
  });

  ampmList.addEventListener("click", (e) => {
    const btn = e.target.closest(".time-item-ampm");
    if (!btn || !activeTimePicker) return;
    setTimeSegmentValue("ampm", btn.dataset.val, false);
  });

  // Header quick buttons
  document.getElementById("popover-clear-btn")?.addEventListener("click", () => {
    clearActivePickerTime();
  });

  document.getElementById("popover-done-btn")?.addEventListener("click", () => {
    commitActivePickerAndAdvance();
  });

  // Global dismiss when clicking outside
  document.addEventListener("pointerdown", (e) => {
    const popover = document.getElementById("custom-time-picker-popover");
    if (!popover || popover.classList.contains("hidden")) return;
    if (popover.contains(e.target)) return;
    if (e.target.closest(".custom-time-picker")) return;
    closeTimePickerDropdown();
  });

  // Window resize & scroll reposition
  window.addEventListener("resize", () => {
    if (activeTimePicker && activeTimePicker.anchorEl) {
      positionTimePickerDropdown(activeTimePicker.anchorEl);
    }
  }, { passive: true });

  window.addEventListener("scroll", () => {
    if (activeTimePicker && activeTimePicker.anchorEl) {
      positionTimePickerDropdown(activeTimePicker.anchorEl);
    }
  }, { passive: true });
}

export function openTimePickerDropdown(dateStr, field, segName = "hour") {
  const anchorEl = document.getElementById(`picker-${field}-${dateStr}`);
  const popover = document.getElementById("custom-time-picker-popover");
  if (!anchorEl || !popover) return;

  activeTimePicker = { dateStr, field, seg: segName, anchorEl };

  popover.classList.remove("hidden");
  positionTimePickerDropdown(anchorEl);

  syncPopoverSelection();
  highlightActivePopoverColumn(segName);
}

export function closeTimePickerDropdown() {
  const popover = document.getElementById("custom-time-picker-popover");
  if (popover) popover.classList.add("hidden");
  activeTimePicker = null;
  recentDigitBuffer = "";
}

function positionTimePickerDropdown(anchorEl) {
  const popover = document.getElementById("custom-time-picker-popover");
  if (!popover || !anchorEl) return;

  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 288;
  const popoverHeight = 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.left;
  if (left + popoverWidth > vw - 12) {
    left = vw - popoverWidth - 12;
  }
  if (left < 12) left = 12;

  let top = rect.bottom + 6;
  if (top + popoverHeight > vh - 12 && rect.top - popoverHeight - 6 > 0) {
    top = rect.top - popoverHeight - 6;
  }

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function syncPopoverSelection() {
  if (!activeTimePicker || !activeTimePicker.anchorEl) return;
  const { anchorEl } = activeTimePicker;

  const hourInput = anchorEl.querySelector('.time-seg-hour');
  const minInput = anchorEl.querySelector('.time-seg-min');
  const ampmInput = anchorEl.querySelector('.time-seg-ampm');

  const curHour = hourInput && hourInput.value ? hourInput.value.padStart(2, '0') : '';
  const curMin = minInput && minInput.value ? minInput.value.padStart(2, '0') : '';
  const curAmpm = ampmInput ? ampmInput.value.toUpperCase() : '';

  // Update header preview
  const displayEl = document.getElementById("popover-time-display");
  if (displayEl) {
    displayEl.textContent = `${curHour || '--'}:${curMin || '--'} ${curAmpm || '--'}`;
  }

  // Update Hour selection & scroll
  const hourButtons = document.querySelectorAll(".time-item-hour");
  hourButtons.forEach(btn => {
    const isSel = btn.dataset.val === curHour;
    btn.classList.toggle("selected", isSel);
    if (isSel) {
      btn.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  // Update Min selection & scroll
  const minButtons = document.querySelectorAll(".time-item-min");
  minButtons.forEach(btn => {
    const isSel = btn.dataset.val === curMin;
    btn.classList.toggle("selected", isSel);
    if (isSel) {
      btn.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  // Update AM/PM selection
  const ampmButtons = document.querySelectorAll(".time-item-ampm");
  ampmButtons.forEach(btn => {
    const isSel = btn.dataset.val === curAmpm;
    btn.classList.toggle("selected", isSel);
  });
}

function highlightActivePopoverColumn(segName) {
  const hHour = document.getElementById("popover-col-header-hour");
  const hMin = document.getElementById("popover-col-header-min");
  const hAmpm = document.getElementById("popover-col-header-ampm");

  const lHour = document.getElementById("popover-list-hour");
  const lMin = document.getElementById("popover-list-min");
  const lAmpm = document.getElementById("popover-list-ampm");

  if (!hHour || !hMin || !hAmpm) return;

  hHour.className = "text-[10px] font-extrabold uppercase py-1 transition-colors " + (segName === "hour" ? "text-emerald-700 font-black" : "text-slate-400");
  hMin.className = "text-[10px] font-extrabold uppercase py-1 transition-colors " + (segName === "min" ? "text-emerald-700 font-black" : "text-slate-400");
  hAmpm.className = "text-[10px] font-extrabold uppercase py-1 transition-colors " + (segName === "ampm" ? "text-emerald-700 font-black" : "text-slate-400");

  lHour?.classList.toggle("ring-2", segName === "hour");
  lHour?.classList.toggle("ring-emerald-500/40", segName === "hour");
  lMin?.classList.toggle("ring-2", segName === "min");
  lMin?.classList.toggle("ring-emerald-500/40", segName === "min");
  lAmpm?.classList.toggle("ring-2", segName === "ampm");
  lAmpm?.classList.toggle("ring-emerald-500/40", segName === "ampm");
}

function setTimeSegmentValue(segName, value, shouldAdvance = false) {
  if (!activeTimePicker || !activeTimePicker.anchorEl) return;
  const { dateStr, field, anchorEl } = activeTimePicker;

  const targetInput = anchorEl.querySelector(`.time-seg-${segName}`);
  if (targetInput) {
    targetInput.value = value;
    targetInput.select();
  }

  // If setting hour and min is empty, default min to "00"
  const minInput = anchorEl.querySelector(".time-seg-min");
  if (segName === "hour" && minInput && !minInput.value) {
    minInput.value = "00";
  }

  // If setting hour or min and ampm is empty, default ampm
  const ampmInput = anchorEl.querySelector(".time-seg-ampm");
  if ((segName === "hour" || segName === "min") && ampmInput && !ampmInput.value) {
    ampmInput.value = (field === "in" ? "AM" : "PM");
  }

  commitPickerToLedger(dateStr, field);
  syncPopoverSelection();

  if (shouldAdvance) {
    if (segName === "hour") {
      focusTimeSegment(dateStr, field, "min");
    } else if (segName === "min") {
      focusTimeSegment(dateStr, field, "ampm");
    } else if (segName === "ampm") {
      commitActivePickerAndAdvance();
    }
  }
}

function focusTimeSegment(dateStr, field, segName) {
  const anchorEl = document.getElementById(`picker-${field}-${dateStr}`);
  if (!anchorEl) return;
  const input = anchorEl.querySelector(`.time-seg-${segName}`);
  if (input) {
    input.focus();
    input.select();
  }
}

function commitPickerToLedger(dateStr, field, immediate = false) {
  const anchorEl = document.getElementById(`picker-${field}-${dateStr}`);
  if (!anchorEl) return;

  const hInput = anchorEl.querySelector('.time-seg-hour');
  const mInput = anchorEl.querySelector('.time-seg-min');
  const aInput = anchorEl.querySelector('.time-seg-ampm');

  const h = hInput ? hInput.value.trim() : "";
  const m = mInput ? mInput.value.trim() : "";
  const a = aInput ? aInput.value.trim().toUpperCase() : "";

  let timeString = "";
  if (h && m && a) {
    const numH = parseInt(h, 10);
    const numM = parseInt(m, 10);
    if (!isNaN(numH) && !isNaN(numM)) {
      const paddedH = String(numH).padStart(2, '0');
      const paddedM = String(numM).padStart(2, '0');
      timeString = `${paddedH}:${paddedM} ${a}`;
    }
  }

  if (!ledgerMap[dateStr]) {
    ledgerMap[dateStr] = {
      staffId: activeStaffId,
      dateStr: dateStr,
      inTime: "",
      outTime: "",
      status: "working",
      notes: "",
      credit: 0,
      creditNote: "",
      debit: 0,
      debitNote: ""
    };
  }

  if (field === "in") {
    ledgerMap[dateStr].inTime = timeString;
  } else {
    ledgerMap[dateStr].outTime = timeString;
  }

  // Live Math & Daily Wage
  const staff = staffList.find(s => s.id === activeStaffId);
  const stdHours = staff ? (staff.standardHours || 8) : 8;
  const hourlyWage = staff ? Number(staff.hourlyWage || 0) : 0;
  const shift = calculateShiftHours(ledgerMap[dateStr].inTime, ledgerMap[dateStr].outTime, stdHours);

  const mathPill = document.getElementById(`math-pill-${dateStr}`);
  const wagePill = document.getElementById(`daily-wage-${dateStr}`);

  if (mathPill) {
    if (shift) {
      const badges = getShiftBadgesHTML(shift, hourlyWage);
      mathPill.innerHTML = badges.mathPillHTML;
      if (wagePill) wagePill.innerHTML = badges.dailyWageHTML;
    } else if (ledgerMap[dateStr].inTime && !ledgerMap[dateStr].outTime) {
      mathPill.innerHTML = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 font-semibold text-xs animate-pulse">
          <i class="fa-solid fa-clock text-[10px]"></i>
          <span>Shift in progress...</span>
        </span>
      `;
      if (wagePill) wagePill.innerHTML = "";
    } else {
      mathPill.innerHTML = "";
      if (wagePill) wagePill.innerHTML = "";
    }
  }

  updateLiveSummary();

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveLedgerDayToFirestore(dateStr);
  }, immediate ? 100 : 700);
}

function clearActivePickerTime() {
  if (!activeTimePicker) return;
  const { dateStr, field, anchorEl } = activeTimePicker;

  const hInput = anchorEl.querySelector('.time-seg-hour');
  const mInput = anchorEl.querySelector('.time-seg-min');
  const aInput = anchorEl.querySelector('.time-seg-ampm');

  if (hInput) hInput.value = "";
  if (mInput) mInput.value = "";
  if (aInput) aInput.value = "";

  commitPickerToLedger(dateStr, field, true);
  syncPopoverSelection();
  closeTimePickerDropdown();
}

function commitActivePickerAndAdvance() {
  if (!activeTimePicker) return;
  const { dateStr, field } = activeTimePicker;

  commitPickerToLedger(dateStr, field, true);
  closeTimePickerDropdown();

  // Find next picker: In -> Out of same day; Out -> In of next day
  const dates = generateDateRangeArray(currentFromDate, currentToDate);
  const curDateIndex = dates.indexOf(dateStr);

  let nextDateStr = null;
  let nextField = null;

  if (field === "in") {
    nextDateStr = dateStr;
    nextField = "out";
  } else {
    if (curDateIndex !== -1 && curDateIndex < dates.length - 1) {
      nextDateStr = dates[curDateIndex + 1];
      nextField = "in";
    }
  }

  if (nextDateStr && nextField) {
    const nextAnchor = document.getElementById(`picker-${nextField}-${nextDateStr}`);
    if (nextAnchor) {
      nextAnchor.scrollIntoView({ behavior: "smooth", block: "center" });
      const nextHourInput = nextAnchor.querySelector(".time-seg-hour");
      if (nextHourInput) {
        setTimeout(() => {
          nextHourInput.focus();
          nextHourInput.select();
        }, 50);
      }
    }
  } else {
    showToast("Reached end of selected month!", "success");
  }
}

function bindCustomTimePickerEvents() {
  const pickers = document.querySelectorAll(".custom-time-picker");

  pickers.forEach((picker) => {
    const dateStr = picker.dataset.date;
    const field = picker.dataset.field;

    // Clicking anywhere on the picker wrapper focuses hour segment
    picker.addEventListener("click", (e) => {
      if (!e.target.classList.contains("time-seg-input")) {
        const hourInput = picker.querySelector(".time-seg-hour");
        if (hourInput) {
          hourInput.focus();
          hourInput.select();
        }
      }
    });

    // Toggle button opens/toggles dropdown
    const toggleBtn = picker.querySelector(".picker-toggle-btn");
    toggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const hourInput = picker.querySelector(".time-seg-hour");
      if (hourInput) {
        hourInput.focus();
        hourInput.select();
      }
    });

    const segments = [
      { input: picker.querySelector(".time-seg-hour"), name: "hour" },
      { input: picker.querySelector(".time-seg-min"), name: "min" },
      { input: picker.querySelector(".time-seg-ampm"), name: "ampm" }
    ];

    segments.forEach(({ input, name }) => {
      if (!input) return;

      input.addEventListener("focus", () => {
        openTimePickerDropdown(dateStr, field, name);
        input.select();
      });

      input.addEventListener("click", (e) => {
        e.stopPropagation();
        openTimePickerDropdown(dateStr, field, name);
        input.select();
      });

      input.addEventListener("keydown", (e) => {
        // ENTER KEY: confirms current segment and advances
        if (e.key === "Enter" || e.keyCode === 13) {
          e.preventDefault();
          if (name === "hour") {
            if (!input.value) {
              input.value = "09";
            } else {
              input.value = String(parseInt(input.value, 10)).padStart(2, "0");
            }
            commitPickerToLedger(dateStr, field);
            focusTimeSegment(dateStr, field, "min");
          } else if (name === "min") {
            if (!input.value) {
              input.value = "00";
            } else {
              input.value = String(parseInt(input.value, 10)).padStart(2, "0");
            }
            commitPickerToLedger(dateStr, field);
            focusTimeSegment(dateStr, field, "ampm");
          } else if (name === "ampm") {
            if (!input.value) {
              input.value = (field === "in" ? "AM" : "PM");
            }
            commitPickerToLedger(dateStr, field, true);
            commitActivePickerAndAdvance();
          }
          return;
        }

        // LEFT ARROW: shift focus backwards
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (name === "min") focusTimeSegment(dateStr, field, "hour");
          else if (name === "ampm") focusTimeSegment(dateStr, field, "min");
          return;
        }

        // RIGHT ARROW: shift focus forward
        if (e.key === "ArrowRight") {
          e.preventDefault();
          if (name === "hour") focusTimeSegment(dateStr, field, "min");
          else if (name === "min") focusTimeSegment(dateStr, field, "ampm");
          return;
        }

        // UP ARROW: increment values
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (name === "hour") {
            let cur = parseInt(input.value, 10) || 12;
            cur = cur >= 12 ? 1 : cur + 1;
            setTimeSegmentValue("hour", String(cur).padStart(2, "0"));
          } else if (name === "min") {
            let cur = parseInt(input.value, 10);
            if (isNaN(cur)) cur = 0;
            else cur = cur >= 59 ? 0 : cur + 1;
            setTimeSegmentValue("min", String(cur).padStart(2, "0"));
          } else if (name === "ampm") {
            const next = input.value === "AM" ? "PM" : "AM";
            setTimeSegmentValue("ampm", next);
          }
          return;
        }

        // DOWN ARROW: decrement values
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (name === "hour") {
            let cur = parseInt(input.value, 10) || 1;
            cur = cur <= 1 ? 12 : cur - 1;
            setTimeSegmentValue("hour", String(cur).padStart(2, "0"));
          } else if (name === "min") {
            let cur = parseInt(input.value, 10);
            if (isNaN(cur)) cur = 0;
            else cur = cur <= 0 ? 59 : cur - 1;
            setTimeSegmentValue("min", String(cur).padStart(2, "0"));
          } else if (name === "ampm") {
            const next = input.value === "AM" ? "PM" : "AM";
            setTimeSegmentValue("ampm", next);
          }
          return;
        }

        // BACKSPACE
        if (e.key === "Backspace") {
          if (!input.value) {
            e.preventDefault();
            if (name === "min") focusTimeSegment(dateStr, field, "hour");
            else if (name === "ampm") focusTimeSegment(dateStr, field, "min");
          } else {
            input.value = "";
            commitPickerToLedger(dateStr, field);
            syncPopoverSelection();
          }
          return;
        }

        // ESCAPE: dismiss popover
        if (e.key === "Escape") {
          closeTimePickerDropdown();
          return;
        }

        // AM/PM LETTERS
        if (name === "ampm") {
          if (e.key.toLowerCase() === "a") {
            e.preventDefault();
            setTimeSegmentValue("ampm", "AM");
            return;
          }
          if (e.key.toLowerCase() === "p") {
            e.preventDefault();
            setTimeSegmentValue("ampm", "PM");
            return;
          }
        }

        // NUMBERS (0-9) ON HOUR & MIN
        if ((name === "hour" || name === "min") && /^\d$/.test(e.key)) {
          e.preventDefault();
          const digit = e.key;

          if (recentDigitTimer) clearTimeout(recentDigitTimer);

          if (name === "hour") {
            if (recentDigitBuffer && (recentDigitBuffer === "0" || recentDigitBuffer === "1")) {
              const combined = parseInt(recentDigitBuffer + digit, 10);
              if (combined >= 1 && combined <= 12) {
                setTimeSegmentValue("hour", String(combined).padStart(2, "0"));
                recentDigitBuffer = "";
              } else {
                const val = digit === "0" ? "12" : String(digit).padStart(2, "0");
                setTimeSegmentValue("hour", val);
                recentDigitBuffer = digit;
              }
            } else {
              if (digit === "0" || digit === "1") {
                setTimeSegmentValue("hour", "0" + digit);
                recentDigitBuffer = digit;
              } else {
                // Digits 2 through 9 instantly snap to 02-09
                setTimeSegmentValue("hour", "0" + digit);
                recentDigitBuffer = "";
              }
            }
          } else if (name === "min") {
            if (recentDigitBuffer && parseInt(recentDigitBuffer, 10) >= 0 && parseInt(recentDigitBuffer, 10) <= 5) {
              const combined = parseInt(recentDigitBuffer + digit, 10);
              if (combined >= 0 && combined <= 59) {
                setTimeSegmentValue("min", String(combined).padStart(2, "0"));
                recentDigitBuffer = "";
              } else {
                setTimeSegmentValue("min", "0" + digit);
                recentDigitBuffer = digit;
              }
            } else {
              setTimeSegmentValue("min", "0" + digit);
              recentDigitBuffer = digit;
            }
          }

          recentDigitTimer = setTimeout(() => {
            recentDigitBuffer = "";
          }, 750);
        }
      });
    });
  });
}

async function saveLedgerDayToFirestore(dateStr) {
  if (!activeStaffId || !dateStr) return;
  const entry = ledgerMap[dateStr];
  if (!entry) return;

  const docId = `${activeStaffId}_${dateStr}`;
  try {
    await setDoc(doc(db, "ledger", docId), {
      staffId: activeStaffId,
      dateStr: dateStr,
      inTime: entry.inTime || null,
      outTime: entry.outTime || null,
      status: entry.status || "working",
      notes: entry.notes || "",
      credit: Number(entry.credit || 0),
      creditNote: entry.creditNote || "",
      debit: Number(entry.debit || 0),
      debitNote: entry.debitNote || "",
      // Backward compatibility mirror
      allowance: Number(entry.credit || 0),
      allowanceNote: entry.creditNote || "",
      deduction: Number(entry.debit || 0),
      deductionNote: entry.debitNote || "",
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error("Autosave ledger error:", err);
    showToast("Error saving to database: " + err.message, "error");
  }
}

// =========================================================================
// 3. THE PAYOUT CALCULATOR & SUMMARY CARD (Debits & Credits)
// =========================================================================

function updateLiveSummary() {
  const staff = staffList.find(s => s.id === activeStaffId);
  const wage = staff ? Number(staff.hourlyWage || 0) : 0;
  const stdHours = staff ? Number(staff.standardHours || 8) : 8;

  let totalRegMinutes = 0;
  let totalOtMinutes = 0;
  let totalCredits = 0;
  let totalDebits = 0;

  const dates = generateDateRangeArray(currentFromDate, currentToDate);

  dates.forEach((dateStr) => {
    const entry = ledgerMap[dateStr];
    if (entry) {
      const status = entry.status || "working";
      if (status === "weekoff" || status === "holiday") {
        totalRegMinutes += Math.round(stdHours * 60);
      } else if (status === "working") {
        const shift = calculateShiftHours(entry.inTime, entry.outTime, stdHours);
        if (shift) {
          totalRegMinutes += shift.regMinutes;
          totalOtMinutes += shift.otMinutes;
        }
      }
      // Note: If status === "leave", 0 hours/minutes added to regular & OT
      totalCredits += Number(entry.credit || 0);
      totalDebits += Number(entry.debit || 0);
    }
  });

  const regWage = (totalRegMinutes / 60) * wage;
  const otWage = (totalOtMinutes / 60) * wage; // Flat hourly wage, no OT multiplier
  const grossPay = regWage + otWage;
  // Formula: (Reg Wage + OT Wage + Credits) - Debits rounded to nearest Rupee
  const finalPayout = Math.max(0, Math.round(grossPay + totalCredits - totalDebits));

  // Update UI Elements
  const payoutEl = document.getElementById("summary-final-payout");
  const regHoursEl = document.getElementById("summary-reg-hours");
  const regWageEl = document.getElementById("summary-reg-wage");
  const otHoursEl = document.getElementById("summary-ot-hours");
  const otWageEl = document.getElementById("summary-ot-wage");
  const creditTotalEl = document.getElementById("summary-total-credits");
  const debitTotalEl = document.getElementById("summary-total-debits");

  if (payoutEl) payoutEl.textContent = `${APP_CONFIG.currency}${finalPayout.toLocaleString("en-IN")}`;
  if (regHoursEl) regHoursEl.textContent = formatMinutesToDuration(totalRegMinutes);
  if (regWageEl) regWageEl.textContent = `${APP_CONFIG.currency}${Math.round(regWage).toLocaleString("en-IN")}`;
  if (otHoursEl) otHoursEl.textContent = formatMinutesToDuration(totalOtMinutes);
  if (otWageEl) otWageEl.textContent = `${APP_CONFIG.currency}${Math.round(otWage).toLocaleString("en-IN")}`;
  if (creditTotalEl) creditTotalEl.textContent = `+${APP_CONFIG.currency}${totalCredits.toLocaleString("en-IN")}`;
  if (debitTotalEl) debitTotalEl.textContent = `-${APP_CONFIG.currency}${totalDebits.toLocaleString("en-IN")}`;
}

// =========================================================================
// 4. FINANCIAL ENTRIES CRUD (Credits & Debits with Note/Reason)
// =========================================================================

window.openDayModal = (dateStr) => {
  activeDayModalDate = dateStr;
  const entry = ledgerMap[dateStr] || {};
  const { dayName, dayNum, monthName, year } = formatDayDetails(dateStr);

  document.getElementById("day-modal-title").textContent = `Adjustments: ${dayName}, ${dayNum} ${monthName} ${year}`;
  document.getElementById("day-modal-credit").value = entry.credit || "";
  document.getElementById("day-modal-credit-note").value = entry.creditNote || "";
  document.getElementById("day-modal-debit").value = entry.debit || "";
  document.getElementById("day-modal-debit-note").value = entry.debitNote || "";

  document.getElementById("day-modal").classList.add("active");
};

function closeDayModal() {
  document.getElementById("day-modal").classList.remove("active");
  activeDayModalDate = null;
}

// Save Daily Credit and Debit - FIX: Preserves targetDate before closeDayModal
async function saveDayFinancials() {
  const targetDate = activeDayModalDate;
  if (!targetDate || !activeStaffId) return;

  const credit = Number(document.getElementById("day-modal-credit").value) || 0;
  const creditNote = document.getElementById("day-modal-credit-note").value.trim();
  const debit = Number(document.getElementById("day-modal-debit").value) || 0;
  const debitNote = document.getElementById("day-modal-debit-note").value.trim();

  if (!ledgerMap[targetDate]) {
    ledgerMap[targetDate] = {
      staffId: activeStaffId,
      dateStr: targetDate,
      inTime: "",
      outTime: "",
      status: "working",
      notes: "",
      credit: 0,
      creditNote: "",
      debit: 0,
      debitNote: ""
    };
  }

  ledgerMap[targetDate].credit = credit;
  ledgerMap[targetDate].creditNote = creditNote;
  ledgerMap[targetDate].debit = debit;
  ledgerMap[targetDate].debitNote = debitNote;

  // Save to Firestore first while targetDate is valid
  await saveLedgerDayToFirestore(targetDate);

  closeDayModal();
  renderLedgerDayCards();
  updateLiveSummary();
  showToast("Saved Credit & Debit adjustments!", "success");
}

// Clear Credit with confirmation
async function clearDayCredit() {
  const targetDate = activeDayModalDate;
  if (!targetDate || !ledgerMap[targetDate]) return;

  if (!window.confirm("Are you sure you want to remove this Credit entry?")) return;

  ledgerMap[targetDate].credit = 0;
  ledgerMap[targetDate].creditNote = "";
  document.getElementById("day-modal-credit").value = "";
  document.getElementById("day-modal-credit-note").value = "";

  await saveLedgerDayToFirestore(targetDate);
  renderLedgerDayCards();
  updateLiveSummary();
  showToast("Credit removed.", "info");
}

// Clear Debit with confirmation
async function clearDayDebit() {
  const targetDate = activeDayModalDate;
  if (!targetDate || !ledgerMap[targetDate]) return;

  if (!window.confirm("Are you sure you want to remove this Debit entry?")) return;

  ledgerMap[targetDate].debit = 0;
  ledgerMap[targetDate].debitNote = "";
  document.getElementById("day-modal-debit").value = "";
  document.getElementById("day-modal-debit-note").value = "";

  await saveLedgerDayToFirestore(targetDate);
  renderLedgerDayCards();
  updateLiveSummary();
  showToast("Debit removed.", "info");
}

// Clear All Financials for Date with confirmation
async function clearAllDayFinancials() {
  const targetDate = activeDayModalDate;
  if (!targetDate || !activeStaffId) return;

  if (!window.confirm(`Are you sure you want to clear all Credits and Debits for this day?`)) {
    return;
  }

  if (ledgerMap[targetDate]) {
    ledgerMap[targetDate].credit = 0;
    ledgerMap[targetDate].creditNote = "";
    ledgerMap[targetDate].debit = 0;
    ledgerMap[targetDate].debitNote = "";
  }

  await saveLedgerDayToFirestore(targetDate);
  closeDayModal();
  renderLedgerDayCards();
  updateLiveSummary();
  showToast("All Credits and Debits cleared for this day.", "info");
}

// =========================================================================
// 5. ATTENDANCE STATUS & DAILY NOTES CRUD
// =========================================================================

let activeStatusNotesDate = null;

window.openStatusNotesModal = (dateStr) => {
  activeStatusNotesDate = dateStr;
  const entry = ledgerMap[dateStr] || {};
  const { dayName, dayNum, monthName, year } = formatDayDetails(dateStr);

  const titleEl = document.getElementById("status-notes-modal-title");
  if (titleEl) {
    titleEl.textContent = `Status & Notes: ${dayName}, ${dayNum} ${monthName} ${year}`;
  }

  const currentStatus = entry.status || "working";
  const radios = document.querySelectorAll('input[name="modal-attendance-status"]');
  radios.forEach((r) => {
    r.checked = (r.value === currentStatus);
  });

  const textareaEl = document.getElementById("status-notes-textarea");
  if (textareaEl) {
    textareaEl.value = entry.notes || "";
  }

  document.getElementById("status-notes-modal")?.classList.add("active");
};

function closeStatusNotesModal() {
  document.getElementById("status-notes-modal")?.classList.remove("active");
  activeStatusNotesDate = null;
}

async function saveStatusNotes() {
  const targetDate = activeStatusNotesDate;
  if (!targetDate || !activeStaffId) return;

  const selectedRadio = document.querySelector('input[name="modal-attendance-status"]:checked');
  const status = selectedRadio ? selectedRadio.value : "working";
  const notes = (document.getElementById("status-notes-textarea")?.value || "").trim();

  if (!ledgerMap[targetDate]) {
    ledgerMap[targetDate] = {
      staffId: activeStaffId,
      dateStr: targetDate,
      inTime: "",
      outTime: "",
      status: "working",
      notes: "",
      credit: 0,
      creditNote: "",
      debit: 0,
      debitNote: ""
    };
  }

  ledgerMap[targetDate].status = status;
  ledgerMap[targetDate].notes = notes;

  // Surgical Firestore save with merge: true preserving existing entries
  await saveLedgerDayToFirestore(targetDate);

  closeStatusNotesModal();
  renderLedgerDayCards();
  updateLiveSummary();
  showToast(`Saved attendance status & notes for ${targetDate}.`, "success");
}

// =========================================================================
// 6. INTERACTIVE SUMMARY BREAKDOWN MODALS (Credits & Debits)
// =========================================================================

function openBreakdownModal(type) {
  const isCredit = type === "credit";
  const titleEl = document.getElementById("breakdown-modal-title");
  const listEl = document.getElementById("breakdown-modal-list");
  const totalEl = document.getElementById("breakdown-modal-total");

  titleEl.textContent = isCredit ? "Credits Breakdown" : "Debits Breakdown";

  const dates = generateDateRangeArray(currentFromDate, currentToDate);
  const items = [];
  let totalSum = 0;

  dates.forEach((dateStr) => {
    const entry = ledgerMap[dateStr];
    if (entry) {
      const amount = isCredit ? Number(entry.credit || 0) : Number(entry.debit || 0);
      const note = isCredit ? entry.creditNote : entry.debitNote;

      if (amount > 0) {
        totalSum += amount;
        items.push({ dateStr, amount, note });
      }
    }
  });

  totalEl.textContent = `${isCredit ? '+' : '-'}${APP_CONFIG.currency}${totalSum.toLocaleString("en-IN")}`;
  totalEl.className = isCredit ? "text-emerald-600 font-extrabold text-lg font-mono-numbers" : "text-rose-600 font-extrabold text-lg font-mono-numbers";

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="py-12 text-center text-slate-400 text-sm font-medium">
        No ${isCredit ? 'Credits' : 'Debits'} recorded in this period.
      </div>
    `;
  } else {
    listEl.innerHTML = items.map((item) => {
      const { dayName, dayNum, monthName, year } = formatDayDetails(item.dateStr);
      return `
        <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
          <div class="grow">
            <div class="text-xs font-bold text-slate-900">${dayName}, ${dayNum} ${monthName} ${year}</div>
            <div class="text-xs text-slate-500 mt-0.5">${item.note || (isCredit ? "Daily credit" : "Debit / advance")}</div>
          </div>
          <div class="flex items-center space-x-3 shrink-0">
            <span class="text-sm font-black font-mono-numbers ${isCredit ? 'text-emerald-700' : 'text-rose-700'}">
              ${isCredit ? '+' : '-'}${APP_CONFIG.currency}${item.amount.toLocaleString("en-IN")}
            </span>
            <button 
              onclick="closeBreakdownModal(); window.openDayModal('${item.dateStr}');" 
              class="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold tap-active"
              title="Edit or Delete this entry"
            >
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  document.getElementById("breakdown-modal").classList.add("active");
}

window.closeBreakdownModal = function() {
  document.getElementById("breakdown-modal").classList.remove("active");
};

function renderEmptyState() {
  const container = document.getElementById("ledger-cards-container");
  if (container) {
    container.innerHTML = `
      <div class="py-20 px-6 text-center space-y-4 bg-white rounded-3xl border border-slate-200 card-shadow">
        <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-3xl mx-auto shadow-inner">
          <i class="fa-solid fa-users"></i>
        </div>
        <div>
          <h3 class="text-lg font-extrabold text-slate-900">No Staff Members Found</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto mt-1">Click "Add Staff" in the header to create an employee with Standard Fixed Hours and Hourly Wage.</p>
        </div>
        <button onclick="document.getElementById('add-staff-btn').click()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/30 transition-all tap-active">
          <i class="fa-solid fa-plus mr-1.5"></i> Add Staff Member
        </button>
      </div>
    `;
  }
}
