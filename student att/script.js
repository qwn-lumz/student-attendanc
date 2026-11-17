const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "attendly_students_v2";
const HISTORY_KEY = "attendly_attendance_history_v1";
const STATUSES = ["Present", "Late", "Absent"];

const seedStudents = [
  { id: "001", name: "Juan Dela Cruz" },
  { id: "002", name: "Maria Santos" },
  { id: "003", name: "Pedro Reyes" },
  { id: "004", name: "Ana Garcia" },
  { id: "005", name: "Carlos Mendoza" },
  { id: "006", name: "Sofia Ramos" },
  { id: "007", name: "Miguel Torres" },
  { id: "008", name: "Lara Villanueva" }
];

/* ---------- Helpers ---------- */

// Escape user-entered text before putting it into innerHTML.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// Numeric-aware sorting so "2" comes before "10".
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byId = (a, b) => collator.compare(a.id, b.id);
const byName = (a, b) => collator.compare(a.name, b.name);

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
const todayKey = () => dateKey();
const isToday = (key) => key === todayKey();
const isFuture = (key) => key > todayKey();

function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d)) === key;
}

function formatDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
}

// "today" or the full date, for use inside sentences.
const dayLabel = (key) => (isToday(key) ? "today" : formatDate(key));

/* ---------- Storage ---------- */

let storageWarned = false;

function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageWarned = false;
    return true;
  } catch {
    if (!storageWarned) {
      storageWarned = true;
      showToast("Couldn't save to this browser (storage is full or blocked). Changes may be lost when you reload.", 5000);
    }
    return false;
  }
}

function loadStudents() {
  const fallback = () => seedStudents.map(s => ({ ...s, status: "" }));
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return fallback();
    const list = JSON.parse(saved);
    if (!Array.isArray(list)) return fallback();
    // Only id and name are stored; counts come from history, status from the selected date.
    return list
      .filter(s => s && s.id != null && s.name != null)
      .map(s => ({ id: String(s.id), name: String(s.name), status: "" }));
  } catch {
    return fallback();
  }
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    const list = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter(h => h && isValidDateKey(h.date) && Array.isArray(h.records))
      .map(h => ({
        date: h.date,
        records: h.records
          .filter(r => r && r.id != null)
          .map(r => ({
            id: String(r.id),
            name: String(r.name ?? ""),
            status: STATUSES.includes(r.status) ? r.status : ""
          }))
      }))
      // Drop blank dates created by older versions of the app.
      .filter(h => h.records.some(r => r.status))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

function saveStudents() {
  return safeSave(STORAGE_KEY, students.map(({ id, name }) => ({ id, name })));
}

function saveHistory() {
  return safeSave(HISTORY_KEY, history);
}

/* ---------- State ---------- */

let students = loadStudents();
let history = loadHistory();
let activeFilter = "All";
let activeView = "dashboard";
let selectedHistoryDate = null;
let selectedAttendanceDate = todayKey();
let selectedStudentIds = new Set();
let totalsMap = new Map();

let modalMode = "add";
let editingId = null;
let modalReturnFocus = null;
let confirmResolver = null;
let confirmReturnFocus = null;

/* ---------- History logic ---------- */

function getHistoryRecord(key) {
  return history.find(h => h.date === key);
}

function loadDateIntoStudents(key) {
  const record = getHistoryRecord(key);
  students = students.map(student => {
    const saved = record ? record.records.find(r => r.id === student.id) : null;
    return { ...student, status: saved ? saved.status : "" };
  });
}

// Saves the selected date. A date with no marked students is not stored at all,
// so opening dates never fills History with blank rows. Records of students who
// were removed from the active list are preserved.
function saveSelectedDateSnapshot() {
  const key = selectedAttendanceDate;
  const existing = getHistoryRecord(key);
  const kept = existing ? existing.records.filter(r => !students.some(s => s.id === r.id)) : [];
  const records = [
    ...kept,
    ...students.map(s => ({ id: s.id, name: s.name, status: s.status || "" }))
  ];

  const index = history.findIndex(h => h.date === key);
  if (!records.some(r => r.status)) {
    if (index >= 0) history.splice(index, 1);
  } else if (index >= 0) {
    history[index] = { date: key, records };
  } else {
    history.push({ date: key, records });
  }
  history.sort((a, b) => b.date.localeCompare(a.date));
  saveHistory();
}

