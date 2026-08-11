export type AppLanguage = 'zh' | 'en';

export const APP_LANGUAGES: AppLanguage[] = ['zh', 'en'];

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'en';

export function detectAppLanguage(): AppLanguage {
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return DEFAULT_APP_LANGUAGE;
}

export function normalizeAppLanguage(value: unknown): AppLanguage {
  return value === 'zh' ? 'zh' : DEFAULT_APP_LANGUAGE;
}
