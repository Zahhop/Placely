const interviewsSupabase = window.employerSupabase;

const INITIAL_INTERVIEWS = [
  {
    id: "interview-austin",
    candidate: "Austin Tickle Toucher",
    initials: "AT",
    role: "Electrician",
    job: "Austin Tickle Toucher",
    location: "Penticton, BC",
    type: "Video Interview",
    typeKey: "video",
    durationMinutes: 30,
    interviewer: "TG",
    interviewerName: "Trevor Gar",
    interviewerRole: "MRI Technologist",
    status: "Scheduled",
    statusKey: "scheduled",
    feedback: "-",
    dateISO: "2026-06-21",
    startTime: "10:00",
    eventTone: "purple",
    notes: ""
  },
  {
    id: "interview-james",
    candidate: "James Wilson",
    initials: "JW",
    role: "Electrician",
    job: "Austin Tickle Toucher",
    location: "Penticton, BC",
    type: "Video Interview",
    typeKey: "video",
    durationMinutes: 30,
    interviewer: "TG",
    interviewerName: "Trevor Gar",
    interviewerRole: "MRI Technologist",
    status: "Scheduled",
    statusKey: "scheduled",
    feedback: "-",
    dateISO: "2026-06-21",
    startTime: "13:00",
    eventTone: "purple",
    notes: ""
  },
  {
    id: "interview-patrick",
    candidate: "Patrick Frownsbottom",
    initials: "PF",
    role: "Software Founder",
    job: "Austin Tickle Toucher",
    location: "Penticton, BC",
    type: "Panel Interview",
    typeKey: "panel",
    durationMinutes: 60,
    interviewer: "PF",
    interviewerName: "Priya Ford",
    interviewerRole: "Hiring Lead",
    status: "Completed",
    statusKey: "completed",
    feedback: "Pending",
    dateISO: "2026-06-22",
    startTime: "14:00",
    eventTone: "green",
    notes: ""
  },
  {
    id: "interview-mike",
    candidate: "Mike Thompson",
    initials: "A",
    role: "Helper",
    job: "Austin Tickle Toucher",
    location: "Penticton, BC",
    type: "In-Person Interview",
    typeKey: "in-person",
    durationMinutes: 45,
    interviewer: "A",
    interviewerName: "Alex Kim",
    interviewerRole: "Site Lead",
    status: "Scheduled",
    statusKey: "scheduled",
    feedback: "-",
    dateISO: "2026-06-23",
    startTime: "11:00",
    eventTone: "blue",
    notes: ""
  },
  {
    id: "interview-sarah",
    candidate: "Sarah Johnson",
    initials: "SJ",
    role: "Welder",
    job: "Austin Tickle Toucher",
    location: "Penticton, BC",
    type: "Phone Interview",
    typeKey: "phone",
    durationMinutes: 30,
    interviewer: "SJ",
    interviewerName: "Sarah Jones",
    interviewerRole: "Recruiter",
    status: "Completed",
    statusKey: "completed",
    feedback: "Received",
    dateISO: "2026-06-24",
    startTime: "09:00",
    eventTone: "amber",
    notes: ""
  }
];

const INTERVIEW_TYPE_KEYS = {
  "Video Interview": "video",
  "Panel Interview": "panel",
  "Phone Interview": "phone",
  "In-Person Interview": "in-person"
};