function computeTotals() {
  const map = new Map();
  history.forEach(day => day.records.forEach(r => {
    if (!STATUSES.includes(r.status)) return;
    const t = map.get(r.id) || { present: 0, late: 0, absent: 0 };
    t[r.status.toLowerCase()] += 1;
    map.set(r.id, t);
  }));
  return map;
}

function studentTotals(student) {
  return totalsMap.get(student.id) || { present: 0, late: 0, absent: 0 };
}

// Late counts as attended. Returns null when the student has no records yet.
function attendancePct(student) {
  const t = studentTotals(student);
  const total = t.present + t.late + t.absent;
  return total ? ((t.present + t.late) / total) * 100 : null;
}

function pctText(student) {
  const pct = attendancePct(student);
  return pct === null ? "—" : `${Math.round(pct)}%`;
}

/* ---------- Derived numbers for the selected date ---------- */

function counts() {
  const c = { total: students.length, present: 0, late: 0, absent: 0 };
  students.forEach(s => {
    if (s.status === "Present") c.present++;
    else if (s.status === "Late") c.late++;
    else if (s.status === "Absent") c.absent++;
  });
  c.marked = c.present + c.late + c.absent;
  c.unmarked = c.total - c.marked;
  return c;
}

// Rate among students who have been marked (unmarked students are not counted as absent).
function rateOf(c) {
  return c.marked ? ((c.present + c.late) / c.marked) * 100 : null;
}

function todayRate() {
  if (isToday(selectedAttendanceDate)) return rateOf(counts());
  const record = getHistoryRecord(todayKey());
  if (!record) return null;
  const marked = record.records.filter(r => r.status);
  const attended = marked.filter(r => r.status !== "Absent").length;
  return marked.length ? (attended / marked.length) * 100 : null;
}

const rateText = (rate) => (rate === null ? "—" : `${Math.round(rate)}%`);

function statusClass(status) {
  return (status || "Unmarked").toLowerCase();
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => Array.from(w)[0]).join("").toUpperCase();
}

function filteredStudents(list = students) {
  let result = list;
  if (activeFilter !== "All") {
    result = result.filter(s => s.status === activeFilter);
  }
  if (activeView === "students") {
    const q = $("studentSearch").value.trim().toLowerCase();
    if (q) result = result.filter(s =>
      s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
    );
  }
  return result;
}

/* ---------- Rendering ---------- */

function updateHeader() {
  const label = dayLabel(selectedAttendanceDate);
  const data = {
    dashboard: ["Dashboard", "Attendance Overview", `Monitor attendance for ${label} at a glance.`],
    students: ["Students", "Student List", "Review student records and attendance history."],
    attendance: ["Attendance", "Record Attendance", `Select a status to update the records for ${label}.`],
    history: ["History", "Attendance History", "Review attendance records from previous days."]
  }[activeView];
  $("pageEyebrow").textContent = data[0];
  $("pageTitle").textContent = data[1];
  $("pageSubtitle").textContent = data[2];
  $("resetBtn").textContent = isToday(selectedAttendanceDate) ? "Reset Today" : "Reset This Date";
  $("summarySubtitle").textContent = `Attendance distribution for ${label}.`;
}

