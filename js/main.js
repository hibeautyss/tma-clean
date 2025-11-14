import {
  initTelegram,
  getTelegramUser,
  getTelegramInitData,
  setTelegramBackButtonHandler,
  setTelegramBackButtonVisible,
} from "./telegram.js";
import {
  loadUserState,
  saveUserState,
  createRemotePoll,
  fetchPollDetail,
  submitVote,
  updatePollDetails,
  updatePollOptions,
  updatePollStatus,
} from "./api.js";
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
  setEditDetailsValues,
  setEditDetailsFeedback,
  setEditDetailsSaving,
  toggleEditDetailsModal,
  setEditOptionsSpecifyToggle,
  setEditOptionsFeedback,
  setEditOptionsSaving,
  toggleEditOptionsModal,
  setEditOptionsTimezoneLabel,
  setPollStatusActions,
  setTelegramUserIdentity,
  setInviteLinkDetails,
  setInviteCopyButtonState,
} from "./ui.js";

const TIME_CONFIG = {
  minutesInDay: 24 * 60,
  timeStep: 15,
  defaultSlot: { start: 12 * 60, end: 13 * 60 },
};
const DEFAULT_DURATION = TIME_CONFIG.defaultSlot.end - TIME_CONFIG.defaultSlot.start;
const INVITE_PARAM_PREFIX = "poll:";
const INVITE_COPY_RESET_MS = 2000;

const NORMALIZE = (value) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const TIMEZONE_CATALOG = [{ zone: "Europe/Moscow", offset: "UTC+03:00", cities: ["Moscow (GMT+3)"] }];
const DEFAULT_TIMEZONE = TIMEZONE_CATALOG[0].zone;

const sanitizeShareCode = (code = "") => {
  if (typeof code !== "string") return "";
  return code.replace(/[^0-9a-z]/gi, "").toUpperCase();
};

const sanitizeBotUsername = (value = "") => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/^@/, "");
  return trimmed.replace(/[^0-9a-z_]/gi, "").toLowerCase();
};

const resolveBotUsername = () => {
  const doc = typeof document !== "undefined" ? document : null;
  const win = typeof window !== "undefined" ? window : null;
  const sources = [
    () => win?.__APP_CONFIG__?.botUsername,
    () => win?.__TMA_BOT_USERNAME__,
    () => doc?.body?.dataset?.botUsername,
    () => doc?.documentElement?.dataset?.botUsername,
  ];
  for (const source of sources) {
    const candidate = sanitizeBotUsername(source?.());
    if (candidate) {
      return candidate;
    }
  }
  return "";
};

const BOT_USERNAME = resolveBotUsername();

const buildInvitePayload = (shareCode) => {
  const safe = sanitizeShareCode(shareCode);
  return safe ? `${INVITE_PARAM_PREFIX}${safe}` : "";
};

const buildInviteLink = (shareCode) => {
  const payload = buildInvitePayload(shareCode);
  if (!payload || !BOT_USERNAME) {
    return "";
  }
  return `https://t.me/${BOT_USERNAME}?startapp=${payload}`;
};

const parseInviteStartParam = (raw = "") => {
  if (!raw) return "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const prefix = INVITE_PARAM_PREFIX.toLowerCase();
  const normalized = decoded.toLowerCase().startsWith(prefix)
    ? decoded.slice(INVITE_PARAM_PREFIX.length)
    : decoded;
  return sanitizeShareCode(normalized);
};

let cachedStartParam = null;
let latestInviteLink = "";
let inviteCopyResetTimer = null;

const getStartParamValue = () => {
  if (cachedStartParam !== null) {
    return cachedStartParam;
  }
  const initParam = getTelegramInitData()?.start_param ?? "";
  let queryParam = "";
  if (typeof window !== "undefined") {
    try {
      queryParam = new URLSearchParams(window.location.search).get("tgWebAppStartParam") ?? "";
    } catch {
      queryParam = "";
    }
  }
  cachedStartParam = (initParam || queryParam || "").trim();
  return cachedStartParam;
};

const resetInviteLinkDetails = () => {
  latestInviteLink = "";
  clearTimeout(inviteCopyResetTimer);
  inviteCopyResetTimer = null;
  setInviteLinkDetails({ link: "", shareCode: "" });
  setInviteCopyButtonState("idle");
};

const showInviteLinkForShareCode = (shareCode) => {
  const safeCode = sanitizeShareCode(shareCode);
  if (!safeCode) {
    resetInviteLinkDetails();
    return;
  }
  const inviteLink = buildInviteLink(safeCode);
  latestInviteLink = inviteLink;
  setInviteLinkDetails({ link: inviteLink, shareCode: safeCode });
  setInviteCopyButtonState("idle");
  if (!inviteLink && !BOT_USERNAME) {
    console.warn(
      "No Telegram bot username configured. Set data-bot-username on <body> to enable invite links."
    );
  }
};

