import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildOutputLanguageContract } from '../services/prompt/OutputLanguageRules'
import { buildLanguageRecoveryPrompt } from '../services/prompt/LanguageRecoveryPrompt'
import type { DeviceInfo } from '../types'

const device: DeviceInfo = { deviceName: 'M5NanoC6', microPythonVersion: 'test', firmwareInfo: 'test', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }
const error = { exceptionType: 'SyntaxError', message: 'error', traceback: 'captured error', intentionalInterrupt: false }

describe('MicroPython出力環境の維持と再同期', () => {
  it.each(['ja', 'en', 'zh'] as const)('%sの準備文と修正依頼の冒頭・生成直前に出力契約を示す', locale => {
    const context = createWorkshopContext({ ...workshopPresets[0].profile, firmwareVersion: 'test-firmware', ledModel: 'WS2812B', ledCount: 37, maxBrightnessPercent: 20 }, locale)
    const contract = buildOutputLanguageContract(locale)
    for (const prompt of [buildStartPrompt(context), new RepairPromptBuilder().build(error, 'print("captured source")', device, 'captured log', '実行', context)]) {
      expect(prompt.startsWith(contract)).toBe(true)
      expect(prompt.split(contract)).toHaveLength(3)
      for (const value of ['UIFlow2', 'MicroPython', 'Arduino', 'C++', 'main.py']) expect(contract).toContain(value)
    }
  })
  it.each(['ja', 'en', 'zh'] as const)('%sの短い再同期文は現在設定と演出維持を含め、登録コードやコピー本文を送らない', locale => {
    const context = createWorkshopContext({ ...workshopPresets[1].profile, firmwareVersion: 'current-uiflow2', ledModel: 'SK6812', ledCount: 37, ledPin: 2, maxBrightnessPercent: 23, features: { button: true, ble: false, controller: false }, baseline: { code: 'private baseline secret', verification: null } }, locale)
    const before = structuredClone(context)
    const recovery = buildLanguageRecoveryPrompt(context, locale)
    for (const value of ['AtomS3Lite', 'current-uiflow2', 'SK6812', 'LED_COUNT: 37', 'LED_PIN: 2', 'MAX_BRIGHTNESS_PERCENT: 23', 'BUTTON_PIN: 41', 'BLE_REQUESTED: false', 'WEB_CONTROLLER_REQUESTED: false']) expect(recovery).toContain(value)
    expect(recovery).toContain(locale === 'en' ? 'preserving the agreed lighting effects' : locale === 'zh' ? '保持已商定的灯光效果' : '合意済みの光り方')
    expect(recovery).not.toContain('private baseline secret')
    expect(recovery.length).toBeLessThan(2200)
    expect(context).toEqual(before)
  })
  it('未選択時は勝手に機種・LED条件を決めない', () => {
    const recovery = buildLanguageRecoveryPrompt(null, 'ja')
    expect(recovery).toContain('合意済みの設定を使い、不明なら確認')
    expect(recovery).not.toContain('GPIO2')
    expect(recovery).not.toContain('LED_COUNT: 10')
  })
  it.each(['ja', 'en', 'zh'] as const)('%sはBluetooth希望と未登録による準備不可を区別し、既存機能の削除を指示しない', locale => {
    const context = createWorkshopContext({ ...workshopPresets[0].profile, firmwareVersion: 'test-only', ledModel: 'WS2812B', features: { button: true, ble: true, controller: false }, baseline: { code: '', verification: null } }, locale)
    expect(context.bleEnabled).toBe(false)
    const recovery = buildLanguageRecoveryPrompt(context, locale)
    expect(recovery).toContain('BLE_REQUESTED: true')
    expect(recovery).toContain('BLE_PREPARATION_AVAILABLE: false')
    expect(recovery).toContain(locale === 'en' ? 'preserve the existing agreement' : locale === 'zh' ? '保持已有约定' : '既存の合意を優先')
    expect(recovery).toContain(locale === 'en' ? 'does not authorize deleting' : locale === 'zh' ? '不是删除所需或既有功能的许可' : '希望・既存の機能を削除しない')
  })
})
