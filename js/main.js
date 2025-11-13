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
  setManageMenuVisibility,
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

const TIMEZONE_CATALOG = [{ zone: "Europe/Moscow", offset: "UTC+03:00", cities: ["Moscow (GMT+3)"] }];
const DEFAULT_TIMEZONE = TIMEZONE_CATALOG[0].zone;

const formatTimezoneDisplay = (zone) => {
  const entry = TIMEZONE_CATALOG.find((item) => item.zone === zone);
  return entry?.cities?.[0] ?? zone;
};

const sanitizeTimezone = (zone) =>
  TIMEZONE_CATALOG.some((entry) => entry.zone === zone) ? zone : DEFAULT_TIMEZONE;

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
const VOTE_TRACKER_KEY = "submittedPollVotes";

const readVoteTracker = () => {
  try {
    const raw = localStorage.getItem(VOTE_TRACKER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to read vote tracker", error);
    return {};
  }
};

const writeVoteTracker = (payload = {}) => {
  try {
    localStorage.setItem(VOTE_TRACKER_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Unable to persist vote tracker", error);
  }
};

const getTrackedVote = (pollId) => {
  if (!pollId) return null;
  const tracker = readVoteTracker();
  return tracker[pollId] ?? null;
};

const upsertTrackedVote = (pollId, payload) => {
  if (!pollId || !payload) return;
  const tracker = readVoteTracker();
  tracker[pollId] = payload;
  writeVoteTracker(tracker);
};

const removeTrackedVote = (pollId) => {
  if (!pollId) return;
  const tracker = readVoteTracker();
  if (!tracker[pollId]) {
    return;
  }
  delete tracker[pollId];
  writeVoteTracker(tracker);
};

const rememberVoteSubmission = (poll, vote) => {
  if (!poll?.id || !vote?.id) return;
  upsertTrackedVote(poll.id, {
    voteId: vote.id,
    shareCode: poll.share_code ?? null,
    voterName: vote.voter_name ?? null,
    timestamp: new Date().toISOString(),
  });
};

const hasTrackedVoteForPoll = (pollData) => {
  if (!pollData?.id) return false;
  const entry = getTrackedVote(pollData.id);
  if (!entry?.voteId) return false;
  if (!Array.isArray(pollData.votes)) {
    return true;
  }
  const hasMatch = pollData.votes.some((vote) => vote.id === entry.voteId);
  if (hasMatch) {
    return true;
  }
  removeTrackedVote(pollData.id);
  return false;
};

const normalizeStatus = (status) => (POLL_STATUSES.includes(status) ? status : POLL_STATUSES[0]);

const getPollFilters = () => {
  const filters = getState().pollFilters ?? {};
  return {
    status: normalizeStatus(filters.status),
    createdOnly: Boolean(filters.createdOnly),
  };
};

const getPollHistory = () => (Array.isArray(getState().pollHistory) ? getState().pollHistory : []);
const getPollHistoryKey = (entry) => entry?.id ?? entry?.share_code ?? null;
const getTimestampValue = (value) => {
  if (!value) return 0;
  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const dedupePollHistory = (entries = []) => {
  if (!Array.isArray(entries)) return [];
  const indexByKey = new Map();
  const cleaned = [];
  entries.forEach((entry) => {
    if (!entry) return;
    const key = getPollHistoryKey(entry);
    if (!key) {
      cleaned.push({ ...entry });
      return;
    }
    if (!indexByKey.has(key)) {
      indexByKey.set(key, cleaned.length);
      cleaned.push({ ...entry });
      return;
    }
    const existingIndex = indexByKey.get(key);
    const existing = cleaned[existingIndex];
    const relation =
      existing.relation === "created" || entry.relation === "created"
        ? "created"
        : existing.relation;
    const timestamp =
      getTimestampValue(entry.timestamp) > getTimestampValue(existing.timestamp)
        ? entry.timestamp
        : existing.timestamp;
    cleaned[existingIndex] = {
      ...existing,
      relation,
      timestamp,
    };
  });
  return cleaned;
};

const renderPollSection = () => {
  const filters = getPollFilters();
  const history = dedupePollHistory(
    getPollHistory()
      .filter((entry) => normalizeStatus(entry.status ?? filters.status) === filters.status)
      .filter((entry) => !filters.createdOnly || entry.relation === "created")
      .sort(
        (a, b) =>
          new Date(b.timestamp ?? 0).valueOf() - new Date(a.timestamp ?? 0).valueOf()
    )
  );
  setPollTabActive(filters.status);
  setCreatedOnlyFilter(filters.createdOnly);
  renderPollHistory(history, {
    onSelect: handleHistorySelect,
    onManage: handleHistoryManage,
  });
};

const recordPollHistoryEntry = (poll, relation) => {
  if (!poll?.id && !poll?.share_code) {
    return;
  }
  const currentUserId = getState().telegramUser?.id;
  const derivedRelation =
    relation === "created" || (poll.creator?.id && poll.creator.id === currentUserId)
      ? "created"
      : relation ?? "joined";
  const entry = {
    id: poll.id,
    share_code: poll.share_code,
    title: poll.title ?? "Untitled poll",
    status: normalizeStatus(poll.status ?? POLL_STATUSES[0]),
    relation: derivedRelation,
    creator_id: poll.creator?.id ?? null,
    timestamp: poll.created_at ?? new Date().toISOString(),
  };
  const history = dedupePollHistory([entry, ...getPollHistory()]);
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

const openPollFromHistory = async (entry, relationOverride) => {
  if (!entry) return;
  const target = {
    pollId: entry.id,
    shareCode: entry.share_code,
  };
  if (!target.pollId && !target.shareCode) {
    setJoinFeedback("Missing poll reference.", "error");
    return;
  }
  try {
    const poll = await fetchPollDetail(target);
    if (!poll) {
      setJoinFeedback("Unable to load that poll.", "error");
      return;
    }
    applyPollDetail(poll, relationOverride ?? entry.relation ?? "joined");
  } catch (error) {
    console.error("Failed to open poll from history", error);
    setJoinFeedback(error.message ?? "Unable to open that poll right now.", "error");
  }
};

const handleHistorySelect = (entry) => openPollFromHistory(entry);
const handleHistoryManage = (entry) => openPollFromHistory(entry, "created");

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
  const readOnly = Boolean(getState().hasSubmittedVote);
  const canManage = Boolean(getState().canManageActivePoll);
  const manageMenuOpen = Boolean(getState().manageMenuOpen && canManage);
  const hasSelections = hasPositiveSelection(draft);
  renderPollSummary(
    {
      ...poll,
      timezone_label: formatTimezoneDisplay(poll.timezone),
      canManage,
    },
    participants.length
  );
  setManageMenuVisibility(manageMenuOpen);
  renderPollGrid({
    options: poll.poll_options,
    participants,
    draft,
    onToggle: readOnly ? undefined : handleDraftSlotToggle,
    isReadOnly: readOnly,
  });
  const comments = participants
    .filter((participant) => participant.comment)
    .map((participant) => ({ name: participant.name, body: participant.comment }));
  renderCommentList(comments);
  setVoteCommentValue(getState().voteComment ?? "");
  setContinueButtonEnabled(!readOnly && hasSelections);
};

const setManageMenuState = (open) => {
  const canManage = Boolean(getState().canManageActivePoll);
  const nextOpen = open && canManage;
  updateState({ manageMenuOpen: nextOpen });
  setManageMenuVisibility(nextOpen);
};

const closeManageMenu = () => setManageMenuState(false);

const handleActivePollManage = () => {
  if (!getState().canManageActivePoll) return;
  setManageMenuState(!getState().manageMenuOpen);
};

const handleManageEditDetails = () => {
  if (!getState().canManageActivePoll) return;
  closeManageMenu();
  console.debug("Edit details action selected.");
};

const handleManageEditOptions = () => {
  if (!getState().canManageActivePoll) return;
  closeManageMenu();
  console.debug("Edit options action selected.");
};

const applyPollDetail = (pollData, relation = "joined") => {
  const userId = getState().telegramUser?.id;
  const derivedRelation =
    relation === "created" || (pollData.creator?.id && pollData.creator.id === userId)
      ? "created"
      : "joined";
  const normalizedPoll = { ...normalizePollData(pollData), relation: derivedRelation };
  const participants = mapVotesToParticipants(pollData.votes ?? []);
  const alreadySubmitted = hasTrackedVoteForPoll(pollData);
  const canManage = derivedRelation === "created";
  updateState({
    activePoll: normalizedPoll,
    activePollVotes: participants,
    voteDraft: buildInitialDraft(normalizedPoll),
    voteComment: "",
    voteName: getDefaultParticipantName(),
    nameModalOpen: false,
    hasSubmittedVote: alreadySubmitted,
    activePollRelation: derivedRelation,
    canManageActivePoll: canManage,
    manageMenuOpen: false,
  });
  setVoteCommentValue("");
  if (alreadySubmitted) {
    setVoteFeedbackMessage("You already submitted your availability for this poll.", "success");
  } else {
    setVoteFeedbackMessage("");
  }
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
  setTimezoneLabel(formatTimezoneDisplay(state.timezone));
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
  setTimezoneLabel(formatTimezoneDisplay(zone));
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
  setJoinFeedback("");
  try {
    const poll = await fetchPollDetail({ shareCode });
    if (!poll) {
      setJoinFeedback("No poll found with that code.", "error");
      return;
    }
    setJoinFeedback("");
    refs.joinCodeInput && (refs.joinCodeInput.value = "");
    applyPollDetail(poll, "joined");
  } catch (error) {
    console.error("Failed to join poll", error);
    setJoinFeedback(error.message ?? "Unable to join poll. Please try again.", "error");
  }
};

const handleDraftSlotToggle = (optionId) => {
  if (getState().hasSubmittedVote) return;
  const poll = getState().activePoll;
  if (!poll || !optionId) return;
  const currentDraft = { ...(getState().voteDraft ?? {}) };
  currentDraft[optionId] = getNextAvailability(currentDraft[optionId]);
  updateState({ voteDraft: currentDraft });
  setVoteFeedbackMessage("");
  renderPollDetail();
};

const handleVoteCommentChange = (value) => {
  if (getState().hasSubmittedVote) return;
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
  if (getState().hasSubmittedVote) return;
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
    const alreadySubmitted = hasTrackedVoteForPoll(latest);
    const previouslyLocked = Boolean(getState().hasSubmittedVote);
    const userId = getState().telegramUser?.id;
    const derivedRelation =
      getState().activePollRelation === "created" ||
      (latest.creator?.id && latest.creator.id === userId)
        ? "created"
        : "joined";
    const canManage = derivedRelation === "created";
    const previousMenuState = Boolean(getState().manageMenuOpen);
    updateState({
      activePoll: { ...normalized, relation: derivedRelation },
      activePollVotes: mapVotesToParticipants(latest.votes ?? []),
      hasSubmittedVote: alreadySubmitted,
      activePollRelation: derivedRelation,
      canManageActivePoll: canManage,
      manageMenuOpen: canManage ? previousMenuState : false,
    });
    if (alreadySubmitted && !previouslyLocked) {
      setVoteFeedbackMessage("You already submitted your availability for this poll.", "success");
    }
    renderPollDetail();
  } catch (error) {
    console.error("Failed to refresh poll", error);
  }
};

const handleSubmitVote = async () => {
  const poll = getState().activePoll;
  if (!poll || getState().isVoting || getState().hasSubmittedVote) return;
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
    const recordedVote = await submitVote({
      pollId: poll.id,
      voterName: nameValue,
      voterContact: getState().voteComment?.trim() || null,
      selections,
    });
    rememberVoteSubmission(poll, recordedVote);
    setVoteFeedbackMessage("Thanks! Your vote has been recorded.", "success");
    updateState({
      voteDraft: buildInitialDraft(poll),
      voteComment: "",
      voteName: nameValue,
      nameModalOpen: false,
      isVoting: false,
      hasSubmittedVote: true,
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
  if (isTimezonePopoverVisible()) {
    const interactedWithTimezone =
      refs.timezonePopover.contains(event.target) ||
      refs.timezoneButton.contains(event.target) ||
      refs.pollTimezoneButton?.contains(event.target);
    if (!interactedWithTimezone) {
      setTimezonePopoverVisible(false);
    }
  }

  if (getState().manageMenuOpen) {
    const interactedWithManage =
      refs.manageMenu?.contains(event.target) || refs.pollManageButton?.contains(event.target);
    if (!interactedWithManage) {
      closeManageMenu();
    }
  }
};

const handleDocumentKeydown = (event) => {
  if (event.key !== "Escape") return;
  if (isTimezonePopoverVisible()) {
    setTimezonePopoverVisible(false);
  }
  if (getState().manageMenuOpen) {
    closeManageMenu();
  }
};

const attachEventHandlers = () => {
  refs.navButtons.forEach((btn) => btn.addEventListener("click", handleMonthNav));
  refs.timeToggle.addEventListener("change", (event) =>
    handleTimeToggleChange(event.target.checked)
  );
  refs.timezoneButton.addEventListener("click", handleTimezoneButtonClick);
  refs.pollTimezoneButton?.addEventListener("click", handleTimezoneButtonClick);
  refs.pollManageButton?.addEventListener("click", handleActivePollManage);
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
  refs.manageEditDetails?.addEventListener("click", handleManageEditDetails);
  refs.manageEditOptions?.addEventListener("click", handleManageEditOptions);
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
  updateState({ pollHistory: dedupePollHistory(getPollHistory()) });
  updateState({ timezone: sanitizeTimezone(getState().timezone) });
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