const INTERVIEW_TYPE_TONES = {
  "Video Interview": "purple",
  "Panel Interview": "green",
  "Phone Interview": "amber",
  "In-Person Interview": "blue"
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TODAY = stripTime(new Date());

const interviewsState = {
  interviews: INITIAL_INTERVIEWS.map(normalizeInterview),
  weekStart: parseLocalDate("2026-06-18"),
  filters: {
    search: "",
    job: "all",
    type: "all",
    location: "all"
  },
  openMenuId: null
};

document.addEventListener("DOMContentLoaded", initEmployerInterviews);

async function initEmployerInterviews() {
  setupInterviewsShell();

  const user = await verifyEmployerAccess(interviewsSupabase, {
    loginPath: "employer-login.html",
    candidateDashboardPath: "../candidates/candidate-dashboard.html"
  });

  if (!user) return;

  setupInterviewControls();
  populateFilterOptions();
  renderInterviewsPage();
}

function setupInterviewsShell() {
  const body = document.body;
  const sidebar = document.getElementById("dashboardSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");
  const globalSearch = document.querySelector(".utility-search");

  const closeSidebar = () => {
    body.classList.remove("sidebar-open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (backdrop) backdrop.hidden = true;
  };

  toggle?.addEventListener("click", () => {
    const opening = !body.classList.contains("sidebar-open");
    body.classList.toggle("sidebar-open", opening);
    toggle.setAttribute("aria-expanded", String(opening));
    if (backdrop) backdrop.hidden = !opening;
  });

  backdrop?.addEventListener("click", closeSidebar);
  sidebar?.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSidebar();
  });

  globalSearch?.addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

function setupInterviewControls() {
  const page = document.querySelector(".interviews-page");
  const searchInput = document.getElementById("interviewSearchInput");
  const jobFilter = document.getElementById("interviewJobFilter");
  const typeFilter = document.getElementById("interviewTypeFilter");
  const locationFilter = document.getElementById("interviewLocationFilter");
  const filtersButton = document.getElementById("interviewFiltersBtn");
  const scheduleButton = document.getElementById("scheduleInterviewBtn");
  const scheduleForm = document.getElementById("scheduleInterviewForm");

  searchInput?.addEventListener("input", () => {
    interviewsState.filters.search = searchInput.value.trim().toLowerCase();
    renderInterviewsPage();
  });

  jobFilter?.addEventListener("change", () => {
    interviewsState.filters.job = jobFilter.value;
    renderInterviewsPage();
  });

  typeFilter?.addEventListener("change", () => {
    interviewsState.filters.type = typeFilter.value;
    renderInterviewsPage();
  });

  locationFilter?.addEventListener("change", () => {
    interviewsState.filters.location = locationFilter.value;
    renderInterviewsPage();
  });

  filtersButton?.addEventListener("click", () => {
    showToast("Advanced filters are a V1 placeholder.");
  });

  document.querySelectorAll("[data-calendar-action]").forEach((control) => {
    control.addEventListener("click", () => {
      const action = control.dataset.calendarAction;
      if (action === "previous") interviewsState.weekStart = addDays(interviewsState.weekStart, -7);
      if (action === "next") interviewsState.weekStart = addDays(interviewsState.weekStart, 7);
      if (action === "today") interviewsState.weekStart = startOfWeek(TODAY);
      renderInterviewsPage();
    });
  });

  document.getElementById("calendarViewSelect")?.addEventListener("change", (event) => {
    event.target.value = "Week";
  });

  scheduleButton?.addEventListener("click", openScheduleModal);
  scheduleForm?.addEventListener("submit", handleScheduleSubmit);

  document.querySelectorAll("[data-modal-close]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.closest(".interviews-modal-backdrop")));
  });

  document.querySelectorAll(".interviews-modal-backdrop").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeOpenMenus();
      document.querySelectorAll(".interviews-modal-backdrop:not([hidden])").forEach(closeModal);
    }
  });

  page?.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-interview-action='view']");
    if (viewButton) {
      const interview = findInterview(viewButton.dataset.interviewId);
      if (interview) openDetailsModal(interview);
      return;
    }

    const menuButton = event.target.closest("[data-interview-menu]");
    if (menuButton) {
      toggleOverflowMenu(menuButton);
      return;
    }

    const placeholderAction = event.target.closest("[data-placeholder-action]");
    if (placeholderAction) {
      closeOpenMenus();
      showToast(`${placeholderAction.dataset.placeholderAction} is a V1 placeholder.`);
      return;
    }

    if (!event.target.closest(".interview-menu-wrap")) closeOpenMenus();
  });
}

function renderInterviewsPage() {
  const visibleInterviews = getVisibleInterviews();
  const weekInterviews = visibleInterviews.filter(isInDisplayedWeek);

  renderWeekChrome();
  renderMetrics();
  renderCalendarEvents(weekInterviews);
  renderUpcomingInterviews(weekInterviews);
  renderRecentInterviews(weekInterviews.slice(0, 4), weekInterviews.length);
}

