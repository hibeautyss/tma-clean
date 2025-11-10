const STORAGE_PREFIX = "planner-state";

const buildKey = (telegramId) => `${STORAGE_PREFIX}:${telegramId ?? "guest"}`;

const prepareForStorage = (state) => ({
  selectedDates: Array.from(state.selectedDates?.entries?.() ?? []),
  specifyTimesEnabled: Boolean(state.specifyTimesEnabled),
  timezone: state.timezone ?? "UTC",
  timezoneSearch: state.timezoneSearch ?? "",
  today: state.today?.toISOString?.() ?? null,
  currentView: state.currentView?.toISOString?.() ?? null,
});

export const loadUserState = async (telegramId) => {
  try {
    const raw = localStorage.getItem(buildKey(telegramId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to load user state", error);
    return null;
  }
};

export const saveUserState = async (telegramId, state) => {
  try {
    localStorage.setItem(buildKey(telegramId), JSON.stringify(prepareForStorage(state)));
    return true;
  } catch (error) {
    console.error("Failed to save user state", error);
    return false;
  }
};