const copyToClipboard = async (text) => {
  if (!text) return;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
};

const handleCopyInviteLink = async () => {
  if (!latestInviteLink) return;
  try {
    await copyToClipboard(latestInviteLink);
    setInviteCopyButtonState("copied");
  } catch (error) {
    console.error("Failed to copy invite link", error);
    setInviteCopyButtonState("idle");
    return;
  }
  clearTimeout(inviteCopyResetTimer);
  inviteCopyResetTimer = setTimeout(() => setInviteCopyButtonState("idle"), INVITE_COPY_RESET_MS);
};

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

const formatTelegramDisplayName = (user) => {
  if (!user) return "";
  const nameParts = [user.first_name, user.last_name].filter(Boolean);
  if (nameParts.length) {
    return nameParts.join(" ");
  }
  if (user.username) {
    return `@${user.username}`;
  }
  if (user.id) {
    return `User ${user.id}`;
  }
  return "Telegram user";
};

const buildTelegramMeta = (user) => {
  if (!user) return "";
  const meta = [];
  if (user.username) {
    meta.push(`@${user.username}`);
  }
  if (user.id) {
    meta.push(`ID ${user.id}`);
  }
  return meta.join(" | ");
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

const shouldShowTelegramBackButton = (screen) =>
  screen === SCREENS.CREATE || screen === SCREENS.POLL;

const syncTelegramBackButtonVisibility = (screen = getState().screen) => {
  const visible = shouldShowTelegramBackButton(screen);
  setTelegramBackButtonVisible(visible);
  return visible;
};

const syncTelegramIdentity = () => {
  const user = getState().telegramUser;
  if (!user) {
    setTelegramUserIdentity(null);
    return;
  }
  setTelegramUserIdentity({
    name: formatTelegramDisplayName(user),
    meta: buildTelegramMeta(user),
  });
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

const isPollFinishedState = (poll) => normalizeStatus(poll?.status) === "finished";

const getLockedVotingMessage = (poll) =>
  isPollFinishedState(poll) ? "This poll is finished." : "You already submitted your availability for this poll.";

const isVotingLocked = () => {
  const poll = getState().activePoll;
  if (!poll) return false;
  return isPollFinishedState(poll) || Boolean(getState().hasSubmittedVote);
};

const getPollFilters = () => {
  const filters = getState().pollFilters ?? {};
  return {
    status: normalizeStatus(filters.status),
    createdOnly: Boolean(filters.createdOnly),
  };
};

const getPollHistory = () => (Array.isArray(getState().pollHistory) ? getState().pollHistory : []);
const getPollHistoryKey = (entry) => entry?.share_code ?? entry?.id ?? null;
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
      status: normalizeStatus(entry.status ?? existing.status),
    };
  });
  return cleaned;
};

const normalizePollReference = (reference) => {
  if (!reference || typeof reference !== "object") {
    return null;
  }
  const pollId = reference.pollId ?? null;
  const shareCode = reference.shareCode ?? null;
  if (!pollId && !shareCode) {
    return null;
  }
  return { pollId, shareCode };
};

const buildPollReference = (poll) => {
  if (!poll) {
    return null;
  }
  const pollId = poll.id ?? null;
  const shareCode = poll.share_code ?? null;
  if (!pollId && !shareCode) {
    return null;
  }
  return { pollId, shareCode };
};