function renderSummary() {
  const c = counts();
  const rate = rateOf(c);
  const pctOfMarked = (n) => (c.marked ? Math.round((n / c.marked) * 100) : 0);

  $("totalStudents").textContent = c.total;
  $("presentCount").textContent = c.present;
  $("lateCount").textContent = c.late;
  $("absentCount").textContent = c.absent;
  $("presentPct").textContent = `${pctOfMarked(c.present)}%`;
  $("latePct").textContent = `${pctOfMarked(c.late)}%`;
  $("absentPct").textContent = `${pctOfMarked(c.absent)}%`;
  $("classRate").textContent = rateText(rate);
  $("legendPresent").textContent = c.present;
  $("legendLate").textContent = c.late;
  $("legendAbsent").textContent = c.absent;
  $("legendUnmarked").textContent = c.unmarked;
  $("markedProgress").textContent = c.total
    ? `${c.marked} of ${c.total} student${c.total === 1 ? "" : "s"} marked`
    : "No students yet";

  const deg = (n) => (c.total ? (n / c.total) * 360 : 0);
  const presentEnd = deg(c.present);
  const lateEnd = presentEnd + deg(c.late);
  const absentEnd = lateEnd + deg(c.absent);
  $("donut").style.background =
    `conic-gradient(var(--present) 0deg ${presentEnd}deg, var(--late) ${presentEnd}deg ${lateEnd}deg, ` +
    `var(--absent) ${lateEnd}deg ${absentEnd}deg, var(--unmarked) ${absentEnd}deg 360deg)`;
}

