import type { BaseLocale, MessageCatalog } from './types'
import { MAX_CONTROL_ACTIONS, MAX_CONTROL_MODES, MAX_NAMED_CONTROLS } from '../config/bleLimits'

// Long-form prompt blocks are kept together so every language retains the same safety contract.
// User code, hardware-verified baseline code, logs and protocol identifiers are never translated.
export const promptMessages: MessageCatalog = {}

const nanoLedV2Schema = `{"v":2,"mode":"RAINBOW","brightness":50,"speed":30,"pixels":"100000","playback":"playing","action":null,"controls":{"speed":true,"modes":[{"id":"RAINBOW","label":"Rainbow"}],"actions":[{"id":"SPARKLE","label":"Sparkle once"}]}}`

// RXの長さやv1の項目は変更せず、TXの送信条件だけを共有する。
export const nanoLedTransportRules: Record<BaseLocale, string> = {
  ja: `### NanoLED共通の送信条件（v1/v2）
- 既存サービスとアプリ独自CharacteristicはRX/TXの2本を維持する。ボタン・キャラクター・モード・アクションごとに増設しない。MODE <id> / ACTION <id>等は既存の共通RX、状態と操作定義は共通TXを使う。v1にはv2専用操作を追加しない。Notify用にスタックが管理するDescriptorはアプリ独自Characteristicの本数に数えない。UUIDを変更・追加しない。
- TX Notifyは接続直後・交渉済みATT MTU不明時に20バイト以下で開始する。希望ATT MTUの候補は247。有効な交渉結果を得た現在の接続だけ min(交渉済みATT MTU - 3, 244) バイト以下へ拡大する。希望値の設定やBluetooth 5.0以上という製品仕様は交渉結果ではない。
- 対象MicroPython/UIFlow2の公式資料でBLE.config(mtu=...)・MTU交換イベント・データ形式を確認する。未確認APIやWeb BluetoothにないMTU操作APIを推測しない。MTU指定API非対応または交換なしは20バイトで継続し、初回STATUS・LED処理をMTU待ちで止めない。BLE初期化失敗・メモリ不足・予期しない例外はAPI非対応と区別し、全例外を握りつぶして成功扱いしない。
- MTUイベントは該当する現在の接続にだけ適用する。切断・再接続で以前のMTUを破棄して20バイト開始へ戻す。旧来の固定20バイト送信も受信できる。登録済み基準コードをこの規則だけで無断変更せず、差分と再確認の必要性を示す。
- JSONをUTF-8バイト列へ変換してから分割し、LFは最終チャンクに含める。Unicode文字の途中でも分割でき、ブラウザはLFまでバイト結合してから復号する。送信中の1行は固定し、MTUが途中で変わっても正常に受け付けられたチャンクの実バイト数だけ位置を進め、欠落・重複・別JSONの混入を防ぐ。
- 主ループで少量ずつ送信し、LED・ボタン・BLE受信を止めない。有界な再試行とエラー処理を維持し、回数や待ち時間を増やしただけで安定化済みとしない。途中行を破棄する場合は切断などにより受信側と再同期し、残りの断片へ別JSONを続けない。切断時の送受信途中行を破棄し、再接続でサービス・Characteristicを取得し直して完全な新しい行から送る。`,
  en: `### Shared NanoLED transport (v1/v2)
- Keep the existing service and exactly two application-defined characteristics, RX/TX. Never add one per button, character, mode or action. Share RX for MODE <id> / ACTION <id> and other commands, and TX for state and controls. Do not add v2-only operations to v1. Stack-managed Notify descriptors are not additional application-defined characteristics. Do not change or add UUIDs.
- Start TX Notify at at most 20 bytes immediately after connection and while negotiated ATT MTU is unknown. The preferred ATT MTU candidate is 247. Only a valid negotiated result for the current connection permits min(negotiated ATT MTU - 3, 244) bytes. Setting a preferred value or a Bluetooth 5.0-or-newer product specification is not a negotiated result.
- Check BLE.config(mtu=...), the MTU exchange event and its data format against official documentation for the target MicroPython/UIFlow2. Do not invent unverified APIs or MTU APIs absent from Web Bluetooth. Continue at 20 bytes when MTU configuration is unsupported or no exchange occurs; never block initial STATUS or LEDs waiting for MTU. Distinguish unsupported APIs from BLE initialization failure, memory exhaustion and unexpected exceptions; do not swallow all errors as successful fallback.
- Apply MTU events only to their current connection. Discard the previous MTU on disconnect/reconnect and restart at 20 bytes. Legacy fixed-20-byte senders remain receivable. Do not silently modify registered baselines to satisfy this rule; show differences and required revalidation.
- Encode JSON as UTF-8 bytes before splitting, with LF in the last chunk. Unicode may cross chunks; the browser joins bytes up to LF before decoding. Freeze the current line; even if MTU changes mid-line, advance by the actual byte count of successfully accepted chunks only, avoiding loss, duplication and mixed JSON.
- Send incrementally from the main loop without blocking LEDs, buttons or BLE reception. Preserve bounded retries/error handling; merely increasing retries or delays is not proven stability. When abandoning a partial line, resynchronize with the receiver, for example by disconnecting, rather than appending another JSON to its fragments. Discard partial RX/TX on disconnect; rediscover services/characteristics after reconnect and start a complete new line.`,
  zh: `### NanoLED 共用传输条件（v1/v2）
- 保持原有服务及 RX/TX 两个应用自定义 Characteristic，不按按钮、角色、模式或动作增设。MODE <id> / ACTION <id> 等命令共用 RX，状态及操作定义共用 TX；不向 v1 添加 v2 专用操作。协议栈管理的 Notify Descriptor 不计入应用自定义 Characteristic 数量，不更改或新增 UUID。
- 连接后及已协商 ATT MTU 未知时，TX Notify 从每片最多 20 字节开始。期望 ATT MTU 候选值为 247，仅当前连接获得有效协商结果后，才扩大为 min(已协商 ATT MTU - 3, 244) 字节。设置期望值或产品支持 Bluetooth 5.0 以上都不等于已协商成功。
- 根据目标 MicroPython/UIFlow2 的官方资料确认 BLE.config(mtu=...)、MTU 交换事件及数据格式。不猜测未确认 API 或 Web Bluetooth 不提供的 MTU 操作 API。MTU 配置 API 不支持或未发生交换时继续 20 字节分片，不为等待 MTU 阻塞首次 STATUS 或 LED。区分 API 不支持、BLE 初始化失败、内存不足及意外异常，不能吞掉全部异常并当作正常回退。
- MTU 事件只应用于对应的当前连接。断开及重连丢弃以前的 MTU，重新从 20 字节开始。旧有固定 20 字节发送仍可接收。不能仅因新规则而擅改已登记基准代码，应列出差异及重新验证要求。
- JSON 先编码为 UTF-8 字节再分片，LF 放在最后一片。允许 Unicode 字符跨片，浏览器拼接到 LF 后才解码。固定正在发送的一行，即使中途 MTU 改变，也只按成功接受片段的实际字节数推进位置，不能漏字节、重复或混入另一个 JSON。
- 主循环少量发送，不阻塞 LED、按钮及 BLE 接收。保持有界重试与错误处理，不能仅增加重试次数或等待就宣称稳定。放弃半行时须通过断开等方式与接收方重新同步，不能把新 JSON 接在残片后。断开丢弃未完成的收发行，重连重新获取服务和 Characteristic，从完整新行开始。`,
}

