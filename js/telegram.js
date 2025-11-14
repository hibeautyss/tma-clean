let telegramInstance = null;

const TELEGRAM_THEME_VARS = {
  "--surface": "secondary_bg_color",
  "--surface-alt": "secondary_bg_color",
  "--text-primary": "text_color",
  "--text-secondary": "hint_color",
  "--accent": "button_color",
  "--accent-strong": "button_color",
  "--border": "section_separator_color",
};

const applyTelegramTheme = (webApp) => {
  if (!webApp?.themeParams) {
    return;
  }
  const root = document.documentElement;
  Object.entries(TELEGRAM_THEME_VARS).forEach(([cssVar, paramKey]) => {
    const value = webApp.themeParams[paramKey];
    if (value) {
      root.style.setProperty(cssVar, value);
    }
  });
  if (webApp.themeParams.bg_color) {
    root.style.setProperty("--bg", webApp.themeParams.bg_color);
    root.style.setProperty("--app-background", webApp.themeParams.bg_color);
  }
  if (webApp.themeParams.link_color) {
    root.style.setProperty("--success", webApp.themeParams.link_color);
  }
  if (webApp.colorScheme) {
    root.style.setProperty("color-scheme", webApp.colorScheme);
  }
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
  applyTelegramTheme(telegramInstance);
  telegramInstance.onEvent?.("themeChanged", () => applyTelegramTheme(telegramInstance));
  return telegramInstance;
};

export const getTelegramUser = () => telegramInstance?.initDataUnsafe?.user ?? null;

export const getTelegram = () => telegramInstance;