function renderSidebar() {
  const now = new Date();
  $("sidebarDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  $("footerDate").textContent = now.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  $("sidebarRate").textContent = rateText(todayRate());
}

function statusBadge(status) {
  if (!status) return `<span class="status-badge unmarked">Unmarked</span>`;
  const icon = status === "Present" ? "✓" : status === "Late" ? "◷" : "!";
  return `<span class="status-badge ${statusClass(status)}">${icon} ${esc(status)}</span>`;
}

function statusSelect(student) {
  return `
    <select class="status-select" data-action="status" data-id="${esc(student.id)}" aria-label="Attendance status for ${esc(student.name)}">
      <option value="">Unmarked</option>
      <option value="Present" ${student.status === "Present" ? "selected" : ""}>Present</option>
      <option value="Late" ${student.status === "Late" ? "selected" : ""}>Late</option>
      <option value="Absent" ${student.status === "Absent" ? "selected" : ""}>Absent</option>
    </select>
  `;
}

function studentRow(student, compact = false) {
  const totals = studentTotals(student);
  return `
    <tr>
      ${compact ? `<td class="select-column"><input type="checkbox" class="student-select" data-select-student="${esc(student.id)}" ${selectedStudentIds.has(student.id) ? "checked" : ""} aria-label="Select ${esc(student.name)}"></td><td><strong>${esc(student.id)}</strong></td>` : ""}
      <td>
        <div class="student-cell">
          <div class="avatar">${esc(initials(student.name))}</div>
          <div><strong>${esc(student.name)}</strong>${compact ? "" : `<div class="muted">${esc(student.id)}</div>`}</div>
        </div>
      </td>
      <td>${totals.present}</td>
      <td>${totals.absent}</td>
      <td>${totals.late}</td>
      <td><strong>${pctText(student)}</strong></td>
      <td>${statusBadge(student.status)}</td>
      <td>${statusSelect(student)}</td>
      ${compact ? `<td><div class="action-cell"><button class="btn btn-secondary btn-sm" data-edit-student="${esc(student.id)}">Edit</button><button class="btn btn-danger btn-sm delete-student-btn" data-delete-student="${esc(student.id)}">Remove</button></div></td>` : ""}
    </tr>
  `;
}

function renderAttendanceTable() {
  const list = filteredStudents().slice().sort(byName);
  $("attendanceTable").innerHTML = list.length
    ? list.map(s => studentRow(s)).join("")
    : `<tr><td colspan="8"><div class="empty-state">No students match this filter.</div></td></tr>`;
}

function renderStudentsTable() {
  const list = filteredStudents().slice().sort(byId);
  $("studentsTable").innerHTML = list.length
    ? list.map(s => studentRow(s, true)).join("")
    : `<tr><td colspan="10"><div class="empty-state">No students found.</div></td></tr>`;
  updateBulkSelectionUI();
}

function updateBulkSelectionUI() {
  const visible = filteredStudents().slice().sort(byId);
  const removeBtn = $("removeSelectedBtn");
  const selectAll = $("selectAllStudents");
  if (removeBtn) {
    removeBtn.disabled = selectedStudentIds.size === 0;
    removeBtn.textContent = `Remove Selected (${selectedStudentIds.size})`;
  }
  if (selectAll) {
    const visibleSelected = visible.filter(s => selectedStudentIds.has(s.id)).length;
    selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
  }
}

function renderAttendanceCards() {
  const list = filteredStudents().slice().sort(byName);
  $("attendanceCards").innerHTML = list.length
    ? list.map(s => `
      <div class="attendance-card">
        <div>
          <div class="name">${esc(s.name)}</div>
          <div class="id">${esc(s.id)} · ${pctText(s)} attendance</div>
        </div>
        <div class="attendance-card-actions">
          <button class="filter-btn ${s.status === "Present" ? "active" : ""}" data-set-status="Present" data-id="${esc(s.id)}">Present</button>
          <button class="filter-btn ${s.status === "Late" ? "active" : ""}" data-set-status="Late" data-id="${esc(s.id)}">Late</button>
          <button class="filter-btn ${s.status === "Absent" ? "active" : ""}" data-set-status="Absent" data-id="${esc(s.id)}">Absent</button>
        </div>
      </div>
    `).join("")
    : `<div class="empty-state">No students match this filter.</div>`;
}

function renderHistory() {
  const table = $("historyTable");
  const detailPanel = $("historyDetailPanel");

  if (!history.length) {
    table.innerHTML = `<tr><td colspan="6"><div class="history-empty">No attendance history has been saved yet.</div></td></tr>`;
    selectedHistoryDate = null;
    detailPanel.style.display = "none";
    return;
  }

  table.innerHTML = history.slice().sort((a, b) => b.date.localeCompare(a.date)).map(record => {
    const marked = record.records.filter(r => r.status);
    const present = marked.filter(r => r.status === "Present").length;
    const late = marked.filter(r => r.status === "Late").length;
    const absent = marked.filter(r => r.status === "Absent").length;
    const rate = marked.length ? `${Math.round(((present + late) / marked.length) * 100)}%` : "—";

    return `
      <tr>
        <td><strong>${formatDate(record.date)}</strong></td>
        <td>${present}</td>
        <td>${late}</td>
        <td>${absent}</td>
        <td><span class="history-rate">${rate}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm history-view-btn" data-history-date="${record.date}">View Details</button>
          <button class="btn btn-primary btn-sm history-edit-btn" data-edit-history-date="${record.date}">Edit</button>
        </td>
      </tr>
    `;
  }).join("");

  if (selectedHistoryDate && getHistoryRecord(selectedHistoryDate)) showHistoryDetail(selectedHistoryDate);
  else {
    selectedHistoryDate = null;
    detailPanel.style.display = "none";
  }
}

function showHistoryDetail(key) {
  const record = getHistoryRecord(key);
  if (!record) return;

  selectedHistoryDate = key;
  $("historyDetailPanel").style.display = "block";
  $("historyDetailTitle").textContent = formatDate(key);
  $("historyDetailSubtitle").textContent = "Attendance records saved for this date.";

  $("historyDetailTable").innerHTML = record.records
    .slice().sort(byId)
    .map(r => `
      <tr>
        <td><strong>${esc(r.id)}</strong></td>
        <td>${esc(r.name)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>
    `).join("");
}

function renderAttendanceDate() {
  const input = $("attendanceDate");
  input.max = todayKey();
  input.value = selectedAttendanceDate;
  $("attendanceDateText").textContent =
    `Recording attendance for ${formatDate(selectedAttendanceDate)}. Changes are saved for this date.`;
}

function render() {
  totalsMap = computeTotals();
  updateHeader();
  renderSummary();
  renderSidebar();
  renderAttendanceTable();
  renderStudentsTable();
  renderAttendanceCards();
  renderHistory();
  renderAttendanceDate();
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active-view"));
  $(`${activeView}View`).classList.add("active-view");
  document.querySelectorAll(".nav-item").forEach(btn => btn.classList.toggle("active", btn.dataset.view === activeView));
  document.querySelectorAll(".filter-btn").forEach(btn => {
    if (btn.dataset.filter) btn.classList.toggle("active", btn.dataset.filter === activeFilter);
  });
}

/* ---------- Actions ---------- */

function selectAttendanceDate(key) {
  if (!key) { renderAttendanceDate(); return; }
  if (isFuture(key)) {
    showToast("Attendance can't be recorded for a future date.");
    renderAttendanceDate();
    return;
  }
  selectedAttendanceDate = key;
  loadDateIntoStudents(key);
  render();
  showToast(getHistoryRecord(key)
    ? `Loaded attendance for ${formatDate(key)}.`
    : `No attendance recorded yet for ${formatDate(key)}.`);
}

function setStatus(id, newStatus) {
  const student = students.find(s => s.id === id);
  if (!student) return;

  student.status = STATUSES.includes(newStatus) ? newStatus : "";
  saveSelectedDateSnapshot();
  render();
  showToast(`${student.name} marked ${student.status || "Unmarked"} for ${dayLabel(selectedAttendanceDate)}.`);
}

function markAllPresent() {
  if (!students.length) { showToast("There are no students to mark."); return; }
  const pending = students.filter(s => !s.status);
  if (!pending.length) { showToast("Every student is already marked."); return; }
  pending.forEach(s => { s.status = "Present"; });
  saveSelectedDateSnapshot();
  render();
  showToast(`${pending.length} unmarked student${pending.length === 1 ? "" : "s"} marked Present for ${dayLabel(selectedAttendanceDate)}.`);
}

async function deleteStudents(ids) {
  const targets = students.filter(s => ids.includes(s.id));
  if (!targets.length) return;
  const names = targets.map(s => s.name);
  const preview = names.length <= 4 ? names.join(", ") : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;

  const ok = await confirmDialog({
    title: targets.length === 1 ? "Remove student?" : `Remove ${targets.length} students?`,
    message: `${preview}\n\nThey will be removed from the active student list. Their previous attendance history will be kept.`,
    confirmText: "Remove",
    danger: true
  });
  if (!ok) return;

  students = students.filter(s => !ids.includes(s.id));
  ids.forEach(id => selectedStudentIds.delete(id));
  saveStudents();
  render();
  showToast(targets.length === 1
    ? `${targets[0].name} was removed from the active student list.`
    : `${targets.length} students removed from the active student list.`);
}

/* ---------- Toast ---------- */

function showToast(message, duration = 2200) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

/* ---------- Modals (student form + confirm dialog) ---------- */

function syncInert() {
  const anyOpen = $("modalBackdrop").classList.contains("open") || $("confirmBackdrop").classList.contains("open");
  document.querySelector(".app-shell").inert = anyOpen;
}

function openModal(mode = "add", student = null) {
  modalMode = mode;
  editingId = student ? student.id : null;
  const editing = mode === "edit";

  $("studentForm").reset();
  $("modalTitle").textContent = editing ? "Edit Student" : "Add Student";
  $("modalDesc").textContent = editing
    ? "Update the student's name. The Student ID can't be changed."
    : "Add a student to the attendance list.";
  $("studentSubmit").textContent = editing ? "Save Changes" : "Add Student";
  $("studentId").value = editing ? student.id : "";
  $("studentName").value = editing ? student.name : "";
  $("studentId").disabled = editing;

  modalReturnFocus = document.activeElement;
  $("modalBackdrop").classList.add("open");
  syncInert();
  (editing ? $("studentName") : $("studentId")).focus();
}

function closeModal() {
  $("modalBackdrop").classList.remove("open");
  $("studentForm").reset();
  $("studentId").disabled = false;
  modalMode = "add";
  editingId = null;
  syncInert();
  if (modalReturnFocus && modalReturnFocus.focus) modalReturnFocus.focus();
}

function confirmDialog({ title, message, confirmText = "Confirm", danger = false }) {
  return new Promise(resolve => {
    if (confirmResolver) confirmResolver(false);
    confirmResolver = resolve;
    $("confirmTitle").textContent = title;
    $("confirmMessage").textContent = message;
    const okBtn = $("confirmOk");
    okBtn.textContent = confirmText;
    okBtn.className = `btn ${danger ? "btn-danger-solid" : "btn-primary"}`;
    confirmReturnFocus = document.activeElement;
    $("confirmBackdrop").classList.add("open");
    syncInert();
    $("confirmCancel").focus(); // safest default for destructive actions
  });
}

function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  $("confirmBackdrop").classList.remove("open");
  syncInert();
  if (confirmReturnFocus && confirmReturnFocus.focus) confirmReturnFocus.focus();
  resolve(result);
}

