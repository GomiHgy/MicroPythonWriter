import type { Locale } from '../../i18n/types'

/** 長い準備文・相談・エラー修正でも見失わない、短い実行環境と出力形式の指定。 */
export function buildOutputLanguageContract(locale: Locale): string {
  if (locale === 'en') return 'This conversation creates and repairs MicroPython programs running on UIFlow2. Keep this runtime even when the device or effects change; never switch to Arduino/C++. Whenever you output finished code, provide the complete main.py without omissions in one Python code block.'
  if (locale === 'zh') return '本对话创建和修复的是在 UIFlow2 上运行的 MicroPython 程序。即使更改设备或效果，也要保持此运行环境，不切换为 Arduino/C++。输出完成代码时，必须在一个 Python 代码块中提供无省略的完整 main.py。'
  return 'この会話で作成・修正するプログラムは、UIFlow2上で動くMicroPython用です。機器や演出を変更してもこの実行環境を維持し、Arduino・C++へ切り替えないでください。完成コードを出すときは、省略のないmain.py全文を1つのPythonコードブロックで出してください。'
}