function populateFilterOptions() {
  populateSelect("interviewJobFilter", "All Jobs", uniqueValues(interviewsState.interviews.map((item) => item.job)));
  populateSelect("interviewTypeFilter", "All Interview Types", uniqueValues(interviewsState.interviews.map((item) => item.type)));
  populateSelect("interviewLocationFilter", "All Locations", uniqueValues(interviewsState.interviews.map((item) => item.location)));
  syncFilterControls();
}

function populateSelect(id, defaultLabel, values) {
  const select = document.getElementById(id);
  if (!select) return;

  const current = select.value || "all";
  select.innerHTML = [
    `<option value="all">${escapeHTML(defaultLabel)}</option>`,
    ...values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
  ].join("");
  select.value = values.includes(current) ? current : "all";
}

function renderWeekChrome() {
  const weekStart = interviewsState.weekStart;
  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}, ${weekEnd.getFullYear()}`;
  const dayHeaders = Array.from(document.querySelectorAll(".calendar-day-header:not(.calendar-time-spacer)"));
  const dateRangeSelect = document.getElementById("interviewDateRange");
  const dateRangeButton = document.querySelector("[data-calendar-action='date-range']");

  dayHeaders.forEach((header, index) => {
    const date = addDays(weekStart, index);
    const label = header.querySelector("span");
    const number = header.querySelector("strong");
    if (label) label.textContent = DAY_LABELS[index];
    if (number) number.textContent = String(date.getDate());
    header.classList.toggle("active", isSameDate(date, TODAY));
  });

  if (dateRangeSelect) {
    dateRangeSelect.innerHTML = `<option value="current-week">${escapeHTML(rangeLabel)}</option>`;
  }

  if (dateRangeButton) {
    dateRangeButton.textContent = rangeLabel;
  }
}

function renderMetrics() {
  const today = TODAY;
  const sevenDaysOut = addDays(today, 7);
  const thirtyDaysAgo = addDays(today, -30);
  const interviews = interviewsState.interviews;
  const upcomingCount = interviews.filter((item) => item.date >= today && item.date <= sevenDaysOut && item.statusKey !== "completed").length;
  const todayCount = interviews.filter((item) => isSameDate(item.date, today)).length;
  const completedCount = interviews.filter((item) => item.statusKey === "completed" && item.date >= thirtyDaysAgo && item.date <= today).length;
  const feedbackPendingCount = interviews.filter((item) => item.feedback.toLowerCase() === "pending").length;

  setMetric("upcomingInterviewsCount", upcomingCount);
  setMetric("todayInterviewsCount", todayCount);
  setMetric("completedInterviewsCount", completedCount);
  setMetric("feedbackPendingCount", feedbackPendingCount);
}

function setMetric(id, value) {
  const metric = document.getElementById(id);
  if (metric) metric.textContent = String(value);
}

function renderCalendarEvents(interviews) {
  const calendarLayer = document.getElementById("calendarEventsLayer");
  if (!calendarLayer) return;

  if (!interviews.length) {
    calendarLayer.innerHTML = `<p class="interviews-empty-state calendar-empty-state">No interviews match this week.</p>`;
    return;
  }

  calendarLayer.innerHTML = interviews
    .map((interview) => {
      const event = getCalendarPlacement(interview);
      return `
        <button type="button" class="calendar-event ${escapeHTML(interview.eventTone)}" style="--event-day: ${event.day}; --event-start: ${event.start}; --event-span: ${event.span};" data-interview-action="view" data-interview-id="${escapeHTML(interview.id)}">
          <strong>${escapeHTML(interview.calendarLabel)}</strong>
          <span>${escapeHTML(interview.type)}</span>
          <span>${escapeHTML(formatDisplayTime(interview.startTime))}</span>
        </button>
      `;
    })
    .join("");
}

function renderUpcomingInterviews(interviews) {
  const upcomingList = document.getElementById("upcomingInterviewsList");
  if (!upcomingList) return;

  const sorted = [...interviews].sort(compareInterviewDate);
  if (!sorted.length) {
    upcomingList.innerHTML = `<p class="interviews-empty-state">No upcoming interviews match these filters.</p>`;
    return;
  }

  upcomingList.innerHTML = sorted
    .slice(0, 5)
    .map((interview) => `
      <article class="upcoming-interview-row" data-interview-id="${escapeHTML(interview.id)}">
        <div class="interview-date-block">
          <span>${escapeHTML(formatMonth(interview.date))}</span>
          <strong>${escapeHTML(String(interview.date.getDate()))}</strong>
          <span>${escapeHTML(formatDisplayTime(interview.startTime))}</span>
        </div>
        <span class="interview-avatar" aria-hidden="true">${escapeHTML(interview.initials)}</span>
        <div class="interview-summary">
          <strong>${escapeHTML(interview.candidate)}</strong>
          <span>${escapeHTML(interview.role)} • ${escapeHTML(interview.job)}</span>
        </div>
        <span class="interview-type-badge ${escapeHTML(interview.typeKey)}">${escapeHTML(interview.type)}</span>
        <span class="interview-duration">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2V2Zm12 8H5v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9ZM5 8h14V6H5v2Z"/></svg>
          ${escapeHTML(formatDuration(interview.durationMinutes))}
        </span>
        <span class="interviewer-initials">${escapeHTML(interview.interviewer)}</span>
        ${renderOverflowButton(interview)}
      </article>
    `)
    .join("");
}

function renderRecentInterviews(interviews, totalCount) {
  const tableBody = document.getElementById("recentInterviewsTableBody");
  const countLabel = document.getElementById("recentInterviewsCount");
  if (!tableBody) return;

  if (!interviews.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8">
          <p class="interviews-empty-state table-empty-state">No interviews match these filters.</p>
        </td>
      </tr>
    `;
  } else {
    tableBody.innerHTML = interviews
      .map((interview) => `
        <tr data-interview-id="${escapeHTML(interview.id)}">
          <td>
            <div class="recent-person-cell">
              <span class="interview-avatar" aria-hidden="true">${escapeHTML(interview.initials)}</span>
              <span class="recent-cell-copy">
                <strong>${escapeHTML(interview.candidate)}</strong>
                <span>${escapeHTML(interview.job)}</span>
              </span>
            </div>
          </td>
          <td>
            <span class="recent-cell-copy">
              <strong>${escapeHTML(interview.role)}</strong>
              <span>${escapeHTML(interview.location)}</span>
            </span>
          </td>
          <td>
            <div class="recent-type-cell">
              <span class="interview-type-badge ${escapeHTML(interview.typeKey)}">${escapeHTML(interview.type)}</span>
              <span>${escapeHTML(formatDuration(interview.durationMinutes))}</span>
            </div>
          </td>
          <td>
            <div class="recent-person-cell">
              <span class="interviewer-initials">${escapeHTML(interview.interviewer)}</span>
              <span class="recent-cell-copy">
                <strong>${escapeHTML(interview.interviewerName)}</strong>
                <span>${escapeHTML(interview.interviewerRole)}</span>
              </span>
            </div>
          </td>
          <td>
            <span class="recent-cell-copy">
              <strong>${escapeHTML(formatLongDate(interview.date))}</strong>
              <span>${escapeHTML(formatDisplayTime(interview.startTime))}</span>
            </span>
          </td>
          <td>
            <span class="status recent-status ${escapeHTML(interview.statusKey)}">${escapeHTML(interview.status)}</span>
          </td>
          <td>
            <span class="recent-feedback ${interview.feedback === "-" ? "empty" : ""}">${escapeHTML(interview.feedback)}</span>
          </td>
          <td>
            <div class="recent-actions">
              <button type="button" class="row-action" data-interview-action="view" data-interview-id="${escapeHTML(interview.id)}">View</button>
              ${renderOverflowButton(interview)}
            </div>
          </td>
        </tr>
      `)
      .join("");
  }

  if (countLabel) {
    countLabel.textContent = totalCount
      ? `Showing ${interviews.length} of ${totalCount} interviews`
      : "Showing 0 interviews";
  }
}

