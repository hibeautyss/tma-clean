import { initTelegram, getTelegramUser } from "./telegram.js";
import { loadUserState, saveUserState, createRemotePoll, fetchPoll } from "./api.js";
import { getState, updateState } from "./state.js";
import {
  initUI,
  renderCalendar,
  renderSelection,
  setTimezoneLabel,
  setTimezonePopoverVisible,
  isTimezonePopoverVisible,
  renderTimezoneList,
  setTimezoneSearchValue,
  setCreatePollEnabled,
  setFormFeedback,
  setScreenVisibility,
  setPollTabActive,
  renderPollHistory,
  setCreatedOnlyFilter,
  setJoinFeedback,
} from "./ui.js";

const TIME_CONFIG = {
  minutesInDay: 24 * 60,
  timeStep: 15,
  defaultSlot: { start: 12 * 60, end: 13 * 60 },
};
const DEFAULT_DURATION = TIME_CONFIG.defaultSlot.end - TIME_CONFIG.defaultSlot.start;

const NORMALIZE = (value) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const TIMEZONE_CATALOG = [
  { zone: "UTC", offset: "UTCВ±00:00", cities: ["Reykjavik", "Accra", "Dakar"] },
  { zone: "Europe/London", offset: "UTC+00:00", cities: ["London", "Dublin", "Lisbon"] },
  { zone: "Europe/Berlin", offset: "UTC+01:00", cities: ["Berlin", "Paris", "Madrid", "Rome"] },
  { zone: "Europe/Moscow", offset: "UTC+03:00", cities: ["Moscow", "Istanbul", "Doha"] },
  { zone: "Asia/Dubai", offset: "UTC+04:00", cities: ["Dubai", "Abu Dhabi", "Muscat"] },
  { zone: "Asia/Kolkata", offset: "UTC+05:30", cities: ["Mumbai", "Delhi", "Bengaluru"] },
  { zone: "Asia/Singapore", offset: "UTC+08:00", cities: ["Singapore", "Kuala Lumpur", "Perth"] },
  { zone: "Asia/Tokyo", offset: "UTC+09:00", cities: ["Tokyo", "Seoul", "Osaka"] },
  { zone: "Australia/Sydney", offset: "UTC+10:00", cities: ["Sydney", "Melbourne", "Brisbane"] },
  {
    zone: "America/New_York",
    offset: "UTC-05:00",
    cities: ["New York", "Washington DC", "Toronto", "Miami"],
  },
  { zone: "America/Chicago", offset: "UTC-06:00", cities: ["Chicago", "Dallas", "Mexico City"] },
  { zone: "America/Denver", offset: "UTC-07:00", cities: ["Denver", "Phoenix", "Salt Lake City"] },
  {
    zone: "America/Los_Angeles",
    offset: "UTC-08:00",
    cities: ["Los Angeles", "San Francisco", "Seattle", "Vancouver"],
  },
  {
    zone: "America/Sao_Paulo",
    offset: "UTC-03:00",
    cities: ["Sao Paulo", "Rio de Janeiro", "Buenos Aires"],
  },
];

const SCREENS = {
  DASHBOARD: "dashboard",
  CREATE: "create",
};

let refs = {};
let saveTimer = null;
const CREATE_LABEL_DEFAULT = "Create Poll";
const CREATE_LABEL_WORKING = "Saving...";

const getStorageId = () => getState().telegramUser?.id ?? "guest";

const schedulePersist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistState, 200);
};

const POLL_STATUSES = ["live", "paused", "finished"];

const normalizeStatus = (status) => (POLL_STATUSES.includes(status) ? status : POLL_STATUSES[0]);

const getPollFilters = () => {
  const filters = getState().pollFilters ?? {};
  return {
    status: normalizeStatus(filters.status),
    createdOnly: Boolean(filters.createdOnly),
  };
};

const getPollHistory = () => (Array.isArray(getState().pollHistory) ? getState().pollHistory : []);

const renderPollSection = () => {
  const filters = getPollFilters();
  const history = getPollHistory()
    .filter((entry) => normalizeStatus(entry.status ?? filters.status) === filters.status)
    .filter((entry) => !filters.createdOnly || entry.relation === "created")
    .sort(
      (a, b) =>
        new Date(b.timestamp ?? 0).valueOf() - new Date(a.timestamp ?? 0).valueOf()
    );
  setPollTabActive(filters.status);
  setCreatedOnlyFilter(filters.createdOnly);
  renderPollHistory(history);
};

