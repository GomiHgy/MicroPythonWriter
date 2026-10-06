import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { workshopPresets } from '../config/workshops'
import { MAX_CONTROL_ACTIONS, MAX_CONTROL_MODES, MAX_NAMED_CONTROLS } from '../config/bleLimits'
import { namedControlPlanningRules, nanoLedTransportRules, nanoLedV2Rules } from '../i18n/promptMessages'
import type { BaseLocale as Locale } from '../i18n/types'
import { buildStartPrompt } from '../services/prompt/StartPromptBuilder'
import { RepairPromptBuilder } from '../services/prompt/RepairPromptBuilder'
import { buildMemoryPressureRules } from '../services/prompt/MemoryPressureRules'
import { createWorkshopContext } from '../services/prompt/WorkshopRules'
import { cloneWorkshopProfile } from '../services/workshop/WorkshopProfile'
import type { DeviceInfo } from '../types'

const locales: Locale[] = ['ja', 'en', 'zh']
const error = { exceptionType: 'ValueError', message: 'fixture', traceback: 'captured traceback', intentionalInterrupt: false }
const device: DeviceInfo = { deviceName: 'M5Stack NanoC6', microPythonVersion: 'test', firmwareInfo: 'test', nanoC6Confirmed: true, bootOptionSupported: true, nvsFallbackSupported: false }
const builder = new RepairPromptBuilder()

function setup(locale: Locale, path: 'candidate' | 'v1' | 'v2' | 'disabled') {
  const profile = cloneWorkshopProfile(workshopPresets[0].profile)
  profile.firmwareVersion = 'TEST-ONLY'
  profile.ledModel = 'WS2812B-MINI'
  profile.features = { button: true, ble: path !== 'disabled', controller: path !== 'disabled' }
  if (path === 'v1' || path === 'v2') {
    const code = '# Synthetic test baseline only; never physically verified\nprint("unaltered")'
    profile.baseline = { code, verification: { code, boardId: profile.boardId, firmwareVersion: 'TEST-ONLY', confirmedBy: 'test-only', confirmedAt: '2026-09-30', nanoLedV1: path === 'v1', nanoLedV2: path === 'v2' } }
  }
  return createWorkshopContext(profile, locale)
}

const content = {
  ja: {
    counts: ['controls.modesは1〜16個', 'controls.actionsは0〜15個', '合計16個以内の自由配分', 'SPARKLEも1個', '共通操作', 'ページ分けや非表示化でも減らない'],
    plan: ['早期に案内', '最終承認前', 'コード生成直前', '追加注文', '先頭16個へ切り詰め', '説明なく削除・統合', '上限を17個以上へ変更', 'コードを生成しない', 'おまかせでも整理内容を明示', '必要な質問は最大6問', 'UUID・MTU・通信ID'],
    transport: ['RX/TXの2本', '交渉済みATT MTU不明時に20バイト以下で開始', 'min(交渉済みATT MTU - 3, 244)', '希望値の設定', 'Bluetooth 5.0', '現在の接続にだけ', '以前のMTUを破棄', 'メモリ不足', '実バイト数だけ', '再同期'],
    memory: ['初期化時に構築して再利用', '毎回のSTATUSへcontrols全体', '送信中の1行と待機最新1件', '古い待機分だけ', '4096バイト以下', 'エンコード後バイト数', 'RAM不足は起きないとは保証しない'],
    rx: 'RXはLF終端のASCIIで1行LF込み20バイト以下',
    guard: '修正対象main.pyがNanoLEDを使用していると確認できた部分だけ',
  },
  en: {
    counts: ['controls.modes:1–16', 'controls.actions:0–15', 'combined 16 freely', 'SPARKLE counts as one', 'shared play/pause/off/status', 'including hidden or paginated ones'],
    plan: ['Warn early', 'Before final approval', 'immediately before code generation', 'after further requests', 'truncate to the first 16', 'silently remove/merge', 'raise the cap to 17', 'generate over-limit code', 'explain every change', 'at most 6 necessary questions', 'UUIDs, MTU or protocol IDs'],
    transport: ['exactly two application-defined characteristics', 'while negotiated ATT MTU is unknown', 'min(negotiated ATT MTU - 3, 244)', 'Setting a preferred value', 'Bluetooth 5.0', 'only to their current connection', 'Discard the previous MTU', 'memory exhaustion', 'actual byte count', 'resynchronize'],
    memory: ['at initialization and reuse', 'all controls in every STATUS', 'at most one latest pending state', 'only the older pending state', '4096 UTF-8 bytes', 'encoded byte size', 'prevents RAM exhaustion'],
    rx: 'RX is ASCII, LF terminated, at most 20 bytes including LF',
    guard: 'captured repair-target main.py is confirmed to use NanoLED',
  },
  zh: {
    counts: ['controls.modes 为 1–16 个', 'controls.actions 为 0–15 个', '合计 16 个以内自由分配', 'SPARKLE 也算 1 个', '共用播放/暂停/熄灭/状态获取', '分页和隐藏不减少数量'],
    plan: ['及早提醒', '最终批准前', '代码生成前', '追加需求后', '只截取前 16 个', '未说明就删除或合并', '上限改为 17 个以上', '不能生成超限代码', '说明整理了什么', '必要问题最多 6 个', 'UUID、MTU 或通信 ID'],
    transport: ['RX/TX 两个应用自定义 Characteristic', '已协商 ATT MTU 未知时', 'min(已协商 ATT MTU - 3, 244)', '设置期望值', 'Bluetooth 5.0', '对应的当前连接', '丢弃以前的 MTU', '内存不足', '实际字节数', '重新同步'],
    memory: ['初始化时构建并复用', '每个 STATUS 仍须包含完整 controls', '最多一份最新待发送状态', '只替换旧待发送状态', '4096 个 UTF-8 字节', '编码后的字节数', '不会内存不足'],
    rx: 'RX 为 LF 结尾的 ASCII，每行含 LF 最多 20 字节',
    guard: '已确认修复对象 main.py 使用 NanoLED 的部分',
  },
}

