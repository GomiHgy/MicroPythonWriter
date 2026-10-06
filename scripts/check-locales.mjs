// 翻訳の欠落・差し込み変数の変更を検査する。--materialize は翻訳作業用IDを日本語キーへ機械変換する。
import fs from 'node:fs'
import process from 'node:process'
import { log } from 'node:console'
import { localeSource } from './locale-source.mjs'

const source = new Map(localeSource().map(entry => [entry.key, entry]))
const tokens = text => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort().join(',')
for (const locale of ['es', 'de', 'fr', 'ko', 'pt', 'zh-TW']) {
  const path = `src/i18n/locales/${locale}.json`
  const dictionary = JSON.parse(fs.readFileSync(path, 'utf8'))
  const converted = {}
  for (const { key, id } of source.values()) {
    const value = dictionary[key] ?? dictionary[id]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${locale}: missing ${key}`)
    if (tokens(key) !== tokens(value)) throw new Error(`${locale}: changed parameters ${key}`)
    converted[key] = value
  }
  if (Object.keys(dictionary).length !== source.size) throw new Error(`${locale}: unexpected or missing translation keys`)
  if (process.argv.includes('--materialize')) fs.writeFileSync(path, JSON.stringify(converted, null, 2) + '\n')
  else if (Object.keys(dictionary).some(key => !source.has(key))) throw new Error(`${locale}: use Japanese message keys, not temporary IDs`)
  log(`${locale}: ${source.size} messages PASS`)
}
