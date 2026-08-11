import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { AppLanguage } from './types';
import { enMessages } from './locales/en';
import { zhMessages, type TranslationKey } from './locales/zh';

export type TranslateParams = Record<string, string | number>;

export type Translator = (key: TranslationKey, params?: TranslateParams) => string;

export interface I18nContextValue {
  language: AppLanguage;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function createTranslator(language: AppLanguage): Translator {
  const messages = language === 'en' ? enMessages : zhMessages;
  return (key: TranslationKey, params?: TranslateParams): string => {
    let text = messages[key] ?? zhMessages[key] ?? key;
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
      }
    }
    return text;
  };
}

export function I18nProvider({
  language,
  children
}: {
  language: AppLanguage;
  children: ReactNode;
}): React.ReactElement {
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      t: createTranslator(language)
    }),
    [language]
  );

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}

export function openToolLabelKey(tool: string): TranslationKey {
  return `openTool.${tool}` as TranslationKey;
}

export function statusLabelKey(state: string): TranslationKey {
  return `status.${state}` as TranslationKey;
}

export const START_COMMAND_LOG_MARKERS = ['执行启动命令', 'Starting command'] as const;

export function extractCommandFromStartLog(line: string): string | null {
  for (const marker of START_COMMAND_LOG_MARKERS) {
    const index = line.indexOf(marker);
    if (index >= 0) {
      return line.slice(index + marker.length).replace(/^[:：]\s*/, '').trim();
    }
  }
  return null;
}
