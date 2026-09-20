import type { Locale, MessageCatalog } from './types'

// Long-form prompt blocks are kept together so every language retains the same safety contract.
// User code, hardware-verified baseline code, logs and protocol identifiers are never translated.
export const promptMessages: MessageCatalog = {}

const nanoLedV2Schema = `{"v":2,"mode":"RAINBOW","brightness":50,"speed":30,"pixels":"100000","playback":"playing","action":null,"controls":{"speed":true,"modes":[{"id":"RAINBOW","label":"Rainbow"}],"actions":[{"id":"SPARKLE","label":"Sparkle once"}]}}`

export const remoteOffFadeRules: Record<Locale, string> = {
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

export const nanoLedV2Rules: Record<Locale, string> = {
  ja: `## NanoLED v2通信仕様
- この仕様への適合と実機確認は別。上記で明示したコードの出典・確認状態を維持し、同梱候補を確認済みと扱わない。
- 機器はPeripheral、ブラウザはCentral。選択したコードのAPIでNanoLED-から始まる完全名を広告またはscan responseへ含める。サービスUUIDの広告は任意。完全名と128-bit UUIDを同じ広告へ無理に詰めず、広告APIを推測しない。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e。RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e は応答ありWrite必須。TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e はNotify必須、Read任意。UUIDやWrite応答だけでは反映成功にならない。
- RXはLF終端のASCIIで1行LF込み20バイト以下。PLAY / PAUSE / OFF / STATUS / BRIGHTNESS n / SPEED n / MODE <id> / ACTION <id>を使う。nは0〜100整数。コマンドは直列送信し、不正・未知・範囲外を適用しない。分割受信はLFまで結合し128バイト超の行を次のLFまで破棄する。受信キュー・待機・再試行は有界。
- モードは続く光り方、アクションは一度だけの演出。利用者と光り方を相談し、技術的なID入力を求めず分かりやすい名前を付ける。下記例のID・ラベルは例示であり固定の作品内容ではない。再生・停止・消灯とそれぞれのボタンの用途を短く説明する。
- TXはUTF-8 JSONをLF終端で送る。必須の構造例: ${nanoLedV2Schema}
- v=2。modeは消灯中もcontrols.modesにある選択モードを保持する。playbackはplaying/paused/offのみ。actionは実行中のcontrols.actionsのid、またはnull。actionがnull以外ならplayback=playing。offならaction=nullでpixelsは全桁0。省略・型違いを許可しない。
- 毎回controls全体を含める。speedはboolean、modesは1〜8件、actionsは0〜8件。各{id,label}のidは^[A-Z][A-Z0-9_]{0,11}$、同じリスト内で重複不可。OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTIONは予約語。labelは制御文字を含まない1〜24 Unicodeコードポイントの平文。説明言語に合う名前を機器に保持し、HTMLや通信命令として扱わない。ブラウザの言語変更で名前を翻訳しない。
- MODE <id>は選択モードをリセットしてplayingへ移る。PLAYはpausedの保存位相から再開し、offなら選択モードで再生する。PAUSEはアニメーションと点灯フェードの進行を止め、現在表示中の色と位相を保持する。OFFは下記の200ms消灯フェードを開始し、選択モードは保持する。プログラムとBLEは停止しない。STATUSは状態を返すだけ。
- ACTION <id>は非ブロッキングで1回実行する。最初のアクション開始前の基底モード・位相・playbackを復帰元として保存し、最後のアクション完了後に戻る。元がpausedなら元の凍結位相、offなら消灯へ戻す。再スタートや別アクションへの置換で復帰元を更新しない。
- アクション中も有効な追加ACTIONを即時に受け付け、同じIDなら再スタート、別のIDなら置換する。最新の要求へ切り替え、実行待ちの演出キューを作らない。不正・未登録IDでは現在の演出・遷移・復帰元を変更しない。
- 再スタート・置換は最後に実際に送信した全LEDのRGB出力を接続原点とし、新しい演出へ有限時間で非ブロッキングに補間する。同梱候補は200ms、作品では演出の仕様に合わせて自然につなぐ。補間途中の再押下も直前の実出力からつなぎ、急に黒へ落としたり基底モードをリセットしたりしない。安全上限適用済みの実出力へ輝度係数を二重に掛けず、補間先と途中の全出力にも安全上限を維持する。time.ticks_ms()/time.ticks_diff()を使い、受信処理やLED更新を長いsleepで止めない。
- MODE/PLAY/PAUSE/OFFはアクションと再スタート補間を中断する。PLAYは基底モードを再開、PAUSEは補間途中でも中断時に見えていたフレームを保持する。停止時のフレームと、再開する基底モードの位相を必要に応じて別々に保存する。OFFの200msフェードアウト、消灯から点灯する最低200msフェードイン、起動・例外・安全停止の即時消灯を維持する。
- brightness/speedは適用した0〜100整数。BRIGHTNESS 100は設定した安全上限の100%。全出力で上限を守り、0でも選択モードを保持する。pausedで明るさを変える場合は位相を進めず現在のフレームへ倍率を適用する。off中の明るさ・速度変更では点灯しない。controls.speed=falseならブラウザは速度欄を隠し、機器はSPEEDを無視する。trueなら0は最も遅く停止ではなく、100は最速。標準周期はperiod_ms = 3000 - 29 * n。
- 起動時の既定はplayback=off、action=null、brightness=100、speed=0、modeは最初の定義済みモード。v2では固定フェード条件の「現在モードがOFF」をplayback=offとして扱う。起動・PLAY・MODE・ACTIONでoffかつ全出力0から点灯するときは最低200msの非ブロッキングフェード。点灯中の変更や一時的な黒で再開始せず、進行中のモード変更ではフェード進行度を維持する。
- pixelsはRGB LED1〜300個のRRGGBB連結。全数を報告し省略しない。安全上限・明るさ・フェードを適用して最後に送信したGRBバッファをRGB順へ戻した値であり、目標値や物理発光の測定値ではない。1行はLFを除きUTF-8で4096バイト以下。Unicodeラベルがあるため文字数でなくエンコード後バイト数で制限する。
- Notifyを1回20バイト以下へ分割する。UTF-8文字の途中で分割されても、ブラウザはLFまでバイト結合してから復号する。1行の固定スナップショットを最後まで送ってから次へ進む。LED・ボタンを止めず主ループで少量ずつ送り、待機分は最新1件だけ。切断では送受信途中行を捨て、再接続でサービス・Characteristicを取り直し完全な行から再送する。
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
- Include the entire controls catalog in every status: speed:boolean, modes:1–8 items, actions:0–8 items. Each {id,label} uses an ID matching ^[A-Z][A-Z0-9_]{0,11}$, unique within its list. Reserved: OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTION. Labels are plain text of 1–24 Unicode code points without control characters. Keep device-provided labels in the program language, not HTML or commands; the browser must not translate them when its language changes.
- MODE <id> selects and resets that mode, then plays. PLAY resumes the saved phase when paused, or plays the selected mode when off. PAUSE freezes animation/fade-in progress and retains the currently displayed color and phase. OFF starts the 200ms fade-out below while retaining the selected mode. Keep the program and BLE running. STATUS only reports state.
- ACTION <id> runs once without blocking. Save the base mode, phase and playback from before the first action as the return state, and restore it after the final action completes: restore the frozen phase if originally paused, or darkness if off. Restarting or replacing an action must not overwrite this return state.
- Accept valid additional ACTION commands immediately while active: restart the same ID or replace it with a different ID. Switch to the latest request; never build an effect-execution backlog. Invalid or unregistered IDs leave the current action, transition and return state unchanged.
- For a restart or replacement, snapshot every LED's last actually transmitted RGB output and interpolate nonblockingly from it to the new effect over a finite duration. The bundled candidate uses 200ms; adapt the transition naturally to the artwork's effect specification. A retrigger during interpolation starts from the latest actual output too, without abruptly going black or resetting the base mode. Never apply brightness factors twice to already safety-capped output; keep the target and every intermediate output within the safety cap. Use time.ticks_ms()/time.ticks_diff(), without long sleeps that block reception or LED updates.
- MODE/PLAY/PAUSE/OFF interrupt both the action and restart interpolation. PLAY resumes the base mode; PAUSE holds the frame actually visible at interruption, even mid-interpolation. Store the held frame separately from the base mode phase to resume when needed. Preserve the 200ms OFF fade-out, minimum 200ms OFF-to-ON fade-in, and immediate extinction for startup, exceptions and safety shutdown.
- Report applied brightness/speed as integers 0–100. BRIGHTNESS 100 is 100% of the configured safety cap; keep the cap on every output. Zero retains the mode. Changing brightness while paused scales the current frame without advancing its phase. Brightness/speed changes while off do not light LEDs. With controls.speed=false hide the slider and ignore SPEED on the device; otherwise 0 is slowest, not stopped, and 100 is fastest. Standard period_ms = 3000 - 29 * n.
- Startup defaults: playback=off, action=null, brightness=100, speed=0, mode=first defined mode. In v2 the fixed fade rule's current mode OFF means playback=off. Startup/PLAY/MODE/ACTION from off with all-zero output must fade in nonblockingly for at least 200ms. Do not restart for changes while lit or a temporary black frame; preserve fade progress during mode changes.
- pixels concatenates RRGGBB for every RGB LED, 1–300 LEDs without omissions, converting the last transmitted, cap/brightness/fade-adjusted GRB buffer back to RGB. It reports transmitted output, not target colors or measured physical light. Each UTF-8 line is at most 4096 bytes excluding LF; count encoded bytes, not characters.
- Split Notify into at most 20 bytes per chunk. Unicode characters may cross chunks: the browser reassembles bytes to LF before decoding. Finish one frozen snapshot before the next. Send incrementally from the main loop without blocking LEDs/buttons; keep only the newest pending snapshot. Discard partial RX/TX on disconnect; rediscover services/characteristics and restart a complete line after reconnect.
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
- 每次状态都包含完整 controls：speed 为 boolean，modes 为 1–8 项，actions 为 0–8 项。各 {id,label} 的 id 匹配 ^[A-Z][A-Z0-9_]{0,11}$，同一列表内不重复。保留字为 OFF/PLAY/PAUSE/STATUS/BRIGHTNESS/SPEED/MODE/ACTION。label 为不含控制字符的 1–24 个 Unicode 码点的纯文本。设备名称使用程序语言，不能当成 HTML 或命令；浏览器切换语言时不翻译这些名称。
- MODE <id> 选择并重置模式，然后播放。PLAY 从暂停保存的相位继续，或在 off 时播放所选模式。PAUSE 冻结动画及渐亮进度，保留当前显示颜色和相位。OFF 按下述规则开始 200ms 渐暗，保持所选模式。程序和 BLE 继续运行。STATUS 仅报告状态。
- ACTION <id> 非阻塞执行一次。将首次动作开始前的基础模式、相位和 playback 保存为恢复状态，最后一个动作结束后恢复；原先为 paused 时恢复冻结相位，为 off 时恢复熄灭。重新开始或替换动作时不能覆盖该恢复状态。
- 动作执行中也立即接受有效的额外 ACTION：相同 ID 重新开始，不同 ID 替换当前动作。切换到最新请求，不建立等待执行的演出队列。无效或未登记 ID 不改变当前动作、过渡或恢复状态。
- 重新开始或替换时，以全部 LED 最后实际发送的 RGB 输出为衔接起点，在有限时间内非阻塞插值到新效果。内置候选程序使用 200ms，作品可按演出规格自然衔接。插值中再次按下也从最新实际输出衔接，不能突然变黑或重置基础模式。不要对已应用安全上限的输出重复乘以亮度系数，目标和全部中间输出仍保持安全上限。使用 time.ticks_ms()/time.ticks_diff()，不以长时间 sleep 阻塞接收或 LED 更新。
- MODE/PLAY/PAUSE/OFF 中断动作及重新开始的插值。PLAY 恢复基础模式；PAUSE 即使在插值中也保留中断时实际看到的画面。必要时将保留画面与待恢复的基础模式相位分开保存。保持 OFF 的 200ms 渐暗、OFF 到点亮至少 200ms 的渐亮，以及启动、异常和安全停止的立即熄灭。
- brightness/speed 报告已应用的 0–100 整数。BRIGHTNESS 100 是设置安全上限的 100%，全部输出保持上限，0 不改变所选模式。暂停中调整亮度只缩放当前画面，不推进相位。off 时调整亮度或速度不点亮。controls.speed=false 时浏览器隐藏速度，设备忽略 SPEED；为 true 时 0 最慢但不停，100 最快，标准 period_ms = 3000 - 29 * n。
- 默认启动为 playback=off、action=null、brightness=100、speed=0，mode 为第一个已定义模式。v2 中固定渐变规则的“当前模式 OFF”应解释为 playback=off。启动、PLAY、MODE、ACTION 从 off 且全零输出点亮时，必须非阻塞渐亮至少 200ms。已亮时变化或动画临时黑帧不重新开始，切换模式时保持正在进行的渐变进度。
- pixels 将 1–300 个 RGB LED 的全部 RRGGBB 连接，不省略。将最后实际发送且已应用安全上限、亮度、渐变的 GRB 缓冲区转回 RGB，报告已发送输出而非目标颜色或物理发光测量值。每行 UTF-8 编码后不含 LF 最多 4096 字节，按字节而非字符计数。
- 每次 Notify 分片最多 20 字节。Unicode 字符可跨片，浏览器按字节拼接至 LF 后解码。同一固定快照整行发完再发下一行。主循环分步发送，不阻塞 LED 或按钮；待发送仅保留最新一条。断开时丢弃未完成收发行，重连重新获取服务和特征，从完整新行开始。
- 先订阅 TX 再发送 STATUS，首次有效状态前只允许 OFF。STATUS、命令应用、按钮变化、动作开始、重新开始、替换及结束时通知；不变时也约每秒通知，最多 5 次/秒，慢链路可延长周期。无效或超长 JSON 不覆盖当前状态，明确提示未收到或已过期状态。
- 发送完成与执行确认不同：v2 没有请求 ID ACK。不能将写入响应称为动作成功或完成，只显示设备报告的当前 action。短动作未被通知观察到时，也不能推断成功。
${remoteOffFadeRules.zh}`,
}

export const localizedPromptBlocks: Record<Exclude<Locale, 'ja'>, { led: string; ble: string; nanoLed: string; information: string }> = {
  en: {
    led: `## Fixed LED and button rules
- External LEDs use the configured GPIO{ledPin}. Initialize machine.Pin(LED_PIN, machine.Pin.OUT). Default GPIO2 is Grove G2. If changed, verify wiring and GPIO output support without conflicting with USB, onboard LEDs or buttons. Check power requirements and maintain a common ground.
- If the onboard button is enabled, use GPIO{buttonPin}, active LOW (pressed LOW, released HIGH), optionally machine.Pin.PULL_UP. Read it in the main loop with approximately 40ms debounce. Do not replace it with M5.BtnA or a guessed board API. Do not add button operations when the button feature is disabled.
- {onboardRule}
- Use import machine and import time as the basis. Do not import neopixel. Use machine.bitstream() and bytearray for LED output.
- BITSTREAM_TIMING = 1 is only a fixed 800kHz label. Keep encoding=0 and WS2812_TIMING_NS = (400, 850, 800, 450), in nanoseconds, ordered T0H,T0L,T1H,T1L.
- Build one complete frame in bytearray(LED_COUNT * LED_BPP), then send machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer). Never pass the numeric 1 as the third argument. Do not send one LED at a time.
- Specify colors as RGB but store the buffer as GRB. At offset = led_index * LED_BPP, store green, red, blue. Follow each transmission with approximately time.sleep_us(80) for reset.
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
- For MTU23, split Notify into chunks of at most 20 bytes; put LF in the last chunk. Keep one snapshot fixed until its whole line is sent; never mix snapshots. Send small amounts from the main loop without blocking LEDs, buttons or commands. Bound pending sends and retries.
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
- 颜色使用 RGB 表示，发送缓冲区使用 GRB。offset = led_index * LED_BPP，依次存储 green、red、blue。每次发送后使用约 time.sleep_us(80) 的复位等待。
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
- 为兼容 MTU23，每次 Notify 最多 20 字节，LF 位于最后一个分片。整行发送期间固定同一快照，不混入其他快照。从主循环少量发送，不阻塞 LED、按钮和命令处理；待发送及重试必须有界。
- STATUS、命令应用和可用按钮状态变化时通知最新状态；无变化也约每秒通知一次，最多每秒 5 个快照。通信慢时延长周期。完成正在发送的整行，待发送仅保留最新一份，不能在行中途替换 JSON。
- 断开时丢弃发送和接收的半行。重连及重新订阅通知后，从完整新行开始。浏览器丢弃旧 GATT 对象并重新获取服务和特征。
- 浏览器按 LF 分行，而非 Notify 边界。无效 JSON 或超长行不能覆盖状态。明确提示未收到或停止更新，不能仅根据发送的设置改变 LED 预览。
${remoteOffFadeRules.zh}`,
    information: `## 信息处理
优先级为固定规范、经实机验证的基准代码、M5Stack 和 MicroPython 官方资料、一般知识。规范与基准代码存在实质矛盾时，不要擅自修正，应暂停相关功能并请用户在目标实机上确认。无法读取外部页面时不能假装已读。本提示词已包含必要信息，不依赖外部页面获取、重新初始设置或再次粘贴 URL。不要切换到 Arduino、C++、CircuitPython 或电脑用 Python。`,
  },
}

export const interpolatePrompt = (text: string, values: Record<string, string | number>) => text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match)