const clearActivePollState = () => {
  updateState({
    activePoll: null,
    activePollRef: null,
    activePollVotes: [],
    voteDraft: null,
    voteComment: "",
    voteName: "",
    nameModalOpen: false,
    hasSubmittedVote: false,
    canManageActivePoll: false,
    manageMenuOpen: false,
    activePollRelation: "joined",
    isUpdatingPollStatus: false,
  });
  syncPollStatusActions();
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

const updatePollHistoryDetails = (poll) => {
  if (!poll?.id) return;
  const history = getPollHistory();
  if (!history.length) return;
  let changed = false;
  const patched = history.map((entry) => {
    if (entry.id !== poll.id) {
      return entry;
    }
    const next = {
      ...entry,
      title: poll.title ?? entry.title,
      status: normalizeStatus(poll.status ?? entry.status),
    };
    const timestamp =
      poll.timestamp ?? poll.updated_at ?? poll.created_at ?? entry.timestamp;
    if (timestamp) {
      next.timestamp = timestamp;
    }
    if (
      next.title === entry.title &&
      next.status === entry.status &&
      next.timestamp === entry.timestamp
    ) {
      return entry;
    }
    changed = true;
    return next;
  });
  if (!changed) return;
  updateState({ pollHistory: patched });
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
  syncTelegramBackButtonVisibility(normalized);
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
  return { ...poll, poll_options: options, status: normalizeStatus(poll.status) };
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
  if (!poll) {
    syncPollStatusActions();
    return;
  }
  const participants = getState().activePollVotes ?? [];
  const draft = getState().voteDraft ?? {};
  const pollClosed = isPollFinishedState(poll);
  const readOnly = pollClosed || Boolean(getState().hasSubmittedVote);
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
  syncPollStatusActions();
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

function syncPollStatusActions() {
  const poll = getState().activePoll;
  setPollStatusActions({
    status: poll?.status ?? null,
    canManage: getState().canManageActivePoll,
    isWorking: getState().isUpdatingPollStatus,
  });
}

const setManageMenuState = (open) => {
  const canManage = Boolean(getState().canManageActivePoll);
  const nextOpen = open && canManage;
  updateState({ manageMenuOpen: nextOpen });
  setManageMenuVisibility(nextOpen);
  syncPollStatusActions();
};

const closeManageMenu = () => setManageMenuState(false);

const handleActivePollManage = () => {
  if (!getState().canManageActivePoll) return;
  setManageMenuState(!getState().manageMenuOpen);
};

const changePollStatus = async (nextStatus) => {
  const poll = getState().activePoll;
  if (
    !poll?.id ||
    !getState().canManageActivePoll ||
    getState().isUpdatingPollStatus ||
    normalizeStatus(poll.status) === nextStatus
  ) {
    setManageMenuState(false);
    return;
  }
  updateState({ isUpdatingPollStatus: true });
  setManageMenuState(false);
  syncPollStatusActions();
  setVoteFeedbackMessage("Updating poll status...", "info");
  try {
    await updatePollStatus({ pollId: poll.id, status: nextStatus });
    await refreshActivePoll();
    if (nextStatus === "finished") {
      setVoteFeedbackMessage("Poll finished. Voting is closed.", "success");
    } else {
      setVoteFeedbackMessage("Poll reopened. Participants can vote again.", "success");
    }
  } catch (error) {
    console.error("Failed to update poll status", error);
    setVoteFeedbackMessage(error.message ?? "Unable to update poll status. Try again.", "error");
  } finally {
    updateState({ isUpdatingPollStatus: false });
    syncPollStatusActions();
  }
};

const handleFinishPoll = () => changePollStatus("finished");

const handleReopenPoll = () => changePollStatus("live");

const isEditDetailsModalOpen = () =>
  Boolean(refs.editDetailsModal && !refs.editDetailsModal.hidden);

const openEditDetailsModal = () => {
  const poll = getState().activePoll;
  if (!poll) return;
  setEditDetailsValues({
    title: poll.title ?? "",
    location: poll.location ?? "",
    description: poll.description ?? "",
  });
  setEditDetailsFeedback("");
  setEditDetailsSaving(false);
  toggleEditDetailsModal(true);
  setTimeout(() => refs.editTitleInput?.focus(), 0);
};

const closeEditDetailsModal = () => {
  toggleEditDetailsModal(false);
  setEditDetailsSaving(false);
  setEditDetailsFeedback("");
};

const getEmptyEditOptionsDraft = () => {
  const today = getState().today ?? new Date();
  return {
    specifyTimesEnabled: false,
    selectedDates: new Map(),
    baselineOptionIds: [],
    timezone: getState().timezone ?? DEFAULT_TIMEZONE,
    currentView: new Date(today.getFullYear(), today.getMonth(), 1),
  };
};

const ensureEditOptionsDraft = () => {
  let draft = getState().editOptionsDraft;
  if (!draft || !(draft.selectedDates instanceof Map)) {
    draft = getEmptyEditOptionsDraft();
    updateState({ editOptionsDraft: draft });
  }
  return draft;
};

const buildEditOptionsDraftFromPoll = (poll) => {
  const base = getEmptyEditOptionsDraft();
  if (!poll) {
    return base;
  }
  base.specifyTimesEnabled = Boolean(poll.specify_times);
  base.timezone = poll.timezone ?? base.timezone;
  const selectedDates = new Map();
  (poll.poll_options ?? []).forEach((option) => {
    const iso = option.option_date;
    if (!iso) {
      return;
    }
    if (!selectedDates.has(iso)) {
      selectedDates.set(iso, { slots: [] });
    }
    const entry = selectedDates.get(iso);
    const start = Number.isFinite(option.start_minute)
      ? option.start_minute
      : TIME_CONFIG.defaultSlot.start;
    const end = Number.isFinite(option.end_minute)
      ? option.end_minute
      : Math.min(start + DEFAULT_DURATION, TIME_CONFIG.minutesInDay);
    entry.slots.push({
      id: option.id ?? null,
      start,
      end,
    });
  });
  if (base.specifyTimesEnabled) {
    selectedDates.forEach((_, iso) => ensureDefaultSlotForCollection(selectedDates, iso));
  }
  base.selectedDates = selectedDates;
  base.baselineOptionIds = (poll.poll_options ?? []).map((option) => option.id).filter(Boolean);
  const firstIso = selectedDates.keys().next().value;
  if (firstIso) {
    const seed = new Date(firstIso);
    base.currentView = new Date(seed.getFullYear(), seed.getMonth(), 1);
  }
  return base;
};

const setEditOptionsModalState = (open) => {
  updateState({ editOptionsModalOpen: open });
  toggleEditOptionsModal(open);
};

const isEditOptionsModalOpen = () =>
  Boolean(refs.editOptionsModal && !refs.editOptionsModal.hidden);

const clampEditorMinute = (value, max = TIME_CONFIG.minutesInDay) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, max));
};

