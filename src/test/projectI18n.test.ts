import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { messages, translate } from '../i18n'
import { projectMessages } from '../i18n/projectMessages'
import appSource from '../App.tsx?raw'
import storageSource from '../services/projects/ProjectStorage.ts?raw'
import generatorSource from '../services/projects/StarterProgram.ts?raw'
import preparationSource from '../hooks/useWorkshopPreparation.ts?raw'
import { createProject, parseProject, restoreWorking, validateProject } from '../services/projects/ProjectStorage'
import { buildStarterProgram, starterAvailability } from '../services/projects/StarterProgram'

function expectTranslated(message: string, file: string) {
  expect(messages[message], `${file}: ${message}`).toBeDefined()
  expect(translate('ja', message)).toBe(message)
  for (const locale of ['en', 'zh'] as const) {
    expect(translate(locale, message), `${file} ${locale}: ${message}`).toBe(messages[message][locale])
    expect(translate(locale, message).trim()).not.toBe('')
  }
}

describe('作品づくり・保存・入門コードのメッセージ翻訳', () => {
  it('作品カタログに英語・中国語があり、差込みパラメータを保持する', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort()
    for (const [key, entry] of Object.entries(projectMessages)) {
      for (const locale of ['en', 'zh'] as const) {
        expect(entry[locale].trim(), `${locale}: ${key}`).not.toBe('')
        expect(placeholders(entry[locale]), `${locale}: ${key}`).toEqual(placeholders(key))
      }
    }
  })

  it.each([
    ['src/App.tsx', appSource],
    ['src/services/projects/StarterProgram.ts', generatorSource],
    ['src/hooks/useWorkshopPreparation.ts', preparationSource],
  ])('%s の固定表示・エラー・通知を英語と中国語へ翻訳できる', (file, source) => {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    function visit(node: ts.Node) {
      if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/.test(node.text)) expectTranslated(node.text, file)
      ts.forEachChild(node, visit)
    }
    visit(tree)
  })

  it('保存サービスのfailメッセージは前置きも含めた実際の全文を翻訳する', () => {
    const file = 'src/services/projects/ProjectStorage.ts'
    const tree = ts.createSourceFile(file, storageSource, ts.ScriptTarget.Latest, true)
    let errors = 0
    function visit(node: ts.Node) {
      // 初期作品名・演出名は作品データとして保持し、表示言語で勝手に書き換えない。
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'createProject') return
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'fail' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        expectTranslated(`作品データを読み込めません。${node.arguments[0].text}`, file)
        errors++
        return
      }
      if (ts.isStringLiteral(node) && /[ぁ-んァ-ヶ一-龯]/.test(node.text)) expectTranslated(node.text, file)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(errors).toBeGreaterThan(15)
  })

  it.each([
    () => parseProject('{broken'),
    () => validateProject({ ...createProject(), version: 2 }),
    () => restoreWorking(createProject()),
    () => buildStarterProgram(createProject().draft.settings, createProject().draft.recipe),
  ])('利用者へ実際に返す例外全文を翻訳できる (case %#)', action => {
    let caught: unknown
    try { action() } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(Error)
    expectTranslated((caught as Error).message, 'runtime error')
  })

  it('実機未検証という制約を3言語で明示し、ボタンIDと作品コードは翻訳しない', () => {
    const project = createProject()
    project.draft.settings.firmwareVersion = '2.3.7'
    const availability = starterAvailability(project.draft.settings, project.draft.recipe)
    expect(availability.verified).toBe(false)
    expectTranslated(availability.reason, 'starterAvailability')
    expect(translate('en', availability.reason)).toContain('testing candidate')
    expect(translate('zh', availability.reason)).toContain('尚未完成')
    for (const literal of ['CUSTOM_MODE', 'NanoLED-AtomS3Lite', 'print("自分の作品")', '作品の名前です']) {
      expect(translate('en', literal)).toBe(literal)
      expect(translate('zh', literal)).toBe(literal)
    }
  })
})
