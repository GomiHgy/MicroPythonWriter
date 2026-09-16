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
    expect(repair).toContain('BRIGHTNESS 100は講師設定の最大輝度の100%')
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
