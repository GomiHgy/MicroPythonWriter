export type BaseLocale = 'ja' | 'en' | 'zh'
export type Locale = BaseLocale | 'zh-TW' | 'es' | 'de' | 'fr' | 'ko' | 'pt'
export type ExtendedLocale = Exclude<Locale, BaseLocale>
export type MessageCatalog = Record<string, { en: string; zh: string } & Partial<Record<ExtendedLocale, string>>>
export type MessageParams = Record<string, string | number>