export const namedControlPlanningRules: Record<BaseLocale, string> = {
  ja: `### 相談・仕様確認・生成前の名前付きボタン確認
- 希望やAI自身の追加提案が増えるたびに、controls.modes / controls.actionsへの実際の登録予定数を数える。合計${MAX_NAMED_CONTROLS}個を超えそうと分かった時点で早期に案内し、超過案を先に承認して生成時に初めて拒否しない。
- 例：「今の希望だと、光り方が15個、一回だけの演出が2個で、合計17個になります。上限は16個なので、あと1個整理する必要があります。どの方法がよさそうですか？」。実装可能な範囲で「優先度の低い演出を外す／用途を確認して似た演出をまとめる／共通の明るさ・速度調整で表す／おまかせで整理案」を示す。おまかせでも整理内容を明示し、最終仕様へ反映する。
- 勝手に先頭${MAX_NAMED_CONTROLS}個へ切り詰めたり、説明なく削除・統合したり、上限を17個以上へ変更したり、ページ分け・非表示化・別Characteristicで回避したりしない。配線や端末の買い替えが必要とは説明しない。既存作品のアクションも無断で削除しない。
- 最終承認前の仕様まとめに「名前付きボタン：合計11個／最大16個（光り方10個＋一回限りの演出1個）」の形で実際の件数を示す。コード生成直前と追加注文のたびに再計数し、超過が残れば「この仕様で作れます」と確定せずコードを生成しない。合計${MAX_NAMED_CONTROLS}個以内でもUTF-8の4096バイト制限は別途確認する。
- 質問は一度に1問・3〜5個の選択肢・おまかせ・必要な質問は最大6問・回答済みを聞き直さない、を維持する。件数確認は既存の相談や最終確認へ早めに織り込み、質問数制限を超過コード生成の理由にしない。UUID・MTU・通信IDは利用者に質問しない。BLE/Webリモコン無効時はこの説明のために機能を有効化せず、使えないリモコン操作を提案しない。`,
  en: `### Count named buttons during consultation, approval and generation
- Recount the actual planned controls.modes / controls.actions registrations whenever wishes or AI-proposed effects are added. Warn early as soon as the combined count may exceed ${MAX_NAMED_CONTROLS}; do not approve an oversized order first and reject it only at generation.
- Beginner example: "15 lighting modes plus 2 one-shot effects gives 17 named buttons. The limit is 16, so we need to consolidate one. Which approach would you prefer?" Offer only feasible choices: remove a low-priority effect; merge similar effects after confirming their purpose; use shared brightness/speed controls; or Choose for me to propose a consolidation. Even with Choose for me, explain every change and include it in the final specification.
- Never truncate to the first ${MAX_NAMED_CONTROLS}, silently remove/merge effects, raise the cap to 17 or more, or bypass it with pages, hidden buttons or separate characteristics. Do not imply rewiring or buying another device is required. Never silently remove actions from existing artwork.
- Before final approval show actual counts, for example "Named buttons: 11 / maximum 16 (10 lighting modes + 1 one-shot effect)". Recount immediately before code generation and after further requests. Do not promise the design is ready or generate over-limit code. Validate the separate 4096-byte UTF-8 limit even within ${MAX_NAMED_CONTROLS} controls.
- Retain one question at a time, 3–5 choices including Choose for me, at most 6 necessary questions, and no repeated answered questions. Integrate early count checks into existing consultation/final approval; the question budget never permits over-limit generation. Do not ask users for UUIDs, MTU or protocol IDs. If BLE/Web remote is disabled, neither enable it for this explanation nor propose unavailable remote operations.`,
  zh: `### 讨论、规格确认及生成前统计命名按钮
- 每次新增愿望或 AI 建议的效果，都统计实际准备登记到 controls.modes / controls.actions 的数量。预计合计将超过 ${MAX_NAMED_CONTROLS} 个时及早提醒，不先批准超额需求再到生成时才拒绝。
- 面向初学者的示例：“15 种发光模式加 2 个一次性效果，合计 17 个命名按钮。上限为 16 个，需要整理 1 个。你喜欢哪种方法？”仅提出可实现选项：去掉低优先级效果、确认用途后合并相似效果、用共用亮度/速度调节表达、或帮我决定整理方案。即使选帮我决定，也说明整理了什么并写入最终规格。
- 禁止只截取前 ${MAX_NAMED_CONTROLS} 个、未说明就删除或合并、把上限改为 17 个以上、借分页/隐藏/其他 Characteristic 规避；不要说需要换接线或更换设备。不能擅自删除现有作品的动作。
- 最终批准前展示实际统计，例如“命名按钮：合计 11 个／最多 16 个（发光模式 10 个＋一次性效果 1 个）”。代码生成前及追加需求后再次计数；超限未解决时不能确认可以制作，也不能生成超限代码。即使不超过 ${MAX_NAMED_CONTROLS} 个，也独立验证 UTF-8 的 4096 字节限制。
- 保持每次一题、3–5 个选项含帮我决定、必要问题最多 6 个、不重复已回答内容。把早期计数检查纳入既有讨论和最终确认，不能以问题次数为由生成超限代码。不要询问 UUID、MTU 或通信 ID。BLE/网页遥控已禁用时，不为此说明启用它，也不提出不可用的遥控操作。`,
}

