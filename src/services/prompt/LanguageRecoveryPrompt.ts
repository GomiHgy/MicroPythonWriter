import { boardDefinitions, isBoardId } from '../../config/boards'
import type { Locale } from '../../i18n/types'
import { validProfileText } from '../workshop/WorkshopProfile'
import type { WorkshopContext } from './WorkshopRules'
import { buildOutputLanguageContract } from './OutputLanguageRules'
import { basePromptLocale } from '../../i18n/locales'

/** 同じAIの会話へ戻す短い依頼。クリップボードのコードや秘密情報は取り込まない。 */
export function buildLanguageRecoveryPrompt(workshop: WorkshopContext | null | undefined, locale: Locale): string {
  const base = basePromptLocale(locale)
  const profile = workshop?.profile
  const unknown = base === 'en' ? 'Use the settings already agreed in this conversation; ask if unknown.' : base === 'zh' ? '使用本对话已商定的设置；未知时先确认。' : 'この会話で合意済みの設定を使い、不明なら確認してください。'
  const board = profile && isBoardId(profile.boardId) ? boardDefinitions[profile.boardId] : null
  const value = (setting: string | number | null | undefined) => typeof setting === 'number' && Number.isFinite(setting) ? String(setting) : typeof setting === 'string' && validProfileText(setting) ? setting : unknown
  const settings = profile ? `Device: ${board?.name ?? unknown}\nUIFlow2: ${value(profile.firmwareVersion)}\nLED: ${value(profile.ledModel)}\nLED_COUNT: ${value(profile.ledCount)}\nLED_PIN: ${value(profile.ledPin)}\nLED_BPP: 3\nMAX_BRIGHTNESS_PERCENT: ${value(profile.maxBrightnessPercent)}\nBUTTON_REQUESTED: ${profile.features.button}\nBUTTON_PIN: ${board?.buttonPin ?? unknown}\nBLE_REQUESTED: ${profile.features.ble}\nBLE_PREPARATION_AVAILABLE: ${workshop?.bleEnabled === true}\nWEB_CONTROLLER_REQUESTED: ${profile.features.controller}\nWEB_CONTROLLER_PREPARATION_AVAILABLE: ${workshop?.controllerEnabled === true}` : unknown
  const instruction = base === 'en'
    ? 'The last program was Arduino/C++ and cannot run in MicroPythonWriter. Convert it to MicroPython while preserving the agreed lighting effects, timing, button gestures and enabled wireless controls, including the existing BLE version/protocol. Use machine.Pin, machine.bitstream and time with the fixed LED safety rules already supplied. Do not replace the artwork with a sample or add unrequested features. The browser settings below are reference information, not a device inspection. If their relationship to this artwork is unconfirmed or conflicting, preserve the existing agreement and confirm before changing settings. REQUESTED means the user selection; PREPARATION_AVAILABLE is readiness and does not authorize deleting requested or existing features.'
    : locale === 'zh'
      ? '刚才的程序是 Arduino/C++，不能在 MicroPythonWriter 中运行。请转换为 MicroPython，保持已商定的灯光效果、时序、按钮手势和已启用的无线操作，包括既有 BLE 版本和协议。遵守已提供的 LED 安全规则，使用 machine.Pin、machine.bitstream 和 time。不用示例替换作品，不增加未请求的功能。下方浏览器设置是参考信息，不代表设备检查结果；与作品的对应关系未确认或冲突时，保持已有约定并在更改设置前确认。REQUESTED 表示用户的选择，PREPARATION_AVAILABLE 表示准备可用性，不是删除所需或既有功能的许可。'
      : '直前のプログラムはArduino用のC++で、MicroPythonWriterでは実行できません。合意済みの光り方・時間・ボタンの押し方・有効な無線操作（既存のBLE版・通信仕様を含む）を変えず、MicroPython版へ書き直してください。すでに渡したLEDの固定安全ルールに従い、machine.Pin・machine.bitstream・timeを使ってください。作品をサンプルに置き換えず、依頼されていない機能を追加しないでください。下記はブラウザ設定の参考情報であり、機器から取得した設定ではありません。作品との対応が未確認、または矛盾する場合は既存の合意を優先し、設定を変える前に確認してください。REQUESTEDは利用者の選択、PREPARATION_AVAILABLEは準備の可否で、準備不可を理由に希望・既存の機能を削除しないでください。'
  return `${buildOutputLanguageContract(locale)}\n\n${instruction}\n\n${settings}\n\n${buildOutputLanguageContract(locale)}`
}
