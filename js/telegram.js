let telegramInstance = null;
let backButtonHandler = null;
let isBackButtonBound = false;
let isThemeBound = false;
let isViewportBound = false;

const TELEGRAM_THEME_VARS = {
  "--bg": ["bg_color", "secondary_bg_color"],
  "--app-background": ["bg_color"],
  "--surface": ["secondary_bg_color", "section_bg_color"],
  "--surface-alt": ["secondary_bg_color", "section_bg_color"],
  "--text-primary": ["text_color"],
  "--text-secondary": ["hint_color", "subtitle_text_color"],
  "--accent": ["button_color", "link_color"],
  "--accent-strong": ["button_color"],
  "--border": ["section_separator_color"],
  "--danger": ["destructive_text_color"],
  "--success": ["link_color"],
};

const numberOrNull = (value) => (typeof value === "number" && !Number.isNaN(value) ? value : null);

const applyTelegramTheme = (themeParams = {}, colorScheme) => {
  const root = document.documentElement;
  if (!root) return;

  if (colorScheme === "light") {
    // Light theme is disabled, so reset to the default dark palette.
    Object.keys(TELEGRAM_THEME_VARS).forEach((cssVar) => root.style.removeProperty(cssVar));
    root.style.setProperty("color-scheme", "dark");
    return;
  }

  Object.entries(TELEGRAM_THEME_VARS).forEach(([cssVar, paramKeys]) => {
    const list = Array.isArray(paramKeys) ? paramKeys : [paramKeys];
    const value = list.map((key) => themeParams?.[key]).find((entry) => typeof entry === "string" && entry.length);
    if (value) {
      root.style.setProperty(cssVar, value);
    }
  });
  if (colorScheme) {
    root.style.setProperty("color-scheme", colorScheme);
  } else if (themeParams?.text_color) {
    root.style.setProperty("color-scheme", "dark");
  }
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

const bindThemeParams = (webApp) => {
  if (!webApp) return;
  applyTelegramTheme(webApp.themeParams, webApp.colorScheme);
  if (isThemeBound || !webApp.onEvent) return;
  webApp.onEvent("themeChanged", () => applyTelegramTheme(webApp.themeParams, webApp.colorScheme));
  isThemeBound = true;
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
    return null;
  }
  telegramInstance.ready?.();
  expandTelegramWebView(telegramInstance);
  telegramInstance.setHeaderColor?.("secondary_bg_color");
  bindThemeParams(telegramInstance);
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
