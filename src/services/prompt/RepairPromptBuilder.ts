import type { DeviceInfo, ParsedTraceback } from '../../types'
const sensitive = /(?:password|passwd|pswd|api_key|token|secret|ssid)\s*=\s*[^\n#]+/i
export const hasSensitiveAssignments = (source: string) => sensitive.test(source)
export class RepairPromptBuilder {
  build(error: ParsedTraceback, source: string, device: DeviceInfo, terminalLog: string, stage: string) {
    return `あなたはM5Stack NanoC6向けMicroPythonのデバッグ担当です。\n\n以下のmain.pyでエラーが発生しました。原因を分析し、M5Stack NanoC6上のMicroPythonで動作する修正版を作成してください。\n\n## 実行環境\n機器: ${device.deviceName}\nSoC: ESP32-C6\nMicroPython: ${device.microPythonVersion}\nファームウェア情報: ${device.firmwareInfo}\nboot_option: ${device.bootOption ?? '未取得'}\n実行方法: ブラウザのWeb Serial APIからRaw REPLを使用してmain.pyを書込み、実行\n\n## エラー発生ステージ\n${stage}\n\n## エラー\n種類: ${error.exceptionType}\nメッセージ: ${error.message}\nTraceback:\n~~~\n${error.traceback}\n~~~\n\n## 関連するシリアルログ\n~~~\n${terminalLog}\n~~~\n\n## 現在のmain.py\n~~~python\n${source}\n~~~\n\n## 修正条件\n- CPython専用APIではなくMicroPythonで動作させる\n- ESP32-C6およびM5Stack NanoC6で利用可能なAPIを使う\n- 存在が確認できないライブラリを勝手に仮定しない\n- 使用するGPIO番号や周辺機器の前提を明記する\n- 無限ループには適切なsleep_ms()を入れる\n- Ctrl-Cによる停止を極力妨げない\n- エラー原因を簡潔に説明する\n- 修正後の完全なmain.pyをコードブロックで出力する` }
}