// Escape closes the top-most dialog; Tab is kept inside it.
document.addEventListener("keydown", (event) => {
  const confirmOpen = $("confirmBackdrop").classList.contains("open");
  const modalOpen = $("modalBackdrop").classList.contains("open");
  if (!confirmOpen && !modalOpen) return;
  const backdrop = confirmOpen ? $("confirmBackdrop") : $("modalBackdrop");

  if (event.key === "Escape") {
    event.preventDefault();
    if (confirmOpen) closeConfirm(false); else closeModal();
    return;
  }

  if (event.key === "Tab") {
    const focusable = [...backdrop.querySelectorAll("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")]
      .filter(el => !el.disabled && el.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!backdrop.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

/* ---------- CSV export / import ---------- */

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

function exportCsv() {
  if (!history.length && !students.length) { showToast("There is nothing to export yet."); return; }

  const activeIds = new Set(students.map(s => s.id));
  const seen = new Set();
  const rows = [["Date", "Student ID", "Student Name", "Status", "Active"]];

  history.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(day => {
    day.records.filter(r => r.status).slice().sort(byId).forEach(r => {
      seen.add(r.id);
      rows.push([day.date, r.id, r.name, r.status, activeIds.has(r.id) ? "Yes" : "No"]);
    });
  });
  // Active students with no records still go in the file so a restore brings them back.
  students.slice().sort(byId).forEach(s => {
    if (!seen.has(s.id)) rows.push(["", s.id, s.name, "", "Yes"]);
  });

  const csv = "\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-${todayKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Attendance exported as CSV.");
}

async function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) { showToast("That file has no data rows."); return; }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => header.findIndex(h => names.includes(h));
  const iDate = col("date");
  const iId = col("student id", "id");
  const iName = col("student name", "name");
  const iStatus = col("status");
  const iActive = col("active");
  if (iId < 0 || iName < 0) {
    showToast("Couldn't find the 'Student ID' and 'Student Name' columns.", 4000);
    return;
  }

  const clean = (v) => String(v ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  const normStatus = (v) => STATUSES.find(s => s.toLowerCase() === clean(v).toLowerCase()) || "";

  // Known IDs (active students and history) so an ID can never be linked to a different person.
  const known = new Map();
  students.forEach(s => known.set(s.id.toLowerCase(), { id: s.id, name: s.name.trim().toLowerCase() }));
  history.forEach(day => day.records.forEach(r => {
    if (!known.has(r.id.toLowerCase())) known.set(r.id.toLowerCase(), { id: r.id, name: r.name.trim().toLowerCase() });
  }));

  const activeIds = new Set(students.map(s => s.id.toLowerCase()));
  const newStudents = new Map();
  const entries = [];
  let skipped = 0;

  rows.slice(1).forEach(r => {
    let id = clean(r[iId]);
    const name = clean(r[iName]).replace(/\s+/g, " ");
    if (!id || !name) { skipped++; return; }

    const match = known.get(id.toLowerCase());
    if (match) {
      if (match.name !== name.toLowerCase()) { skipped++; return; } // same ID, different person
      id = match.id;
    } else {
      known.set(id.toLowerCase(), { id, name: name.toLowerCase() });
    }

    const active = iActive < 0 || clean(r[iActive]).toLowerCase() !== "no";
    if (active && !activeIds.has(id.toLowerCase()) && !newStudents.has(id.toLowerCase())) {
      newStudents.set(id.toLowerCase(), { id, name });
    }

    const date = iDate >= 0 ? clean(r[iDate]) : "";
    const status = iStatus >= 0 ? normStatus(r[iStatus]) : "";
    if (!date && !status) return; // roster-only row
    if (!isValidDateKey(date) || isFuture(date) || !status) { skipped++; return; }
    entries.push({ date, id, name, status });
  });

  if (!entries.length && !newStudents.size) {
    showToast(skipped ? `Nothing could be imported (${skipped} row${skipped === 1 ? "" : "s"} skipped).` : "Nothing new to import.", 4000);
    return;
  }

  const dates = new Set(entries.map(e => e.date));
  const parts = [];
  if (entries.length) parts.push(`${entries.length} attendance record${entries.length === 1 ? "" : "s"} across ${dates.size} date${dates.size === 1 ? "" : "s"}`);
  if (newStudents.size) parts.push(`${newStudents.size} new student${newStudents.size === 1 ? "" : "s"}`);
  let message = `Import ${parts.join(" and ")}? Existing entries for the same date and student will be overwritten.`;
  if (skipped) message += `\n\n${skipped} row${skipped === 1 ? " is" : "s are"} invalid or conflict with existing students and will be skipped.`;

  const ok = await confirmDialog({ title: "Import CSV?", message, confirmText: "Import" });
  if (!ok) return;

  newStudents.forEach(s => students.push({ id: s.id, name: s.name, status: "" }));
  entries.forEach(e => {
    let day = getHistoryRecord(e.date);
    if (!day) { day = { date: e.date, records: [] }; history.push(day); }
    const rec = day.records.find(r => r.id === e.id);
    if (rec) { rec.status = e.status; rec.name = e.name; }
    else day.records.push({ id: e.id, name: e.name, status: e.status });
  });
  history.sort((a, b) => b.date.localeCompare(a.date));

  saveStudents();
  saveHistory();
  loadDateIntoStudents(selectedAttendanceDate);
  render();
  showToast("CSV imported successfully.");
}

/* ---------- Event listeners ---------- */

document.addEventListener("click", async (event) => {
  const nav = event.target.closest(".nav-item");
  if (nav) {
    activeView = nav.dataset.view;
    activeFilter = "All";
    render();
    return;
  }

  const filter = event.target.closest("[data-filter]");
  if (filter) {
    activeFilter = filter.dataset.filter;
    render();
    return;
  }

  const statusButton = event.target.closest("[data-set-status]");
  if (statusButton) {
    setStatus(statusButton.dataset.id, statusButton.dataset.setStatus);
    return;
  }

  const editStudentButton = event.target.closest("[data-edit-student]");
  if (editStudentButton) {
    const student = students.find(s => s.id === editStudentButton.dataset.editStudent);
    if (student) openModal("edit", student);
    return;
  }

  const deleteStudentButton = event.target.closest("[data-delete-student]");
  if (deleteStudentButton) {
    await deleteStudents([deleteStudentButton.dataset.deleteStudent]);
    return;
  }

  if (event.target.closest("#removeSelectedBtn")) {
    await deleteStudents([...selectedStudentIds]);
    return;
  }

  const historyButton = event.target.closest("[data-history-date]");
  if (historyButton) {
    showHistoryDetail(historyButton.dataset.historyDate);
    return;
  }

  const editHistoryButton = event.target.closest("[data-edit-history-date]");
  if (editHistoryButton) {
    activeView = "attendance";
    activeFilter = "All";
    selectAttendanceDate(editHistoryButton.dataset.editHistoryDate);
    return;
  }
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-student]");
  if (checkbox) {
    const id = checkbox.dataset.selectStudent;
    if (checkbox.checked) selectedStudentIds.add(id);
    else selectedStudentIds.delete(id);
    updateBulkSelectionUI();
    return;
  }

  if (event.target.id === "selectAllStudents") {
    const visible = filteredStudents();
    if (event.target.checked) visible.forEach(s => selectedStudentIds.add(s.id));
    else visible.forEach(s => selectedStudentIds.delete(s.id));
    renderStudentsTable();
    return;
  }

  const select = event.target.closest("[data-action='status']");
  if (select) setStatus(select.dataset.id, select.value);
});

$("studentSearch").addEventListener("input", renderStudentsTable);
$("attendanceDate").addEventListener("change", (event) => selectAttendanceDate(event.target.value));

$("addStudentBtn").addEventListener("click", () => openModal("add"));
$("markAllBtn").addEventListener("click", markAllPresent);
$("modalClose").addEventListener("click", closeModal);
$("modalCancel").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", (event) => {
  if (event.target === $("modalBackdrop")) closeModal();
});

