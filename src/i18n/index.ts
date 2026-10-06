import { useSyncExternalStore } from 'react'
import { appMessages } from './appMessages'
import { preparationMessages } from './preparationMessages'
import { bluetoothMessages } from './bluetoothMessages'
import { serviceMessages } from './serviceMessages'
import { workshopMessages } from './workshopMessages'
import { promptMessages } from './promptMessages'
import { makerMessages } from './makerMessages'
import { projectMessages } from './projectMessages'
import { licenseMessages } from './licenseMessages'
import { bootMessages } from './bootMessages'
import { programLibraryMessages } from './programLibraryMessages'
import { simulationMessages } from './simulationMessages'
import { pasteMessages } from './pasteMessages'
import { ledCodeMessages } from './ledCodeMessages'
import { pwaMessages } from './pwaMessages'
import { exportMessages } from './exportMessages'
import { localeDictionaries } from './localeDictionaries'
import { isLocale } from './locales'
import type { ExtendedLocale, Locale, MessageCatalog, MessageParams } from './types'

export type { Locale, MessageCatalog, MessageParams } from './types'
export { isLocale, supportedLocales, localeDefinition } from './locales'
export const messages: MessageCatalog = { ...appMessages, ...preparationMessages, ...bluetoothMessages, ...serviceMessages, ...workshopMessages, ...promptMessages, ...makerMessages, ...projectMessages, ...licenseMessages, ...bootMessages, ...programLibraryMessages, ...simulationMessages, ...pasteMessages, ...ledCodeMessages, ...pwaMessages, ...exportMessages }
for (const [locale, dictionary] of Object.entries(localeDictionaries)) {
  for (const [key, value] of Object.entries(dictionary)) {
    if (messages[key]) messages[key][locale as ExtendedLocale] = value
  }
}
const readLocale = (): Locale => { try { const value = localStorage.getItem('mpw-language'); return isLocale(value) ? value : 'ja' } catch { return 'ja' } }
let currentLocale = readLocale()
const listeners = new Set<() => void>()
export const getLocale = () => currentLocale
const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setLocale(value: Locale) {
  if (!isLocale(value) || value === currentLocale) return
  currentLocale = value
  try { localStorage.setItem('mpw-language', value) } catch { /* 保存不可でも言語切替は継続する */ }
  for (const listener of listeners) listener()
}

const interpolate = (text: string, params: MessageParams) => text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token, key: string) => Object.hasOwn(params, key) ? String(params[key]) : token)
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = Object.entries(messages).filter(([key]) => /\{[A-Za-z][A-Za-z0-9_]*\}/.test(key)).sort(([a], [b]) => b.replace(/\{[^}]+\}/g, '').length - a.replace(/\{[^}]+\}/g, '').length).map(([key, entry]) => {
  const names: string[] = []
  let start = 0
  let source = '^'
  for (const match of key.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
    source += escaped(key.slice(start, match.index)) + '([\\s\\S]*?)'
    names.push(match[1]); start = match.index + match[0].length
  }
  return { pattern: new RegExp(source + escaped(key.slice(start)) + '$'), names, entry }
})
export function translate(locale: Locale, message: string, params: MessageParams = {}): string {
  const entry = messages[message]
  if (locale !== 'ja' && !entry && Object.keys(params).length === 0) {
    for (const item of patterns) {
      const match = item.pattern.exec(message)
      if (match) return interpolate(item.entry[locale] ?? item.entry.en, Object.fromEntries(item.names.map((name, index) => [name, match[index + 1]])))
    }
  }
  return interpolate(locale === 'ja' ? message : entry?.[locale] ?? entry?.en ?? message, params)
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'ja' as const)
  return { locale, setLocale, t: (message: string, params?: MessageParams) => translate(locale, message, params) }
}
