import type { MessageCatalog } from './types'

export const basicOperationMessages: MessageCatalog = {
  'どう操作する？': { en: 'How would you like to control it?', zh: '想用什么方式操作？' },
  '機器のボタンで光り方を変える': { en: 'Change the lights with the device button', zh: '用设备上的按钮改变灯效' },
  'Webリモコン': { en: 'Web remote', zh: '网页遥控器' },
  'スマホやパソコンから無線で操作する': { en: 'Control wirelessly from your phone or computer', zh: '用手机或电脑无线控制' },
  '選んだ操作方法は準備文へすぐ反映し、機種別にこのブラウザへ自動保存します。Webリモコンを使うとBluetoothも有効になります。': { en: 'Your choices update the AI prompt immediately and are saved in this browser for each device. The web remote also enables Bluetooth.', zh: '所选操作方式会立即应用到 AI 准备文，并按设备保存到此浏览器。使用网页遥控器时也会启用蓝牙。' },
  'どちらもOFF：ボタンやリモコンを使わず、プログラムで光り方を動かします。': { en: 'Both are off: the program runs the lights without a button or remote.', zh: '两项均关闭：由程序控制灯效，不使用按钮或遥控器。' },
  '独自のBluetooth通信が詳細設定で有効です。Webリモコンとは別の設定です。': { en: 'Custom Bluetooth communication is enabled in advanced settings. It is separate from the web remote.', zh: '详细设置中已启用自定义蓝牙通信。这与网页遥控器是不同的设置。' },
  'Webリモコンを試す場合は、上の「どう操作する？」でWebリモコンをONにしてください。独自のBluetooth通信を使う場合だけ、開発者向け設定で基準コードを登録します。': { en: 'To try the web remote, turn it on under “How would you like to control it?” above. Register a baseline in developer settings only when using custom Bluetooth communication.', zh: '要试用网页遥控器，请在上方“想用什么方式操作？”中将其开启。只有使用自定义蓝牙通信时，才需要在开发者设置中登记基准代码。' },
  '操作方法をこのブラウザに自動保存しました。基準コードや未適用の詳細設定は保存していません。': { en: 'Control methods saved automatically in this browser. Baseline code and unapplied advanced settings were not saved.', zh: '操作方式已自动保存到此浏览器。未保存基准代码或尚未应用的详细设置。' },
  '操作方法を保存できませんでした。画面の設定を確認してください。': { en: 'Control methods could not be saved. Check the settings on this screen.', zh: '无法保存操作方式。请检查画面上的设置。' },
  '操作方法を保存できませんでした。この画面では使えますが、再読み込みすると失われます。': { en: 'Control methods could not be saved. They work on this screen but will be lost when you reload.', zh: '无法保存操作方式。当前画面仍可使用，但重新加载后会丢失。' },
  '保存した操作方法を読み込めませんでした。画面の設定を確認してください。': { en: 'Saved control methods could not be restored. Check the settings on this screen.', zh: '无法恢复保存的操作方式。请检查画面上的设置。' },
}
