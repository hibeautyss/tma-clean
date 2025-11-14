let telegramInstance = null;
let backButtonHandler = null;
let isBackButtonBound = false;
let isViewportBound = false;

const numberOrNull = (value) => (typeof value === "number" && !Number.isNaN(value) ? value : null);

const enforceDarkTheme = () => {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty("color-scheme", "dark");
};

const applyViewportMetrics = (payload = {}) => {
  const root = document.documentElement;
  if (!root) return;
  const height = numberOrNull(payload.height ?? telegramInstance?.viewportHeight);
  const stableHeight = numberOrNull(
    payload.stableHeight ?? payload.stable_height ?? telegramInstance?.viewportStableHeight
  );
  const width = numberOrNull(payload.width ?? telegramInstance?.viewportWidth);
  if (height) {
    root.style.setProperty("--viewport-height", `${height}px`);
  }
  if (stableHeight) {
    root.style.setProperty("--viewport-stable-height", `${stableHeight}px`);
  }
  if (width) {
    root.style.setProperty("--viewport-width", `${width}px`);
  }
};

const handleBackButtonClicked = () => {
  try {
    backButtonHandler?.();
  } catch (error) {
    console.error("Telegram back button handler failed", error);
  }
};

const bindBackButton = (webApp) => {
  if (isBackButtonBound || !webApp?.onEvent) return;
  webApp.onEvent("backButtonClicked", handleBackButtonClicked);
  isBackButtonBound = true;
};

const bindThemeParams = () => {
  enforceDarkTheme();
};

const bindViewport = (webApp) => {
  if (!webApp) return;
  applyViewportMetrics();
  if (isViewportBound || !webApp.onEvent) return;
  webApp.onEvent("viewportChanged", applyViewportMetrics);
  isViewportBound = true;
};

const expandTelegramWebView = (webApp) => {
  if (webApp?.expand) {
    try {
      webApp.expand();
      return;
    } catch {
      // ignore failures and fall back to the global helper
    }
  }
  window.Telegram?.WebApp?.expand?.();
};

export const initTelegram = () => {
  telegramInstance = window.Telegram?.WebApp ?? null;
  if (!telegramInstance) {
    console.warn("Telegram WebApp SDK not detected. Running without Telegram context.");
    return null;
  }
  telegramInstance.ready?.();
  expandTelegramWebView(telegramInstance);
  telegramInstance.setHeaderColor?.("secondary_bg_color");
  bindThemeParams();
  bindViewport(telegramInstance);
  bindBackButton(telegramInstance);
  return telegramInstance;
};

export const getTelegramUser = () => telegramInstance?.initDataUnsafe?.user ?? null;

export const getTelegramInitData = () => telegramInstance?.initDataUnsafe ?? null;

export const getTelegram = () => telegramInstance;

export const setTelegramBackButtonHandler = (handler) => {
  backButtonHandler = typeof handler === "function" ? handler : null;
  if (backButtonHandler && telegramInstance) {
    bindBackButton(telegramInstance);
  }
};

export const setTelegramBackButtonVisible = (visible) => {
  const backButton = telegramInstance?.BackButton;
  if (!backButton) return;
  if (visible) {
    backButton.show?.();
  } else {
    backButton.hide?.();
  }
};
