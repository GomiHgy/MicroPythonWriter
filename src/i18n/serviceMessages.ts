import type { MessageCatalog } from './types'

export const serviceMessages: MessageCatalog = {
  ...{
  "受信: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Receive: timed out after {timeoutMs} ms waiting for data.",
    "zh": "接收：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "常駐プログラム停止: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Stop running program: timed out after {timeoutMs} ms waiting for data.",
    "zh": "停止运行中的程序：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "常駐プログラム出力: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Program output: timed out after {timeoutMs} ms waiting for data.",
    "zh": "程序输出：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "常駐プログラム受付: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Start program: timed out after {timeoutMs} ms waiting for data.",
    "zh": "启动程序：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "Raw REPL同期: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Raw REPL synchronization: timed out after {timeoutMs} ms waiting for data.",
    "zh": "Raw REPL 同步：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "Raw REPLプロンプト: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Raw REPL prompt: timed out after {timeoutMs} ms waiting for data.",
    "zh": "Raw REPL 提示符：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "有限コマンド受付: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Accept command: timed out after {timeoutMs} ms waiting for data.",
    "zh": "接受命令：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "有限コマンド標準出力: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Command output: timed out after {timeoutMs} ms waiting for data.",
    "zh": "命令标准输出：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "有限コマンド標準エラー: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "Command error output: timed out after {timeoutMs} ms waiting for data.",
    "zh": "命令标准错误：等待接收数据 {timeoutMs} 毫秒后超时。"
  }
},
  "ローカルの未保存編集を上書きしますか？": {
    "en": "Overwrite the unsaved code in the editor?",
    "zh": "要覆盖编辑器中尚未保存的代码吗？"
  },
  "既存のmain.pyをmain.py.bakへ退避して、編集内容で更新します。実行はしません。続ける？": {
    "en": "Back up main.py as main.py.bak and replace it with your edited code without running. Continue?",
    "zh": "将 main.py 备份为 main.py.bak，然后用编辑后的代码更新，但不运行。继续吗？"
  },
  "動作OKとして自動起動モードに変更し、リセットします。実機動作を確認済み？": {
    "en": "Enable automatic startup and restart the device. Have you verified the program on the real device?",
    "zh": "将启用自动启动并重启设备。是否已确认实机运行正常？"
  },
  "次回起動を永続プログラムモードに変更します。続ける？": {
    "en": "Disable automatic execution at power-on. This setting persists. Continue?",
    "zh": "将禁用通电自动运行，此设置会永久保存。继续吗？"
  },
  "MicroPython機器をリセットします。続ける？": {
    "en": "Restart the MicroPython device. Continue?",
    "zh": "要重启 MicroPython 设备吗？"
  },
  "USB接続": {
    "en": "USB connection",
    "zh": "USB 连接"
  },
  "プログラム読込み": {
    "en": "Read program",
    "zh": "读取程序"
  },
  "停止": {
    "en": "Stop",
    "zh": "停止"
  },
  "起動モード設定": {
    "en": "Startup settings",
    "zh": "启动设置"
  },
  "ハードリセット": {
    "en": "Device restart",
    "zh": "设备重启"
  },
  "このブラウザはWeb Serial APIに対応していません。PC版ChromeまたはEdgeを使用してください。": {
    "en": "This browser does not support Web Serial. Use Chrome or Edge on a computer.",
    "zh": "此浏览器不支持 Web Serial，请使用电脑版 Chrome 或 Edge。"
  },
  "USBシリアルポートの選択がキャンセルされたか、許可されませんでした。": {
    "en": "USB port selection was cancelled or denied.",
    "zh": "USB 串口选择已取消或未获许可。"
  },
  "USBシリアル接続が切断されました。": {
    "en": "The USB serial connection was lost.",
    "zh": "USB 串口连接已断开。"
  },
  "MicroPython REPLを取得できませんでした。": {
    "en": "Could not access the MicroPython REPL.",
    "zh": "无法访问 MicroPython REPL。"
  },
  "このファームウェアではUIFlowの起動モードを安全に変更できません。main.pyの書込みと実行は利用できますが、boot_optionの変更は行いません。": {
    "en": "This firmware does not support safe UIFlow startup-mode changes. You can write and run main.py, but boot_option will not be changed.",
    "zh": "此固件不支持安全更改 UIFlow 启动模式。仍可写入和运行 main.py，但不会更改 boot_option。"
  },
  "再接続できる許可済みポートがありません。USB接続を押してください。": {
    "en": "No authorized port is available for reconnection. Click “Connect USB”.",
    "zh": "没有可重新连接的已授权端口。请点击“连接 USB”。"
  },
  "ポートを開けませんでした。": {
    "en": "Could not open the port.",
    "zh": "无法打开端口。"
  },
  "プログラムの停止を確認できませんでした。書込みを中止します。": {
    "en": "The program could not be confirmed stopped. Writing has been cancelled.",
    "zh": "无法确认程序已停止，已取消写入。"
  },
  "DEVICE_COMPILE_ERROR: /flash/main.py の構文確認に失敗しました。": {
    "en": "DEVICE_COMPILE_ERROR: Syntax validation of /flash/main.py failed.",
    "zh": "DEVICE_COMPILE_ERROR: /flash/main.py 语法检查失败。"
  },
  "main.py のBase64データを安全に解析できませんでした。": {
    "en": "Could not safely decode the Base64 data for main.py.",
    "zh": "无法安全解析 main.py 的 Base64 数据。"
  },
  "main.py が上限 {maxBytes} bytes を超えています。": {
    "en": "main.py exceeds the limit of {maxBytes} bytes.",
    "zh": "main.py 超过了 {maxBytes} 字节的限制。"
  },
  "書込みサイズが一致しません: PC={pc}, device={device}": {
    "en": "Write size mismatch: PC={pc}, device={device}",
    "zh": "写入大小不匹配：PC={pc}，device={device}"
  },
  "保存後のmain.pyサイズが一致しません: PC={pc}, device={device}": {
    "en": "Saved main.py size mismatch: PC={pc}, device={device}",
    "zh": "保存后的 main.py 大小不匹配：PC={pc}，device={device}"
  },
  "main.py.tmp の構文確認に失敗しました。\n{details}": {
    "en": "Syntax validation of main.py.tmp failed.\n{details}",
    "zh": "main.py.tmp 语法检查失败。\n{details}"
  },
  "不正な状態遷移: {from} → {to}": {
    "en": "Invalid state transition: {from} → {to}",
    "zh": "无效的状态转换：{from} → {to}"
  },
  "Raw-paste の応答が不正です: {bytes}": {
    "en": "Invalid Raw-paste response: {bytes}",
    "zh": "Raw-paste 响应无效：{bytes}"
  },
  "Raw-paste のウィンドウサイズが不正です。": {
    "en": "Invalid Raw-paste window size.",
    "zh": "Raw-paste 窗口大小无效。"
  },
  "Raw-paste のフロー制御バイトが不正です。": {
    "en": "Invalid Raw-paste flow-control byte.",
    "zh": "Raw-paste 流控制字节无效。"
  },
  "Raw-paste 完了待機がタイムアウトしました。": {
    "en": "Timed out waiting for Raw-paste completion.",
    "zh": "等待 Raw-paste 完成超时。"
  },
  "常駐プログラム実行中です。停止してからリセットしてください。": {
    "en": "A program is running. Stop it before resetting.",
    "zh": "程序正在运行。请先停止，再重启。"
  },
  "常駐プログラム実行中です。停止してから有限コマンドを実行してください。": {
    "en": "A program is running. Stop it before running a one-shot command.",
    "zh": "程序正在运行。请先停止，再执行单次命令。"
  },
  "前の常駐プログラムを停止してから起動してください。": {
    "en": "Stop the previous running program before starting another.",
    "zh": "请先停止上一个程序，再启动新程序。"
  },
  "Raw REPL が常駐プログラムを受け付けませんでした。": {
    "en": "Raw REPL did not accept the long-running program.",
    "zh": "Raw REPL 未接受持续运行的程序。"
  },
  "Raw REPL が OK を返しませんでした。": {
    "en": "Raw REPL did not return OK.",
    "zh": "Raw REPL 未返回 OK。"
  },
  "操作は中止されました。": {
    "en": "The operation was cancelled.",
    "zh": "操作已取消。"
  },
  "{operation}: 受信待機が{timeoutMs}msでタイムアウトしました。": {
    "en": "{operation}: timed out after {timeoutMs} ms waiting for data.",
    "zh": "{operation}：等待接收数据 {timeoutMs} 毫秒后超时。"
  },
  "RAW_REPL_SYNC_ERROR": {
    "en": "Raw REPL synchronization",
    "zh": "Raw REPL 同步"
  },
  "SERIAL_DISCONNECTED": {
    "en": "USB disconnected",
    "zh": "USB 已断开"
  },
  "HOST_SERIAL_ERROR": {
    "en": "Host serial error",
    "zh": "主机串口错误"
  },
  "DEVICE_RUNTIME_ERROR": {
    "en": "Device runtime error",
    "zh": "设备运行时错误"
  }
}
