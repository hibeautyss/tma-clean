import { initTelegram, getTelegramUser } from "./telegram.js";
import { loadUserState, saveUserState, createRemotePoll, fetchPollDetail, submitVote } from "./api.js";
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
  renderPollSummary,
  renderPollGrid,
  renderCommentList,
  setVoteCommentValue,
  setVoteFeedbackMessage,
  setVoteNameValue,
  toggleNameModal,
  setContinueButtonEnabled,
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
  POLL: "poll",
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
const AVAILABILITY_SEQUENCE = [null, "yes", "maybe", "no"];
const POSITIVE_AVAILABILITY = new Set(["yes", "maybe"]);

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
  let normalized = SCREENS.DASHBOARD;
  if (screen === SCREENS.CREATE) {
    normalized = SCREENS.CREATE;
  } else if (screen === SCREENS.POLL) {
    normalized = SCREENS.POLL;
  }
  setScreenVisibility(normalized);
  return normalized;
};

const setActiveScreen = (screen) => {
  const normalized = syncScreenVisibility(screen);
  updateState({ screen: normalized });
  schedulePersist();
  if (normalized === SCREENS.CREATE) {
    renderAll();
  } else if (normalized === SCREENS.POLL) {
    renderPollDetail();
  }
};

const normalizePollData = (poll) => {
  if (!poll) return null;
  const options = Array.isArray(poll.poll_options) ? [...poll.poll_options] : [];
  options.sort((a, b) => {
    const dateA = new Date(`${a.option_date}T00:00:00Z`).valueOf();
    const dateB = new Date(`${b.option_date}T00:00:00Z`).valueOf();
    if (dateA === dateB) {
      return (a.start_minute ?? 0) - (b.start_minute ?? 0);
    }
    return dateA - dateB;
  });
  return { ...poll, poll_options: options };
};

const mapVotesToParticipants = (votes = []) =>
  votes.map((vote) => {
    const selections = {};
    (vote.vote_selections ?? []).forEach((selection) => {
      selections[selection.poll_option_id] = selection.availability;
    });
    return {
      id: vote.id,
      name: vote.voter_name ?? "Guest",
      meta: new Date(vote.created_at ?? Date.now()).toLocaleString(),
      comment: vote.voter_contact ?? "",
      selections,
    };
  });

const buildInitialDraft = (poll) => {
  const selections = {};
  (poll?.poll_options ?? []).forEach((option) => {
    selections[option.id] = null;
  });
  return selections;
};

const getNextAvailability = (current) => {
  const index = AVAILABILITY_SEQUENCE.indexOf(current ?? null);
  const nextIndex = (index + 1) % AVAILABILITY_SEQUENCE.length;
  return AVAILABILITY_SEQUENCE[nextIndex];
};

const hasPositiveSelection = (selections = {}) =>
  Object.values(selections).some((value) => POSITIVE_AVAILABILITY.has(value));

const getDefaultParticipantName = () => {
  const user = getState().telegramUser;
  if (!user) return "";
  return user.first_name || user.username || user.last_name || "";
};

const renderPollDetail = () => {
  const poll = getState().activePoll;
  if (!poll) return;
  const participants = getState().activePollVotes ?? [];
  const draft = getState().voteDraft ?? {};
  const hasSelections = hasPositiveSelection(draft);
  renderPollSummary(poll, participants.length);
  renderPollGrid({
    options: poll.poll_options,
    participants,
    draft,
    onToggle: handleDraftSlotToggle,
  });
  const comments = participants
    .filter((participant) => participant.comment)
    .map((participant) => ({ name: participant.name, body: participant.comment }));
  renderCommentList(comments);
  setVoteCommentValue(getState().voteComment ?? "");
  setContinueButtonEnabled(hasSelections);
};

const applyPollDetail = (pollData, relation = "joined") => {
  const normalizedPoll = normalizePollData(pollData);
  const participants = mapVotesToParticipants(pollData.votes ?? []);
  updateState({
    activePoll: normalizedPoll,
    activePollVotes: participants,
    voteDraft: buildInitialDraft(normalizedPoll),
    voteComment: "",
    voteName: getDefaultParticipantName(),
    nameModalOpen: false,
  });
  setVoteCommentValue("");
  setVoteFeedbackMessage("");
  renderPollDetail();
  if (relation) {
    recordPollHistoryEntry(normalizedPoll, relation);
  }
  setActiveScreen(SCREENS.POLL);
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
    const poll = await fetchPollDetail({ shareCode });
    if (!poll) {
      setJoinFeedback("No poll found with that code.", "error");
      return;
    }
    setJoinFeedback(`Loaded "${poll.title ?? "Untitled poll"}".`, "success");
    refs.joinCodeInput && (refs.joinCodeInput.value = "");
    applyPollDetail(poll, "joined");
  } catch (error) {
    console.error("Failed to join poll", error);
    setJoinFeedback(error.message ?? "Unable to join poll. Please try again.", "error");
  }
};