const recordPollHistoryEntry = (poll, relation) => {
  if (!poll?.id && !poll?.share_code) {
    return;
  }
  const entry = {
    id: poll.id,
    share_code: poll.share_code,
    title: poll.title ?? "Untitled poll",
    status: normalizeStatus(poll.status ?? POLL_STATUSES[0]),
    relation,
    timestamp: poll.created_at ?? new Date().toISOString(),
  };
  const history = [entry, ...getPollHistory()];
  updateState({ pollHistory: history });
  renderPollSection();
  schedulePersist();
};

const syncScreenVisibility = (screen) => {
  const normalized = screen === SCREENS.CREATE ? SCREENS.CREATE : SCREENS.DASHBOARD;
  setScreenVisibility(normalized);
  return normalized;
};

const setActiveScreen = (screen) => {
  const normalized = syncScreenVisibility(screen);
  updateState({ screen: normalized });
  schedulePersist();
  if (normalized === SCREENS.CREATE) {
    renderAll();
  }
};

const formatDisplayDate = (date, options) =>
  new Intl.DateTimeFormat("en-US", options).format(date);

const toLocalISO = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildCalendarView = () => {
  const state = getState();
  const { currentView, today, selectedDates } = state;
  const year = currentView.getFullYear();
  const month = currentView.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - startOffset);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + i);
    const iso = toLocalISO(cellDate);
    cells.push({
      iso,
      label: cellDate.getDate(),
      isCurrentMonth: cellDate.getMonth() === month,
      isSelected: selectedDates.has(iso),
      isToday: cellDate.toDateString() === today.toDateString(),
    });
  }

  return {
    monthLabel: formatDisplayDate(new Date(year, month, 1), { month: "long", year: "numeric" }),
    cells,
  };
};

const ensureDefaultSlot = (iso) => {
  const entry = getState().selectedDates.get(iso);
  if (!entry) return;
  if (!entry.slots.length) {
    entry.slots.push({ ...TIME_CONFIG.defaultSlot });
  }
};

const appendSlot = (iso) => {
  const entry = getState().selectedDates.get(iso);
  if (!entry) {
    return;
  }
  if (!entry.slots.length) {
    ensureDefaultSlot(iso);
    return;
  }
  const last = entry.slots[entry.slots.length - 1];
  const duration = Math.max(last.end - last.start, DEFAULT_DURATION);
  const newStart = last.end;
  const newEnd = newStart + duration;
  if (newEnd > TIME_CONFIG.minutesInDay) {
    return;
  }
  entry.slots.push({ start: newStart, end: newEnd });
};

const canAddSlotForDate = (iso) => {
  const entry = getState().selectedDates.get(iso);
  if (!entry || !entry.slots.length) {
    return true;
  }
  const last = entry.slots[entry.slots.length - 1];
  const duration = Math.max(last.end - last.start, DEFAULT_DURATION);
  return last.end + duration <= TIME_CONFIG.minutesInDay;
};

const renderAll = () => {
  const state = getState();
  renderCalendar(buildCalendarView(), { onDateToggle: handleDateToggle });
  renderSelection(
    state,
    {
      onAddSlot: handleAddSlot,
      onRemoveSlot: handleRemoveSlot,
      onSlotChange: handleSlotChange,
      canAddSlot: canAddSlotForDate,
    },
    TIME_CONFIG
  );
  setTimezoneLabel(state.timezone);
  const matches = filterTimezones(state.timezoneSearch || "");
  renderTimezoneList(matches, handleTimezoneSelect);
  setCreatePollEnabled(state.selectedDates.size > 0 && !state.isSubmitting);
};

const handleDateToggle = (iso) => {
  const { selectedDates, specifyTimesEnabled } = getState();
  if (selectedDates.has(iso)) {
    selectedDates.delete(iso);
  } else {
    selectedDates.set(iso, { slots: [] });
    if (specifyTimesEnabled) {
      ensureDefaultSlot(iso);
    }
  }
  renderAll();
  schedulePersist();
};

const handleMonthNav = (event) => {
  const { direction } = event.currentTarget.dataset;
  const delta = direction === "next" ? 1 : -1;
  const { currentView } = getState();
  currentView.setMonth(currentView.getMonth() + delta);
  updateState({ currentView });
  renderAll();
  schedulePersist();
};

const handleTimeToggleChange = (checked) => {
  updateState({ specifyTimesEnabled: checked });
  if (checked) {
    getState().selectedDates.forEach((_, iso) => ensureDefaultSlot(iso));
  }
  renderAll();
  schedulePersist();
};

