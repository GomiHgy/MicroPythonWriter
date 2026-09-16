import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { RepairPromptBuilder, hasSensitiveAssignments } from '../services/prompt/RepairPromptBuilder'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const device: DeviceInfo = { deviceName: 'test-NanoC6', microPythonVersion: 'probe-micropython-version', firmwareInfo: 'probe-firmware-info', bootOption: 1, nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }
const error = { exceptionType: 'ValueError', message: 'failed', traceback: 'Traceback (most recent call last):\n  File "main.py", line 3\nValueError: failed', intentionalInterrupt: false }
const profile = (): WorkshopProfile => ({ ...workshopPresets[0].profile, kitId: '007', firmwareVersion: 'instructor-uiflow-version', ledModel: 'test-RGB', ledCount: 37, maxBrightnessPercent: 25 })
const builder = new RepairPromptBuilder()

describe('ワークショップ修正依頼', () => {
  it.each(['en', 'zh'] as const)('アプリ由来の未取得表示と操作名のみ%sへ翻訳し、原文データを変えない', locale => {
    const unavailableDevice = { ...device, deviceName: '未接続', microPythonVersion: '未取得', firmwareInfo: '未取得', nanoC6Confirmed: false }
    const rawError = { ...error, message: '機器の原文エラー', traceback: '機器の原文トレースバック' }
    const repair = builder.build(rawError, '# 原文コード', unavailableDevice, '原文ログ: 未取得', 'USB接続', null, { locale })
    expect(repair).toContain(locale === 'en' ? 'Device: Not connected' : '设备: 未连接')
    expect(repair).toContain(locale === 'en' ? 'MicroPython: Not available' : 'MicroPython: 尚未获取')
    expect(repair).toContain(locale === 'en' ? 'Firmware information: Not available' : '固件信息: 尚未获取')
    expect(repair).toContain(locale === 'en' ? '\nUSB connection\n' : '\nUSB 连接\n')
    for (const raw of ['機器の原文エラー', '機器の原文トレースバック', '# 原文コード', '原文ログ: 未取得']) expect(repair).toContain(raw)
    const runtime = builder.build(error, 'source', { ...device, deviceName: '実機の名前', firmwareInfo: '未取得を含む実機原文', microPythonVersion: '実機バージョン' }, 'log', 'DEVICE_RUNTIME_ERROR', null, { locale })
    for (const raw of ['実機の名前', '未取得を含む実機原文', '実機バージョン', '(DEVICE_RUNTIME_ERROR)']) expect(runtime).toContain(raw)
  })
  it.each(['en', 'zh'] as const)('言語変更後も操作時設定・コード・ログを保持して%sで全文生成する', locale => {
    const input = { ...profile(), boardId: 'atoms3lite' as const, displayName: 'Test material' }
    const context = createWorkshopContext(input)
    const atom = { ...device, deviceName: 'AtomS3Lite', boardId: 'atoms3lite' as const, soc: 'ESP32-S3' as const, nanoC6Confirmed: false }
    const source = '# 日本語コードは変えない\nprint("snapshot")'
    const log = '日本語ログも変えない'
    const repair = builder.build(error, source, atom, log, 'DEVICE_RUNTIME_ERROR', context, { locale })
    for (const value of [source, log, error.traceback, 'GPIO41', 'GPIO35', 'SoC: ESP32-S3', 'LED_COUNT: 37', 'instructor-uiflow-version']) expect(repair).toContain(value)
    expect(repair).not.toContain('## ワークショップの設定スナップショット')
    expect(repair).toContain(locale === 'en' ? 'Respond in English' : '请用简体中文回答')
    expect(context.locale).toBe('ja')
    expect(context.profile.ledCount).toBe(37)
  })

  it('汎用機器へNanoC6とESP32-C6を固定で割り当てない', () => {
    const unknown = { ...device, deviceName: 'MicroPython device', microPythonVersion: 'v1', nanoC6Confirmed: false }
    const repair = builder.build(error, 'source', unknown, 'log', '実行')
    expect(repair).toContain('確認できた機種: 未確認')
    expect(repair).toContain('SoC: 未確認')
    expect(repair).not.toContain('SoC: ESP32-C6')
    const s3 = builder.build(error, 'source', { ...unknown, deviceName: 'ESP32-S3' }, 'log', '実行')
    expect(s3).toContain('確認できた機種: 未確認')
    expect(s3).toContain('SoC: ESP32-S3')
  })

  it('選択キットと取得機器の不一致を隠さず、GPIO依存の修正を保留する', () => {
    const context = createWorkshopContext({ ...profile(), boardId: 'atoms3lite' })
    const repair = builder.build(error, 'source', device, 'log', '実行', context)
    expect(repair).toContain('確認できた機種: M5NanoC6')
    expect(repair).toContain('機器: M5Stack AtomS3Lite')
    expect(repair).toContain('選択教材と取得した機器の種類が一致しません')
    expect(repair).toContain('設定に依存する修正版の生成は保留')
  })
  it('初回準備文と同じ固定ルールを全文1回だけ使い、修正対象の情報を保持する', () => {
    const context = createWorkshopContext(profile())
    const source = 'print("complete-source")\n' + 'value = 1\n'.repeat(1000) + 'raise ValueError("failed")'
    const start = buildStartPrompt(context)
    const repair = builder.build(error, source, device, 'complete-operation-log', 'DEVICE_RUNTIME_ERROR', context)
    expect(start).toContain(context.rules)
    expect(repair).toContain(context.rules)
    expect(repair.split(context.rules)).toHaveLength(2)
    for (const required of ['LED_COUNT: 37', 'GPIO2', 'GPIO9', 'machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)', 'GRB', 'MAX_BRIGHTNESS_PERCENT: 25', 'MIN_OFF_TO_ON_FADE_MS = 200', '最後に送信した全LED出力が0', 'フェード中に別の点灯モードへ変更するときは進行度を維持', source, error.traceback, device.microPythonVersion, device.firmwareInfo, 'complete-operation-log', 'DEVICE_RUNTIME_ERROR']) expect(repair).toContain(required)
    expect(repair).toContain('instructor-uiflow-version')
    expect(repair).not.toContain('最初の質問を1問')
    expect(repair).not.toContain('6e400001')
  })

  it('BLEが有効な場合は同じ確認済み基準コード全文とNanoLEDルールを保持する', () => {
    const input = profile()
    const baselineCode = 'print("test-fixture-only")\napi_key = "test-not-a-real-key"\n'
    input.features = { button: true, ble: true, controller: true }
    input.baseline = { code: baselineCode, verification: { code: baselineCode, firmwareVersion: input.firmwareVersion!, confirmedBy: 'test-fixture', confirmedAt: '2026-09-15', nanoLedV1: true } }
    const context = createWorkshopContext(input)
    expect(context.bleEnabled).toBe(true)
    const repair = builder.build(error, 'print("device-source")', device, 'log', '実行', context)
    expect(repair).toContain(baselineCode)
    expect(repair).toContain('NanoLED-007')
    expect(repair).toContain('6e400001-b5a3-f393-e0a9-e50e24dcca9e')
    expect(repair).toContain('BRIGHTNESS 100は準備画面で設定した最大輝度の100%')
    expect(repair).toContain('Notifyは1回20バイト以下')
    expect(repair).toContain('物理的な発光をセンサーで測定した結果ではない')
    expect(hasSensitiveAssignments(repair)).toBe(true)
  })

  it('選択した教材が不正でも黙って汎用版へ変えず、未登録コードを含めない', () => {
    const input = profile()
    input.ledCount = null
    input.features = { button: true, ble: true, controller: true }
    input.baseline = { code: 'unverified-private-baseline', verification: null }
    const context = createWorkshopContext(input)
    const repair = builder.build(error, 'actual-source', device, 'log', '実行', context)
    expect(repair).toContain('設定が未設定または不正')
    expect(repair).toContain('講師が修正するまで')
    for (const issue of context.errors) expect(repair).toContain(issue)
    expect(repair).toContain('キットID: 007')
    expect(repair).toContain('actual-source')
    expect(repair).not.toContain('unverified-private-baseline')
  })

  it('通常利用の汎用修正依頼も利用できる', () => {
    const repair = builder.build(error, 'generic-source', device, 'generic-log', '実行')
    expect(repair).toContain('generic-source')
    expect(repair).toContain('generic-log')
    expect(repair).toContain(error.traceback)
    expect(repair).not.toContain('ワークショップの設定スナップショット')
    expect(repair).not.toContain('LED_COUNT:')
  })

  it('実行コード未取得は空のmain.pyや編集中コードとして偽装しない', () => {
    const context = createWorkshopContext(workshopPresets[0].profile)
    const repair = builder.build(error, 'unrelated-source', device, 'sync-log', 'RAW_REPL_SYNC_ERROR', context, { sourceKnown: false })
    expect(repair).toContain('機器で実行されたmain.pyは未取得')
    expect(repair).toContain('教材設定はブラウザ側の参考情報')
    expect(repair).toContain('設定が未設定または不正')
    expect(repair).not.toContain('unrelated-source')
    expect(repair).toContain('sync-log')
  })
})
