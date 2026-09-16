import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile, getBlePreparationReasons, isWorkshopProfile, MAX_BASELINE_CODE_LENGTH, validateWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'
import { boardDefinitions, identifyBoard, identifySoc } from '../config/boards'

function profile(): WorkshopProfile {
  return {
    ...cloneWorkshopProfile(workshopPresets[0].profile),
    displayName: 'テスト用の教材',
    kitId: '007',
    firmwareVersion: 'TEST-ONLY-UIFlow2',
    ledModel: 'TEST-ONLY-RGB',
    ledCount: 37,
    maxBrightnessPercent: 25,
  }
}

function bleProfile(): WorkshopProfile {
  const value = profile()
  value.features = { button: true, ble: true, controller: true }
  value.baseline = {
    code: '# This is synthetic test data, not a firmware implementation.\nprint("baseline sentinel")\n',
    verification: null,
  }
  value.baseline.verification = {
    code: value.baseline.code,
    firmwareVersion: value.firmwareVersion!,
    confirmedBy: 'テスト用の確認者',
    confirmedAt: '2026-09-15T10:00:00.000Z',
    nanoLedV1: true,
  }
  return value
}

describe('WorkshopProfileの設定検証', () => {
  it('AtomS3Liteを別プリセットとし未確定設定やNanoC6用基準コードを流用しない', () => {
    const atom = workshopPresets.find(preset => preset.profile.boardId === 'atoms3lite')!
    expect(atom.id).toBe('atom-s3-lite-led-default')
    expect(atom.profile.materialId).not.toBe(workshopPresets[0].profile.materialId)
    expect(atom.profile).toMatchObject({ boardId: 'atoms3lite', kitId: null, firmwareVersion: null, ledModel: null, ledCount: null, maxBrightnessPercent: null, baseline: { code: '', verification: null } })
    expect(buildStartPrompt(createWorkshopContext(atom.profile))).toBe('')
  })

  it('型番を指定せずSoCだけから製品を断定しない', () => {
    expect(identifyBoard('M5Stack NanoC6 with ESP32C6')).toBe('m5nanoc6')
    expect(identifyBoard('M5Stack AtomS3-Lite with ESP32S3')).toBe('atoms3lite')
    for (const text of ['ESP32-S3', 'ESP32C6', 'AtomS3', 'AtomS3R', 'M5Stack CoreS3', '9']) expect(identifyBoard(text)).toBeUndefined()
    expect(identifySoc('ESP32-S3')).toBe('ESP32-S3')
    expect(identifySoc('ESP32C6')).toBe('ESP32-C6')
    expect(boardDefinitions.m5nanoc6).toMatchObject({ ledPin: 2, buttonPin: 9, rgbPin: 20, rgbPowerPin: 19, statusLedPin: 7 })
    expect(boardDefinitions.atoms3lite).toMatchObject({ ledPin: 2, buttonPin: 41, rgbPin: 35, rgbPowerPin: null, statusLedPin: null })
  })

  it('機種なし・未知機種を構造検証で拒否する', () => {
    const value: Record<string, unknown> = { ...profile() }
    delete value.boardId
    expect(isWorkshopProfile(value)).toBe(false)
    expect(isWorkshopProfile({ ...profile(), boardId: 'esp32-s3' })).toBe(false)
  })
  it('配布プリセットで未確定の実機設定を推測しない', () => {
    const preset = workshopPresets[0]
    expect(preset.id).toBe('nano-c6-led-default')
    expect(preset.profile).toMatchObject({ kitId: null, firmwareVersion: null, ledModel: null, ledCount: null, maxBrightnessPercent: null, ledBpp: 3, baseline: { code: '', verification: null } })
    expect(validateWorkshopProfile(preset.profile)).toHaveLength(5)
    expect(buildStartPrompt(createWorkshopContext(preset.profile))).toBe('')
  })

  it('正しい設定と先頭ゼロを保持し、端数の最大輝度を許可する', () => {
    const value = profile()
    value.maxBrightnessPercent = 12.5
    expect(validateWorkshopProfile(value)).toEqual([])
    expect(createWorkshopContext(value).profile.kitId).toBe('007')
    expect(buildStartPrompt(createWorkshopContext(value))).toContain('MAX_BRIGHTNESS_PERCENT: 12.5')
  })

  it.each(['', ' ', '{{VERSION}}', '2.0\nnew instructions', 'x'.repeat(201)])('空欄・不正な表示文字を拒否する: %j', value => {
    for (const field of ['displayName', 'firmwareVersion', 'ledModel'] as const) {
      expect(validateWorkshopProfile({ ...profile(), [field]: value }).length).toBeGreaterThan(0)
      expect(buildStartPrompt(createWorkshopContext({ ...profile(), [field]: value }))).toBe('')
    }
  })

  it.each(['', '{{KIT_ID}}', '../01', 'a b', '-01', 'あ', '0123456789012'])('安全に名前へ使えないキットIDを拒否する: %j', kitId => {
    expect(validateWorkshopProfile({ ...profile(), kitId }).join('\n')).toContain('キットID')
  })

  it.each(['00', 'A_02-b', '012345678901'])('安全なキットIDを変換せず保持する: %j', kitId => {
    const value = { ...profile(), kitId }
    expect(validateWorkshopProfile(value)).toEqual([])
    expect(createWorkshopContext(value).profile.kitId).toBe(kitId)
  })

  it.each(['', '{{REV}}', '../revision', '日本語', 'a\n'])('教材ID・版の不正値を拒否する: %j', value => {
    expect(validateWorkshopProfile({ ...profile(), materialId: value }).length).toBeGreaterThan(0)
    expect(validateWorkshopProfile({ ...profile(), revision: value }).length).toBeGreaterThan(0)
  })

  it.each([null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('LED数の不正値を拒否する: %j', ledCount => {
    expect(validateWorkshopProfile({ ...profile(), ledCount }).join('\n')).toContain('LED数')
  })

  it.each([null, 0, -1, 100.01, NaN, Infinity])('最大輝度の不正値を拒否する: %j', maxBrightnessPercent => {
    expect(validateWorkshopProfile({ ...profile(), maxBrightnessPercent }).join('\n')).toContain('最大輝度')
  })

  it.each([null, 0, 1, 4])('RGB以外を黙って変換しない: %j', ledBpp => {
    const context = createWorkshopContext({ ...profile(), ledBpp })
    expect(context.profile.ledBpp).toBe(ledBpp)
    expect(context.errors.join('\n')).toContain('LED_BPP=3')
    expect(buildStartPrompt(context)).toBe('')
  })

  it('構造検証で破損・未知フィールド・巨大なコードを拒否する', () => {
    expect(isWorkshopProfile(profile())).toBe(true)
    expect(isWorkshopProfile(bleProfile())).toBe(true)
    for (const value of [null, [], {}, { ...profile(), source: 'user code' }, { ...profile(), terminalLog: 'private log' }, { ...profile(), ledCount: '37' }, { ...profile(), ledCount: Infinity }, { ...profile(), features: { button: true } }, { ...profile(), baseline: { code: 'x', verification: true } }, { ...profile(), baseline: { code: 'x'.repeat(MAX_BASELINE_CODE_LENGTH + 1), verification: null } }]) expect(isWorkshopProfile(value)).toBe(false)
  })

  it('有効な構造でも意味的な不正値を復元後に判定できる', () => {
    const value = { ...profile(), ledCount: -2 }
    expect(isWorkshopProfile(value)).toBe(true)
    expect(createWorkshopContext(value).errors.length).toBeGreaterThan(0)
  })
})

describe('BLEの準備状態', () => {
  it('旧NanoC6確認をAtomS3Liteへ流用せず、確認機種を一致させる', () => {
    const value = bleProfile()
    expect(createWorkshopContext(value).bleEnabled).toBe(true)
    value.boardId = 'atoms3lite'
    expect(createWorkshopContext(value).bleEnabled).toBe(false)
    expect(getBlePreparationReasons(value).join('\n')).toContain('確認対象機器')
    value.baseline.verification!.boardId = 'atoms3lite'
    expect(createWorkshopContext(value).bleEnabled).toBe(true)
    value.boardId = 'm5nanoc6'
    expect(createWorkshopContext(value).bleEnabled).toBe(false)
  })
  it('基準コードが未登録・未確認でもLEDとボタン用の準備は止めない', () => {
    const value = profile()
    value.features.ble = true
    value.features.controller = true
    const context = createWorkshopContext(value)
    expect(context.errors).toEqual([])
    expect(context.bleEnabled).toBe(false)
    expect(context.controllerEnabled).toBe(false)
    expect(context.bleReasons.join('\n')).toContain('未登録')
    expect(buildStartPrompt(context)).toContain('最初の質問を1問だけ')
    expect(context.rules).not.toContain('6e400001')
  })

  it('未確認コードを準備文へ持ち出さない', () => {
    const value = bleProfile()
    value.baseline.verification = null
    const context = createWorkshopContext(value)
    expect(context.bleEnabled).toBe(false)
    expect(context.rules).not.toContain('baseline sentinel')
  })

  it('対象ファームウェアまたはコードを変えるとBLEが失効する', () => {
    const value = bleProfile()
    value.firmwareVersion += '-changed'
    expect(createWorkshopContext(value).bleEnabled).toBe(false)
    expect(getBlePreparationReasons(value).join('\n')).toContain('版が設定と一致しません')
    const changed = bleProfile()
    changed.baseline.code += '\n'
    expect(createWorkshopContext(changed).bleEnabled).toBe(false)
    expect(getBlePreparationReasons(changed).join('\n')).toContain('確認時から変更')
  })

  it('Webコントローラ対応の確認がなければBLEだけを止める', () => {
    const value = bleProfile()
    value.baseline.verification!.nanoLedV1 = false
    const context = createWorkshopContext(value)
    expect(context.errors).toEqual([])
    expect(context.bleEnabled).toBe(false)
    expect(context.bleReasons.join('\n')).toContain('NanoLED v1')
  })

  it('通常の確認済みBLE基準コードへNanoLED仕様を推測で付けない', () => {
    const value = bleProfile()
    value.features.controller = false
    value.baseline.verification!.nanoLedV1 = false
    const context = createWorkshopContext(value)
    expect(context.bleEnabled).toBe(true)
    expect(context.controllerEnabled).toBe(false)
    expect(context.rules).toContain(value.baseline.code)
    expect(context.rules).not.toContain('6e400001')
    expect(context.rules).toContain('Webコントローラ未対応')
  })

  it('BLE無効かつコントローラ有効の矛盾を黙って補正しない', () => {
    const value = bleProfile()
    value.features.ble = false
    const context = createWorkshopContext(value)
    expect(context.bleEnabled).toBe(false)
    expect(context.profile.features).toEqual(value.features)
    expect(context.bleReasons.join('\n')).toContain('BLEも有効')
  })

  it('NanoLEDのLED上限はBLEだけを無効にし数を勝手に変えない', () => {
    const value = bleProfile()
    value.ledCount = 301
    const context = createWorkshopContext(value)
    expect(context.errors).toEqual([])
    expect(context.bleEnabled).toBe(false)
    expect(context.profile.ledCount).toBe(301)
    expect(buildStartPrompt(context)).toContain('LED_COUNT: 301')
    value.ledCount = 300
    expect(createWorkshopContext(value).bleEnabled).toBe(true)
  })

  it('確認者と日時の空欄や未解決プレースホルダでは有効化しない', () => {
    const value = bleProfile()
    value.baseline.verification!.confirmedBy = '{{TEACHER}}'
    expect(createWorkshopContext(value).bleEnabled).toBe(false)
    value.baseline.verification!.confirmedBy = 'テスト'
    value.baseline.verification!.confirmedAt = 'not a date'
    expect(createWorkshopContext(value).bleEnabled).toBe(false)
    value.baseline.code += '{{LED_COUNT}}'
    value.baseline.verification!.code = value.baseline.code
    expect(createWorkshopContext(value).rules).not.toContain('{{LED_COUNT}}')
  })

  it('コード全文を保持し、コード内のフェンスでは閉じない', () => {
    const value = bleProfile()
    value.baseline.code += '# ~~~\n# ~~~~\nprint("last line")'
    value.baseline.verification!.code = value.baseline.code
    const context = createWorkshopContext(value)
    expect(context.bleEnabled).toBe(true)
    expect(context.rules).toContain(`~~~~~python\n${value.baseline.code}\n~~~~~`)
    expect(buildStartPrompt(context)).toContain(value.baseline.code)
  })
})

describe('一回で渡せる初回準備文と共通ルール', () => {
  it('AtomS3Liteではボタン41・内蔵RGB35を使い、NanoC6の内蔵電源制御を流用しない', () => {
    const value = { ...profile(), boardId: 'atoms3lite' as const }
    const prompt = buildStartPrompt(createWorkshopContext(value))
    for (const text of ['機器: M5Stack AtomS3Lite', 'SoC: ESP32-S3', '本体ボタンを使う場合はGPIO41のアクティブLOW', '内蔵RGB LEDはGPIO35', '未確認のRGB電源制御ピンを追加しない', '外付けLEDはGrove G2のGPIO2']) expect(prompt).toContain(text)
    expect(prompt).not.toContain('本体ボタンを使う場合はGPIO9')
    expect(prompt).not.toContain('RGB電源有効化はGPIO19をHIGH')
    const noButton = buildStartPrompt(createWorkshopContext({ ...value, features: { ...value.features, button: false } }))
    expect(noButton).toContain('GPIO41の初期化・読み取り・チャタリング対策・ボタン操作を追加しない')
  })

  it.each(['en', 'zh'] as const)('初回準備文全体を%sへ切り替え、固定値と基準コードを保持する', locale => {
    const value = bleProfile()
    value.boardId = 'atoms3lite'
    value.displayName = 'Test workshop'
    value.baseline.verification!.boardId = value.boardId
    value.baseline.verification!.confirmedBy = 'Test instructor'
    const context = createWorkshopContext(value, locale)
    const prompt = buildStartPrompt(context)
    expect(context.locale).toBe(locale)
    for (const text of ['AtomS3Lite', 'ESP32-S3', 'GPIO41', 'GPIO35', 'GPIO2', 'LED_COUNT: 37', 'MAX_BRIGHTNESS_PERCENT: 25', 'WS2812_TIMING_NS = (400, 850, 800, 450)', 'machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)', 'MIN_OFF_TO_ON_FADE_MS = 200', 'period_ms = 3000 - 29 * n', '6e400001-b5a3-f393-e0a9-e50e24dcca9e', 'NanoLED-007', value.baseline.code]) expect(prompt).toContain(text)
    expect(prompt).not.toMatch(/[\u3040-\u30ff]/u)
    expect(prompt).not.toContain('{buttonPin}')
    expect(prompt).toContain(locale === 'en' ? 'Respond in English' : '请用简体中文回答')
  })

  it.each(['en', 'zh'] as const)('不正設定とBLE未準備の説明も%sにする', locale => {
    const value = { ...profile(), features: { button: true, ble: true, controller: true }, ledCount: null }
    const context = createWorkshopContext(value, locale)
    expect(context.errors.length).toBeGreaterThan(0)
    expect(context.errors.join('\n')).not.toMatch(/[\u3040-\u30ff]/u)
    expect(context.bleReasons.join('\n')).not.toMatch(/[\u3040-\u30ff]/u)
    expect(context.rules).toContain(locale === 'en' ? 'Settings are incomplete or invalid' : '设置不完整或无效')
    expect(buildStartPrompt(context)).toBe('')
  })
  it('ボタンなしのキットにGPIO9の初期化・操作・相談を追加させない', () => {
    const value = bleProfile()
    value.features.button = false
    const context = createWorkshopContext(value)
    const prompt = buildStartPrompt(context)
    expect(context.errors).toEqual([])
    expect(context.bleEnabled).toBe(true)
    expect(context.rules).toContain('本体ボタンなし')
    expect(context.rules).toContain('GPIO9の初期化・読み取り・チャタリング対策・ボタン操作を追加しない')
    expect(context.rules).toContain('ボタンを使う相談や選択肢も出さない')
    expect(context.rules).toContain('本体ボタンを使う場合はGPIO9のアクティブLOW')
    expect(prompt).toContain('使わない機能の初期化や操作を追加していないこと')
    expect(prompt).toContain('利用可能なボタン操作・BLE操作')
  })

  it('最初の点灯でも消灯フレームを送ってから200ms条件を適用する', () => {
    const rules = createWorkshopContext(profile()).rules
    expect(rules).toContain('起動時は共通の送信処理で全LEDへ0を送って')
    expect(rules).toContain('起動演出が指定されていても、その後の最初の点灯にはOFFから点灯する最低200msの条件を適用')
  })

  it('LEDのみの文面は自己完結し、競合する初回応答や不要なBLE本文を含まない', () => {
    const context = createWorkshopContext(profile())
    const prompt = buildStartPrompt(context)
    expect(prompt).toContain(context.rules)
    for (const text of ['教材の版「writer-ai-1」', 'キット番号「007」', '最初の質問を1問だけ', '3〜5個', 'おまかせ', '最大6問', 'この仕様で作って', 'main.py全体を1つのPythonコードブロック', 'MicroPythonWriterからRaw REPL', 'AIが実機で動かしていない']) expect(prompt).toContain(text)
    for (const text of ['準備できたよ。', '{{', '6e400001', 'プロンプトE0', 'Traceback:', '## 現在のmain.py']) expect(prompt).not.toContain(text)
  })

  it('共通ルールにbitstream・輝度・フェードの具体的な条件を維持する', () => {
    const rules = createWorkshopContext(profile()).rules
    for (const text of ['GPIO2', 'GPIO9', 'アクティブLOW', '約40ms', 'bytearray(LED_COUNT * LED_BPP)', 'BITSTREAM_TIMING = 1', 'encoding=0', 'WS2812_TIMING_NS = (400, 850, 800, 450)', 'machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)', '第3引数に数値の1を直接渡さない', 'GRB', 'time.sleep_us(80)', 'neopixelをimportしない', 'MAX_BRIGHTNESS_PERCENT: 25', 'MIN_OFF_TO_ON_FADE_MS = 200', '最後に送信した全LED出力が0', 'time.ticks_ms()', 'time.ticks_diff()', '目標輝度のフレームを先に送信しない', '一時的な黒いフレーム', '進行度を維持', 'フェードインを中止', '10〜20ms以下']) expect(rules).toContain(text)
  })

  it('有効なNanoLEDはUUID・分割・上限・キュー・再接続・通知値を全て含む', () => {
    const context = createWorkshopContext(bleProfile())
    expect(context.bleEnabled).toBe(true)
    expect(context.controllerEnabled).toBe(true)
    for (const text of ['NanoLED-007', '6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e', '応答ありWrite', 'Notify', 'LF込み20バイト以下', '128バイト', '有界', 'PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS', 'BRIGHTNESS 0は現在モードを保持', 'OFF中の明るさ・速さ変更では点灯しない', 'SPEED 0は停止ではなく最も遅い', 'period_ms = 3000 - 29 * n', '4096バイト以下', 'RRGGBB', '最後に実際に送信した値をRGB順', '最大5スナップショット/秒', '待機分は最新1件だけ', '完全な新しい行から', '物理的な発光をセンサーで測定した結果ではない']) expect(context.rules).toContain(text)
  })

  it('設定スナップショットは後の編集と参照を共有しない', () => {
    const value = bleProfile()
    const context = createWorkshopContext(value)
    const rules = context.rules
    value.kitId = '999'
    value.features.ble = false
    value.baseline.code = 'changed'
    value.baseline.verification!.confirmedBy = 'changed'
    expect(context.profile.kitId).toBe('007')
    expect(context.profile.features.ble).toBe(true)
    expect(context.profile.baseline.code).not.toBe('changed')
    expect(context.profile.baseline.verification!.confirmedBy).not.toBe('changed')
    expect(context.rules).toBe(rules)
  })

  it('不正設定を修正依頼から汎用設定へ黙って落とさない', () => {
    const context = createWorkshopContext({ ...profile(), maxBrightnessPercent: null })
    expect(context.rules).toContain('設定が未完成または不正')
    expect(context.rules).toContain('汎用設定へ黙って切り替えない')
    expect(context.rules).toContain('講師が上記を直すまで')
    expect(buildStartPrompt(context)).toBe('')
  })

  it('構造化設定に混入した編集中コードやログを準備文へ持ち込まない', () => {
    const value = { ...profile(), source: 'private-current-code', terminalLog: 'private-terminal-log' }
    const context = createWorkshopContext(value)
    expect(context.profile).not.toHaveProperty('source')
    expect(context.profile).not.toHaveProperty('terminalLog')
    const prompt = buildStartPrompt(context)
    expect(prompt).not.toContain('private-current-code')
    expect(prompt).not.toContain('private-terminal-log')
  })
})