const handleAddSlot = (iso) => {
  appendSlot(iso);
  renderAll();
  schedulePersist();
};

const handleRemoveSlot = (iso, index) => {
  const entry = getState().selectedDates.get(iso);
  if (!entry) return;
  entry.slots.splice(index, 1);
  renderAll();
  schedulePersist();
};

const handleSlotChange = (iso, index, type, value) => {
  const entry = getState().selectedDates.get(iso);
  if (!entry) return;
  const slot = entry.slots[index];
  if (!slot) return;

  if (type === "start") {
    const duration = Math.max(slot.end - slot.start, TIME_CONFIG.timeStep);
    slot.start = value;
    if (slot.end <= slot.start) {
      slot.end = Math.min(slot.start + duration, TIME_CONFIG.minutesInDay);
    }
  } else {
    if (value <= slot.start) {
      slot.end = Math.min(slot.start + TIME_CONFIG.timeStep, TIME_CONFIG.minutesInDay);
    } else {
      slot.end = value;
    }
  }
  renderAll();
  schedulePersist();
};

const filterTimezones = (query) => {
  const normalizedQuery = NORMALIZE(query.trim());
  if (!normalizedQuery) {
    return TIMEZONE_CATALOG;
  }
  return TIMEZONE_CATALOG.filter(
    (entry) =>
      NORMALIZE(entry.zone).includes(normalizedQuery) ||
      entry.cities.some((city) => NORMALIZE(city).includes(normalizedQuery))
  );
};

const handleTimezoneButtonClick = (event) => {
  event.stopPropagation();
  if (isTimezonePopoverVisible()) {
    setTimezonePopoverVisible(false);
    return;
  }
  updateState({ timezoneSearch: "" });
  setTimezoneSearchValue("");
  renderTimezoneList(filterTimezones(""), handleTimezoneSelect);
  setTimezonePopoverVisible(true);
  queueMicrotask(() => refs.timezoneSearch?.focus());
};

const handleTimezoneSearch = (value) => {
  updateState({ timezoneSearch: value });
  renderTimezoneList(filterTimezones(value), handleTimezoneSelect);
  schedulePersist();
};

const handleTimezoneSelect = (zone) => {
  updateState({ timezone: zone });
  setTimezonePopoverVisible(false);
  setTimezoneLabel(zone);
  schedulePersist();
};

const handlePollTabChange = (status) => {
  const normalized = normalizeStatus(status);
  const current = getPollFilters();
  if (current.status === normalized) return;
  updateState({ pollFilters: { ...current, status: normalized } });
  renderPollSection();
  schedulePersist();
};

const handleCreatedOnlyToggle = (checked) => {
  const current = getPollFilters();
  updateState({ pollFilters: { ...current, createdOnly: checked } });
  renderPollSection();
  schedulePersist();
};

const handleJoinPoll = async () => {
  const raw = refs.joinCodeInput?.value ?? "";
  const trimmed = raw.trim();
  if (!trimmed) {
    setJoinFeedback("Enter a share code first.", "error");
    refs.joinCodeInput?.focus();
    return;
  }
  const shareCode = trimmed.toUpperCase();
  setJoinFeedback(`Looking up ${shareCode}...`, "info");
  try {
    const poll = await fetchPoll({ shareCode });
    if (!poll) {
      setJoinFeedback("No poll found with that code.", "error");
      return;
    }
    setJoinFeedback(`Joined "${poll.title ?? "Untitled poll"}".`, "success");
    if (refs.joinCodeInput) {
      refs.joinCodeInput.value = "";
    }
    recordPollHistoryEntry(poll, "joined");
  } catch (error) {
    console.error("Failed to join poll", error);
    setJoinFeedback(error.message ?? "Unable to join poll. Please try again.", "error");
  }
};

const handleJoinInputKeydown = (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleJoinPoll();
  }
};

const handleNewPollClick = () => setActiveScreen(SCREENS.CREATE);

const handleBackToDashboard = () => setActiveScreen(SCREENS.DASHBOARD);

const wirePressAnimation = (button) => {
  if (!button) return;
  const add = (event) => {
    if (button.disabled) return;
    button.classList.add("is-pressing");
    if (button.setPointerCapture) {
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // ignore capture errors
      }
    }
  };
  const remove = () => button.classList.remove("is-pressing");
  button.addEventListener("pointerdown", add);
  ["pointerup", "pointerleave", "pointercancel", "lostpointercapture"].forEach((evt) =>
    button.addEventListener(evt, remove)
  );
};