const buildEditOptionsPayload = (draft) => {
  const specifyTimesEnabled = Boolean(draft?.specifyTimesEnabled);
  const selectedDates = draft?.selectedDates;
  if (!(selectedDates instanceof Map) || !selectedDates.size) {
    throw new Error("Select at least one date before saving.");
  }
  const normalized = [];
  selectedDates.forEach((entry, iso) => {
    if (!iso) return;
    const slots = Array.isArray(entry?.slots) ? entry.slots : [];
    if (!specifyTimesEnabled) {
      const slot = slots[0];
      normalized.push({
        id: slot?.id ?? null,
        option_date: iso,
        start_minute: null,
        end_minute: null,
      });
      return;
    }
    if (!slots.length) {
      throw new Error("Add at least one time slot for every selected date.");
    }
    slots.forEach((slot) => {
      const start = clampEditorMinute(slot.start, TIME_CONFIG.minutesInDay - TIME_CONFIG.timeStep);
      let end = clampEditorMinute(slot.end);
      if (end <= start) {
        end = Math.min(start + TIME_CONFIG.timeStep, TIME_CONFIG.minutesInDay);
      }
      normalized.push({
        id: slot.id ?? null,
        option_date: iso,
        start_minute: start,
        end_minute: end,
      });
    });
  });
  return { specifyTimesEnabled, normalized };
};

const deriveRemovedOptionIds = (draft, normalizedOptions) => {
  const toKey = (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };
  const baseline = new Set(
    (draft?.baselineOptionIds ?? []).map(toKey).filter(Boolean)
  );
  normalizedOptions.forEach((option) => {
    const key = toKey(option.id);
    if (key) {
      baseline.delete(key);
    }
  });
  return Array.from(baseline);
};

const applyUpdatedPollDetails = (updated) => {
  const current = getState().activePoll;
  if (!current) return;
  const next = {
    ...current,
    title: updated.title ?? current.title,
    location: updated.location ?? null,
    description: updated.description ?? null,
  };
  updateState({ activePoll: next });
  updatePollHistoryDetails(next);
  renderPollDetail();
};

const handleEditDetailsSubmit = async (event) => {
  event?.preventDefault?.();
  if (getState().isUpdatingPoll) return;
  const poll = getState().activePoll;
  if (!poll?.id) return;
  const title = refs.editTitleInput?.value ?? "";
  if (!title.trim()) {
    setEditDetailsFeedback("Title is required.", "error");
    refs.editTitleInput?.focus();
    return;
  }
  const location = refs.editLocationInput?.value ?? "";
  const description = refs.editDescriptionInput?.value ?? "";
  updateState({ isUpdatingPoll: true });
  setEditDetailsSaving(true);
  setEditDetailsFeedback("Saving changes...", "info");
  try {
    const updated = await updatePollDetails({
      pollId: poll.id,
      title,
      location,
      description,
    });
    applyUpdatedPollDetails(updated);
    closeEditDetailsModal();
  } catch (error) {
    console.error("Failed to update poll details", error);
    setEditDetailsFeedback(error.message ?? "Unable to save changes. Try again.", "error");
  } finally {
    updateState({ isUpdatingPoll: false });
    setEditDetailsSaving(false);
  }
};

const handleCancelEditDetails = (event) => {
  event?.preventDefault?.();
  if (getState().isUpdatingPoll) return;
  closeEditDetailsModal();
};

const handleManageEditDetails = () => {
  if (!getState().canManageActivePoll) return;
  closeManageMenu();
  openEditDetailsModal();
};