$("confirmOk").addEventListener("click", () => closeConfirm(true));
$("confirmCancel").addEventListener("click", () => closeConfirm(false));
$("confirmBackdrop").addEventListener("click", (event) => {
  if (event.target === $("confirmBackdrop")) closeConfirm(false);
});

$("studentForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("studentName").value.trim().replace(/\s+/g, " ");

  if (modalMode === "edit") {
    const student = students.find(s => s.id === editingId);
    if (!student) { closeModal(); return; }
    if (!name) { showToast("Please enter a student name."); return; }

    student.name = name;
    // Keep saved history in sync so a name fix shows everywhere.
    history.forEach(day => day.records.forEach(r => { if (r.id === student.id) r.name = name; }));
    saveStudents();
    saveHistory();
    closeModal();
    render();
    showToast(`${name} updated.`);
    return;
  }

  const id = $("studentId").value.trim();
  if (!id || !name) {
    showToast("Please enter both a Student ID and a name.");
    return;
  }

  if (students.some(s => s.id.toLowerCase() === id.toLowerCase())) {
    showToast("That Student ID already exists.");
    $("studentId").focus();
    $("studentId").select();
    return;
  }

  // Don't let a new student inherit a removed student's attendance history.
  const clash = history.flatMap(d => d.records)
    .find(r => r.id.toLowerCase() === id.toLowerCase() && r.name.trim().toLowerCase() !== name.toLowerCase());
  if (clash) {
    showToast(`ID ${id} was used by a former student (${clash.name}). Please choose a different ID.`, 4500);
    $("studentId").focus();
    $("studentId").select();
    return;
  }

  students.push({ id, name, status: "" });
  saveStudents();
  saveSelectedDateSnapshot();
  closeModal(); // close as soon as the student is successfully added
  render();
  showToast(`${name} added successfully.`);
});

