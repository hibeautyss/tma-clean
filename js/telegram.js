let telegramInstance = null;

export const initTelegram = () => {
  telegramInstance = window.Telegram?.WebApp ?? null;
  if (telegramInstance) {
    telegramInstance.ready();
    telegramInstance.expand?.();
    telegramInstance.setHeaderColor?.("secondary_bg_color");
  }
  return telegramInstance;
};

export const getTelegramUser = () => telegramInstance?.initDataUnsafe?.user ?? null;

export const getTelegram = () => telegramInstance;