function renderOverflowButton(interview) {
  return `
    <span class="interview-menu-wrap">
      <button type="button" class="secondary-btn interview-overflow-btn" data-interview-menu="${escapeHTML(interview.id)}" aria-label="More actions for ${escapeHTML(interview.candidate)}" aria-expanded="false">
        ...
      </button>
      <span class="interview-menu" hidden>
        <button type="button" data-placeholder-action="Edit">Edit</button>
        <button type="button" data-placeholder-action="Cancel Interview">Cancel Interview</button>
      </span>
    </span>
  `;
}

function openScheduleModal() {
  const modal = document.getElementById("scheduleInterviewModal");
  const form = document.getElementById("scheduleInterviewForm");
  const message = document.getElementById("scheduleInterviewMessage");
  if (!modal || !form) return;

  form.reset();
  const dateInput = document.getElementById("scheduleDate");
  const timeInput = document.getElementById("scheduleTime");
  if (dateInput) dateInput.value = formatISODate(TODAY);
  if (timeInput) timeInput.value = "10:00";
  if (message) message.textContent = "";
  openModal(modal, "#scheduleCandidate");
}

function handleScheduleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const requiredFields = ["candidate", "job", "date", "time", "duration", "type", "interviewer", "location"];
  const message = document.getElementById("scheduleInterviewMessage");
  const missingField = requiredFields.find((field) => !String(formData.get(field) || "").trim());

  if (missingField) {
    if (message) message.textContent = "Please complete all required fields.";
    return;
  }

  const type = String(formData.get("type"));
  const interviewerName = String(formData.get("interviewer")).trim();
  const interview = normalizeInterview({
    id: `local-interview-${Date.now()}`,
    candidate: String(formData.get("candidate")).trim(),
    initials: getInitials(String(formData.get("candidate")).trim()),
    role: String(formData.get("job")).trim(),
    job: String(formData.get("job")).trim(),
    location: String(formData.get("location")).trim(),
    type,
    typeKey: INTERVIEW_TYPE_KEYS[type] || "video",
    durationMinutes: Number(formData.get("duration")),
    interviewer: getInitials(interviewerName),
    interviewerName,
    interviewerRole: "Interviewer",
    status: "Scheduled",
    statusKey: "scheduled",
    feedback: "-",
    dateISO: String(formData.get("date")),
    startTime: String(formData.get("time")),
    eventTone: INTERVIEW_TYPE_TONES[type] || "purple",
    notes: String(formData.get("notes") || "").trim()
  });

  interviewsState.interviews = [...interviewsState.interviews, interview].sort(compareInterviewDate);
  interviewsState.weekStart = startOfWeek(interview.date);
  resetInterviewFilters();
  populateFilterOptions();
  renderInterviewsPage();
  closeModal(document.getElementById("scheduleInterviewModal"));
  showToast("Interview added locally for V1.");
}