export const remoteOffFadeRules: Record<BaseLocale, string> = {
  ja: `## Webリモコンの消灯（v1/v2共通）
- REMOTE_OFF_FADE_MS = 200。OFF受信時の最後に実際に送信した全LEDのRGBを固定し、その出力から200msで直線的に黒へフェードアウトする。目標色から再計算せず、安全上限・明るさを二重に掛けない。time.ticks_ms()/time.ticks_diff()と通常の主ループで非ブロッキングに進め、長いsleepを使わない。
- ブラウザはOFFを1回送るだけ。BRIGHTNESSを連送してフェードを作らず、明るさ設定を0へ変更しない。選択モード・明るさ設定を保持し、アクションとフェードインは中止する。プログラムとBLEは継続する。
- フェードアウト中の再度のOFFは再開始・延長しない。PAUSEでも消灯処理は止めない。BRIGHTNESS/SPEEDは設定だけを更新し、消えかけの出力を明るくしない。新しい点灯操作（v2のPLAY/MODE/ACTION、v1の点灯モード）は消灯フェードを中断して新しい要求を処理する。
- pixelsは毎回最後に送信した途中の出力を報告する。v2は消灯完了までplayback=playing、action=nullで、黒を送ってからplayback=offとする。v1は完了まで直前のmodeを維持し、黒を送ってからmode=OFFとする。OFF送信成功だけで消灯済みと表示しない。既に全出力0なら直ちに消灯状態にできる。
- 起動時・例外・KeyboardInterrupt・安全停止の消灯は即時のまま。本体ボタンの消灯動作を勝手に変更せず、OFFから点灯する最低200msのフェードインも維持する。
- 既存の機器プログラムはWeb画面の更新だけでは変わらない。対応コードを準備し直し、利用者がUSBで明示的に書き込み・実行して対象機器で確認する。既存コードや実機確認記録を黙って上書きしない。`,
  en: `## Web-remote lights off (shared by v1/v2)
- Define REMOTE_OFF_FADE_MS = 200. Snapshot every LED's last actually transmitted RGB output when OFF is accepted, and linearly fade that output to black over 200ms. Do not recalculate target colors or apply the safety cap/brightness twice. Advance nonblockingly in the normal main loop with time.ticks_ms()/time.ticks_diff(), without long sleeps.
- The browser sends OFF once, never a stream of BRIGHTNESS commands to animate the fade, and never changes the brightness setting to zero. Retain the selected mode and brightness setting; cancel actions and fade-in. Keep the program and BLE running.
- Repeated OFF does not restart or extend the fade-out. PAUSE must not stop extinction. BRIGHTNESS/SPEED update settings only without brightening the fading output. A new lighting request (v2 PLAY/MODE/ACTION or a v1 lighting mode) cancels the fade-out and handles the new request.
- Always report pixels from the last transmitted intermediate output. In v2 use playback=playing and action=null until completion; report playback=off only after transmitting black. In v1 retain the preceding mode until completion, then report mode=OFF after transmitting black. Never display extinction merely because OFF was sent successfully. Already-all-zero output may become off immediately.
- Startup, exceptions, KeyboardInterrupt and safety shutdown still turn LEDs off immediately. Do not silently change button-off behavior; preserve the minimum 200ms OFF-to-ON fade-in.
- Updating the web page does not update existing device programs. Prepare updated code, then have the user explicitly write/run it over USB and check the target hardware. Do not silently overwrite existing code or hardware-verification records.`,
  zh: `## 网页遥控熄灭（v1/v2 共用）
- 定义 REMOTE_OFF_FADE_MS = 200。接收 OFF 时固定全部 LED 最后实际发送的 RGB 输出，并从该输出在 200ms 内线性渐暗至全黑。不要从目标颜色重新计算，也不要重复应用安全亮度上限或亮度倍率。使用 time.ticks_ms()/time.ticks_diff() 在正常主循环中非阻塞推进，不使用长时间 sleep。
- 浏览器只发送一次 OFF，不连续发送 BRIGHTNESS 来实现渐暗，也不将亮度设置改为 0。保持所选模式和亮度设置，取消动作与渐亮，程序和 BLE 继续运行。
- 渐暗中再次收到 OFF 不重新开始或延长时间。PAUSE 不停止熄灭过程。BRIGHTNESS/SPEED 只更新设置，不能让渐暗中的输出变亮。新的点亮请求（v2 的 PLAY/MODE/ACTION 或 v1 的点亮模式）取消渐暗并处理新请求。
- pixels 始终报告最后实际发送的中间输出。v2 在完成前使用 playback=playing、action=null，发送全黑后才报告 playback=off。v1 在完成前保持此前 mode，发送全黑后才报告 mode=OFF。不能仅凭 OFF 发送成功显示已熄灭。如果全部输出已经为 0，可立即进入熄灭状态。
- 启动、异常、KeyboardInterrupt 和安全停止仍立即熄灭。不擅自改变按钮的熄灭行为，保持 OFF 到点亮至少 200ms 的渐亮规则。
- 更新网页不会更新设备中已有程序。需重新准备兼容代码，由用户明确通过 USB 写入并运行，再在目标实机上确认。不能静默覆盖已有代码或实机验证记录。`,
}