const renderEditOptionsUI = () => {
  const draft = ensureEditOptionsDraft();
  const selectedDates = draft.selectedDates ?? new Map();
  const calendarView = buildCalendarView({
    currentView: draft.currentView ?? getState().currentView,
    today: getState().today,
    selectedDates,
  });
  renderCalendar(
    calendarView,
    { onDateToggle: handleEditDateToggle },
    { grid: refs.editOptionsCalendarGrid, monthLabel: refs.editOptionsMonthLabel }
  );
  renderSelection(
    { selectedDates, specifyTimesEnabled: draft.specifyTimesEnabled },
    {
      onAddSlot: handleEditAddSlot,
      onRemoveSlot: handleEditRemoveSlot,
      onSlotChange: handleEditSlotChange,
      canAddSlot: (iso) => canAddSlotForCollection(selectedDates, iso),
    },
    TIME_CONFIG,
    {
      body: refs.editOptionsSelectionBody,
      empty: refs.editOptionsSelectionEmpty,
      count: refs.editOptionsSelectionCount,
    }
  );
  setEditOptionsSpecifyToggle(draft.specifyTimesEnabled);
  setEditOptionsTimezoneLabel(formatTimezoneDisplay(draft.timezone ?? DEFAULT_TIMEZONE));
};

const openEditOptionsModal = () => {
  const poll = getState().activePoll;
  if (!poll) return;
  const draft = buildEditOptionsDraftFromPoll(poll);
  updateState({
    editOptionsDraft: draft,
    isUpdatingOptions: false,
  });
  setEditOptionsFeedback("");
  setEditOptionsSaving(false);
  renderEditOptionsUI();
  setEditOptionsModalState(true);
};

const closeEditOptionsModal = () => {
  setEditOptionsModalState(false);
  setEditOptionsSaving(false);
  setEditOptionsFeedback("");
  updateState({
    isUpdatingOptions: false,
    editOptionsDraft: getEmptyEditOptionsDraft(),
  });
};

const handleEditOptionsSpecifyToggle = (checked) => {
  if (getState().isUpdatingOptions) return;
  const draft = ensureEditOptionsDraft();
  draft.specifyTimesEnabled = Boolean(checked);
  if (checked) {
    draft.selectedDates.forEach((_, iso) => ensureDefaultSlotForCollection(draft.selectedDates, iso));
  }
  renderEditOptionsUI();
};

const handleManageEditOptions = () => {
  if (!getState().canManageActivePoll) return;
  closeManageMenu();
  openEditOptionsModal();
};

const handleEditDateToggle = (iso) => {
  if (getState().isUpdatingOptions) return;
  const draft = ensureEditOptionsDraft();
  const selectedDates = draft.selectedDates;
  if (selectedDates.has(iso)) {
    selectedDates.delete(iso);
  } else {
    selectedDates.set(iso, { slots: [] });
    if (draft.specifyTimesEnabled) {
      ensureDefaultSlotForCollection(selectedDates, iso);
    }
  }
  renderEditOptionsUI();
};

const handleEditAddSlot = (iso) => {
  if (getState().isUpdatingOptions) return;
  const draft = ensureEditOptionsDraft();
  appendSlotToCollection(draft.selectedDates, iso);
  renderEditOptionsUI();
};

const handleEditRemoveSlot = (iso, index) => {
  if (getState().isUpdatingOptions) return;
  const draft = ensureEditOptionsDraft();
  removeSlotFromCollection(draft.selectedDates, iso, index);
  renderEditOptionsUI();
};

const handleEditSlotChange = (iso, index, type, value) => {
  if (getState().isUpdatingOptions) return;
  const draft = ensureEditOptionsDraft();
  updateSlotInCollection(draft.selectedDates, iso, index, type, value);
  renderEditOptionsUI();
};

const handleEditMonthNav = (event) => {
  event?.preventDefault?.();
  if (getState().isUpdatingOptions) return;
  const direction = event.currentTarget.dataset.editDirection;
  const draft = ensureEditOptionsDraft();
  const current = draft.currentView ? new Date(draft.currentView) : new Date(getState().today ?? new Date());
  current.setMonth(current.getMonth() + (direction === "next" ? 1 : -1));
  draft.currentView = current;
  renderEditOptionsUI();
};

const handleCancelEditOptions = (event) => {
  event?.preventDefault?.();
  if (getState().isUpdatingOptions) return;
  closeEditOptionsModal();
};