const handleDraftSlotToggle = (optionId) => {
  const poll = getState().activePoll;
  if (!poll || !optionId) return;
  const currentDraft = { ...(getState().voteDraft ?? {}) };
  currentDraft[optionId] = getNextAvailability(currentDraft[optionId]);
  updateState({ voteDraft: currentDraft });
  setVoteFeedbackMessage("");
  renderPollDetail();
};

const handleVoteCommentChange = (value) => {
  updateState({ voteComment: value });
  setVoteFeedbackMessage("");
};

const handleResetVote = () => {
  const poll = getState().activePoll;
  if (!poll) return;
  updateState({
    voteDraft: buildInitialDraft(poll),
    voteComment: "",
  });
  setVoteCommentValue("");
  setVoteFeedbackMessage("");
  renderPollDetail();
};

const openNameModal = () => {
  const defaultName = getState().voteName || getDefaultParticipantName();
  updateState({ voteName: defaultName, nameModalOpen: true });
  setVoteNameValue(defaultName);
  toggleNameModal(true);
};

const closeNameModal = () => {
  updateState({ nameModalOpen: false });
  toggleNameModal(false);
};

const handleContinueVote = () => {
  const draft = getState().voteDraft ?? {};
  if (!hasPositiveSelection(draft)) {
    setVoteFeedbackMessage("Select at least one slot (green or yellow) first.", "error");
    return;
  }
  setVoteFeedbackMessage("");
  openNameModal();
};

const refreshActivePoll = async () => {
  const poll = getState().activePoll;
  if (!poll?.id) return;
  try {
    const latest = await fetchPollDetail({ pollId: poll.id });
    if (!latest) return;
    const normalized = normalizePollData(latest);
    updateState({
      activePoll: normalized,
      activePollVotes: mapVotesToParticipants(latest.votes ?? []),
    });
    renderPollDetail();
  } catch (error) {
    console.error("Failed to refresh poll", error);
  }
};

const handleSubmitVote = async () => {
  const poll = getState().activePoll;
  if (!poll || getState().isVoting) return;
  const draft = getState().voteDraft ?? {};
  if (!hasPositiveSelection(draft)) {
    setVoteFeedbackMessage("Select at least one slot (green or yellow) first.", "error");
    return;
  }
  const nameValue = refs.voteNameInput?.value?.trim() || getState().voteName?.trim();
  if (!nameValue) {
    setVoteFeedbackMessage("Please provide your name before submitting.", "error");
    return;
  }
  updateState({ isVoting: true });
  try {
    const selections = (poll.poll_options ?? []).map((option) => ({
      optionId: option.id,
      availability: draft[option.id] ?? "no",
    }));
    await submitVote({
      pollId: poll.id,
      voterName: nameValue,
      voterContact: getState().voteComment?.trim() || null,
      selections,
    });
    setVoteFeedbackMessage("Thanks! Your vote has been recorded.", "success");
    updateState({
      voteDraft: buildInitialDraft(poll),
      voteComment: "",
      voteName: nameValue,
      nameModalOpen: false,
      isVoting: false,
    });
    setVoteCommentValue("");
    toggleNameModal(false);
    await refreshActivePoll();
  } catch (error) {
    console.error("Failed to submit vote", error);
    setVoteFeedbackMessage(error.message ?? "Unable to submit vote. Try again.", "error");
    updateState({ isVoting: false });
  }
};

const handleBackToDashboardFromPoll = () => {
  setActiveScreen(SCREENS.DASHBOARD);
};

const handleNameInputChange = (value) => {
  updateState({ voteName: value });
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
  refs.voteComment?.addEventListener("input", (event) => handleVoteCommentChange(event.target.value));
  refs.resetVoteButton?.addEventListener("click", handleResetVote);
  refs.continueVoteButton?.addEventListener("click", handleContinueVote);
  refs.backToDashboardFromPoll?.addEventListener("click", handleBackToDashboardFromPoll);
  refs.modalBackButton?.addEventListener("click", closeNameModal);
  refs.closeNameModal?.addEventListener("click", closeNameModal);
  refs.submitVoteButton?.addEventListener("click", handleSubmitVote);
  refs.voteNameInput?.addEventListener("input", (event) => handleNameInputChange(event.target.value));
  wirePressAnimation(refs.createPollButton);
  wirePressAnimation(refs.joinPollButton);
  wirePressAnimation(refs.continueVoteButton);
  wirePressAnimation(refs.submitVoteButton);
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
  if (getState().screen === SCREENS.POLL) {
    renderPollDetail();
  }
  renderPollSection();
  setJoinFeedback("");
  setFormFeedback("");
  attachEventHandlers();
  renderAll();
};

window.addEventListener("beforeunload", persistState);
window.addEventListener("DOMContentLoaded", bootstrap);
