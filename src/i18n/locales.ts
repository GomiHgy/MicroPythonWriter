import type { BaseLocale, Locale } from './types'

export const supportedLocales: { id: Locale; label: string; htmlLang: string; aiLanguage: string }[] = [
  { id: 'ja', label: '日本語', htmlLang: 'ja', aiLanguage: 'Japanese' },
  { id: 'en', label: 'English', htmlLang: 'en', aiLanguage: 'English' },
  { id: 'zh', label: '简体中文', htmlLang: 'zh-CN', aiLanguage: 'Simplified Chinese' },
  { id: 'zh-TW', label: '繁體中文', htmlLang: 'zh-TW', aiLanguage: 'Traditional Chinese' },
  { id: 'es', label: 'Español', htmlLang: 'es', aiLanguage: 'Spanish' },
  { id: 'de', label: 'Deutsch', htmlLang: 'de', aiLanguage: 'German' },
  { id: 'fr', label: 'Français', htmlLang: 'fr', aiLanguage: 'French' },
  { id: 'ko', label: '한국어', htmlLang: 'ko', aiLanguage: 'Korean' },
  { id: 'pt', label: 'Português', htmlLang: 'pt', aiLanguage: 'Portuguese' },
]
export const isLocale = (value: unknown): value is Locale => supportedLocales.some(locale => locale.id === value)
export const isBaseLocale = (locale: Locale): locale is BaseLocale => locale === 'ja' || locale === 'en' || locale === 'zh'
// 長文の共通技術仕様は新しい6言語では英語版を使う。AIの回答言語とは区別する。
export const basePromptLocale = (locale: Locale): BaseLocale => isBaseLocale(locale) ? locale : 'en'
export const localeDefinition = (locale: Locale) => supportedLocales.find(item => item.id === locale)!
