import { cloneWorkshopProfile, getBlePreparationReasons, validProfileText, validateWorkshopProfile } from '../workshop/WorkshopProfile'
import type { WorkshopProfile } from '../workshop/WorkshopProfile'

export interface WorkshopContext {
  profile: WorkshopProfile
  errors: string[]
  bleReasons: string[]
  bleEnabled: boolean
  controllerEnabled: boolean
  rules: string
}

const setting = (value: string | number | null) => typeof value === 'string'
  ? (validProfileText(value) ? value : '未設定または不正')
  : (value !== null && Number.isFinite(value) ? String(value) : '未設定または不正')

function codeBlock(code: string) {
  let length = 3
  for (const run of code.matchAll(/~+/g)) length = Math.max(length, run[0].length + 1)
  const fence = '~'.repeat(length)
  return `${fence}python\n${code}\n${fence}`
}

const ledRules = `## LEDとボタンの固定ルール
- 外付けLEDはGrove G2のGPIO2。GPIO2をmachine.Pin(LED_PIN, machine.Pin.OUT)で初期化する。Grove G1は使用しない。5VとGNDを接続し共通GNDを維持する。
- 本体ボタンを使う場合はGPIO9のアクティブLOW（押すとLOW、離すとHIGH）。必要に応じてmachine.Pin.PULL_UPを使い、メインループで読み、約40msのチャタリング対策をする。M5.BtnA・NanoC6.BtnAで代用しない。使用機能が「本体ボタンなし」のキットにはボタン操作を追加しない。
- 内蔵LEDのGPIO20・GPIO19・GPIO7と外付けLEDを混同しない。講師からの指示がない内蔵LED操作を追加しない。
- import machine と import timeを基本とし、neopixelをimportしない。LED送信はmachine.bitstream()とbytearrayを使用する。
- BITSTREAM_TIMING = 1 は800kHzを表す固定ラベル。encoding=0、WS2812_TIMING_NS = (400, 850, 800, 450)（T0H,T0L,T1H,T1L、ナノ秒）を変更しない。
- bytearray(LED_COUNT * LED_BPP)に全LEDの1フレーム分を作り、machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)でまとめて送る。第3引数に数値の1を直接渡さない。LED1個ずつ送信しない。
- 色指定はRGB、送信バッファはGRB。offset = led_index * LED_BPP、順にgreen、red、blueを入れる。送信後はtime.sleep_us(80)程度のリセット待ちを入れる。
- 全ての消灯・単色・演出の出力を共通処理へ通す。RGBを0〜255へ制限し、講師設定の最大輝度、利用者の明るさ、フェード係数を適用してからGRB順へ格納する。最大輝度を超える要求でも安全上限を変更しない。
- 起動時は共通の送信処理で全LEDへ0を送って安全な消灯状態へ初期化する。起動演出が指定されていても、その後の最初の点灯にはOFFから点灯する最低200msの条件を適用する。
- machine.bitstreamなど必要なAPIが対象環境で確認できない場合は講師確認が必要と伝え、代替APIやライブラリを推測しない。外部ライブラリの追加インストールを参加者へ要求しない。
- 講師が明示しないuasyncio、スレッド、GPIO割り込みを追加しない。停止時・KeyboardInterrupt時は可能な限りLEDを消灯し、Ctrl-C停止を妨げない。

## OFFから点灯するときの固定ルール
- MIN_OFF_TO_ON_FADE_MS = 200 を冒頭に置く。対象は現在モードがOFF、かつ最後に送信した全LED出力が0の状態から点灯モードへ移る場合だけ。起動直後の最初の点灯も含む。
- フェード時間は参加者指定時間と200msの長い方。指定なしや「パッと点灯」でも200ms。time.ticks_ms()とtime.ticks_diff()を使い、出力係数を0.0から1.0へ非ブロッキングで進める。目標輝度のフレームを先に送信しない。
- 点灯中の色変更・明るさ変更・アニメーション中の一時的な黒いフレームではフェードを再開始しない。暗くする変化や消灯にも200msを強制しない。
- フェード中に別の点灯モードへ変更するときは進行度を維持し、目標色だけを更新する。OFFへ変更した場合はフェードインを中止する。
- 長いsleep、time.sleep_ms(200)、演出完了まで抜けられないループは禁止。通常のメインループの待ち時間は10〜20ms以下とし、フェード・演出中も利用可能なボタンとBLEを受け付ける。
- 時刻・現在モード・アニメーション位置・前回更新時刻で1種類の演出を進める。モード変更時に前の演出状態を適切にリセットするが、進行中の点灯フェードは上記の条件を維持する。
- 指定が省略された場合は起動時OFF、本体ボタンを使う場合は短く1回押す、演出1周期は約3秒、次の操作まで繰り返す。採用した標準設定は参加者へ短く説明する。`