$("resetBtn").addEventListener("click", async () => {
  const key = selectedAttendanceDate;
  const ok = await confirmDialog({
    title: "Reset attendance?",
    message: `All students will be set back to Unmarked for ${formatDate(key)}, and the saved record for that date will be cleared.`,
    confirmText: "Reset",
    danger: true
  });
  if (!ok) return;

  students = students.map(s => ({ ...s, status: "" }));
  history = history.filter(h => h.date !== key);
  saveHistory();
  render();
  showToast(`Attendance for ${dayLabel(key)} has been reset.`);
});

$("clearHistoryBtn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Clear all history?",
    message: "All saved attendance history will be deleted. This cannot be undone. Tip: export a CSV first if you want a backup.",
    confirmText: "Clear History",
    danger: true
  });
  if (!ok) return;

  history = [];
  selectedHistoryDate = null;
  saveHistory();
  loadDateIntoStudents(selectedAttendanceDate);
  render();
  showToast("Attendance history cleared.");
});

$("closeHistoryDetail").addEventListener("click", () => {
  selectedHistoryDate = null;
  $("historyDetailPanel").style.display = "none";
});

$("exportCsvBtn").addEventListener("click", exportCsv);
$("importCsvBtn").addEventListener("click", () => $("importCsvInput").click());
$("importCsvInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast("That file is too large to import (5 MB max)."); return; }
  let text;
  try { text = await file.text(); }
  catch { showToast("Couldn't read that file."); return; }
  await importCsv(text);
});

/* ---------- Init ---------- */

loadDateIntoStudents(selectedAttendanceDate);
saveStudents(); // also upgrades older stored data to the slimmer format
saveHistory();
render();