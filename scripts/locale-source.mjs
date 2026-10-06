// 翻訳用の固定UI文言を抽出する。機器コード・ログ・利用者の設定は含めない。
import fs from 'node:fs'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { log } from 'node:console'

export function localeSource() {
  const entries = []
  for (const file of fs.readdirSync('src/i18n').filter(file => file.endsWith('Messages.ts')).sort()) {
    const tree = ts.createSourceFile(file, fs.readFileSync(`src/i18n/${file}`, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.initializer)) {
        const en = node.initializer.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(tree).replace(/^['"]|['"]$/g, '') === 'en')
        if (en && ts.isStringLiteral(en.initializer)) entries.push({ id: createHash('sha256').update(node.name.text).digest('hex').slice(0, 12), key: node.name.text, en: en.initializer.text })
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return entries
}

if (process.argv[1]?.endsWith('locale-source.mjs')) log(JSON.stringify(localeSource().map((entry, index) => ({ index, ...entry })), null, 2))
