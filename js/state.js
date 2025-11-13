const initialToday = new Date();

const state = {
  telegramUser: null,
  selectedDates: new Map(),
  specifyTimesEnabled: false,
  isSubmitting: false,
  timezone: "Europe/Moscow",
  timezoneSearch: "",
  today: initialToday,
  currentView: new Date(initialToday.getFullYear(), initialToday.getMonth(), 1),
  screen: "dashboard",
  pollHistory: [],
  pollFilters: {
    status: "live",
    createdOnly: false,
  },
  activePoll: null,
  activePollVotes: [],
  voteDraft: null,
  voteComment: "",
  voteName: "",
  isVoting: false,
  nameModalOpen: false,
  hasSubmittedVote: false,
};

const mapKeys = new Set(["selectedDates"]);
const dateKeys = new Set(["today", "currentView"]);
const arrayKeys = new Set(["pollHistory", "activePollVotes"]);

const toMap = (value) => {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) return new Map(value);
  if (value && typeof value === "object") {
    return new Map(Object.entries(value));
  }
  return new Map();
};

const toDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed;
    }
  }
  return new Date();
};

const normalizePatch = (patch = {}) => {
  const normalized = {};
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }
    if (mapKeys.has(key)) {
      normalized[key] = toMap(value);
    } else if (dateKeys.has(key)) {
      normalized[key] = toDate(value);
    } else if (arrayKeys.has(key)) {
      normalized[key] = Array.isArray(value) ? [...value] : [];
    } else {
      normalized[key] = value;
    }
  });
  return normalized;
};

export const getState = () => state;

export const setState = (newState) => {
  const normalized = normalizePatch(newState);
  Object.keys(state).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      state[key] = normalized[key];
    }
  });
};

export const updateState = (patch) => {
  const normalized = normalizePatch(patch);
  Object.assign(state, normalized);
};