const getEventDetails = () => ({
  title: refs.titleInput?.value ?? "",
  location: refs.locationInput?.value ?? "",
  description: refs.descriptionInput?.value ?? "",
});

const setSubmitting = (isSubmitting) => {
  updateState({ isSubmitting });
  renderAll();
  if (refs.createPollButton) {
    refs.createPollButton.textContent = isSubmitting ? CREATE_LABEL_WORKING : CREATE_LABEL_DEFAULT;
  }
};

const resetPlannerState = () => {
  updateState({
    selectedDates: new Map(),
    specifyTimesEnabled: false,
  });
  if (refs.timeToggle) {
    refs.timeToggle.checked = false;
  }
  renderAll();
  persistState();
};

const handleCreatePoll = async () => {
  if (getState().isSubmitting) return;
  const { title, location, description } = getEventDetails();
  const state = getState();
  if (!title.trim()) {
    setFormFeedback("Title is required before creating a poll.", "error");
    refs.titleInput?.focus();
    return;
  }
  if (!state.selectedDates.size) {
    setFormFeedback("Select at least one date first.", "error");
    return;
  }

  setFormFeedback("Saving poll to Supabase...", "info");
  setSubmitting(true);
  try {
    const poll = await createRemotePoll({
      title,
      location,
      description,
      timezone: state.timezone,
      specifyTimesEnabled: state.specifyTimesEnabled,
      selectedDates: new Map(state.selectedDates),
      telegramUser: state.telegramUser,
    });
    setFormFeedback(
      `Poll created! Share code ${poll.share_code} with participants.`,
      "success"
    );
    recordPollHistoryEntry(poll, "created");
    resetPlannerState();
  } catch (error) {
    console.error("Failed to create poll", error);
    setFormFeedback(error.message ?? "Unable to create poll. Please try again.", "error");
  } finally {
    setSubmitting(false);
  }
};

const handleDocumentClick = (event) => {
  if (!isTimezonePopoverVisible()) return;
  if (
    refs.timezonePopover.contains(event.target) ||
    refs.timezoneButton.contains(event.target)
  ) {
    return;
  }
  setTimezonePopoverVisible(false);
};

const handleDocumentKeydown = (event) => {
  if (event.key === "Escape" && isTimezonePopoverVisible()) {
    setTimezonePopoverVisible(false);
  }
};

const attachEventHandlers = () => {
  refs.navButtons.forEach((btn) => btn.addEventListener("click", handleMonthNav));
  refs.timeToggle.addEventListener("change", (event) =>
    handleTimeToggleChange(event.target.checked)
  );
  refs.timezoneButton.addEventListener("click", handleTimezoneButtonClick);
  refs.timezoneClose.addEventListener("click", () => setTimezonePopoverVisible(false));
  refs.timezoneSearch.addEventListener("input", (event) =>
    handleTimezoneSearch(event.target.value)
  );
  refs.createPollButton.addEventListener("click", handleCreatePoll);
  refs.newPollButton?.addEventListener("click", handleNewPollClick);
  refs.backToDashboard?.addEventListener("click", handleBackToDashboard);
  refs.joinPollButton?.addEventListener("click", handleJoinPoll);
  refs.joinCodeInput?.addEventListener("keydown", handleJoinInputKeydown);
  refs.pollTabs?.forEach((tab) =>
    tab.addEventListener("click", () => handlePollTabChange(tab.dataset.pollStatus))
  );
  refs.createdOnlyToggle?.addEventListener("change", (event) =>
    handleCreatedOnlyToggle(event.target.checked)
  );
  wirePressAnimation(refs.createPollButton);
  wirePressAnimation(refs.joinPollButton);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
};

const hydrateState = async () => {
  const user = getTelegramUser();
  if (user) {
    updateState({ telegramUser: user });
  }
  const savedState = await loadUserState(user?.id ?? "guest");
  if (savedState) {
    updateState(savedState);
  }
  const today = new Date();
  updateState({
    today,
    currentView: new Date(today.getFullYear(), today.getMonth(), 1),
  });
};

const persistState = () => {
  saveUserState(getStorageId(), getState());
};

const bootstrap = async () => {
  initTelegram();
  refs = initUI();
  if (refs.createPollButton) {
    refs.createPollButton.textContent = CREATE_LABEL_DEFAULT;
  }
  await hydrateState();
  syncScreenVisibility(getState().screen);
  renderPollSection();
  setJoinFeedback("");
  setFormFeedback("");
  attachEventHandlers();
  renderAll();
};

window.addEventListener("beforeunload", persistState);
window.addEventListener("DOMContentLoaded", bootstrap);
