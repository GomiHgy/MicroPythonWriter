import type { Locale } from '../../i18n/types'

// 初回準備文と、設定情報のない場合を含む修正依頼文で送信方針を共有する。
// 既存の作品・登録基準コード・実機確認記録自体を書き換える機能ではない。
const rules: Record<Locale, string> = {
  ja: `## LED送信のちらつき抑制
- 同じ表示の不要な再送を減らす。対象は既存のLED送信処理であり、作品の色・明るさ・速さ・繰り返し回数・起動状態・GPIO・実接続LED数・RGB/BPP=3・最大輝度を維持する。NanoC6とAtomS3Liteの設定を混同せず、LED_COUNTへ2を加えたり特定の個数・輝度へ固定したりしない。
- 次フレームのnext_frameと最終送信済みのlast_sent_frameは、それぞれ全LED分のbytearray(LED_COUNT * LED_BPP)として初期化時に別々に確保し再利用する。最大輝度・利用者の明るさ・フェード・補間・消灯をすべて適用した最終GRBバイト列で比較する。有効なlast_sent_frameと一致し、force=Trueでなければbitstreamと前後の待ちだけを省略する。
- 設定部にLED_RESET_US = 350を置く。実送信はGPIOをLOW → time.sleep_us(LED_RESET_US) → machine.bitstream(led_pin, 0, WS2812_TIMING_NS, next_frame)で全LEDを1回送信 → GPIOをLOW → time.sleep_us(LED_RESET_US)。encoding=0、WS2812_TIMING_NS = (400, 850, 800, 450)を維持し、第3引数にBITSTREAM_TIMING=1を渡さない。部分送信やLED単位の送信にしない。
- bitstreamと後段のLOW待ちが正常完了してからlast_sent_frame[:] = next_frameで確保済み領域へコピーし、有効にする。参照の代入で両バッファを共有しない。途中で送信・LOW・待機が失敗したら最終送信済みデータを更新せずキャッシュを無効化し、可能な限り信号をLOWへ戻して既存の安全停止・エラー経路へ渡す。例外を握り潰した成功扱い・無制限再試行は禁止。
- 初期キャッシュは無効とし、両バッファが0でも起動時の全消灯を必ず実送信する。起動・安全停止・例外・KeyboardInterrupt時の消灯はforce=True相当で省略させない。無効なキャッシュとの一致でも送信する。強制送信は作品の通常の起動状態を変更する理由にはしない。
- 静止した表示の不要な再描画は安全に判定できる場合だけ省く。連続演出や判定が難しい場合は正しい描画を続け、最終バイト比較で送信だけを省く。主ループ全体をreturnしない。time.ticks_ms()/time.ticks_diff()による折り返し対応の時計で、位相・回数・ACTION完了・フェード完了・入力処理を送信回数から独立して進める。一律のFPS制限・200ms更新制限は加えない。
- 明るさ0や量子化で出力が同じでもplayingなら論理状態を進め、pausedなら従来どおり止める。基準色・output_reference・復帰位相は必要に応じて更新する。PAUSE、ACTION再押下補間、OFFに必要な固定スナップショットを作業バッファと共有しない。OFFは最後にソフトウェア送信を正常完了した出力から始め、描画途中の値を使ったり輝度を二重適用したりしない。
- 最低200msのOFF→ONフェード、Web OFFの200msフェードアウト、進行中のフェード、ACTION再押下の作品ごとの明示仕様・補間・復帰先、PAUSE中の出力を維持する。LEDの変更フラグとBLE通知要求を分離し、同じ色でもMODE・PAUSE・ACTION・STATUSや約1秒周期の通知を止めない。既存のBLE初期化・広告・UUID・コマンド・有界送受信・切断と再接続を変えず、無効な機能を追加しない。
- pixelsは目標値や次フレームでなく、最後にソフトウェア送信を正常完了したlast_sent_frameからRGB順へ戻して全LED分を報告する。「最終送信済み」は物理発光の測定ではなく、信号異常やLEDの独立した電源リセットを検出する保証もない。
- 可能な範囲でLEDごとのbytes((g,r,b))を再利用bytearrayへの直接代入へ変え、大きなフレームごとの割り当てを減らす。ただし演出エンジン全体の置換、必要な復帰データの削除、neopixel・外部ライブラリ・別ファームウェア・独自RMTへの置換、BLE/Wi-Fiの無断無効化、全体的な割り込み禁止、スレッド追加、長いsleep、毎フレームのgc.collect()を対策にしない。
- 350µsは今回採用する候補値であり、全WS2812系列・全機種・全配線での保証値ではない。NanoC6 / UIFlow2 v2.5.3 / WS2812B-MINIの一作品での利用者の改善観察は、各対策の寄与・原因・他構成を実証していない。同梱候補の更新や模擬テストだけで実機確認済みにしない。
- 修正は記録された利用者のmain.pyを対象とし、演出を同梱サンプルへ置き換えない。実行コードが未取得なら修正対象を推測しない。登録基準コード・保存作品・実機確認記録は自動改変しない。新ルールと登録基準コードが衝突したら差分と再確認が必要な範囲を示し、既存の確認状態管理を尊重して該当機能の確定を保留する。旧コードを変えずに新対策適用済みと言わない。
- Webアプリ更新だけでは機器の既存main.pyは変わらない。対応コードの再準備→利用者による明示的な書き込み・実行→実物確認を案内し、自動書き込み・自動実行・自動起動設定変更をしない。実機ではBLE未接続/接続中、低輝度/上限輝度、連続アニメーション・短い点滅・OFF/PLAY・再接続・停止後の再実行を確認し、電源・配線・信号・ファームウェアの未確認事項を残す。`,
  en: `## LED transmission flicker reduction
- Reduce unnecessary retransmission of unchanged light output. Apply this to existing LED output while preserving artwork colors, brightness, speed, repeat count, startup state, GPIOs, actual LED count, RGB/BPP=3 and the configured brightness cap. Keep NanoC6 and AtomS3Lite settings distinct; do not add 2 to LED_COUNT or hard-code one LED count or brightness.
- Allocate distinct reusable next_frame and last_sent_frame bytearrays at initialization, each bytearray(LED_COUNT * LED_BPP). Compare the final GRB bytes after every maximum/user brightness, fade, interpolation and OFF transformation. If last_sent_frame is valid and identical and force=True is not requested, skip only bitstream and its surrounding waits.
- Define LED_RESET_US = 350 in settings. For a real send: GPIO LOW → time.sleep_us(LED_RESET_US) → one machine.bitstream(led_pin, 0, WS2812_TIMING_NS, next_frame) for every LED → GPIO LOW → time.sleep_us(LED_RESET_US). Preserve encoding=0 and WS2812_TIMING_NS = (400, 850, 800, 450); never pass BITSTREAM_TIMING=1 as the third argument. Do not send partial frames or individual LEDs.
- Only after bitstream and the trailing LOW hold complete successfully, copy into the existing storage with last_sent_frame[:] = next_frame and mark the cache valid. Never alias the buffers. On any send, LOW or wait failure, leave the last-sent bytes unchanged, invalidate the cache, attempt to return the signal LOW and propagate to the existing safety/error path. Do not swallow errors as success or retry without bounds.
- Start with an invalid cache: startup black must be physically transmitted even when both buffers contain zeros. Force startup, safety-stop, exception and KeyboardInterrupt black frames with force=True or equivalent. An invalid cache must not suppress an identical frame. Forced output is not permission to change the artwork's normal startup state.
- Skip redraw of static output only when safe to determine; keep correct rendering for dynamic or hard-to-classify effects and optimize only transmission. Never return from the entire main loop for unchanged output. Use wrap-safe time.ticks_ms()/time.ticks_diff() rather than send counts for phase, repeat counts, ACTION/fade completion and input handling. Do not introduce a blanket FPS cap or 200ms refresh limit.
- At brightness zero or during quantization, continue logical progression while playing and preserve existing freezing while paused. Update reference colors, output_reference and return phase as needed even without sending. PAUSE, ACTION-retrigger interpolation and OFF snapshots must not alias a work buffer. OFF starts from the last successfully software-sent output, never a partially rendered frame or values with brightness applied twice.
- Preserve the minimum 200ms OFF-to-ON fade, 200ms web OFF fade-out, ongoing fades, artwork-specific explicit repeated-ACTION policy/interpolation/return target, and PAUSE output. Separate LED-dirty from BLE-notification requests: identical colors must not suppress MODE, PAUSE, ACTION, STATUS or approximately once-per-second notifications. Retain existing BLE initialization, advertising, UUIDs, commands, bounded I/O and disconnect/reconnect behavior; do not add disabled features.
- Report every LED in pixels by converting the last successfully software-sent last_sent_frame to RGB, not target colors or next_frame. Last sent is not measured physical light and does not guarantee detection of signal faults or an independent LED power reset.
- Where practical, replace per-LED bytes((g,r,b)) allocation with direct assignments into a reusable bytearray and reduce large per-frame allocations. Do not replace the whole effects engine, remove required return data, switch to neopixel/external libraries/another firmware/custom RMT, disable BLE/Wi-Fi without permission, globally disable interrupts, add threads or long sleeps, or call gc.collect() every frame.
- 350µs is a candidate value, not a guarantee for all WS2812 variants, devices or wiring. The user's improvement observation on one NanoC6 / UIFlow2 v2.5.3 / WS2812B-MINI artwork does not establish individual contributions, cause or results on other configurations. Updated bundled candidates and simulated tests remain unverified on hardware.
- Repair the captured user main.py; do not replace its effects with a bundled sample. If executed source is unavailable, do not guess the repair target. Never automatically modify registered baselines, saved artwork or verification records. If a registered baseline conflicts with these rules, explain the differences and required revalidation, respect the existing verification lifecycle and defer finalizing the affected feature. Never call unchanged old code mitigation-applied.
- Updating the Web app does not change an existing device main.py. Guide users through preparing updated code, explicitly writing/running it, then checking actual LEDs; do not automatically write, run or change startup settings. Hardware checks must include BLE disconnected/connected, low/capped brightness, continuous animation, short blinks, OFF/PLAY, reconnect and rerun after stopping. Retain unresolved power, wiring, signal and firmware questions.`,
  zh: `## 减少 LED 发送闪烁
- 减少相同显示的不必要重复发送。仅优化现有 LED 输出，保持作品颜色、亮度、速度、重复次数、启动状态、GPIO、实际 LED 数量、RGB/BPP=3 及设定的亮度上限。区分 NanoC6 和 AtomS3Lite 的设置，不能给 LED_COUNT 加 2，也不能固定为某个数量或亮度。
- 初始化时分别分配 next_frame 和 last_sent_frame，均为 bytearray(LED_COUNT * LED_BPP)，独立且重复使用。应用最大/用户亮度、渐变、插值及熄灭后，比较最终 GRB 字节。仅当 last_sent_frame 有效且相同、并非 force=True 时，跳过 bitstream 和前后等待。
- 在设置区定义 LED_RESET_US = 350。实际发送顺序为：GPIO LOW → time.sleep_us(LED_RESET_US) → 一次 machine.bitstream(led_pin, 0, WS2812_TIMING_NS, next_frame) 发送所有 LED → GPIO LOW → time.sleep_us(LED_RESET_US)。保持 encoding=0 和 WS2812_TIMING_NS = (400, 850, 800, 450)，第三个参数不能使用 BITSTREAM_TIMING=1。不能发送局部帧或逐颗 LED 发送。
- 只有 bitstream 和发送后的 LOW 等待都正常完成，才用 last_sent_frame[:] = next_frame 复制到已有存储并标记有效。两个缓冲区不能引用同一对象。发送、LOW 或等待出错时不更新最后发送数据，令缓存失效，尽可能将信号恢复 LOW，然后交给原有安全停止/错误路径。不能吞掉异常当作成功，也不能无限重试。
- 初始缓存无效，即使两个缓冲区全为 0，启动时也必须实际发送全黑。启动、安全停止、异常及 KeyboardInterrupt 的熄灭使用 force=True 或等效强制发送。缓存失效时即使相同也要发送。强制发送不是改变作品正常启动状态的理由。
- 仅在能安全判断时省略静态画面的重复绘制；动态或难判断的效果保持正确绘制，只优化发送。不能因为输出相同就 return 整个主循环。用处理时钟回绕的 time.ticks_ms()/time.ticks_diff()，而非发送次数，推进相位、次数、ACTION/渐变完成及输入处理。不能增加统一 FPS 限制或 200ms 刷新限制。
- 亮度为 0 或量化导致输出相同时，playing 仍推进逻辑，paused 按原样冻结。没有发送也要按需更新基准色、output_reference 和恢复相位。PAUSE、ACTION 再触发插值及 OFF 的固定快照不能与工作缓冲区共用。OFF 从最后一次软件发送正常完成的输出开始，不能使用绘制中间数据或重复应用亮度。
- 保持至少 200ms 的 OFF→ON 渐亮、网页 OFF 的 200ms 渐暗、进行中的渐变、作品明确指定的重复 ACTION 规则/插值/恢复目标，以及 PAUSE 输出。LED 变化标记与 BLE 通知请求分离，相同颜色不能阻止 MODE、PAUSE、ACTION、STATUS 或约每秒一次的通知。保持原有 BLE 初始化、广播、UUID、命令、有界收发及断开/重连行为，不添加已禁用功能。
- pixels 从最后一次软件发送正常完成的 last_sent_frame 还原为 RGB，报告所有 LED，不使用目标色或 next_frame。最后发送不代表测量了实际发光，也不保证检测信号异常或 LED 独立电源重启。
- 可行时，将逐颗 LED 的 bytes((g,r,b)) 改为直接写入重复使用的 bytearray，减少每帧的大量分配。不要整体替换效果引擎或删除必要的恢复数据，也不要改用 neopixel、外部库、其他固件或自定义 RMT。不能擅自关闭 BLE/Wi-Fi、全局禁用中断、新增线程、长时间 sleep 或每帧 gc.collect()。
- 350µs 是本次采用的候选值，不保证适用于所有 WS2812 型号、设备或接线。用户在一个 NanoC6 / UIFlow2 v2.5.3 / WS2812B-MINI 作品中观察到改善，不代表已验证各措施贡献、原因或其他配置。更新后的内置候选代码及模拟测试仍不是实机验证。
- 修复对象是已记录的用户 main.py，不用内置示例替换作品效果。未取得实际运行源码时不能猜测修复对象。不能自动修改登记基准代码、已保存作品或验证记录。如果基准代码与新规则冲突，说明差异和需要重新验证的范围，尊重原有验证状态管理，暂缓确定受影响功能。旧代码未变更时不能宣称已应用新措施。
- 更新网页应用不会改变设备已有的 main.py。引导用户重新准备对应代码、明确写入/运行、然后检查实物 LED；不能自动写入、运行或更改启动设置。实机确认包括 BLE 未连接/已连接、低亮度/上限亮度、连续动画、短闪、OFF/PLAY、重连、停止后重运行；保留电源、接线、信号及固件方面未确认的事项。`,
}

export function buildLedTransmissionRules(locale: Locale): string {
  return rules[locale]
}