const bleRules = `## BLE基準コードの維持
- 下記全文は講師が登録した実機確認情報に対応する基準コードであり、アプリやAIが実機動作を検証したという意味ではない。
- BLE初期化方法、サービスとCharacteristicのUUID、受信コールバックの引数形式、デバイス名の形式、使用ライブラリを維持する。存在未確認のAPIを推測したり、別のBLE実装へ置き換えたりしない。
- 受信コールバックでは受信バイトを有界キューへ保存するだけにする。実際のモード変更とLED更新はメインループで行う。複数コマンドを1つの変数への上書きで失わせない。
- 分割受信の処理と受信バッファ・コマンドキューを有界に保ち、満杯なら追加分を破棄して短い診断を出す。無制限に待機・再試行しない。切断時の受信途中データを次の接続へ持ち越さない。
- 完全なコマンドをUTF-8として検証し、前後の空白・改行・CRを除去し、大文字化して判定する。不正・未知のコマンドや復号エラーでは現在状態を変更せず、可能ならUSB側へ短い診断を出す。処理を停止しない。
- 本体ボタンとBLEを両方使う場合は共通のモード変更処理を使い、同じ演出を重複実装しない。`

const nanoLedRules = `## NanoLED v1通信仕様
- 機器はPeripheral、ブラウザはCentral。完全なデバイス名を対象ファームウェアの確認済みAPIで広告またはscan responseに含める。サービスUUIDの広告は任意。完全名と128-bit UUIDを同じ広告パケットへ無理に詰めず、未知の広告APIを推測しない。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e。ブラウザから機器へ応答ありWriteが必須。Write Without Responseだけでは対応しない。
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e。機器からブラウザへNotifyが必須。Readは任意で代用にはならない。UUID一致だけで互換や動作成功と扱わない。
- ブラウザはTX通知を有効にしてからSTATUSを送る。初回の正しい状態受信まで点灯モードとスライダーは無効、OFFだけは接続後に送信できる。Write応答だけでLED反映成功・消灯成功と判断しない。
- RXコマンドはUTF-8のASCII、1コマンドをLF（\\n）で終端しLF込み20バイト以下。ブラウザは1行ずつ応答ありWriteで順番に送り、同時書込みしない。
- 機器は分割受信を結合してLFまで届いた行だけを順番に処理する。複数行を処理し、受信行バッファ上限は128バイト。超過行を次のLFまで破棄する。コマンドキューも有界にし、満杯の追加分を捨てて診断する。
- PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS を全て維持する。PINKは全体ピンク、BLUEは全体青、MAGICはピンク・紫・青を左から右へ流す、RAINBOWは全体のレインボー変化。
- OFFは直ちに全LEDを消灯し、フェードインを取り消すがプログラムとBLEを継続する。STATUSは状態通知だけで動作を変更しない。
- nは0〜100の整数。引数不足・小数・範囲外・未知コマンドでは状態を変更しない。BRIGHTNESS 100は講師設定の最大輝度の100%であり安全上限自体を変えない。BRIGHTNESS 0は現在モードを保持する。OFF中の明るさ・速さ変更では点灯しない。
- SPEED 0は停止ではなく最も遅い、100は最も速い。標準MAGIC/RAINBOWの周期はperiod_ms = 3000 - 29 * n。LED数で1周期が変わらない。追加演出でも0は停止にせず同じ向きで速さを反映する。
- 指定省略時の起動状態はmode=OFF、brightness=100、speed=0。利用者の明示した起動演出は安全上限とOFF→ONフェードを守って適用できる。通知は実際の適用状態を返す。
- 追加モード名は^[A-Z][A-Z0-9_]{0,15}$、最大16文字。STATUS、BRIGHTNESS、SPEEDは予約語でモード名にしない。追加演出は機器側への実装が必要。
- TXはASCIIだけのJSONを1行、LFで終端する。v（数値1）、mode（適用中モード）、brightness（適用した0〜100整数）、speed（適用した0〜100整数）、pixels（全LEDのRGB値）を全て必須とする。ログはTXへ混ぜずUSB側へ出す。
- pixelsはLED1から順に各LEDのRRGGBB・6桁HEXを連結する。大小文字は任意。全消灯は全桁0。RGBのLED1〜300個、LED数はpixels.length / 6。固定LED数を省略・間引き・変更しない。1行はLFを除いて4096バイト以下。
- pixelsは最大輝度・明るさ設定・フェード適用後に最後に実際に送信した値をRGB順で報告する。LED用GRBバッファからRGB順へ戻す。目標色ではなく送信済み出力のスナップショットであり、物理的な発光をセンサーで測定した結果ではない。
- 既定MTU23でも動くようNotifyは1回20バイト以下へ分割し、LFは最後のチャンクに含める。開始時に固定した1行を最後まで送り、別スナップショットのチャンクを混ぜない。メインループから少量ずつ送り、LED・ボタン・コマンド処理を止めない。送信待ち・再試行も有界にする。
- STATUS・コマンド適用・利用可能な本体ボタンの変更で最新状態を通知する。変化がなくても約1秒ごと、最大5スナップショット/秒。通信が遅ければ周期を延ばす。送信中の行を維持し、待機分は最新1件だけとする。行の途中で別JSONへ切り替えない。
- 切断で送受信途中の行を破棄する。再接続・通知再購読後は完全な新しい行から送る。ブラウザはGATTオブジェクトを破棄しサービス・Characteristicを取り直す。
- ブラウザはNotify境界でなくLFで区切る。不正JSON・過大行で現在状態を上書きしない。未受信や更新停止を明示し、送った設定だけでLED表示を変更しない。`

