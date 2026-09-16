import type { DeviceInfo, ParsedTraceback } from '../../types'
import type { WorkshopContext } from './WorkshopRules'
const sensitive = /(?:password|passwd|pswd|api_key|token|secret|ssid)\s*=\s*[^\n#]+/i
export const hasSensitiveAssignments = (source: string) => sensitive.test(source)
export class RepairPromptBuilder {
  build(error: ParsedTraceback, source: string, device: DeviceInfo, terminalLog: string, stage: string, workshop: WorkshopContext | null = null, options: { sourceKnown?: boolean } = {}) {
    const sourceKnown = options.sourceKnown !== false
    const codeOutput = workshop?.errors.length ? '教材設定が不正または未完成のため、設定に依存する修正版の生成は保留し、講師が確認する項目を示す' : '対応するコードがある場合、修正後の完全なmain.pyを1つのPythonコードブロックで出力する'
    const codeSection = sourceKnown ? `## エラーに対応するmain.py（操作時のスナップショット）\n~~~python\n${source}\n~~~` : '## エラーに対応するmain.py\n機器で実行されたmain.pyは未取得です。編集中コードをエラーが起きたコードとして扱わないでください。この機器の実行コードと選択教材の対応は未確認で、教材設定はブラウザ側の参考情報です。'
    const workshopSection = workshop ? `\n\n## 操作時のワークショップ設定\n${workshop.errors.length ? `設定が未設定または不正です。次の項目を講師が修正するまで、不足値を推測せず、教材に適合した修正版として確定しないでください。\n${workshop.errors.map(message => `- ${message}`).join('\n')}\n\n` : ''}${workshop.rules}` : ''
    return `あなたはM5Stack NanoC6向けMicroPythonのデバッグ担当です。\n\n${sourceKnown ? '以下のmain.pyに関する操作でエラーが発生しました。' : '機器の通信操作でエラーが発生しました。'}原因を分析し、M5Stack NanoC6上のMicroPython向けの対処を、下記の設定と修正条件に従って示してください。\n\n## 実行環境（機器からの取得情報）\n機器: ${device.deviceName}\nSoC: ESP32-C6\nMicroPython: ${device.microPythonVersion}\nファームウェア情報: ${device.firmwareInfo}\nboot_option: ${device.bootOption ?? '未取得'}\n実行方法: ブラウザのWeb Serial APIからRaw REPLを使用してmain.pyを書込み、実行\n取得したMicroPython版から講師設定の対象UIFlow2版を推測しないでください。\n\n## エラー発生ステージ\n${stage}\n\n## エラー\n種類: ${error.exceptionType}\nメッセージ: ${error.message}\nTraceback:\n~~~\n${error.traceback}\n~~~\n\n## 関連するシリアルログ\n~~~\n${terminalLog}\n~~~\n\n${codeSection}${workshopSection}\n\n## 修正条件\n- CPython専用APIではなくMicroPythonで動作させる\n- ESP32-C6およびM5Stack NanoC6で利用可能なAPIを使う\n- 存在が確認できないライブラリを勝手に仮定しない\n- 使用するGPIO番号や周辺機器の前提を明記する\n- 無限ループには適切なsleep_ms()を入れる\n- Ctrl-Cによる停止を極力妨げない\n- エラー原因を簡潔に説明する\n- ${codeOutput}\n- 静的確認と実機確認を区別し、実機未確認のコードを実機確認済みとしない` }
}