export const nanoLedV2Rules: Record<BaseLocale, string> = {
  ja: `## NanoLED v2通信仕様
- この仕様への適合と実機確認は別。上記で明示したコードの出典・確認状態を維持し、同梱候補を確認済みと扱わない。
- 機器はPeripheral、ブラウザはCentral。選択したコードのAPIでNanoLED-から始まる完全名を広告またはscan responseへ含める。サービスUUIDの広告は任意。完全名と128-bit UUIDを同じ広告へ無理に詰めず、広告APIを推測しない。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e。RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e は応答ありWrite必須。TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e はNotify必須、Read任意。UUIDやWrite応答だけでは反映成功にならない。
- RXはLF終端のASCIIで1行LF込み20バイト以下。PLAY / PAUSE / OFF / STATUS / BRIGHTNESS n / SPEED n / MODE <id> / ACTION <id>を使う。nは0〜100整数。コマンドは直列送信し、不正・未知・範囲外を適用しない。分割受信はLFまで結合し128バイト超の行を次のLFまで破棄する。受信キュー・待機・再試行は有界。
- モードは続く光り方、アクションは一度だけの演出。利用者と光り方を相談し、技術的なID入力を求めず分かりやすい名前を付ける。下記例のID・ラベルは例示であり固定の作品内容ではない。再生・停止・消灯とそれぞれのボタンの用途を短く説明する。
- TXはUTF-8 JSONをLF終端で送る。必須の構造例: ${nanoLedV2Schema}
- v=2。modeは消灯中もcontrols.modesにある選択モードを保持する。playbackはplaying/paused/offのみ。actionは実行中のcontrols.actionsのid、またはnull。actionがnull以外ならplayback=playing。offならaction=nullでpixelsは全桁0。省略・型違いを許可しない。
- 毎回controls全体を含める。speedはboolean、controls.modesは1〜${MAX_CONTROL_MODES}個、controls.actionsは0〜${MAX_CONTROL_ACTIONS}個、len(controls.modes) + len(controls.actions) <= ${MAX_NAMED_CONTROLS}が必須。モード16個＋アクション16個ではなく、合計${MAX_NAMED_CONTROLS}個以内の自由配分。10+1、15+1、16+0、1+15は可、16+1、8+9、17モード、0モードは不可。各{id,label}のidは^[A-Z][A-Z0-9_]{0,11}$、同じリスト内で重複不可。OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTIONは予約語。labelは制御文字を含まない1〜24 Unicodeコードポイントの平文。説明言語に合う名前を機器に保持し、HTMLや通信命令として扱わない。ブラウザの言語変更で名前を翻訳しない。
- 再生・一時停止・消灯・状態取得の共通操作、明るさ・速度スライダー、本体の物理ボタン、表示するLEDの個数はこの${MAX_NAMED_CONTROLS}個に含めない。controls.modes/actionsへ登録する独自操作を実数で数え、ページ分けや非表示化でも減らない。候補固有のSPARKLEも1個に数えるため同梱候補は最大15モード＋固定1アクション。汎用仕様の16モード＋0アクションを候補がそのまま提供するとは説明せず、既存アクションを無断削除しない。更新前のWeb側が9モード以上を受け入れるとも説明しない。
${namedControlPlanningRules.ja}
- MODE <id>は選択モードをリセットしてplayingへ移る。PLAYはpausedの保存位相から再開し、offなら選択モードで再生する。PAUSEはアニメーションと点灯フェードの進行を止め、現在表示中の色と位相を保持する。OFFは下記の200ms消灯フェードを開始し、選択モードは保持する。プログラムとBLEは停止しない。STATUSは状態を返すだけ。
- ACTION <id>は非ブロッキングで1回実行する。最初のアクション開始前の基底モード・位相・playbackを復帰元として保存し、最後のアクション完了後に戻る。元がpausedなら元の凍結位相、offなら消灯へ戻す。再スタートや別アクションへの置換で復帰元を更新しない。
- ACTION再押下の動作は、明示された作品仕様を以下の既定動作より優先する。例えば「アクション実行中の追加ACTIONは無視する」と明示されていれば、その対象範囲に従って同ID・別IDの追加要求を無視する。「同IDだけ無視」など限定指定ならその範囲だけに適用し、指定のない範囲は既定動作を使う。範囲や意図が曖昧なら確認する。生成・修正のどちらでも、プロトコル共通規則を理由に意図的な作品仕様を勝手に再スタートへ変更しない。
- 作品仕様に指定のない場合のみ、アクション中も有効な追加ACTIONを即時に受け付け、同じIDなら再スタート、別のIDなら置換する。最新の要求へ切り替え、実行待ちの演出キューを作らない。同梱候補はこの指定なしの既定動作。明示指定により無視する追加要求では、現在の演出・開始時刻・完了予定・補間・復帰元を変えず、後で実行するキューにも積まない。実行中の無視規則を終了後の新しいACTIONへ広げず、新規の要求は受け付ける。不正・未登録IDでは現在の演出・遷移・復帰元を変更しない。
- 作品仕様に従って再スタート・置換するときは、最後に実際に送信した全LEDのRGB出力を接続原点とし、新しい演出へ有限時間で非ブロッキングに補間する。同梱候補は200ms、作品では演出の仕様に合わせて自然につなぐ。補間途中の再押下も直前の実出力からつなぎ、急に黒へ落としたり基底モードをリセットしたりしない。安全上限適用済みの実出力へ輝度係数を二重に掛けず、補間先と途中の全出力にも安全上限を維持する。time.ticks_ms()/time.ticks_diff()を使い、受信処理やLED更新を長いsleepで止めない。作品の再押下指定でも、安全上限・非ブロッキング・OFFと中断動作・有限バッファの共通制約は変更しない。
- MODE/PLAY/PAUSE/OFFはアクションと再スタート補間を中断する。PLAYは基底モードを再開、PAUSEは補間途中でも中断時に見えていたフレームを保持する。停止時のフレームと、再開する基底モードの位相を必要に応じて別々に保存する。OFFの200msフェードアウト、消灯から点灯する最低200msフェードイン、起動・例外・安全停止の即時消灯を維持する。
- brightness/speedは適用した0〜100整数。BRIGHTNESS 100は設定した安全上限の100%。全出力で上限を守り、0でも選択モードを保持する。pausedで明るさを変える場合は位相を進めず現在のフレームへ倍率を適用する。off中の明るさ・速度変更では点灯しない。controls.speed=falseならブラウザは速度欄を隠し、機器はSPEEDを無視する。trueなら0は最も遅く停止ではなく、100は最速。標準周期はperiod_ms = 3000 - 29 * n。
- 起動時の既定はplayback=off、action=null、brightness=100、speed=0、modeは最初の定義済みモード。v2では固定フェード条件の「現在モードがOFF」をplayback=offとして扱う。起動・PLAY・MODE・ACTIONでoffかつ全出力0から点灯するときは最低200msの非ブロッキングフェード。点灯中の変更や一時的な黒で再開始せず、進行中のモード変更ではフェード進行度を維持する。
- pixelsはRGB LED1〜300個のRRGGBB連結。全数を報告し省略しない。安全上限・明るさ・フェードを適用して最後に送信したGRBバッファをRGB順へ戻した値であり、目標値や物理発光の測定値ではない。1行はLFを除きUTF-8で4096バイト以下。Unicodeラベルがあるため文字数でなくエンコード後バイト数で制限する。
${nanoLedTransportRules.ja}
- TX購読後にSTATUS。初回の有効な状態を受け取るまでOFF以外は操作不可。STATUS、操作反映、本体ボタン、アクション開始・再スタート・置換・終了で通知し、変化がなくても約1秒ごと、最大5件/秒。通信が遅ければ周期を延ばす。不正JSON・過大行で現在状態を上書きしない。未受信・古い状態を明示する。
- 送信完了と実行確認は別。v2に要求ID付きACKはない。Write応答をアクション成功・完了と呼ばず、機器から受信した現在のactionだけを表示する。短いアクションを通知で観測できなかった場合も成功と断定しない。
${remoteOffFadeRules.ja}`,
  en: `## NanoLED v2 protocol
- Protocol conformance and hardware verification are separate. Preserve the source and verification status explicitly stated above; never treat a bundled candidate as hardware verified.
- Device: Peripheral; browser: Central. Advertise the full NanoLED- name in advertising or scan response through the selected code's APIs. Service advertising is optional. Do not force the full name and 128-bit UUID into one packet or invent advertising APIs.
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e. RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e requires Write with Response. TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e requires Notify; Read is optional. Matching UUIDs or a Write Response do not prove application success.
- RX is ASCII, LF terminated, at most 20 bytes including LF: PLAY / PAUSE / OFF / STATUS / BRIGHTNESS n / SPEED n / MODE <id> / ACTION <id>. n is an integer 0–100. Serialize writes; invalid, unknown or out-of-range commands do not change state. Reassemble received bytes to LF; discard lines exceeding 128 bytes through the next LF. Bound queues, waits and retries.
- A mode is a continuing effect; an action runs once. Ask about desired effects, not technical IDs. Supply friendly names in the conversation language and briefly explain play, pause, lights off, and project buttons. IDs and labels below are illustrative, not a fixed project.
- TX is UTF-8 JSON terminated by LF. Required shape example: ${nanoLedV2Schema}
- v=2. mode always belongs to controls.modes, retaining the selection even while off. playback is playing/paused/off. action is null or an active controls.actions ID; a non-null action requires playback=playing. off requires action=null and all-zero pixels. No missing fields or incorrect types.
- Include the entire controls catalog in every status: speed:boolean, controls.modes:1–${MAX_CONTROL_MODES}, controls.actions:0–${MAX_CONTROL_ACTIONS}, and require len(controls.modes) + len(controls.actions) <= ${MAX_NAMED_CONTROLS}. This is not 16 modes plus 16 actions; distribute the combined ${MAX_NAMED_CONTROLS} freely. Allow 10+1, 15+1, 16+0 and 1+15; reject 16+1, 8+9, 17 modes and 0 modes. Each {id,label} uses an ID matching ^[A-Z][A-Z0-9_]{0,11}$, unique within its list. Reserved: OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTION. Labels are plain text of 1–24 Unicode code points without control characters. Keep device-provided labels in the program language, not HTML or commands; the browser must not translate them when its language changes.
- Exclude shared play/pause/off/status operations, brightness/speed sliders, physical buttons and the LED count from the ${MAX_NAMED_CONTROLS}. Count actual custom registrations in controls.modes/actions, including hidden or paginated ones. The bundled candidate's fixed SPARKLE counts as one, so that candidate supports at most 15 modes plus 1 fixed action. Do not claim it directly supports the general protocol's 16 modes plus 0 actions or silently delete existing actions. Do not claim older web versions accept 9 or more modes.
${namedControlPlanningRules.en}
- MODE <id> selects and resets that mode, then plays. PLAY resumes the saved phase when paused, or plays the selected mode when off. PAUSE freezes animation/fade-in progress and retains the currently displayed color and phase. OFF starts the 200ms fade-out below while retaining the selected mode. Keep the program and BLE running. STATUS only reports state.
- ACTION <id> runs once without blocking. Save the base mode, phase and playback from before the first action as the return state, and restore it after the final action completes: restore the frozen phase if originally paused, or darkness if off. Restarting or replacing an action must not overwrite this return state.
- Explicit artwork specifications take precedence over the following ACTION retrigger defaults. For example, if the artwork explicitly says "Ignore additional ACTION commands while active", ignore same-ID and different-ID requests within its specified scope. If it says "ignore only the same ID", apply that restriction only there and use defaults for unspecified cases. Ask for clarification if scope or intent is ambiguous. During generation and repair alike, never replace an intentional artwork policy with restarting merely because of the common protocol rules.
- Only where the artwork leaves behavior unspecified, accept valid additional ACTION commands immediately while active: restart the same ID or replace it with a different ID. Switch to the latest request; never build an effect-execution backlog. The bundled candidate uses this unspecified-case default. When an explicit policy ignores a request, leave the current effect, start time, scheduled completion, interpolation and return state unchanged, and never queue that request for later execution. The ignore-while-active policy must not reject a new ACTION after completion. Invalid or unregistered IDs leave the current action, transition and return state unchanged.
- When the artwork policy calls for a restart or replacement, snapshot every LED's last actually transmitted RGB output and interpolate nonblockingly from it to the new effect over a finite duration. The bundled candidate uses 200ms; adapt the transition naturally to the artwork's effect specification. A retrigger during interpolation starts from the latest actual output too, without abruptly going black or resetting the base mode. Never apply brightness factors twice to already safety-capped output; keep the target and every intermediate output within the safety cap. Use time.ticks_ms()/time.ticks_diff(), without long sleeps that block reception or LED updates. Artwork retrigger policies must still preserve the common safety cap, nonblocking behavior, OFF/interruption behavior and bounded buffers.
- MODE/PLAY/PAUSE/OFF interrupt both the action and restart interpolation. PLAY resumes the base mode; PAUSE holds the frame actually visible at interruption, even mid-interpolation. Store the held frame separately from the base mode phase to resume when needed. Preserve the 200ms OFF fade-out, minimum 200ms OFF-to-ON fade-in, and immediate extinction for startup, exceptions and safety shutdown.
- Report applied brightness/speed as integers 0–100. BRIGHTNESS 100 is 100% of the configured safety cap; keep the cap on every output. Zero retains the mode. Changing brightness while paused scales the current frame without advancing its phase. Brightness/speed changes while off do not light LEDs. With controls.speed=false hide the slider and ignore SPEED on the device; otherwise 0 is slowest, not stopped, and 100 is fastest. Standard period_ms = 3000 - 29 * n.
- Startup defaults: playback=off, action=null, brightness=100, speed=0, mode=first defined mode. In v2 the fixed fade rule's current mode OFF means playback=off. Startup/PLAY/MODE/ACTION from off with all-zero output must fade in nonblockingly for at least 200ms. Do not restart for changes while lit or a temporary black frame; preserve fade progress during mode changes.
- pixels concatenates RRGGBB for every RGB LED, 1–300 LEDs without omissions, converting the last transmitted, cap/brightness/fade-adjusted GRB buffer back to RGB. It reports transmitted output, not target colors or measured physical light. Each UTF-8 line is at most 4096 bytes excluding LF; count encoded bytes, not characters.
${nanoLedTransportRules.en}
- Subscribe to TX before STATUS. Disable controls except OFF before the first valid state. Report STATUS, applied commands, button changes, action start/restart/replacement/end, and approximately every second unchanged, at most 5 snapshots/second; slow down for slow links. Invalid/oversized JSON must not overwrite state. Indicate missing/stale state.
- Sending and confirming execution are different: v2 has no request-ID ACK. Never call a Write Response action success/completion. Show only the current action reported by the device; if a short action is not observed in notifications, do not assume it succeeded.
${remoteOffFadeRules.en}`,
  zh: `## NanoLED v2 通信规范
- 符合协议与实机验证是不同事项。保持上方明确说明的代码来源及验证状态，不能将内置候选代码当作已实机验证。
- 设备为 Peripheral，浏览器为 Central。通过所选代码的 API 在广播或 scan response 中包含 NanoLED- 开头的完整名称。广播服务 UUID 为可选，不把完整名称与 128-bit UUID 强行塞进同一包，不猜测广播 API。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e。RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e 必须支持 Write with Response。TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e 必须支持 Notify，Read 为可选。UUID 一致或写入响应不代表实际执行成功。
- RX 为 LF 结尾的 ASCII，每行含 LF 最多 20 字节：PLAY / PAUSE / OFF / STATUS / BRIGHTNESS n / SPEED n / MODE <id> / ACTION <id>。n 为 0–100 整数。顺序写入，无效、未知或越界命令不改变状态。收到 LF 后才处理完整行，超过 128 字节的行丢弃到下一 LF。队列、等待和重试必须有界。
- 模式是持续的效果，动作只执行一次。询问用户希望的效果，不要求输入技术 ID。用对话语言设置易懂名称，简短说明播放、暂停、熄灭及作品按钮。以下 ID 与名称仅为示例，不是固定作品内容。
- TX 为 LF 结尾的 UTF-8 JSON，必需结构示例：${nanoLedV2Schema}
- v=2。mode 必须属于 controls.modes，熄灭时也保留所选模式。playback 仅为 playing/paused/off。action 为 null 或正在执行的 controls.actions 的 ID；非 null 时 playback 必须为 playing。off 时 action=null 且 pixels 全部为 0。不允许字段缺失或类型错误。
- 每次状态都包含完整 controls：speed 为 boolean，controls.modes 为 1–${MAX_CONTROL_MODES} 个，controls.actions 为 0–${MAX_CONTROL_ACTIONS} 个，必须满足 len(controls.modes) + len(controls.actions) <= ${MAX_NAMED_CONTROLS}。不是 16 模式加 16 动作，而是在合计 ${MAX_NAMED_CONTROLS} 个以内自由分配。允许 10+1、15+1、16+0、1+15；拒绝 16+1、8+9、17 模式及 0 模式。各 {id,label} 的 id 匹配 ^[A-Z][A-Z0-9_]{0,11}$，同一列表内不重复。保留字为 OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTION。label 为不含控制字符的 1–24 个 Unicode 码点的纯文本。设备名称使用程序语言，不能当成 HTML 或命令；浏览器切换语言时不翻译这些名称。
- 共用播放/暂停/熄灭/状态获取、亮度和速度滑块、机身物理按钮及显示的 LED 数量不计入这 ${MAX_NAMED_CONTROLS} 个。按 controls.modes/actions 实际登记的独自操作计数，分页和隐藏不减少数量。候选自带 SPARKLE 也算 1 个，所以该候选最多 15 模式加 1 固定动作。不能说它直接支持通用协议的 16 模式加 0 动作，也不能擅删现有动作。不能声称旧网页版本能接收 9 个以上模式。
${namedControlPlanningRules.zh}
- MODE <id> 选择并重置模式，然后播放。PLAY 从暂停保存的相位继续，或在 off 时播放所选模式。PAUSE 冻结动画及渐亮进度，保留当前显示颜色和相位。OFF 按下述规则开始 200ms 渐暗，保持所选模式。程序和 BLE 继续运行。STATUS 仅报告状态。
- ACTION <id> 非阻塞执行一次。将首次动作开始前的基础模式、相位和 playback 保存为恢复状态，最后一个动作结束后恢复；原先为 paused 时恢复冻结相位，为 off 时恢复熄灭。重新开始或替换动作时不能覆盖该恢复状态。
- ACTION 再次按下时，明确的作品规格优先于以下默认行为。例如明确要求“执行中忽略额外 ACTION”时，在指定范围内忽略相同及不同 ID 的追加请求；若仅要求“忽略相同 ID”，则只适用于该范围，未指定范围采用默认行为。范围或意图不明确时先询问确认。生成和修复时都不能以共用协议规则为由，擅自把作品有意规定的行为改成重新开始。
- 仅在作品未指定行为时，动作执行中也立即接受有效的额外 ACTION：相同 ID 重新开始，不同 ID 替换当前动作。切换到最新请求，不建立等待执行的演出队列。内置候选程序采用这一未指定时的默认行为。按明确规格忽略追加请求时，不改变当前演出、开始时间、预计结束时间、插值或恢复状态，也不将请求加入稍后执行的队列。仅在执行中忽略的规则不能延伸到结束后的新 ACTION，结束后应接受新的请求。无效或未登记 ID 不改变当前动作、过渡或恢复状态。
- 作品规格要求重新开始或替换时，以全部 LED 最后实际发送的 RGB 输出为衔接起点，在有限时间内非阻塞插值到新效果。内置候选程序使用 200ms，作品可按演出规格自然衔接。插值中再次按下也从最新实际输出衔接，不能突然变黑或重置基础模式。不要对已应用安全上限的输出重复乘以亮度系数，目标和全部中间输出仍保持安全上限。使用 time.ticks_ms()/time.ticks_diff()，不以长时间 sleep 阻塞接收或 LED 更新。作品的再次按下策略也必须保留安全上限、非阻塞、OFF 及中断行为、有界缓冲区等共用约束。
- MODE/PLAY/PAUSE/OFF 中断动作及重新开始的插值。PLAY 恢复基础模式；PAUSE 即使在插值中也保留中断时实际看到的画面。必要时将保留画面与待恢复的基础模式相位分开保存。保持 OFF 的 200ms 渐暗、OFF 到点亮至少 200ms 的渐亮，以及启动、异常和安全停止的立即熄灭。
- brightness/speed 报告已应用的 0–100 整数。BRIGHTNESS 100 是设置安全上限的 100%，全部输出保持上限，0 不改变所选模式。暂停中调整亮度只缩放当前画面，不推进相位。off 时调整亮度或速度不点亮。controls.speed=false 时浏览器隐藏速度，设备忽略 SPEED；为 true 时 0 最慢但不停，100 最快，标准 period_ms = 3000 - 29 * n。
- 默认启动为 playback=off、action=null、brightness=100、speed=0，mode 为第一个已定义模式。v2 中固定渐变规则的“当前模式 OFF”应解释为 playback=off。启动、PLAY、MODE、ACTION 从 off 且全零输出点亮时，必须非阻塞渐亮至少 200ms。已亮时变化或动画临时黑帧不重新开始，切换模式时保持正在进行的渐变进度。
- pixels 将 1–300 个 RGB LED 的全部 RRGGBB 连接，不省略。将最后实际发送且已应用安全上限、亮度、渐变的 GRB 缓冲区转回 RGB，报告已发送输出而非目标颜色或物理发光测量值。每行 UTF-8 编码后不含 LF 最多 4096 字节，按字节而非字符计数。
${nanoLedTransportRules.zh}
- 先订阅 TX 再发送 STATUS，首次有效状态前只允许 OFF。STATUS、命令应用、按钮变化、动作开始、重新开始、替换及结束时通知；不变时也约每秒通知，最多 5 次/秒，慢链路可延长周期。无效或超长 JSON 不覆盖当前状态，明确提示未收到或已过期状态。
- 发送完成与执行确认不同：v2 没有请求 ID ACK。不能将写入响应称为动作成功或完成，只显示设备报告的当前 action。短动作未被通知观察到时，也不能推断成功。
${remoteOffFadeRules.zh}`,
}

