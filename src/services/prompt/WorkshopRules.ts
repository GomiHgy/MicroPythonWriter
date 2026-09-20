import { cloneWorkshopProfile, getBlePreparationReasons, validProfileText, validateWorkshopProfile } from '../workshop/WorkshopProfile'
import type { WorkshopProfile } from '../workshop/WorkshopProfile'
import { boardDefinitions, isBoardId } from '../../config/boards'
import type { Locale } from '../../i18n/types'
import { interpolatePrompt, localizedPromptBlocks, nanoLedV2Rules, remoteOffFadeRules } from '../../i18n/promptMessages'
import { translateWorkshop } from '../../i18n/workshopMessages'
import { buildControllerStarter } from '../workshop/ControllerStarter'

export interface WorkshopContext {
  locale: Locale
  profile: WorkshopProfile
  errors: string[]
  bleReasons: string[]
  bleEnabled: boolean
  controllerEnabled: boolean
  bleSource?: 'registered' | 'bundled-candidate' | 'none'
  controllerStarter?: ReturnType<typeof buildControllerStarter>
  controllerStarterError?: string
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

function bundledControllerRules(profile: WorkshopProfile, locale: Locale, source: string) {
  const code = codeBlock(source)
  if (locale === 'en') return `## Bundled web-controller starter: unverified trial
- This prompt uses the bundled NanoLED v2 candidate, not a hardware-verified registered baseline. The selected device, UIFlow2 ${setting(profile.firmwareVersion)} and LED configuration have NOT been verified on hardware. Availability of this trial does not guarantee firmware APIs, compatibility, electrical safety or physical lighting.
- Any existing baseline and verification record remain saved unchanged. If that registration is missing, stale or incompatible, it is excluded from this prompt; this separately supplied candidate is NOT a verified replacement or an automatic v1 upgrade.
- Use the complete candidate below as the starting implementation. Preserve its BLE initialization, bounded queues, device name, protocol and safety limits. Do not guess alternative APIs. If an API fails on the selected firmware, explain that target-device investigation is needed; never claim verification or fabricate a registration.
- When repairing an error, the separately captured main.py is the repair target; this candidate is reference code, not evidence of what ran. Do not replace the user's effects with this starter without being asked.
- No baseline registration is required to try this candidate. First prepare the supported program, then explicitly run it on the USB-connected device, then open Controller and connect to its NanoLED- device. On the first valid status report, check the reported LEDs, brightness and playback, and compare them with the actual LEDs. Writing or receiving a report is not proof of physical lighting. Do not automatically write, run or change startup settings.

${nanoLedV2Rules.en}

## Complete bundled candidate (not hardware verified)
${code}`
  if (locale === 'zh') return `## 内置网页控制器入门程序：未实机验证的试用代码
- 本提示词使用内置 NanoLED v2 候选代码，不是已登记的实机验证基准代码。所选设备、UIFlow2 ${setting(profile.firmwareVersion)} 和 LED 配置尚未完成实机验证。可以试用不代表固件 API、兼容性、供电安全或实际发光已获保证。
- 已有基准代码和验证记录保持原样保存。如果登记缺失、过期或不兼容，则不将其带入本提示词；这里单独提供的候选代码不是已验证的替代品，也不是自动将 v1 升级。
- 以下完整候选代码是实现的起点。保持 BLE 初始化、有界队列、设备名称、协议及安全上限，不猜测替代 API。若所选固件出现 API 错误，应说明需要在目标设备上排查，不能宣称已验证或虚构验证登记。
- 修复错误时，以另外记录的 main.py 为修复对象；此候选代码仅作参考，不代表设备实际运行了它。未经要求，不用入门效果替换用户作品。
- 试用此候选代码不需要登记基准代码。先准备兼容程序，再由用户明确通过 USB 在设备上运行，然后打开“控制器”连接对应的 NanoLED- 设备。首次收到有效状态后，查看上报的 LED、亮度与播放状态，并与实物 LED 比较。写入完成或收到状态不代表已确认实物发光。不要自动写入、运行或更改自动启动设置。

${nanoLedV2Rules.zh}

## 内置候选代码全文（未实机验证）
${code}`
  return `## 同梱Webコントローラ入門プログラム：実機未確認の試用コード
- この準備文では、実機確認を登録した基準コードではなく、同梱のNanoLED v2候補コードを使う。選択した機器・UIFlow2 ${setting(profile.firmwareVersion)}・LED構成での実機確認は未実施。試用可能であることはファームウェアAPI・互換性・電源安全性・実際の発光の保証ではない。
- 既存の基準コードと確認情報は変更せず保存される。未登録・確認失効・非対応の登録コードはこの準備文へ含めない。別途示す候補は確認済みの代替コードでも、v1の自動更新でもない。
- 下記の候補全文を実装の土台にし、BLE初期化・有界キュー・デバイス名・通信仕様・安全上限を維持する。代替APIを推測しない。対象ファームウェアでAPIエラーが出た場合は対象機器での調査が必要と伝え、確認済みと偽ったり確認登録を捏造したりしない。
- エラー修正では別途記録されたmain.pyが修正対象。この候補は参考コードであり、実行されたコードの証拠ではない。依頼なく利用者の演出を入門用へ置き換えない。
- 試用のために基準コードの登録は求めない。「対応プログラムを準備」→ USB接続した機器で利用者が「実行」→「コントローラ」でNanoLED-の機器に接続、の順で案内する。最初の正しい状態が届いたらLEDの報告・明るさ・再生状態を見て、実際のLEDとも比較する。書き込み完了や状態受信は実物の発光確認とは別。自動書き込み・自動実行・自動起動設定は行わない。

${nanoLedV2Rules.ja}

## 同梱の候補コード全文（実機未確認）
${code}`
}

function controllerUnavailableRules(locale: Locale) {
  if (locale === 'en') return '## Web-controller preparation is unavailable\nCheck the device and LED settings and enable Bluetooth, then prepare the supported program. Do not guess BLE APIs, invent a working program or require a beginner to register a hardware-verified baseline. Continue discussing available LEDs and only enabled button operations. Do not offer Web-remote operations until preparation is available.'
  if (locale === 'zh') return '## 暂时无法准备网页控制器程序\n请检查设备与 LED 设置并启用 Bluetooth，然后准备兼容程序。不要猜测 BLE API、虚构可用程序或要求初学者登记实机验证基准代码。可以继续讨论 LED 和已启用的按钮功能；准备可用前不提供网页遥控操作选项。'
  return '## Webコントローラの準備はまだできません\n機器とLEDの設定を確認し、Bluetoothを有効にしてから、対応プログラムを準備する。BLEのAPIや動作するコードを推測せず、初心者に実機確認済み基準コードの登録を求めない。利用可能なLEDと有効なボタンの相談は続けられる。準備できるまでWebリモコン操作は選択肢に入れない。'
}

const ledRules = `## LEDとボタンの固定ルール
- 外付けLEDは設定のGPIO{ledPin}。machine.Pin(LED_PIN, machine.Pin.OUT)で初期化する。デフォルトGPIO2はGrove G2。変更時は実際の配線と対象機器で出力可能なGPIOかを確認し、USB・内蔵LED・ボタン等と競合させない。電源仕様を確認し共通GNDを維持する。
- 本体ボタンを使う場合はGPIO9のアクティブLOW（押すとLOW、離すとHIGH）。必要に応じてmachine.Pin.PULL_UPを使い、メインループで読み、約40msのチャタリング対策をする。M5.BtnA・NanoC6.BtnAで代用しない。使用機能が「本体ボタンなし」のキットにはボタン操作を追加しない。
- 内蔵LEDのGPIO20・GPIO19・GPIO7と外付けLEDを混同しない。利用者からの明示的な指示がない内蔵LED操作を追加しない。
- import machine と import timeを基本とし、neopixelをimportしない。LED送信はmachine.bitstream()とbytearrayを使用する。
- BITSTREAM_TIMING = 1 は800kHzを表す固定ラベル。encoding=0、WS2812_TIMING_NS = (400, 850, 800, 450)（T0H,T0L,T1H,T1L、ナノ秒）を変更しない。
- bytearray(LED_COUNT * LED_BPP)に全LEDの1フレーム分を作り、machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer)でまとめて送る。第3引数に数値の1を直接渡さない。LED1個ずつ送信しない。
- 色指定はRGB、送信バッファはGRB。offset = led_index * LED_BPP、順にgreen、red、blueを入れる。送信後はtime.sleep_us(80)程度のリセット待ちを入れる。
- 全ての消灯・単色・演出の出力を共通処理へ通す。RGBを0〜255へ制限し、準備画面で設定した最大輝度、利用者の明るさ、フェード係数を適用してからGRB順へ格納する。最大輝度を超える要求でも安全上限を変更しない。
- 起動時は共通の送信処理で全LEDへ0を送って安全な消灯状態へ初期化する。起動演出が指定されていても、その後の最初の点灯にはOFFから点灯する最低200msの条件を適用する。
- machine.bitstreamなど必要なAPIが対象環境で確認できない場合は実機と対象環境での確認が必要と伝え、代替APIやライブラリを推測しない。外部ライブラリの追加インストールを利用者へ要求しない。
- 利用者が明示しないuasyncio、スレッド、GPIO割り込みを追加しない。停止時・KeyboardInterrupt時は可能な限りLEDを消灯し、Ctrl-C停止を妨げない。

## OFFから点灯するときの固定ルール
- MIN_OFF_TO_ON_FADE_MS = 200 を冒頭に置く。対象は現在モードがOFF、かつ最後に送信した全LED出力が0の状態から点灯モードへ移る場合だけ。起動直後の最初の点灯も含む。
- フェード時間は利用者指定時間と200msの長い方。指定なしや「パッと点灯」でも200ms。time.ticks_ms()とtime.ticks_diff()を使い、出力係数を0.0から1.0へ非ブロッキングで進める。目標輝度のフレームを先に送信しない。
- 点灯中の色変更・明るさ変更・アニメーション中の一時的な黒いフレームではフェードを再開始しない。このフェードイン規則は暗くする変化や消灯には200msを強制しない。WebリモコンのOFFは別途定めた200ms消灯フェードに従う。
- フェード中に別の点灯モードへ変更するときは進行度を維持し、目標色だけを更新する。OFFへ変更した場合はフェードインを中止する。
- 長いsleep、time.sleep_ms(200)、演出完了まで抜けられないループは禁止。通常のメインループの待ち時間は10〜20ms以下とし、フェード・演出中も利用可能なボタンとBLEを受け付ける。
- 時刻・現在モード・アニメーション位置・前回更新時刻で1種類の演出を進める。モード変更時に前の演出状態を適切にリセットするが、進行中の点灯フェードは上記の条件を維持する。
- 指定が省略された場合は起動時OFF、本体ボタンを使う場合は短く1回押す、演出1周期は約3秒、次の操作まで繰り返す。採用した標準設定は利用者へ短く説明する。`

const bleRules = `## BLE基準コードの維持
- 下記全文は利用者が登録した実機確認情報に対応する基準コードであり、アプリやAIが実機動作を検証したという意味ではない。
- BLE初期化方法、サービスとCharacteristicのUUID、受信コールバックの引数形式、デバイス名の形式、使用ライブラリを維持する。存在未確認のAPIを推測したり、別のBLE実装へ置き換えたりしない。
- 受信コールバックでは受信バイトを有界キューへ保存するだけにする。実際のモード変更とLED更新はメインループで行う。複数コマンドを1つの変数への上書きで失わせない。
- 分割受信の処理と受信バッファ・コマンドキューを有界に保ち、満杯なら追加分を破棄して短い診断を出す。無制限に待機・再試行しない。切断時の受信途中データを次の接続へ持ち越さない。
- 完全なコマンドをUTF-8として検証し、前後の空白・改行・CRを除去し、大文字化して判定する。不正・未知のコマンドや復号エラーでは現在状態を変更せず、可能ならUSB側へ短い診断を出す。処理を停止しない。
- 本体ボタンとBLEを両方使う場合は共通のモード変更処理を使い、同じ演出を重複実装しない。`

const nanoLedRules = `## NanoLED v1通信仕様
- これは旧版の確認済み仕様。PLAY/PAUSEやACTION、作品別カタログを提供しない。v2へ自動変更せず、再生・停止・一回限りのアクションをWebコントローラで使えると案内しない。必要な場合は実装者によるv2移行と別の実機確認が必要。
- 機器はPeripheral、ブラウザはCentral。完全なデバイス名を対象ファームウェアの確認済みAPIで広告またはscan responseに含める。サービスUUIDの広告は任意。完全名と128-bit UUIDを同じ広告パケットへ無理に詰めず、未知の広告APIを推測しない。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e。ブラウザから機器へ応答ありWriteが必須。Write Without Responseだけでは対応しない。
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e。機器からブラウザへNotifyが必須。Readは任意で代用にはならない。UUID一致だけで互換や動作成功と扱わない。
- ブラウザはTX通知を有効にしてからSTATUSを送る。初回の正しい状態受信まで点灯モードとスライダーは無効、OFFだけは接続後に送信できる。Write応答だけでLED反映成功・消灯成功と判断しない。
- RXコマンドはUTF-8のASCII、1コマンドをLF（\\n）で終端しLF込み20バイト以下。ブラウザは1行ずつ応答ありWriteで順番に送り、同時書込みしない。
- 機器は分割受信を結合してLFまで届いた行だけを順番に処理する。複数行を処理し、受信行バッファ上限は128バイト。超過行を次のLFまで破棄する。コマンドキューも有界にし、満杯の追加分を捨てて診断する。
- PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS を全て維持する。PINKは全体ピンク、BLUEは全体青、MAGICはピンク・紫・青を左から右へ流す、RAINBOWは全体のレインボー変化。
- OFFは下記の200ms消灯フェードに従い、フェードインを取り消すがプログラムとBLEを継続する。STATUSは状態通知だけで動作を変更しない。
- nは0〜100の整数。引数不足・小数・範囲外・未知コマンドでは状態を変更しない。BRIGHTNESS 100は準備画面で設定した最大輝度の100%であり安全上限自体を変えない。BRIGHTNESS 0は現在モードを保持する。OFF中の明るさ・速さ変更では点灯しない。
- SPEED 0は停止ではなく最も遅い、100は最も速い。標準MAGIC/RAINBOWの周期はperiod_ms = 3000 - 29 * n。LED数で1周期が変わらない。追加演出でも0は停止にせず同じ向きで速さを反映する。
- 指定省略時の起動状態はmode=OFF、brightness=100、speed=0。利用者の明示した起動演出は安全上限とOFF→ONフェードを守って適用できる。通知は実際の適用状態を返す。
- 追加モード名は^[A-Z][A-Z0-9_]{0,15}$、最大16文字。STATUS、BRIGHTNESS、SPEED、PLAY、PAUSE、MODE、ACTIONは予約語でモード名にしない。標準4モードと従来の明るさ・速度は互換。旧カスタム名PLAY/PAUSE/MODE/ACTIONは新画面から送信できないため実装者へ名称変更を確認する。基準コードを自動変更しない。追加演出は機器側への実装が必要。
- TXはASCIIだけのJSONを1行、LFで終端する。v（数値1）、mode（適用中モード）、brightness（適用した0〜100整数）、speed（適用した0〜100整数）、pixels（全LEDのRGB値）を全て必須とする。ログはTXへ混ぜずUSB側へ出す。
- pixelsはLED1から順に各LEDのRRGGBB・6桁HEXを連結する。大小文字は任意。全消灯は全桁0。RGBのLED1〜300個、LED数はpixels.length / 6。固定LED数を省略・間引き・変更しない。1行はLFを除いて4096バイト以下。
- pixelsは最大輝度・明るさ設定・フェード適用後に最後に実際に送信した値をRGB順で報告する。LED用GRBバッファからRGB順へ戻す。目標色ではなく送信済み出力のスナップショットであり、物理的な発光をセンサーで測定した結果ではない。
- 既定MTU23でも動くようNotifyは1回20バイト以下へ分割し、LFは最後のチャンクに含める。開始時に固定した1行を最後まで送り、別スナップショットのチャンクを混ぜない。メインループから少量ずつ送り、LED・ボタン・コマンド処理を止めない。送信待ち・再試行も有界にする。
- STATUS・コマンド適用・利用可能な本体ボタンの変更で最新状態を通知する。変化がなくても約1秒ごと、最大5スナップショット/秒。通信が遅ければ周期を延ばす。送信中の行を維持し、待機分は最新1件だけとする。行の途中で別JSONへ切り替えない。
- 切断で送受信途中の行を破棄する。再接続・通知再購読後は完全な新しい行から送る。ブラウザはGATTオブジェクトを破棄しサービス・Characteristicを取り直す。
- ブラウザはNotify境界でなくLFで区切る。不正JSON・過大行で現在状態を上書きしない。未受信や更新停止を明示し、送った設定だけでLED表示を変更しない。
${remoteOffFadeRules.ja}`

export function createWorkshopContext(input: WorkshopProfile, locale: Locale = 'ja'): WorkshopContext {
  const profile = cloneWorkshopProfile(input)
  const errors = validateWorkshopProfile(profile).map(text => translateWorkshop(locale, text))
  const bleReasons = getBlePreparationReasons(profile).map(text => translateWorkshop(locale, text))
  let bleSource: NonNullable<WorkshopContext['bleSource']> = errors.length === 0 && profile.features.ble && bleReasons.length === 0 ? 'registered' : 'none'
  let controllerStarter: WorkshopContext['controllerStarter']
  let controllerStarterError: string | undefined
  if (errors.length === 0 && profile.features.ble && profile.features.controller && bleSource === 'none') {
    try {
      controllerStarter = buildControllerStarter(profile)
      bleSource = 'bundled-candidate'
    } catch {
      controllerStarterError = locale === 'ja'
        ? '対応プログラムを準備できません。機器・UIFlow2版・RGB LED数（1〜300個）・外部LEDピン・最大輝度の設定を確認してください。'
        : locale === 'en'
          ? 'The controller starter cannot be prepared. Check the board, UIFlow2 version, RGB LED count (1–300), external LED pin and maximum brightness settings.'
          : '无法准备控制器入门程序。请检查设备、UIFlow2 版本、RGB LED 数量（1–300）、外接 LED 引脚及最大亮度设置。'
    }
  }
  const bleEnabled = bleSource !== 'none'
  const controllerEnabled = bleEnabled && profile.features.controller
  const context = { locale, profile, errors, bleReasons, bleEnabled, controllerEnabled, bleSource, controllerStarter, controllerStarterError }
  if (locale !== 'ja') return { ...context, rules: localizedRules(profile, locale, errors, bleReasons, bleEnabled, controllerEnabled, controllerStarter?.source) }
  const board = isBoardId(profile.boardId) ? boardDefinitions[profile.boardId] : null
  const buttonPin = board?.buttonPin ?? '未確認'
  const onboardRule = profile.boardId === 'atoms3lite'
    ? '内蔵RGB LEDはGPIO35。外付けLEDや本体ボタンGPIO41と混同しない。NanoC6のGPIO20・GPIO19・GPIO7を流用しない。AtomS3Liteに未確認のRGB電源制御ピンを追加しない。利用者からの明示的な指示がない内蔵LED操作を追加しない。'
    : '内蔵RGB LEDはGPIO20、RGB電源有効化はGPIO19をHIGH、青色LEDはGPIO7。外付けLEDや本体ボタンGPIO9と混同しない。AtomS3LiteのGPIO35・GPIO41を流用しない。利用者からの明示的な指示がない内蔵LED操作を追加しない。'
  const boardLedRules = ledRules.replaceAll('GPIO9', `GPIO${buttonPin}`).replaceAll('{ledPin}', setting(profile.ledPin)).replace('M5.BtnA・NanoC6.BtnA', 'M5.BtnA・未確認の機器API').replace('内蔵LEDのGPIO20・GPIO19・GPIO7と外付けLEDを混同しない。利用者からの明示的な指示がない内蔵LED操作を追加しない。', board ? onboardRule : '機器が未設定です。ピン番号や内蔵LED仕様を推測しない。')
  const header = `## 機器とLEDの設定スナップショット
教材ID: ${setting(profile.materialId)}
教材の版: ${setting(profile.revision)}
教材名: ${setting(profile.displayName)}
機器: ${board ? `M5Stack ${board.name}` : '未設定または不正'}
SoC: ${board?.soc ?? '未確認'}
対象UIFlow2ファームウェア: ${setting(profile.firmwareVersion)}
外付けLEDの型番: ${setting(profile.ledModel)}
LED_COUNT: ${setting(profile.ledCount)}
LED_PIN: ${setting(profile.ledPin)}
LED_BPP: ${setting(profile.ledBpp)}（対応仕様はRGB・3チャンネルのみ）
MAX_BRIGHTNESS_PERCENT: ${setting(profile.maxBrightnessPercent)}
使用機能: 外付けLED / 本体ボタン${profile.features.button ? 'あり' : 'なし'} / BLE${bleEnabled ? '利用可' : '利用不可'} / Webコントローラ${controllerEnabled ? '利用可' : '利用不可'}
本体ボタンの扱い: ${profile.features.button ? `使う場合のGPIO${buttonPin}・アクティブLOW・約40msの条件を維持する。` : `このキットでは使用しない。GPIO${buttonPin}の初期化・読み取り・チャタリング対策・ボタン操作を追加しない。ボタンを使う相談や選択肢も出さない。`}
実行先: UIFlow2ファームウェア上のMicroPython。MicroPythonWriterからRaw REPLを使ってmain.pyを書き込み・実行する。UIFlow2エディタの利用は必須ではない。
対象UIFlow2版は利用者の入力値であり、USBのMicroPython版・firmwareInfoとは別物。取得情報から推測・上書きしない。
入力した数値が範囲内であることは電源安全性や実機動作の証明ではない。AI向け固定仕様はコードを強制するサンドボックスではなく、実機確認を代替しない。`
  const availability = controllerStarter
    ? bundledControllerRules(profile, locale, controllerStarter.source)
    : bleEnabled
    ? `BLEデバイス名: 確認済み基準コードのNanoLED-で始まる名前を維持する。キットIDは不要。新しい名前を明示的に設定する場合の例はNanoLED-${board?.name ?? 'Device'}。同名の機器を一意に識別できるとは説明しない。基準コードが対応する名前でなければ確認を求め、黙って変更しない。\n${bleRules}${profile.baseline.verification?.nanoLedV2 ? `\n\n${nanoLedV2Rules.ja}` : profile.baseline.verification?.nanoLedV1 ? `\n\n${nanoLedRules}` : '\nこのキットはWebコントローラ未対応。NanoLEDへの変更を推測せず、確認済み基準コードの通信仕様を維持する。'}\n\n## 登録された基準コード全文\n実機確認の登録情報: ${profile.baseline.verification?.confirmedBy} / ${profile.baseline.verification?.confirmedAt}\n確認対象UIFlow2: ${profile.baseline.verification?.firmwareVersion}\nNanoLED v1確認: ${profile.baseline.verification?.nanoLedV1 ? '利用者が確認と登録' : '未確認'}\nNanoLED v2確認: ${profile.baseline.verification?.nanoLedV2 ? '利用者が確認と登録' : '未確認（v1からの自動移行は行わない）'}\n${codeBlock(profile.baseline.code)}`
    : profile.features.controller
      ? controllerUnavailableRules(locale)
      : `## BLEの利用制限\n${bleReasons.length ? bleReasons.map(reason => `- ${reason}`).join('\n') : '- このキットではBLEを使用しない。'}\nBLE処理・UUID・未登録の基準コードを推測して新規生成しない。利用者にAPIや通信仕様を質問せず、必要なら「対象機器で確認した基準コードの登録が必要です」と伝える。利用可能なLED${profile.features.button ? 'とボタン' : ''}の相談は続けられる。`
  const invalid = errors.length ? `\n\n## 設定が未完成または不正です\n${errors.map(error => `- ${error}`).join('\n')}\n設定値を推測せず、利用者が上記を直すまで、このキットの完成コード生成・設定に依存する修正は保留する。汎用設定へ黙って切り替えない。` : ''
  const rules = `${header}${invalid}\n\n${boardLedRules}\n\n${availability}\n\n## 情報の扱い\n固定仕様、実機確認した基準コード、M5Stack・MicroPython公式資料、一般知識の順に扱う。ただし仕様と基準コードに実質的な矛盾があれば勝手に補正せず該当機能を止め、実機と対象環境での確認が必要と伝える。外部ページを読めない場合に読んだふりをしない。必要情報はこの文面に含まれ、外部ページ取得や初期設定・URLの貼り直しを前提にしない。Arduino、C++、CircuitPython、PC用Pythonへ切り替えない。`
  return { ...context, rules }
}

function localizedRules(profile: WorkshopProfile, locale: 'en' | 'zh', errors: string[], bleReasons: string[], bleEnabled: boolean, controllerEnabled: boolean, candidateSource?: string) {
  const en = locale === 'en'
  const block = localizedPromptBlocks[locale]
  const unknown = en ? 'Not set or invalid' : '未设置或无效'
  const value = (input: string | number | null) => setting(input) === '未設定または不正' ? unknown : setting(input)
  const board = isBoardId(profile.boardId) ? boardDefinitions[profile.boardId] : null
  const buttonPin = board?.buttonPin ?? unknown
  const enabled = (state: boolean) => en ? state ? 'enabled' : 'disabled' : state ? '启用' : '禁用'
  const header = en ? `## Device and LED settings snapshot
Material ID: ${value(profile.materialId)}
Material revision: ${value(profile.revision)}
Material name: ${translateWorkshop(locale, value(profile.displayName))}
Board: ${board?.name ?? unknown}
SoC: ${board?.soc ?? unknown}
Target UIFlow2 firmware: ${value(profile.firmwareVersion)}
External LED model: ${value(profile.ledModel)}
LED_COUNT: ${value(profile.ledCount)}
LED_PIN: ${value(profile.ledPin)}
LED_BPP: ${value(profile.ledBpp)} (RGB, 3 channels only)
MAX_BRIGHTNESS_PERCENT: ${value(profile.maxBrightnessPercent)}
Features: external LEDs / onboard button ${enabled(profile.features.button)} / BLE ${enabled(bleEnabled)} / web controller ${enabled(controllerEnabled)}
Button: ${profile.features.button ? `If used, retain GPIO${buttonPin}, active LOW and approximately 40ms debounce.` : `Not used in this kit. Do not initialize or read GPIO${buttonPin}, add debounce/button operations, or offer button-related questions or choices.`}
Execution target: MicroPython on UIFlow2 firmware. MicroPythonWriter writes and runs main.py through Raw REPL; the UIFlow2 editor is not required.
The user-entered UIFlow2 version is separate from USB MicroPython version/firmwareInfo. Do not infer or overwrite it from probe results.
Valid setting ranges do not prove electrical safety or hardware operation. These AI instructions are not a code-enforcing sandbox and do not replace hardware verification.` : `## 设备与 LED 设置快照
教材 ID: ${value(profile.materialId)}
教材版本: ${value(profile.revision)}
教材名称: ${translateWorkshop(locale, value(profile.displayName))}
设备: ${board?.name ?? unknown}
SoC: ${board?.soc ?? unknown}
目标 UIFlow2 固件: ${value(profile.firmwareVersion)}
外接 LED 型号: ${value(profile.ledModel)}
LED_COUNT: ${value(profile.ledCount)}
LED_PIN: ${value(profile.ledPin)}
LED_BPP: ${value(profile.ledBpp)}（仅支持 RGB 三通道）
MAX_BRIGHTNESS_PERCENT: ${value(profile.maxBrightnessPercent)}
功能: 外接 LED / 机身按钮${enabled(profile.features.button)} / BLE ${enabled(bleEnabled)} / 网页控制器${enabled(controllerEnabled)}
按钮: ${profile.features.button ? `使用时保持 GPIO${buttonPin}、低电平有效、约 40ms 消抖。` : `此套件不使用按钮。不要初始化或读取 GPIO${buttonPin}，不要添加消抖、按钮操作或相关提问与选项。`}
运行环境: UIFlow2 固件上的 MicroPython。MicroPythonWriter 通过 Raw REPL 写入并运行 main.py，无需使用 UIFlow2 编辑器。
用户输入的目标 UIFlow2 版本与 USB 获取的 MicroPython 版本及 firmwareInfo 不同，不能根据读取信息推测或覆盖。
设置值在范围内不代表供电安全或实机运行正常。AI 固定规范不是强制代码执行的沙箱，也不能代替用户的实机验证。`
  const onboardRule = !board ? (en ? 'The board is unknown. Do not guess pin assignments or onboard LED specifications.' : '设备未知，不能猜测引脚或内置 LED 规格。') : board.id === 'atoms3lite'
    ? (en ? 'Onboard RGB is GPIO35, separate from external LEDs and button GPIO41. Do not copy NanoC6 GPIO20/GPIO19/GPIO7 or invent a separate AtomS3Lite RGB power-enable pin. Do not add onboard LED behavior unless instructed.' : '内置 RGB 为 GPIO35，与外接 LED 和按钮 GPIO41 不同。不能套用 NanoC6 的 GPIO20/GPIO19/GPIO7，也不能猜测 AtomS3Lite 独立 RGB 供电使能引脚。未经用户指示，不添加内置 LED 操作。')
    : (en ? 'Onboard RGB is GPIO20, its power is enabled by GPIO19 HIGH, and the blue LED is GPIO7. Keep these separate from external LEDs and button GPIO9. Do not copy AtomS3Lite GPIO35/GPIO41. Do not add onboard LED behavior unless instructed.' : '内置 RGB 为 GPIO20，GPIO19 拉高使能其供电，蓝色 LED 为 GPIO7。它们与外接 LED 及按钮 GPIO9 不同，不能套用 AtomS3Lite 的 GPIO35/GPIO41。未经用户指示，不添加内置 LED 操作。')
  const led = interpolatePrompt(block.led, { ledPin: value(profile.ledPin), buttonPin, onboardRule })
  const verification = profile.baseline.verification
  const availability = candidateSource
    ? bundledControllerRules(profile, locale, candidateSource)
    : bleEnabled
    ? `${en ? 'BLE device name' : 'BLE 设备名称'}: ${en ? `Preserve the verified baseline name starting with NanoLED-. No kit ID is required. Only if explicitly setting a new name, an example is NanoLED-${board?.name ?? 'Device'}. Names are not unique identifiers. If the baseline name is incompatible, ask for confirmation rather than silently renaming.` : `保持已验证基准代码中以 NanoLED- 开头的名称，不需要套件编号。只有明确设置新名称时，示例为 NanoLED-${board?.name ?? 'Device'}。名称不保证唯一；如果基准代码名称不兼容，请要求确认，不要擅自更改。`}\n${block.ble}\n\n${verification?.nanoLedV2 ? nanoLedV2Rules[locale] : verification?.nanoLedV1 ? block.nanoLed : (en ? 'This kit is not web-controller compatible. Preserve the verified baseline protocol; do not assume a NanoLED conversion.' : '此套件不支持网页控制器。保持已验证基准代码的通信协议，不能猜测并改为 NanoLED。')}\n\n## ${en ? 'Complete registered baseline' : '登记的完整基准代码'}\n${en ? 'User registration' : '用户登记信息'}: ${verification?.confirmedBy} / ${verification?.confirmedAt}\n${en ? 'Verified UIFlow2' : '已验证 UIFlow2'}: ${verification?.firmwareVersion}\nNanoLED v1: ${verification?.nanoLedV1 ? (en ? 'User-confirmed and registered' : '用户已验证并登记') : (en ? 'Unverified' : '未验证')}\nNanoLED v2: ${verification?.nanoLedV2 ? (en ? 'User-confirmed and registered' : '用户已验证并登记') : (en ? 'Unverified; never auto-upgrade v1' : '未验证；不会自动升级 v1')}\n${codeBlock(profile.baseline.code)}`
    : profile.features.controller
      ? controllerUnavailableRules(locale)
      : `## ${en ? 'BLE availability limits' : 'BLE 使用限制'}\n${bleReasons.length ? bleReasons.map(reason => `- ${reason}`).join('\n') : en ? '- This kit does not use BLE.' : '- 此套件不使用 BLE。'}\n${en ? `Do not invent BLE code, UUIDs or an unregistered baseline. Do not ask users about APIs or protocols; say a baseline verified on the target device must be registered. Continue discussing available LEDs${profile.features.button ? ' and buttons' : ''}.` : `不能猜测并新建 BLE 处理、UUID 或未登记的基准代码。不要向用户询问 API 或协议，需要时说明必须登记经目标设备验证的基准代码。可以继续讨论可用的 LED${profile.features.button ? '和按钮' : ''}功能。`}`
  const invalid = errors.length ? `\n\n## ${en ? 'Settings are incomplete or invalid' : '设置不完整或无效'}\n${errors.map(error => `- ${error}`).join('\n')}\n${en ? 'Do not guess values. Defer complete code generation and setting-dependent repairs until the user fixes these settings. Do not silently switch to generic settings.' : '不要猜测设置值。在用户修正上述设置前，暂缓生成完整代码和依赖设置的修复，不能擅自切换为通用设置。'}` : ''
  return `${header}${invalid}\n\n${led}\n\n${availability}\n\n${block.information}`
}