describe('NanoLED準備文の16操作・可変MTU・省メモリ方針', () => {
  // 指示の存在と経路の整合性のテスト。外部AIの遵守や実機の動作を証明しない。
  it.each(locales)('%s 初回と修正で候補・登録v2の共通方針を一度ずつ保持する', locale => {
    for (const path of ['candidate', 'v2'] as const) {
      const context = setup(locale, path)
      const before = structuredClone(context)
      for (const prompt of [buildStartPrompt(context), builder.build(error, '# original artwork', device, 'captured log', '実行', context)]) {
        expect(prompt).toContain(`len(controls.modes) + len(controls.actions) <= ${MAX_NAMED_CONTROLS}`)
        expect(MAX_CONTROL_MODES).toBe(16)
        expect(MAX_CONTROL_ACTIONS).toBe(15)
        for (const rules of [nanoLedTransportRules[locale], namedControlPlanningRules[locale], buildMemoryPressureRules(locale, true)]) expect(prompt.split(rules)).toHaveLength(2)
        for (const token of [...content[locale].counts, ...content[locale].plan, ...content[locale].transport, ...content[locale].memory, content[locale].rx, '247', '4096', '6e400001-b5a3-f393-e0a9-e50e24dcca9e', '6e400002-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e']) expect(prompt).toContain(token)
        expect(prompt).not.toMatch(/modesは1〜8件|modes:1–8 items|modes 为 1–8 项|Notifyを1回20バイト以下|Split Notify into at most 20 bytes|每次 Notify 分片最多 20 字节/)
      }
      expect(context).toEqual(before)
    }
  })

  it.each(locales)('%s v1は共通送信条件を保持しv2や新しいカタログを追加させない', locale => {
    const context = setup(locale, 'v1')
    for (const prompt of [buildStartPrompt(context), builder.build(error, 'original v1', device, 'log', '実行', context)]) {
      expect(prompt.split(nanoLedTransportRules[locale])).toHaveLength(2)
      expect(prompt).not.toContain(namedControlPlanningRules[locale])
      expect(prompt).not.toContain('len(controls.modes) + len(controls.actions)')
      expect(prompt).toContain(context.profile.baseline.code)
    }
  })

  it.each(locales)('%s BLE無効なら新しいリモコン操作・MTU設定の指示を入れない', locale => {
    const context = setup(locale, 'disabled')
    for (const prompt of [buildStartPrompt(context), builder.build(error, 'original no-BLE code', device, 'log', '実行', context)]) {
      expect(prompt).not.toContain(nanoLedTransportRules[locale])
      expect(prompt).not.toContain(namedControlPlanningRules[locale])
      expect(prompt).not.toContain('BLE.config(mtu=')
      expect(prompt).not.toContain('controls.modes')
    }
  })

  it.each(locales)('%s 設定不明の修正は既存NanoLEDコードだけへの条件付き適用とする', locale => {
    const repair = builder.build(error, '# captured code', device, 'captured log', '実行', null, { locale })
    expect(repair).toContain(content[locale].guard)
    expect(repair).toContain('len(controls.modes) + len(controls.actions) <= 16')
    expect(repair.split(nanoLedTransportRules[locale])).toHaveLength(2)
    expect(repair).toContain('# captured code')
  })

  it.each(locales)('%s の初回相談とコード出力それぞれに再計数を組み込む', locale => {
    const prompt = buildStartPrompt(setup(locale, 'candidate'))
    const heading = { ja: '## コードを出すとき', en: '## Producing code', zh: '## 输出代码' }[locale]
    const [conversation, generation] = prompt.split(heading)
    expect(conversation).toContain(namedControlPlanningRules[locale])
    expect(generation).toContain('16')
    expect(generation).toContain('4096')
  })

  it('手動プロンプトも旧8/8と常時20固定を残さず各作業段階を含む', () => {
    const canonical = readFileSync('prompt.md', 'utf8')
    for (const token of ['controls.modesは1〜16個', 'controls.actionsは0〜15個', 'len(controls.modes) + len(controls.actions) <= 16', '最終承認前', 'コード生成直前', '先頭16個への切り詰め', '希望ATT MTU候補は247', 'min(交渉済みATT MTU - 3, 244)', 'RXのLF込み20バイト以下ASCII', '送信待ちは最新1件', '全LED分のpixels', '_IRQ_MTU_EXCHANGED=21']) expect(canonical).toContain(token)
    expect(canonical).not.toContain('modesは1〜8件、actionsは0〜8件')
    expect(canonical).not.toContain('Notifyは1回20バイト以下。')
    expect(nanoLedV2Rules.ja).toContain('ACTION再押下の動作は、明示された作品仕様')
  })
})
