import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { workshopPresets } from '../config/workshops'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile, getBlePreparationReasons, isWorkshopProfile, LED_MODELS, MAX_BASELINE_CODE_LENGTH, validateWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'
import { boardDefinitions, identifyBoard, identifySoc } from '../config/boards'
import { buildControllerStarter } from '../services/workshop/ControllerStarter'
import { nanoLedV2Rules, remoteOffFadeRules } from '../i18n/promptMessages'

function profile(): WorkshopProfile {
  return {
    ...cloneWorkshopProfile(workshopPresets[0].profile),
    displayName: 'テスト用の教材',
    firmwareVersion: 'TEST-ONLY-UIFlow2',
    ledModel: 'WS2812B',
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
  it.each(LED_MODELS)('自宅でも版とLED型番 %s の指定だけで基本の準備文を作れる', ledModel => {
    for (const preset of workshopPresets) {
      const value = { ...cloneWorkshopProfile(preset.profile), firmwareVersion: 'TEST-ONLY-UIFlow2', ledModel }
      expect(validateWorkshopProfile(value)).toEqual([])
      expect(value).not.toHaveProperty('kitId')
      for (const locale of ['ja', 'en', 'zh'] as const) {
        const prompt = buildStartPrompt(createWorkshopContext(value, locale))
        for (const setting of [value.firmwareVersion, ledModel, 'LED_COUNT: 10', 'LED_PIN: 2', 'MAX_BRIGHTNESS_PERCENT: 20']) expect(prompt).toContain(setting)
        expect(prompt).not.toMatch(/KIT_ID|キットID:|Kit ID:|套件 ID:/u)
      }
    }
  })

  it.each(['WS2812', 'RGBW', 'SK6812-RGBW', 'unknown'])('選択肢にないLED型番 %s では準備文を作らない', ledModel => {
    const context = createWorkshopContext({ ...profile(), ledModel })
    expect(context.errors.length).toBeGreaterThan(0)
    expect(buildStartPrompt(context)).toBe('')
  })

  it.each(['ja', 'en', 'zh'] as const)('%s の準備・共通ルールは外部ピンとLED設定を反映する', locale => {
    const value = { ...profile(), boardId: 'atoms3lite' as const, ledPin: 9, ledCount: 10, maxBrightnessPercent: 20 }
    const context = createWorkshopContext(value, locale)
    const prompt = buildStartPrompt(context)
    expect(prompt).toContain('LED_PIN: 9')
    expect(prompt).toContain('LED_COUNT: 10')
    expect(prompt).toContain('MAX_BRIGHTNESS_PERCENT: 20')
    expect(prompt).toContain('GPIO41')
    expect(prompt).toContain('GPIO35')
    expect(prompt).toContain(locale === 'ja' ? '外付けLEDは設定のGPIO9' : locale === 'en' ? 'External LEDs use the configured GPIO9' : '外接 LED 使用设置的 GPIO9')
    expect(prompt).not.toContain('{ledPin}')
  })
  it.each([null, -1, 1.5, 49, NaN, Infinity])('外部LEDピン %s を拒否する', ledPin => {
    expect(validateWorkshopProfile({ ...profile(), ledPin }).some(text => text.includes('外部LEDピン'))).toBe(true)
  })
  it('AtomS3Liteを別プリセットとし未確定設定やNanoC6用基準コードを流用しない', () => {
    const atom = workshopPresets.find(preset => preset.profile.boardId === 'atoms3lite')!
    expect(atom.id).toBe('atom-s3-lite-led-default')
    expect(atom.profile.materialId).not.toBe(workshopPresets[0].profile.materialId)
    expect(atom.profile).toMatchObject({ boardId: 'atoms3lite', firmwareVersion: null, ledModel: null, ledCount: 10, ledPin: 2, maxBrightnessPercent: 20, baseline: { code: '', verification: null } })
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
    expect(preset.profile).toMatchObject({ firmwareVersion: null, ledModel: null, ledCount: 10, ledPin: 2, maxBrightnessPercent: 20, ledBpp: 3, baseline: { code: '', verification: null } })
    expect(validateWorkshopProfile(preset.profile)).toHaveLength(2)
    expect(buildStartPrompt(createWorkshopContext(preset.profile))).toBe('')
  })

  it('正しい設定を保持し、端数の最大輝度を許可する', () => {
    const value = profile()
    value.maxBrightnessPercent = 12.5
    expect(validateWorkshopProfile(value)).toEqual([])
    expect(createWorkshopContext(value).profile.firmwareVersion).toBe('TEST-ONLY-UIFlow2')
    expect(buildStartPrompt(createWorkshopContext(value))).toContain('MAX_BRIGHTNESS_PERCENT: 12.5')
  })

  it.each(['', ' ', '{{VERSION}}', '2.0\nnew instructions', 'x'.repeat(201)])('空欄・不正な表示文字を拒否する: %j', value => {
    for (const field of ['displayName', 'firmwareVersion', 'ledModel'] as const) {
      expect(validateWorkshopProfile({ ...profile(), [field]: value }).length).toBeGreaterThan(0)
      expect(buildStartPrompt(createWorkshopContext({ ...profile(), [field]: value }))).toBe('')
    }
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
  it.each(['ja', 'en', 'zh'] as const)('%s の同梱候補全文・未確認表示・準備から実行と接続の手順を含める', locale => {
    const value = profile()
    value.displayName = 'Test material'
    value.features = { button: true, ble: true, controller: true }
    const before = structuredClone(value)
    const expected = buildControllerStarter(value)
    const context = createWorkshopContext(value, locale)
    expect(context).toMatchObject({ bleSource: 'bundled-candidate', bleEnabled: true, controllerEnabled: true })
    expect(context.controllerStarter).toEqual(expected)
    expect(context.controllerStarterError).toBeUndefined()
    expect(context.profile).toEqual(before)
    expect(value).toEqual(before)
    const prompt = buildStartPrompt(context)
    for (const text of [expected.source, '"v":2', 'MODE <id>', 'ACTION <id>', 'PLAY / PAUSE / OFF', 'TEST-ONLY-UIFlow2']) expect(prompt).toContain(text)
    const localized = prompt.replace(expected.source, '')
    const phrases = {
      ja: ['実機未確認の試用コード', '実機確認は未実施', '保証ではない', '「対応プログラムを準備」→', 'USB接続', '「コントローラ」', '本体ボタン / Webリモコン / 両方 / おまかせ', '機器から届いたLEDの状態を見る', '明るさを変える', '再生・一時停止・消灯', '名前付きの光り方・一回限りのアクションボタン', '最大6問'],
      en: ['unverified trial', 'NOT been verified on hardware', 'does not guarantee', 'First prepare', 'USB-connected device', 'open Controller', 'Onboard button / Web remote / Both / Choose for me', 'See reported LED state', 'Adjust brightness', 'Play, pause and turn lights off', 'Named lighting modes and one-shot action buttons', 'maximum 6 questions'],
      zh: ['未实机验证的试用代码', '尚未完成实机验证', '不代表', '先准备兼容程序', '通过 USB', '“控制器”', '机身按钮 / 网页遥控器 / 两者都用 / 帮我决定', '查看设备上报的 LED 状态', '调整亮度', '播放、暂停和熄灭', '有名称的灯光模式及一次性动作按钮', '最多 6 题'],
    }
    for (const text of phrases[locale]) expect(localized).toContain(text)
    if (locale !== 'ja') expect(localized).not.toMatch(/[\u3040-\u30ff]/u)
  })

  it.each(['ja', 'en', 'zh'] as const)('%s でボタンなしならWebリモコン用の選択肢だけを尋ねる', locale => {
    const value = profile()
    value.features = { button: false, ble: true, controller: true }
    const prompt = buildStartPrompt(createWorkshopContext(value, locale))
    const expected = {
      ja: ['Webリモコン中心 / 電源を入れたら自動で光り、Webリモコンで調整 / おまかせ', '本体ボタン / Webリモコン / 両方 / おまかせ'],
      en: ['Mainly the Web remote / Light automatically on power-up and adjust with the Web remote / Choose for me', 'Onboard button / Web remote / Both / Choose for me'],
      zh: ['主要用网页遥控器 / 通电自动亮起并用网页遥控器调整 / 帮我决定', '机身按钮 / 网页遥控器 / 两者都用 / 帮我决定'],
    }
    expect(prompt).toContain(expected[locale][0])
    expect(prompt).not.toContain(expected[locale][1])
  })

  it.each(['ja', 'en', 'zh'] as const)('%s の登録済みv1ではv2だけの操作を選択肢にしない', locale => {
    const value = bleProfile()
    const context = createWorkshopContext(value, locale)
    const prompt = buildStartPrompt(context)
    expect(context.bleSource).toBe('registered')
    expect(context.controllerStarter).toBeUndefined()
    expect(prompt).not.toContain('"v":2')
    const offered = {
      ja: '「機器から届いたLEDの状態を見る / 明るさを変える / 光り方の切り替え・消灯 / 速さを変える / おまかせ」',
      en: '"See reported LED state / Adjust brightness / Switch lighting modes and turn lights off / Adjust speed / Choose for me"',
      zh: '“查看设备上报的 LED 状态 / 调整亮度 / 切换灯光模式及熄灭 / 调整速度 / 帮我决定”',
    }
    const v2Options = {
      ja: '再生・一時停止・消灯 / 名前付きの光り方',
      en: 'Play, pause and turn lights off / Named lighting modes',
      zh: '播放、暂停和熄灭 / 有名称的灯光模式',
    }
    expect(prompt).toContain(offered[locale])
    expect(prompt).not.toContain(v2Options[locale])
  })

  it.each(['ja', 'en', 'zh'] as const)('%s のBLEのみでは基準コード検証を省略せず候補やリモコン質問を追加しない', locale => {
    const value = profile()
    value.features = { button: true, ble: true, controller: false }
    const context = createWorkshopContext(value, locale)
    expect(context).toMatchObject({ bleSource: 'none', bleEnabled: false, controllerEnabled: false })
    expect(context.controllerStarter).toBeUndefined()
    const prompt = buildStartPrompt(context)
    expect(prompt).not.toContain('6e400001')
    expect(prompt).not.toContain('"v":2')
    expect(prompt).not.toMatch(/本体ボタン \/ Webリモコン|Onboard button \/ Web remote|机身按钮 \/ 网页遥控器/u)
  })

  it.each(['ja', 'en', 'zh'] as const)('%s の試用候補生成失敗は設定修正へ案内し、基準コードの登録を要求しない', locale => {
    const value = profile()
    value.features = { button: true, ble: true, controller: true }
    value.ledCount = 301
    const context = createWorkshopContext(value, locale)
    expect(context.errors).toEqual([])
    expect(context).toMatchObject({ bleSource: 'none', bleEnabled: false, controllerEnabled: false })
    expect(context.controllerStarter).toBeUndefined()
    expect(context.controllerStarterError).toContain(locale === 'ja' ? '1〜300' : '1–300')
    const prompt = buildStartPrompt(context)
    expect(prompt).not.toContain('"v":2')
    expect(prompt).not.toContain('6e400001')
    expect(prompt).toContain(locale === 'ja' ? '機器とLEDの設定を確認' : locale === 'en' ? 'Check the device and LED settings' : '检查设备与 LED 设置')
    expect(prompt).not.toMatch(/「対象機器で確認した基準コードの登録が必要です」|say a baseline verified on the target device must be registered|需要时说明必须登记经目标设备验证/u)
  })

  it.each(['ja', 'en', 'zh'] as const)('%s は登録済みv1を維持し、明示v2確認または別の未確認候補だけにv2仕様を含める', locale => {
    const value = bleProfile()
    const legacy = buildStartPrompt(createWorkshopContext(value, locale))
    expect(legacy).not.toContain('"v":2')
    value.baseline.verification!.nanoLedV1 = false
    value.baseline.verification!.nanoLedV2 = true
    expect(isWorkshopProfile(value)).toBe(true)
    const context = createWorkshopContext(value, locale)
    expect(context.bleEnabled).toBe(true)
    expect(context.controllerEnabled).toBe(true)
    expect(context.bleSource).toBe('registered')
    expect(context.controllerStarter).toBeUndefined()
    const prompt = buildStartPrompt(context)
    for (const text of ['"v":2', '"controls"', '"playback"', '"action"', 'MODE <id>', 'ACTION <id>', 'PLAY / PAUSE / OFF', '4096', 'UTF-8', 'Unicode', 'MIN_OFF_TO_ON_FADE_MS = 200', 'WS2812_TIMING_NS = (400, 850, 800, 450)', '6e400003-b5a3-f393-e0a9-e50e24dcca9e', value.baseline.code]) expect(prompt).toContain(text)
    expect(prompt).not.toContain('"v":1')
    if (locale !== 'ja') expect(prompt.replace(value.baseline.code, '').replace(value.displayName, '').replace(value.baseline.verification!.confirmedBy, '')).not.toMatch(/[\u3040-\u30ff]/u)
    value.baseline.code += '# modified'
    const changed = createWorkshopContext(value, locale)
    expect(changed.bleSource).toBe('bundled-candidate')
    expect(changed.rules).not.toContain(value.baseline.code)
    expect(changed.profile.baseline).toEqual(value.baseline)
  })
  it('v2フラグはbooleanだけを受け付け、v1から確認を推測しない', () => {
    const value = bleProfile()
    expect(isWorkshopProfile(value)).toBe(true)
    expect(cloneWorkshopProfile(value).baseline.verification).not.toHaveProperty('nanoLedV2')
    for (const nanoLedV2 of ['true', 1, null]) expect(isWorkshopProfile({ ...value, baseline: { ...value.baseline, verification: { ...value.baseline.verification, nanoLedV2 } } })).toBe(false)
    value.baseline.verification!.nanoLedV1 = false
    value.baseline.verification!.nanoLedV2 = false
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
    expect(createWorkshopContext(value).profile.baseline.verification).toEqual(value.baseline.verification)
  })
  it('旧NanoC6確認をAtomS3Liteへ流用せず、確認機種を一致させる', () => {
    const value = bleProfile()
    expect(createWorkshopContext(value).bleEnabled).toBe(true)
    value.boardId = 'atoms3lite'
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
    expect(createWorkshopContext(value).rules).not.toContain(value.baseline.code)
    expect(getBlePreparationReasons(value).join('\n')).toContain('確認対象機器')
    value.baseline.verification!.boardId = 'atoms3lite'
    expect(createWorkshopContext(value).bleSource).toBe('registered')
    value.boardId = 'm5nanoc6'
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
  })
  it('基準コードが未登録でも未確認の同梱候補でWebコントローラを準備できる', () => {
    const value = profile()
    value.features.ble = true
    value.features.controller = true
    const context = createWorkshopContext(value)
    expect(context.errors).toEqual([])
    expect(context.bleEnabled).toBe(true)
    expect(context.controllerEnabled).toBe(true)
    expect(context.bleSource).toBe('bundled-candidate')
    expect(context.bleReasons.join('\n')).toContain('未登録')
    expect(buildStartPrompt(context)).toContain('最初の質問を1問だけ')
    expect(context.rules).toContain('6e400001')
    expect(context.rules).toContain('実機未確認の試用コード')
    expect(context.profile.baseline).toEqual({ code: '', verification: null })
  })

  it('未確認の登録コードを持ち出さず、別の候補を出すと明記する', () => {
    const value = bleProfile()
    value.baseline.verification = null
    const context = createWorkshopContext(value)
    expect(context.bleSource).toBe('bundled-candidate')
    expect(context.rules).not.toContain('baseline sentinel')
  })

  it('対象ファームウェアまたはコードの変更で登録コードを除外し、未確認候補へ明示的に切り替える', () => {
    const value = bleProfile()
    value.firmwareVersion += '-changed'
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
    expect(createWorkshopContext(value).rules).not.toContain(value.baseline.code)
    expect(getBlePreparationReasons(value).join('\n')).toContain('版が設定と一致しません')
    const changed = bleProfile()
    changed.baseline.code += '\n'
    expect(createWorkshopContext(changed).bleSource).toBe('bundled-candidate')
    expect(createWorkshopContext(changed).rules).not.toContain(changed.baseline.code)
    expect(getBlePreparationReasons(changed).join('\n')).toContain('確認時から変更')
  })

  it('登録コードのWeb対応確認がなければ登録を保持して別の未確認候補を用意する', () => {
    const value = bleProfile()
    value.baseline.verification!.nanoLedV1 = false
    const context = createWorkshopContext(value)
    expect(context.errors).toEqual([])
    expect(context.bleSource).toBe('bundled-candidate')
    expect(context.profile.baseline).toEqual(value.baseline)
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

  it('確認者と日時が不正な登録を確認済みとして扱わず候補で準備する', () => {
    const value = bleProfile()
    value.baseline.verification!.confirmedBy = '{{TEACHER}}'
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
    value.baseline.verification!.confirmedBy = 'テスト'
    value.baseline.verification!.confirmedAt = 'not a date'
    expect(createWorkshopContext(value).bleSource).toBe('bundled-candidate')
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
    for (const text of ['機器: M5Stack AtomS3Lite', 'SoC: ESP32-S3', '本体ボタンを使う場合はGPIO41のアクティブLOW', '内蔵RGB LEDはGPIO35', '未確認のRGB電源制御ピンを追加しない', '外付けLEDは設定のGPIO2']) expect(prompt).toContain(text)
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
    for (const text of ['AtomS3Lite', 'ESP32-S3', 'GPIO41', 'GPIO35', 'GPIO2', 'LED_COUNT: 37', 'MAX_BRIGHTNESS_PERCENT: 25', 'WS2812_TIMING_NS = (400, 850, 800, 450)', 'machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)', 'MIN_OFF_TO_ON_FADE_MS = 200', 'period_ms = 3000 - 29 * n', '6e400001-b5a3-f393-e0a9-e50e24dcca9e', 'NanoLED-', value.baseline.code]) expect(prompt).toContain(text)
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

  it.each(['ja', 'en', 'zh'] as const)('%s のv2と同梱候補は現在の実出力からアクションを再スタートし、最初の復帰元を保持する', locale => {
    const required = {
      ja: ['有効な追加ACTIONを即時に受け付け', '同じIDなら再スタート、別のIDなら置換', '実行待ちの演出キューを作らない', '最後に実際に送信した全LEDのRGB出力', '有限時間で非ブロッキング', '同梱候補は200ms', '補間途中の再押下', '輝度係数を二重に掛けず', '基底モード・位相・playback', '復帰元を更新しない', '不正・未登録ID', 'PAUSEは補間途中でも', '開始・再スタート・置換・終了', 'v2に要求ID付きACKはない'],
      en: ['Accept valid additional ACTION commands immediately', 'restart the same ID or replace it with a different ID', 'never build an effect-execution backlog', "last actually transmitted RGB output", 'over a finite duration', 'bundled candidate uses 200ms', 'A retrigger during interpolation', 'Never apply brightness factors twice', 'base mode, phase and playback', 'must not overwrite this return state', 'Invalid or unregistered IDs', 'PAUSE holds the frame actually visible', 'start/restart/replacement/end', 'v2 has no request-ID ACK'],
      zh: ['立即接受有效的额外 ACTION', '相同 ID 重新开始，不同 ID 替换', '不建立等待执行的演出队列', '最后实际发送的 RGB 输出', '有限时间内非阻塞', '内置候选程序使用 200ms', '插值中再次按下', '不要对已应用安全上限的输出重复乘以亮度系数', '基础模式、相位和 playback', '不能覆盖该恢复状态', '无效或未登记 ID', 'PAUSE 即使在插值中', '动作开始、重新开始、替换及结束', 'v2 没有请求 ID ACK'],
    }
    for (const source of ['v2', 'candidate'] as const) {
      const value = bleProfile()
      if (source === 'v2') {
        value.baseline.verification!.nanoLedV1 = false
        value.baseline.verification!.nanoLedV2 = true
      } else value.baseline = { code: '', verification: null }
      const original = structuredClone(value)
      const prompt = buildStartPrompt(createWorkshopContext(value, locale))
      expect(prompt).toContain(nanoLedV2Rules[locale])
      for (const text of required[locale]) expect(prompt).toContain(text)
      for (const safety of ['REMOTE_OFF_FADE_MS = 200', 'MIN_OFF_TO_ON_FADE_MS = 200', 'time.ticks_ms()', 'time.ticks_diff()', 'MODE/PLAY/PAUSE/OFF']) expect(prompt).toContain(safety)
      expect(prompt).not.toMatch(/追加ACTIONは無視|Ignore additional ACTION commands|执行中忽略额外 ACTION/u)
      expect(value).toEqual(original)
    }
    const legacy = buildStartPrompt(createWorkshopContext(bleProfile(), locale))
    expect(legacy).not.toContain(nanoLedV2Rules[locale])
    expect(legacy).not.toContain(required[locale][0])
  })

  it('手動プロンプトの共通仕様・v2移行・演出追加も再スタート契約を維持する', () => {
    const manual = readFileSync(new URL('../../prompt.md', import.meta.url), 'utf8')
    expect(manual).not.toMatch(/追加ACTIONは無視|連打無視/u)
    const general = manual.split('Webコントローラ用のNanoLED v2固定仕様')[1].split('以下のNanoLED v1仕様')[0]
    const migration = manual.split('## プロンプトE0：')[1].split('## プロンプトE-v2：')[0]
    const addEffect = manual.split('## プロンプトE-v2：')[1].split('## プロンプトE（旧v1専用）')[0]
    for (const text of [general, migration, addEffect]) {
      for (const required of ['同じIDなら再スタート、別のIDなら置換', '実行待ちの演出キュー', '全LEDのRGB', '同梱候補は200ms', '復帰元', '不正・未登録ID', 'MODE/PLAY/PAUSE/OFF', 'Write応答']) expect(text).toContain(required)
    }
  })

  it.each(['ja', 'en', 'zh'] as const)('%s のv1・v2・同梱候補にリモコン消灯200msの共通契約を含める', locale => {
    for (const source of ['v1', 'v2', 'candidate'] as const) {
      const value = bleProfile()
      if (source === 'v2') {
        value.baseline.verification!.nanoLedV1 = false
        value.baseline.verification!.nanoLedV2 = true
      } else if (source === 'candidate') value.baseline = { code: '', verification: null }
      const original = structuredClone(value)
      const prompt = buildStartPrompt(createWorkshopContext(value, locale))
      expect(prompt).toContain(remoteOffFadeRules[locale])
      for (const text of ['REMOTE_OFF_FADE_MS = 200', 'MIN_OFF_TO_ON_FADE_MS = 200', 'time.ticks_ms()', 'time.ticks_diff()', 'playback=playing', 'playback=off', 'mode=OFF', 'KeyboardInterrupt']) expect(prompt).toContain(text)
      expect(prompt).not.toMatch(/OFFは直ちに全LEDを消灯|OFFは直ちに黒|OFF immediately sends|OFF 立即熄灭|OFF 立即输出/u)
      expect(value).toEqual(original)
    }
  })

  it.each(['ja', 'en', 'zh'] as const)('%s のリモコン消灯契約は設定保持・通知・明示書込み・安全停止を区別する', locale => {
    const rules = remoteOffFadeRules[locale]
    const required = {
      ja: ['OFFを1回', '最後に実際に送信した', '選択モード・明るさ設定を保持', '再開始・延長しない', 'PAUSEでも消灯処理は止めない', '黒を送ってから', '安全停止の消灯は即時', 'USBで明示的に'],
      en: ['OFF once', 'last actually transmitted', 'Retain the selected mode and brightness setting', 'does not restart or extend', 'PAUSE must not stop extinction', 'only after transmitting black', 'safety shutdown still turn LEDs off immediately', 'explicitly write/run it over USB'],
      zh: ['只发送一次 OFF', '最后实际发送', '保持所选模式和亮度设置', '不重新开始或延长', 'PAUSE 不停止熄灭过程', '发送全黑后才报告', '安全停止仍立即熄灭', '明确通过 USB'],
    }
    for (const text of required[locale]) expect(rules).toContain(text)
  })

  it('LEDのみの文面は自己完結し、競合する初回応答や不要なBLE本文を含まない', () => {
    const context = createWorkshopContext(profile())
    const prompt = buildStartPrompt(context)
    expect(prompt).toContain(context.rules)
    for (const text of ['使う機器「M5NanoC6」', 'LED設定', '最初の質問を1問だけ', '3〜5個', 'おまかせ', '最大6問', 'この仕様で作って', 'main.py全体を1つのPythonコードブロック', 'MicroPythonWriterからRaw REPL', 'AIが実機で動かしていない']) expect(prompt).toContain(text)
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
    for (const text of ['NanoLED-', '6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e', '応答ありWrite', 'Notify', 'LF込み20バイト以下', '128バイト', '有界', 'PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS', 'BRIGHTNESS 0は現在モードを保持', 'OFF中の明るさ・速さ変更では点灯しない', 'SPEED 0は停止ではなく最も遅い', 'period_ms = 3000 - 29 * n', '4096バイト以下', 'RRGGBB', '最後に実際に送信した値をRGB順', '最大5スナップショット/秒', '待機分は最新1件だけ', '完全な新しい行から', '物理的な発光をセンサーで測定した結果ではない']) expect(context.rules).toContain(text)
  })

  it('設定スナップショットは後の編集と参照を共有しない', () => {
    const value = bleProfile()
    const context = createWorkshopContext(value)
    const rules = context.rules
    value.firmwareVersion = 'mutated'
    value.features.ble = false
    value.baseline.code = 'changed'
    value.baseline.verification!.confirmedBy = 'changed'
    expect(context.profile.firmwareVersion).toBe('TEST-ONLY-UIFlow2')
    expect(context.profile.features.ble).toBe(true)
    expect(context.profile.baseline.code).not.toBe('changed')
    expect(context.profile.baseline.verification!.confirmedBy).not.toBe('changed')
    expect(context.rules).toBe(rules)
  })

  it('不正設定を修正依頼から汎用設定へ黙って落とさない', () => {
    const context = createWorkshopContext({ ...profile(), maxBrightnessPercent: null })
    expect(context.rules).toContain('設定が未完成または不正')
    expect(context.rules).toContain('汎用設定へ黙って切り替えない')
    expect(context.rules).toContain('利用者が上記を直すまで')
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