export const localizedPromptBlocks: Record<Exclude<BaseLocale, 'ja'>, { led: string; ble: string; nanoLed: string; information: string }> = {
  en: {
    led: `## Fixed LED and button rules
- External LEDs use the configured GPIO{ledPin}. Initialize machine.Pin(LED_PIN, machine.Pin.OUT). Default GPIO2 is Grove G2. If changed, verify wiring and GPIO output support without conflicting with USB, onboard LEDs or buttons. Check power requirements and maintain a common ground.
- If the onboard button is enabled, use GPIO{buttonPin}, active LOW (pressed LOW, released HIGH), optionally machine.Pin.PULL_UP. Read it in the main loop with approximately 40ms debounce. Do not replace it with M5.BtnA or a guessed board API. Do not add button operations when the button feature is disabled.
- {onboardRule}
- Use import machine and import time as the basis. Do not import neopixel. Use machine.bitstream() and bytearray for LED output.
- BITSTREAM_TIMING = 1 is only a fixed 800kHz label. Keep encoding=0 and WS2812_TIMING_NS = (400, 850, 800, 450), in nanoseconds, ordered T0H,T0L,T1H,T1L.
- Build one complete frame in bytearray(LED_COUNT * LED_BPP), then send machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer). Never pass the numeric 1 as the third argument. Do not send one LED at a time.
- Specify colors as RGB but store the buffer as GRB. At offset = led_index * LED_BPP, store green, red, blue. Follow the shared LED transmission flicker reduction rules for LOW holds before/after sending and for skipping identical frames.
- Route all OFF, solid colors and animations through the same output function. Clamp RGB to 0–255, apply the configured maximum brightness, user brightness and fade factor, then store GRB. Never raise the safety cap to satisfy a brighter request.
- On startup, send zero to every LED through the shared output function. Even a requested startup effect must obey the minimum 200ms OFF-to-ON fade for its first illumination.
- If a required API such as machine.bitstream is unverified in the target firmware, request verification on the target device. Do not guess alternative APIs or libraries or ask users to install external libraries.
- Do not add uasyncio, threads or GPIO interrupts unless explicitly specified by the user. Turn LEDs off where possible on termination or KeyboardInterrupt; do not obstruct Ctrl-C.

## Fixed OFF-to-ON fade rules
- Define MIN_OFF_TO_ON_FADE_MS = 200 at the top. Apply only when the current mode is OFF AND the last transmitted output of every LED is zero, then switching to a lighting mode. Include the first illumination after startup.
- Duration is the greater of the requested duration and 200ms. Use 200ms even when omitted or requested as immediate. Advance a factor from 0.0 to 1.0 without blocking, using time.ticks_ms() and time.ticks_diff(). Do not first transmit a frame at target brightness.
- Do not restart this fade for color changes, brightness changes or temporarily black animation frames while already in an ON mode. This fade-in rule does not impose 200ms on dimming or turning OFF; web-remote OFF has its separate 200ms fade-out rule below.
- When switching to another ON mode during a fade, preserve fade progress and update only the target color. Switching to OFF cancels fade-in.
- Do not use long sleeps, time.sleep_ms(200), or loops that block until an effect completes. Keep main-loop waits at 10–20ms or less, accepting enabled button and BLE input during effects and fades.
- Advance one effect using time, current mode, animation position and last update time. Reset the previous effect state on mode change while preserving an active fade according to the rules above.
- Unless specified, start OFF; if the button is used, use one short press; use an approximately 3-second effect cycle and repeat until the next operation. Briefly explain the defaults adopted.`,
    ble: `## Preserve the BLE baseline
- Fixed-20-byte transmission in a registered baseline remains valid. If negotiated-MTU sending or additional controls require a change, explain the differences, API evidence and required hardware revalidation first. Do not change registered code, saved artwork, executed code or verification records without approval. An approved modification is an unverified candidate; updating the bundled candidate does not update registered baselines.
- The full baseline below corresponds to hardware verification registered by the user. It does not mean this app or AI verified hardware behavior.
- Preserve BLE initialization, service and characteristic UUIDs, receive-callback argument format, device-name format and libraries. Never invent APIs or replace the BLE implementation.
- Receive callbacks only put received bytes in a bounded queue. Perform actual mode changes and LED updates in the main loop. Do not lose multiple commands by overwriting one variable.
- Bound fragmented receive buffers and command queues. If full, drop additional data with a short diagnostic. Do not wait or retry forever. Discard partial receive data on disconnect.
- Validate complete commands as UTF-8, trim surrounding whitespace, LF and CR, then compare uppercase commands. Invalid, unknown or undecodable commands must leave state unchanged; emit a short USB diagnostic if possible and keep running.
- If both onboard button and BLE are enabled, use one shared mode-change function rather than duplicating effects.`,
    nanoLed: `## NanoLED v1 communication contract
- This is the legacy verified protocol. It does not provide PLAY/PAUSE, ACTION or project catalogs. Do not auto-upgrade to v2 or offer web-controller playback, pause or one-shot actions. These require an implementer-led v2 migration and separate hardware verification.
- The device is the Peripheral; the browser is the Central. Include the full device name in advertising or scan response using verified firmware APIs. Advertising the service UUID is optional. Do not force the full name and 128-bit UUID into one packet or invent advertising APIs.
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e. Browser-to-device Write with Response is required; Write Without Response alone is insufficient.
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e. Device-to-browser Notify is required; Read is optional and not a substitute. Matching UUIDs alone do not prove compatibility or successful operation.
- The browser enables TX notifications before STATUS. Lighting modes and sliders stay disabled until the first valid state; OFF may be sent once connected. A Write Response does not prove LED application or successful extinction.
- RX commands are UTF-8 ASCII, one command terminated by LF (\\n), at most 20 bytes including LF. The browser writes one line at a time sequentially with response, never concurrently.
- Join fragments and process complete LF-terminated lines in order, including multiple lines. Limit receive lines to 128 bytes; discard an oversized line until the next LF. Bound the command queue and diagnose discarded overflow.
- Preserve every command: PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS. PINK is solid pink; BLUE solid blue; MAGIC moves pink/purple/blue left to right; RAINBOW cycles all LEDs through rainbow colors.
- OFF uses the 200ms fade-out rule below, canceling fade-in while the program and BLE continue. STATUS only reports state and changes nothing.
- n is an integer from 0 to 100. Missing arguments, fractions, out-of-range values or unknown commands leave state unchanged. BRIGHTNESS 100 means 100% of the configured cap, not a changed cap. BRIGHTNESS 0 retains the mode. Brightness or speed changes while OFF do not turn LEDs on.
- SPEED 0 is slowest, not stopped; 100 is fastest. Default MAGIC/RAINBOW period_ms = 3000 - 29 * n, independent of LED count. Additional effects use the same direction of speed scaling and must not stop at 0.
- Default startup state is mode=OFF, brightness=100, speed=0. Explicit startup effects may override the mode only while respecting the cap and OFF-to-ON fade. Report the actual applied state.
- Additional mode tokens match ^[A-Z][A-Z0-9_]{0,15}$, at most 16 characters. STATUS, BRIGHTNESS, SPEED, PLAY, PAUSE, MODE and ACTION are reserved. The four standard modes and legacy brightness/speed remain compatible. Legacy custom tokens PLAY/PAUSE/MODE/ACTION cannot be sent by the new UI; ask the maintainer to rename them, never silently edit the baseline. Additional effects require firmware implementation.
- TX is one ASCII-only JSON line terminated by LF. Require v (number 1), mode (applied mode), brightness and speed (applied integers 0–100), and pixels (all LED RGB outputs). Keep logs on USB, not TX.
- pixels concatenates six hexadecimal RRGGBB digits per LED in LED order, either case. All zeros means all OFF. Support 1–300 RGB LEDs; count = pixels.length / 6. Never omit, subsample or change the configured LED count. Limit a line to 4096 bytes excluding LF.
- Report pixels in RGB order from the last output actually transmitted AFTER maximum-brightness, user-brightness and fade factors. Convert the LED GRB buffer back to RGB. This is a transmitted-output snapshot, not target colors or a physical light sensor measurement.
${nanoLedTransportRules.en}
- Notify the latest state for STATUS, applied commands and enabled button changes, and approximately once per second even unchanged, at most 5 snapshots/second. Slow down if necessary. Finish the current line and keep only the newest pending snapshot; never replace JSON mid-line.
- Discard partial send and receive lines on disconnect. After reconnect/resubscribe start a complete new line. The browser discards old GATT objects and rediscovers services and characteristics.
- The browser delimits by LF, not Notify boundaries. Invalid JSON or oversized lines do not overwrite state. Clearly indicate missing or stale state. Do not update LED previews merely from sent settings.
${remoteOffFadeRules.en}`,
    information: `## Information handling
Prioritize fixed specifications, hardware-verified baseline code, official M5Stack/MicroPython documentation, then general knowledge. If specifications and baseline materially conflict, do not silently reconcile them: stop the affected feature and ask the user to verify it on the target device. Never pretend to have read an inaccessible page. This prompt is self-contained; do not require external-page retrieval, repeating initial setup or pasting another URL. Do not switch to Arduino, C++, CircuitPython or desktop Python.`,
  },
  zh: {
    led: `## LED 和按钮的固定规则
- 外接 LED 使用设置的 GPIO{ledPin}，通过 machine.Pin(LED_PIN, machine.Pin.OUT) 初始化。默认 GPIO2 对应 Grove G2。更改时请确认接线和设备是否支持该 GPIO 输出，避免与 USB、内置 LED 或按钮冲突。确认供电要求并确保共地。
- 使用机身按钮时，使用 GPIO{buttonPin}、低电平有效（按下为 LOW，松开为 HIGH），按需使用 machine.Pin.PULL_UP。在主循环中读取，并进行约 40ms 的消抖。不要替换成 M5.BtnA 或猜测的设备 API。未启用按钮功能时，不能添加按钮操作。
- {onboardRule}
- 以 import machine 和 import time 为基础，不要 import neopixel。使用 machine.bitstream() 和 bytearray 输出 LED 数据。
- BITSTREAM_TIMING = 1 仅为 800kHz 的固定标签。保持 encoding=0 和 WS2812_TIMING_NS = (400, 850, 800, 450) 不变，单位为纳秒，顺序为 T0H,T0L,T1H,T1L。
- 在 bytearray(LED_COUNT * LED_BPP) 中构建全部 LED 的完整一帧，然后通过 machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer) 一次发送。第三个参数不能直接传数字 1，不能逐个 LED 发送。
- 颜色使用 RGB 表示，发送缓冲区使用 GRB。offset = led_index * LED_BPP，依次存储 green、red、blue。发送前后 LOW 时间及相同帧省略按减少 LED 发送闪烁的共用规则处理。
- 熄灭、单色和动画都必须经过同一个输出函数。将 RGB 限制在 0–255，应用准备页面设置的最大亮度、用户亮度和渐变系数后，再按 GRB 存储。不能为满足更亮的要求而提高安全上限。
- 启动时，通过共用发送函数向全部 LED 发送 0，安全初始化为熄灭。即使指定了启动效果，首次点亮也必须遵守 OFF 到点亮至少 200ms 的渐亮规则。
- 如果 machine.bitstream 等必要 API 尚未在目标固件中确认，请要求在目标实机上确认。不要猜测替代 API 或库，也不要要求用户安装外部库。
- 未经用户明确指定，不添加 uasyncio、线程或 GPIO 中断。停止或 KeyboardInterrupt 时尽可能熄灭 LED，不妨碍 Ctrl-C 停止。

## OFF 到点亮的固定渐变规则
- 在代码开头定义 MIN_OFF_TO_ON_FADE_MS = 200。仅当当前模式为 OFF 且最后发送的全部 LED 输出都为 0，然后切换到点亮模式时应用，包括启动后的首次点亮。
- 渐变时间取用户指定时间与 200ms 中的较大值。未指定或要求立即点亮时也使用 200ms。通过 time.ticks_ms() 和 time.ticks_diff() 非阻塞地将系数从 0.0 推进到 1.0，不能先发送目标亮度的一帧。
- 已点亮时的颜色变化、亮度变化，以及动画中暂时为黑色的一帧，都不能重新开始渐亮。本渐亮规则不强制变暗和熄灭使用 200ms；网页遥控 OFF 另按下述 200ms 渐暗规则处理。
- 渐变中切换到另一点亮模式时，保持进度，仅更新目标颜色。切换到 OFF 时取消渐亮。
- 禁止长时间 sleep、time.sleep_ms(200) 或必须等待动画结束才能退出的循环。主循环等待时间保持 10–20ms 或更短，在动画和渐变中也要接受可用的按钮和 BLE 输入。
- 根据时间、当前模式、动画位置和上次更新时间推进一种效果。切换模式时适当重置旧效果状态，但必须按上述规则保持正在进行的渐亮进度。
- 未指定时，启动为 OFF；使用按钮时采用一次短按；效果周期约 3 秒，重复到下次操作。向用户简短说明采用的默认设置。`,
    ble: `## 保持 BLE 基准代码
- 已登记代码的固定 20 字节发送仍有效。若可变 MTU 发送或增加操作需要改造，先说明差异、API 依据及重新实机验证要求。未经批准，不修改已登记代码、保存作品、执行代码或验证记录。获准的改造版仍为未验证候选，内置候选更新不等于基准代码更新。
- 下方完整基准代码对应用户登记的实机验证信息，不代表本应用或 AI 已验证实机行为。
- 保持 BLE 初始化方法、服务和特征 UUID、接收回调的参数形式、设备名称格式及库不变。不要猜测不存在或未确认的 API，也不要替换 BLE 实现。
- 接收回调只将接收到的字节保存到有界队列。实际模式切换和 LED 更新在主循环中处理，不能通过覆盖单一变量丢失多个命令。
- 分片接收缓冲区和命令队列必须有界。满时丢弃新增数据并给出简短诊断，不无限等待或重试。断开连接时丢弃未完成的接收数据。
- 将完整命令验证为 UTF-8，去除前后空白、LF 和 CR，并转成大写判断。无效、未知或解码失败的命令不能改变状态；如可行，在 USB 输出简短诊断并继续运行。
- 同时使用按钮和 BLE 时，共用一个模式切换函数，不重复实现同一效果。`,
    nanoLed: `## NanoLED v1 通信规范
- 这是已验证的旧协议，不提供 PLAY/PAUSE、ACTION 或作品操作列表。不能自动升级为 v2，也不能说明网页控制器支持播放、暂停或一次性动作。这些功能需要由实现者迁移至 v2 并另行完成实机验证。
- 设备为 Peripheral，浏览器为 Central。使用已确认的固件 API，在广播或 scan response 中包含完整设备名称。广播服务 UUID 为可选。不要强行把完整名称和 128-bit UUID 塞进同一个数据包，也不要猜测广播 API。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e。必须支持浏览器到设备的 Write with Response；仅支持 Write Without Response 不够。
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e。必须支持设备到浏览器的 Notify。Read 可选，不能代替 Notify。UUID 相同不代表兼容或操作成功。
- 浏览器先启用 TX 通知，再发送 STATUS。首次收到有效状态前禁用点亮模式和滑块，但连接后即可发送 OFF。Write Response 不代表 LED 已应用或已经熄灭。
- RX 命令使用 UTF-8 的 ASCII 字符，一条命令以 LF（\\n）结束，含 LF 最多 20 字节。浏览器逐行串行执行带响应写入，不并发写入。
- 设备合并分片，仅按顺序处理收到 LF 的完整行，并支持连续多行。接收行缓冲区最多 128 字节，超长行丢弃到下一个 LF。命令队列也必须有界，满时丢弃新增项并诊断。
- 保留全部命令：PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS。PINK 为全部粉色，BLUE 为全部蓝色，MAGIC 为粉、紫、蓝从左向右流动，RAINBOW 为全部 LED 的彩虹变化。
- OFF 按下述 200ms 渐暗规则处理并取消渐亮，程序和 BLE 继续运行。STATUS 仅通知状态，不改变行为。
- n 为 0–100 的整数。缺少参数、小数、越界或未知命令不能改变状态。BRIGHTNESS 100 表示已设置的安全亮度上限的 100%，不能更改上限本身。BRIGHTNESS 0 保持当前模式。OFF 时调整亮度或速度不能点亮 LED。
- SPEED 0 表示最慢而非停止，100 表示最快。标准 MAGIC/RAINBOW 的 period_ms = 3000 - 29 * n，不随 LED 数量变化。新增效果也使用同方向速度调整，0 不得停止。
- 默认启动状态为 mode=OFF、brightness=100、speed=0。明确指定启动效果时可以更改模式，但必须遵守安全亮度及 OFF 到 ON 渐变。通知返回实际已应用状态。
- 新增模式名称必须匹配 ^[A-Z][A-Z0-9_]{0,15}$，最多 16 个字符。STATUS、BRIGHTNESS、SPEED、PLAY、PAUSE、MODE、ACTION 为保留字。四种标准模式及原有亮度、速度保持兼容。旧自定义名称 PLAY/PAUSE/MODE/ACTION 无法通过新界面发送，需请实现者确认更名，不能自动修改基准代码。新增效果需在设备程序中实现。
- TX 为一行仅含 ASCII 的 JSON，以 LF 结束。必须包含 v（数值 1）、mode（已应用模式）、brightness 和 speed（已应用的 0–100 整数）以及 pixels（全部 LED 的 RGB 输出）。日志走 USB，不能混入 TX。
- pixels 按 LED 顺序拼接每颗 LED 的六位 RRGGBB 十六进制数，大小写均可。全部为 0 表示全部熄灭。支持 1–300 颗 RGB LED，数量为 pixels.length / 6。不能省略、抽样或改变设定数量。每行不含 LF 最多 4096 字节。
- pixels 必须按 RGB 顺序报告经过最大亮度、用户亮度和渐变后最后实际发送的输出。将 LED 的 GRB 缓冲区还原为 RGB。它是已发送输出的快照，不是目标颜色，也不是传感器对实物发光的测量。
${nanoLedTransportRules.zh}
- STATUS、命令应用和可用按钮状态变化时通知最新状态；无变化也约每秒通知一次，最多每秒 5 个快照。通信慢时延长周期。完成正在发送的整行，待发送仅保留最新一份，不能在行中途替换 JSON。
- 断开时丢弃发送和接收的半行。重连及重新订阅通知后，从完整新行开始。浏览器丢弃旧 GATT 对象并重新获取服务和特征。
- 浏览器按 LF 分行，而非 Notify 边界。无效 JSON 或超长行不能覆盖状态。明确提示未收到或停止更新，不能仅根据发送的设置改变 LED 预览。
${remoteOffFadeRules.zh}`,
    information: `## 信息处理
优先级为固定规范、经实机验证的基准代码、M5Stack 和 MicroPython 官方资料、一般知识。规范与基准代码存在实质矛盾时，不要擅自修正，应暂停相关功能并请用户在目标实机上确认。无法读取外部页面时不能假装已读。本提示词已包含必要信息，不依赖外部页面获取、重新初始设置或再次粘贴 URL。不要切换到 Arduino、C++、CircuitPython 或电脑用 Python。`,
  },
}

export const interpolatePrompt = (text: string, values: Record<string, string | number>) => text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match)
