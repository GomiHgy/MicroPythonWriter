import es from './locales/es.json'
import de from './locales/de.json'
import fr from './locales/fr.json'
import ko from './locales/ko.json'
import pt from './locales/pt.json'
import zhTW from './locales/zh-TW.json'
import type { ExtendedLocale } from './types'

export const localeDictionaries: Record<ExtendedLocale, Record<string, string>> = { es, de, fr, ko, pt, 'zh-TW': zhTW }