const handleEditOptionsSubmit = async (event) => {
  event?.preventDefault?.();
  if (getState().isUpdatingOptions) return;
  const poll = getState().activePoll;
  if (!poll?.id) return;
  const draft = ensureEditOptionsDraft();
  let payload;
  try {
    payload = buildEditOptionsPayload(draft);
  } catch (error) {
    setEditOptionsFeedback(error.message ?? "Please review your options.", "error");
    return;
  }
  const removedOptionIds = deriveRemovedOptionIds(draft, payload.normalized);
  updateState({ isUpdatingOptions: true });
  setEditOptionsSaving(true);
  setEditOptionsFeedback("Saving changes...", "info");
  try {
    await updatePollOptions({
      pollId: poll.id,
      specifyTimesEnabled: payload.specifyTimesEnabled,
      options: payload.normalized,
      removedOptionIds,
    });
    const latest = await fetchPollDetail({ pollId: poll.id });
    if (!latest) {
      throw new Error("Unable to refresh the poll after saving. Please try again.");
    }
    applyPollDetail(latest, getState().activePollRelation ?? "created");
    closeEditOptionsModal();
  } catch (error) {
    console.error("Failed to update poll options", error);
    setEditOptionsFeedback(error.message ?? "Unable to update options. Try again.", "error");
  } finally {
    updateState({ isUpdatingOptions: false });
    setEditOptionsSaving(false);
  }
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
    activePollRef: buildPollReference(normalizedPoll),
    activePollVotes: participants,
    voteDraft: buildInitialDraft(normalizedPoll),
    voteComment: "",
    voteName: getDefaultParticipantName(),
    nameModalOpen: false,
    hasSubmittedVote: alreadySubmitted,
    activePollRelation: derivedRelation,
    canManageActivePoll: canManage,
    manageMenuOpen: false,
    isUpdatingPollStatus: false,
  });
  setVoteCommentValue("");
  if (alreadySubmitted) {
    setVoteFeedbackMessage(getLockedVotingMessage(normalizedPoll), "success");
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

const buildCalendarView = (overrides = {}) => {
  const state = getState();
  const currentView = overrides.currentView ?? state.currentView;
  const today = overrides.today ?? state.today;
  const selectedDates = overrides.selectedDates ?? state.selectedDates;
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

const getSelectionEntry = (collection, iso) => {
  if (!(collection instanceof Map)) return null;
  const entry = collection.get(iso);
  if (!entry) return null;
  if (!Array.isArray(entry.slots)) {
    entry.slots = [];
  }
  return entry;
};

const ensureDefaultSlotForCollection = (collection, iso) => {
  const entry = getSelectionEntry(collection, iso);
  if (!entry) return;
  if (!entry.slots.length) {
    entry.slots.push({ ...TIME_CONFIG.defaultSlot, id: null });
  }
};

const appendSlotToCollection = (collection, iso) => {
  const entry = getSelectionEntry(collection, iso);
  if (!entry) {
    return;
  }
  if (!entry.slots.length) {
    ensureDefaultSlotForCollection(collection, iso);
    return;
  }
  const last = entry.slots[entry.slots.length - 1];
  const safeStart = Number.isFinite(last.end) ? last.end : last.start ?? 0;
  const duration = Math.max((last.end ?? last.start ?? 0) - (last.start ?? 0), DEFAULT_DURATION);
  const newStart = safeStart;
  const newEnd = newStart + duration;
  if (newEnd > TIME_CONFIG.minutesInDay) {
    return;
  }
  entry.slots.push({ start: newStart, end: newEnd, id: null });
};

const canAddSlotForCollection = (collection, iso) => {
  const entry = getSelectionEntry(collection, iso);
  if (!entry || !entry.slots.length) {
    return true;
  }
  const last = entry.slots[entry.slots.length - 1];
  const duration = Math.max((last.end ?? last.start ?? 0) - (last.start ?? 0), DEFAULT_DURATION);
  return (last.end ?? last.start ?? 0) + duration <= TIME_CONFIG.minutesInDay;
};

const removeSlotFromCollection = (collection, iso, index) => {
  const entry = getSelectionEntry(collection, iso);
  if (!entry) return;
  entry.slots.splice(index, 1);
};

const updateSlotInCollection = (collection, iso, index, type, value) => {
  const entry = getSelectionEntry(collection, iso);
  if (!entry) return false;
  const slot = entry.slots[index];
  if (!slot) return false;
  const safeValue =
    type === "start"
      ? clampEditorMinute(value, TIME_CONFIG.minutesInDay - TIME_CONFIG.timeStep)
      : clampEditorMinute(value);
  if (type === "start") {
    const currentDuration = Math.max((slot.end ?? slot.start ?? 0) - (slot.start ?? 0), TIME_CONFIG.timeStep);
    slot.start = safeValue;
    if (!Number.isFinite(slot.end) || slot.end <= slot.start) {
      slot.end = Math.min(slot.start + currentDuration, TIME_CONFIG.minutesInDay);
    }
  } else {
    if (safeValue <= slot.start) {
      slot.end = Math.min(slot.start + TIME_CONFIG.timeStep, TIME_CONFIG.minutesInDay);
    } else {
      slot.end = safeValue;
    }
  }
  return true;
};

const ensureDefaultSlot = (iso) => ensureDefaultSlotForCollection(getState().selectedDates, iso);

const appendSlot = (iso) => appendSlotToCollection(getState().selectedDates, iso);

const canAddSlotForDate = (iso) => canAddSlotForCollection(getState().selectedDates, iso);

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
  removeSlotFromCollection(getState().selectedDates, iso, index);
  renderAll();
  schedulePersist();
};

const handleSlotChange = (iso, index, type, value) => {
  updateSlotInCollection(getState().selectedDates, iso, index, type, value);
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
  if (isVotingLocked()) return;
  const poll = getState().activePoll;
  if (!poll || !optionId) return;
  const currentDraft = { ...(getState().voteDraft ?? {}) };
  currentDraft[optionId] = getNextAvailability(currentDraft[optionId]);
  updateState({ voteDraft: currentDraft });
  setVoteFeedbackMessage("");
  renderPollDetail();
};

const handleVoteCommentChange = (value) => {
  if (isVotingLocked()) return;
  updateState({ voteComment: value });
  setVoteFeedbackMessage("");
};

const handleResetVote = () => {
  const poll = getState().activePoll;
  if (!poll || isVotingLocked()) return;
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
  const poll = getState().activePoll;
  if (isPollFinishedState(poll)) {
    setVoteFeedbackMessage("This poll is finished. Voting is closed.", "error");
    return;
  }
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
      activePollRef: buildPollReference(latest),
      activePollVotes: mapVotesToParticipants(latest.votes ?? []),
      hasSubmittedVote: alreadySubmitted,
      activePollRelation: derivedRelation,
      canManageActivePoll: canManage,
      manageMenuOpen: canManage ? previousMenuState : false,
    });
    updatePollHistoryDetails({ ...normalized, created_at: latest.created_at });
    syncPollStatusActions();
    if (alreadySubmitted && !previouslyLocked) {
      setVoteFeedbackMessage(getLockedVotingMessage(normalized), "success");
    }
    renderPollDetail();
  } catch (error) {
    console.error("Failed to refresh poll", error);
  }
};