function resetInterviewFilters() {
  interviewsState.filters = {
    search: "",
    job: "all",
    type: "all",
    location: "all"
  };

  const searchInput = document.getElementById("interviewSearchInput");
  if (searchInput) searchInput.value = "";
  syncFilterControls();
}

function syncFilterControls() {
  const jobFilter = document.getElementById("interviewJobFilter");
  const typeFilter = document.getElementById("interviewTypeFilter");
  const locationFilter = document.getElementById("interviewLocationFilter");
  if (jobFilter) jobFilter.value = interviewsState.filters.job;
  if (typeFilter) typeFilter.value = interviewsState.filters.type;
  if (locationFilter) locationFilter.value = interviewsState.filters.location;
}

function openDetailsModal(interview) {
  const modal = document.getElementById("interviewDetailsModal");
  const subtitle = document.getElementById("interviewDetailsSubtitle");
  const body = document.getElementById("interviewDetailsBody");
  if (!modal || !body) return;

  if (subtitle) {
    subtitle.textContent = `${interview.candidate} • ${formatLongDate(interview.date)} at ${formatDisplayTime(interview.startTime)}`;
  }

  body.innerHTML = `
    <dl>
      <div><dt>Candidate</dt><dd>${escapeHTML(interview.candidate)}</dd></div>
      <div><dt>Job</dt><dd>${escapeHTML(interview.job)}</dd></div>
      <div><dt>Type</dt><dd>${escapeHTML(interview.type)} • ${escapeHTML(formatDuration(interview.durationMinutes))}</dd></div>
      <div><dt>Interviewer</dt><dd>${escapeHTML(interview.interviewerName)}</dd></div>
      <div><dt>Location or link</dt><dd>${escapeHTML(interview.location)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHTML(interview.status)}</dd></div>
      <div><dt>Feedback</dt><dd>${escapeHTML(interview.feedback)}</dd></div>
      <div><dt>Notes</dt><dd>${escapeHTML(interview.notes || "No notes")}</dd></div>
    </dl>
  `;

  openModal(modal, "[data-modal-close]");
}