export function createWorkshopContext(input: WorkshopProfile): WorkshopContext {
  const profile = cloneWorkshopProfile(input)
  const errors = validateWorkshopProfile(profile)
  const bleReasons = getBlePreparationReasons(profile)
  const bleEnabled = errors.length === 0 && profile.features.ble && bleReasons.length === 0
  const controllerEnabled = bleEnabled && profile.features.controller
  const header = `## ワークショップの設定スナップショット
教材ID: ${setting(profile.materialId)}
教材の版: ${setting(profile.revision)}
教材名: ${setting(profile.displayName)}
キットID: ${setting(profile.kitId)}
機器: M5Stack M5NanoC6
対象UIFlow2ファームウェア: ${setting(profile.firmwareVersion)}
外付けLEDの型番: ${setting(profile.ledModel)}
LED_COUNT: ${setting(profile.ledCount)}
LED_BPP: ${setting(profile.ledBpp)}（対応仕様はRGB・3チャンネルのみ）
MAX_BRIGHTNESS_PERCENT: ${setting(profile.maxBrightnessPercent)}
使用機能: 外付けLED / 本体ボタン${profile.features.button ? 'あり' : 'なし'} / BLE${bleEnabled ? '利用可' : '利用不可'} / Webコントローラ${controllerEnabled ? '利用可' : '利用不可'}
本体ボタンの扱い: ${profile.features.button ? '使う場合のGPIO9・アクティブLOW・約40msの条件を維持する。' : 'このキットでは使用しない。GPIO9の初期化・読み取り・チャタリング対策・ボタン操作を追加しない。ボタンを使う相談や選択肢も出さない。'}
実行先: UIFlow2ファームウェア上のMicroPython。MicroPythonWriterからRaw REPLを使ってmain.pyを書き込み・実行する。UIFlow2エディタの利用は必須ではない。
対象UIFlow2版は講師設定であり、USBのMicroPython版・firmwareInfoとは別物。取得情報から推測・上書きしない。
講師設定の数値が範囲内であることは電源安全性や実機動作の証明ではない。AI向け固定仕様はコードを強制するサンドボックスではなく、講師の実機確認を代替しない。`
  const availability = bleEnabled
    ? `BLEデバイス名: NanoLED-${profile.kitId}\n${bleRules}${profile.baseline.verification?.nanoLedV1 ? `\n\n${nanoLedRules}` : '\nこのキットはWebコントローラ未対応。NanoLED v1への変更を推測せず、確認済み基準コードの通信仕様を維持する。'}\n\n## 登録された基準コード全文\n講師の登録情報: ${profile.baseline.verification?.confirmedBy} / ${profile.baseline.verification?.confirmedAt}\n確認対象UIFlow2: ${profile.baseline.verification?.firmwareVersion}\nNanoLED v1確認: ${profile.baseline.verification?.nanoLedV1 ? '講師が確認と登録' : '未確認'}\n${codeBlock(profile.baseline.code)}`
    : `## BLEの利用制限\n${bleReasons.length ? bleReasons.map(reason => `- ${reason}`).join('\n') : '- このキットではBLEを使用しない。'}\nBLE処理・UUID・未登録の基準コードを推測して新規生成しない。参加者にAPIや通信仕様を質問せず、必要なら「講師の準備が必要です」と伝える。利用可能なLED${profile.features.button ? 'とボタン' : ''}の相談は続けられる。`
  const invalid = errors.length ? `\n\n## 設定が未完成または不正です\n${errors.map(error => `- ${error}`).join('\n')}\n設定値を推測せず、講師が上記を直すまで、このキットの完成コード生成・設定に依存する修正は保留する。汎用設定へ黙って切り替えない。` : ''
  const rules = `${header}${invalid}\n\n${ledRules}\n\n${availability}\n\n## 情報の扱い\n固定仕様、講師が実機確認した基準コード、M5Stack・MicroPython公式資料、一般知識の順に扱う。ただし仕様と基準コードに実質的な矛盾があれば勝手に補正せず該当機能を止め、講師確認が必要と伝える。外部ページを読めない場合に読んだふりをしない。必要情報はこの文面に含まれ、外部ページ取得や初期設定・URLの貼り直しを前提にしない。Arduino、C++、CircuitPython、PC用Pythonへ切り替えない。`
  return { profile, errors, bleReasons, bleEnabled, controllerEnabled, rules }
}