const handleSubmitVote = async () => {
  const poll = getState().activePoll;
  if (isPollFinishedState(poll)) {
    setVoteFeedbackMessage("This poll is finished. Voting is closed.", "error");
    return;
  }
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

const handleTelegramBackButton = () => {
  const currentScreen = getState().screen;
  if (currentScreen === SCREENS.POLL) {
    handleBackToDashboardFromPoll();
    return;
  }
  if (currentScreen === SCREENS.CREATE) {
    handleBackToDashboard();
  }
};

const handleNewPollClick = () => {
  resetInviteLinkDetails();
  resetPlannerState();
  setFormFeedback("");
  setActiveScreen(SCREENS.CREATE);
};

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

const resetEventDetailsForm = () => {
  if (refs.titleInput) {
    refs.titleInput.value = "";
  }
  if (refs.locationInput) {
    refs.locationInput.value = "";
  }
  if (refs.descriptionInput) {
    refs.descriptionInput.value = "";
  }
};

const setSubmitting = (isSubmitting) => {
  updateState({ isSubmitting });
  renderAll();
  if (refs.createPollButton) {
    refs.createPollButton.textContent = isSubmitting ? CREATE_LABEL_WORKING : CREATE_LABEL_DEFAULT;
  }
};

const resetPlannerState = () => {
  const today = new Date();
  updateState({
    selectedDates: new Map(),
    specifyTimesEnabled: false,
    timezoneSearch: "",
    today,
    currentView: new Date(today.getFullYear(), today.getMonth(), 1),
  });
  if (refs.timeToggle) {
    refs.timeToggle.checked = false;
  }
  setTimezoneSearchValue("");
  resetEventDetailsForm();
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
    const shareCode = sanitizeShareCode(poll.share_code ?? "");
    showInviteLinkForShareCode(shareCode);
    setFormFeedback(
      `Poll created! Invite link ready below (share code ${shareCode}).`,
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
  if (!getState().isUpdatingPoll && isEditDetailsModalOpen()) {
    closeEditDetailsModal();
  }
  if (!getState().isUpdatingOptions && isEditOptionsModalOpen()) {
    closeEditOptionsModal();
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
  refs.finishPollButton?.addEventListener("click", handleFinishPoll);
  refs.reopenPollButton?.addEventListener("click", handleReopenPoll);
  refs.modalBackButton?.addEventListener("click", closeNameModal);
  refs.closeNameModal?.addEventListener("click", closeNameModal);
  refs.submitVoteButton?.addEventListener("click", handleSubmitVote);
  refs.voteNameInput?.addEventListener("input", (event) => handleNameInputChange(event.target.value));
  refs.editDetailsForm?.addEventListener("submit", handleEditDetailsSubmit);
  refs.cancelEditDetailsButton?.addEventListener("click", handleCancelEditDetails);
  refs.closeEditDetailsModal?.addEventListener("click", handleCancelEditDetails);
  refs.editOptionsForm?.addEventListener("submit", handleEditOptionsSubmit);
  refs.cancelEditOptionsButton?.addEventListener("click", handleCancelEditOptions);
  refs.closeEditOptionsModal?.addEventListener("click", handleCancelEditOptions);
  refs.editOptionsTimeToggle?.addEventListener("change", (event) =>
    handleEditOptionsSpecifyToggle(event.target.checked)
  );
  refs.editOptionsNavButtons?.forEach((btn) =>
    btn.addEventListener("click", handleEditMonthNav)
  );
  refs.copyInviteLinkButton?.addEventListener("click", handleCopyInviteLink);
  wirePressAnimation(refs.createPollButton);
  wirePressAnimation(refs.joinPollButton);
  wirePressAnimation(refs.continueVoteButton);
  wirePressAnimation(refs.submitVoteButton);
  wirePressAnimation(refs.saveEditDetailsButton);
  wirePressAnimation(refs.saveEditOptionsButton);
  wirePressAnimation(refs.copyInviteLinkButton);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);
};

const hydrateState = async () => {
  const user = getTelegramUser();
  if (user) {
    updateState({ telegramUser: user });
    console.info(
      `Telegram Mini App user detected: ${formatTelegramDisplayName(user)} (ID: ${user.id})`
    );
  }
  const initData = getTelegramInitData();
  if (initData) {
    console.info("Telegram init data payload detected", initData);
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

const restoreActivePollIfNeeded = async () => {
  if (getState().screen !== SCREENS.POLL || getState().activePoll) {
    return "skipped";
  }
  const reference = normalizePollReference(getState().activePollRef);
  if (!reference) {
    setActiveScreen(SCREENS.DASHBOARD);
    return "fallback";
  }
  try {
    const poll = await fetchPollDetail({
      pollId: reference.pollId ?? undefined,
      shareCode: reference.shareCode ?? undefined,
    });
    if (!poll) {
      clearActivePollState();
      setActiveScreen(SCREENS.DASHBOARD);
      setJoinFeedback("We couldn't reload that poll. Please join it again.", "error");
      return "error";
    }
    applyPollDetail(poll, getState().activePollRelation ?? "joined");
    return "success";
  } catch (error) {
    console.error("Failed to restore poll from saved state", error);
    clearActivePollState();
    setActiveScreen(SCREENS.DASHBOARD);
    setJoinFeedback("We couldn't reload that poll. Please join it again.", "error");
    return "error";
  }
};

const tryHandleStartParamInvite = async () => {
  const param = getStartParamValue();
  if (!param) {
    return "skipped";
  }
  const shareCode = parseInviteStartParam(param);
  if (!shareCode) {
    return "skipped";
  }
  try {
    setJoinFeedback("Loading invite...", "info");
    const poll = await fetchPollDetail({ shareCode });
    if (!poll) {
      setJoinFeedback("We couldn't find that invite link.", "error");
      return "error";
    }
    setJoinFeedback("");
    applyPollDetail(poll, "joined");
    return "success";
  } catch (error) {
    console.error("Failed to open invite link", error);
    setJoinFeedback("We couldn't open that invite link. Try joining with the code.", "error");
    return "error";
  }
};

const persistState = () => {
  saveUserState(getStorageId(), getState());
};

const bootstrap = async () => {
  initTelegram();
  refs = initUI();
  resetInviteLinkDetails();
  setTelegramBackButtonHandler(handleTelegramBackButton);
  if (refs.createPollButton) {
    refs.createPollButton.textContent = CREATE_LABEL_DEFAULT;
  }
  await hydrateState();
  syncTelegramIdentity();
  const inviteStatus = await tryHandleStartParamInvite();
  const restoreStatus =
    inviteStatus === "success" ? "handled" : await restoreActivePollIfNeeded();
  syncScreenVisibility(getState().screen);
  syncTelegramBackButtonVisibility(getState().screen);
  if (getState().screen === SCREENS.POLL) {
    renderPollDetail();
  }
  renderPollSection();
  if (restoreStatus !== "error" && inviteStatus !== "error") {
    setJoinFeedback("");
  }
  setFormFeedback("");
  attachEventHandlers();
  renderAll();
};

window.addEventListener("beforeunload", persistState);
window.addEventListener("DOMContentLoaded", bootstrap);

