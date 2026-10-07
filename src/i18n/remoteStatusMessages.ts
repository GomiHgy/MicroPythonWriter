import type { MessageCatalog } from './types'

export const remoteStatusMessages: MessageCatalog = {
  '接続状況': { en: 'Connection status', zh: '连接状态' },
  '未確認': { en: 'Not yet confirmed', zh: '尚未确认' },
  '接続できました。機器から光り方と状態が届くまで待っています。': { en: 'Connected. Waiting for the device to report its light modes and status.', zh: '已连接。正在等待设备报告灯光模式和状态。' },
  '機器の状態を受信しています。下のボタンで光り方を変えられます。': { en: 'Receiving device status. Use the buttons below to change the lights.', zh: '正在接收设备状态。可以使用下方的按钮改变灯光。' },
  'ライトを消す動きは作品のプログラムに従います。送信後は実際の光も確認してください。': { en: 'Lights turn off according to your artwork’s program. Check the actual lights after sending.', zh: '熄灯方式由作品程序决定。发送后也请确认实际灯光。' },
  '最後に受信した再生状態': { en: 'Last reported playback state', zh: '最后接收的播放状态' },
  'このプログラムでは再生・停止を使えません。使いたいときは、下の準備手順で対応プログラムを用意してください。': { en: 'This program does not support Play or Stop. Follow the setup steps below to prepare a compatible program if you want these controls.', zh: '此程序不支持播放、停止。如需这些功能，请按照下方的准备步骤准备兼容程序。' },
  '再生・停止は、機器の状態が届いてから使えます。': { en: 'Play and Stop become available after the device reports its status.', zh: '收到设备状态后，即可使用播放、停止。' },
  '「AIの準備」で機器・LEDの設定と「どう操作する？」を確認し、WebリモコンをONにします。': { en: 'In “AI setup”, check your device, LED settings, and “How would you like to control it?”, then enable the web remote.', zh: '在“AI 准备”中确认设备、LED 设置和“想用什么方式操作？”，然后启用网页遥控器。' },
  '「対応プログラムを準備」で同梱プログラムを試すか、準備文をAIへ渡して自分の光り方を作ります。': { en: 'Use “Prepare a compatible program” to try the bundled program, or send the preparation text to an AI to create your own light effects.', zh: '使用“准备兼容程序”试用随附程序，或将准备文本发送给 AI，制作自己的灯光效果。' },
  '「プログラム」で対応コードを「実行」し、ここに戻ってBluetoothでつなぎます。': { en: 'Run the compatible code on the Program screen, then return here and connect with Bluetooth.', zh: '在“程序”页面运行兼容代码，然后返回此处通过蓝牙连接。' },
  '同梱プログラムは試用用です。実機確認済みの保証はないため、配線と実際の光を確認してください。': { en: 'The bundled program is for trial use, not guaranteed hardware-tested. Check your wiring and the actual lights.', zh: '随附程序用于试用，不保证已经过实机验证。请确认接线和实际灯光。' },
  '接続しただけでは、機器のプログラムは変わりません。': { en: 'Connecting alone does not change the program on your device.', zh: '仅连接设备不会改变设备上的程序。' },
  '操作のしくみ・通信仕様': { en: 'How controls work and protocol details', zh: '操作方式与通信规范' },
  '通信仕様': { en: 'Protocol', zh: '通信规范' },
  '受信した操作一覧に合わせて、使えるボタンを表示しています。': { en: 'Available buttons are based on the control list received from your device.', zh: '根据从设备接收的操作列表，显示可用按钮。' },
  '最後に届いたLED': { en: 'Last reported LEDs', zh: '最后接收的 LED 状态' },
  '機器から届いたLED': { en: 'LEDs reported by device', zh: '设备报告的 LED 状态' },
  '最後に受信した表示です。いまの光と同じとは限りません。': { en: 'This is the last received display. It may not match the lights now.', zh: '这里显示的是最后收到的状态，不一定与当前灯光相同。' },
  '最後に届いた状態。{state}': { en: 'Last reported state. {state}', zh: '最后报告的状态。{state}' },
}
