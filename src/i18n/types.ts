export type Locale = 'ja' | 'en' | 'zh'
export type MessageCatalog = Record<string, { en: string; zh: string }>
export type MessageParams = Record<string, string | number>