function openModal(modal, focusSelector) {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("interviews-modal-open");
  modal.querySelector(focusSelector)?.focus();
}

function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("interviews-modal-open");
}

function toggleOverflowMenu(button) {
  const id = button.dataset.interviewMenu;
  const wrap = button.closest(".interview-menu-wrap");
  const menu = wrap?.querySelector(".interview-menu");
  const opening = interviewsState.openMenuId !== id;
  closeOpenMenus();
  if (!opening || !menu) return;
  interviewsState.openMenuId = id;
  menu.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function closeOpenMenus() {
  interviewsState.openMenuId = null;
  document.querySelectorAll("[data-interview-menu]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  document.querySelectorAll(".interview-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function getVisibleInterviews() {
  return interviewsState.interviews
    .filter((interview) => {
      const { search, job, type, location } = interviewsState.filters;
      const matchesSearch = !search || [
        interview.candidate,
        interview.job,
        interview.location,
        interview.interviewerName
      ].some((value) => value.toLowerCase().includes(search));
      const matchesJob = job === "all" || interview.job === job;
      const matchesType = type === "all" || interview.type === type;
      const matchesLocation = location === "all" || interview.location === location;
      return matchesSearch && matchesJob && matchesType && matchesLocation;
    })
    .sort(compareInterviewDate);
}

function isInDisplayedWeek(interview) {
  const weekEnd = addDays(interviewsState.weekStart, 6);
  return interview.date >= interviewsState.weekStart && interview.date <= weekEnd;
}

function findInterview(id) {
  return interviewsState.interviews.find((interview) => interview.id === id);
}

function normalizeInterview(interview) {
  const date = parseLocalDate(interview.dateISO);
  const normalized = {
    ...interview,
    date,
    dateISO: formatISODate(date),
    durationMinutes: Number(interview.durationMinutes || 30),
    typeKey: interview.typeKey || INTERVIEW_TYPE_KEYS[interview.type] || "video",
    eventTone: interview.eventTone || INTERVIEW_TYPE_TONES[interview.type] || "purple",
    statusKey: interview.statusKey || interview.status.toLowerCase(),
    feedback: interview.feedback || "-",
    notes: interview.notes || ""
  };
  normalized.calendarLabel = interview.calendarLabel || getShortName(normalized.candidate);
  return normalized;
}

function getCalendarPlacement(interview) {
  const [hours, minutes] = interview.startTime.split(":").map(Number);
  const day = Math.max(1, Math.min(7, Math.round((interview.date - interviewsState.weekStart) / 86400000) + 1));
  const start = Math.max(0, (hours + minutes / 60) - 9);
  const span = Math.max(0.55, interview.durationMinutes / 60);
  return { day, start, span };
}

function compareInterviewDate(a, b) {
  return getDateTime(a).getTime() - getDateTime(b).getTime();
}

function getDateTime(interview) {
  const [hours, minutes] = interview.startTime.split(":").map(Number);
  const date = new Date(interview.date);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return stripTime(new Date(year, month - 1, day));
}

function stripTime(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date) {
  const start = stripTime(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return stripTime(next);
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonth(date) {
  return date.toLocaleDateString("en-US", { month: "short" });
}

function formatShortDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDisplayTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(2026, 0, 1, hours || 0, minutes || 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDuration(minutes) {
  return `${minutes} min`;
}

function getInitials(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "I";
}

function getShortName(value) {
  const parts = String(value || "").trim().split(/\s+/);
  if (!parts.length) return "Interview";
  return `${parts[0]}${parts[1] ? ` ${parts[1][0]}.` : ""}`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}
