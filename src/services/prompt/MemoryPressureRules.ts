import type { BaseLocale, Locale } from '../../i18n/types'
import { basePromptLocale } from '../../i18n/locales'

// 初回準備・コピー/保存・修正依頼で同じ対策を共有する。実測値を必要容量の閾値にしない。
const generalRules: Record<BaseLocale, string> = {
  ja: `## メモリ圧迫を防ぐ実装と確認
- 作品の演出・タイミング・ACTION再押下の明示仕様、GPIO、LED数、最大輝度、通信仕様を維持したまま、メモリ使用量を抑える。対策のために機能を削除したり、BLEやWi-Fiを無断で無効にしたりしない。
- LEDのbytearrayは初期化時に必要量だけ確保し再利用する。フレームごとの大きなリスト・辞書・文字列の作り直し、巨大な事前計算済み演出表、無制限の履歴・ログ・キューを避ける。演出に必要な現在値・復帰値や送信中の固定スナップショットは保持し、再利用で進行中の内容を壊さない。
- 同じ演出や処理を共通化し、不要なimport・コード全文の埋め込み・read()/exec()/compile()による全文の多重保持や再コンパイルを避ける。一時データは使用後に参照を残さない。コード全文の省略や機能削除で小さくしない。
- 全モード分の全フレームを事前生成して保持せず、現在の位相・時刻・色を中心に持つ。PAUSEの表示保持、OFF、クロスフェード、ACTION中断・再実行・復帰に必要な固定スナップショットや基準値まで削除しない。
- gc.collect()は不要なPythonオブジェクトの回収を補助するだけで、ネイティブ側のメモリ不足やクラッシュを必ず直せるとは説明しない。毎フレームの強制回収、新たな長い待ち時間、スレッド追加を対策にしない。
- 出力時に「メモリ圧迫を減らすために行ったこと」と「実機未確認の項目」を短く示す。通常の利用者には準備→実行→実物確認の流れを案内し、ヒープ解析や基準コードの実装を必須にしない。`,
  en: `## Memory-pressure prevention and verification
- Reduce memory use while preserving the artwork's effects, timing, explicit repeated-ACTION policy, GPIOs, LED count, maximum brightness and protocol. Do not remove features or disable BLE or Wi-Fi without permission as a workaround.
- Allocate only the needed LED bytearray at initialization and reuse it. Avoid rebuilding large lists, dictionaries or strings every frame, giant precomputed effect tables, and unbounded history, logs or queues. Preserve required current/return state and the fixed snapshot being transmitted; buffer reuse must not corrupt work in progress.
- Share common effect logic. Avoid unnecessary imports, embedded copies of the whole program, and retaining or recompiling full source repeatedly with read()/exec()/compile(). Release references to temporary data after use. Do not shrink output by omitting source or removing features.
- Do not precompute and retain every frame for every mode; mainly store the current phase, time and color. Keep the fixed snapshots/reference values required for PAUSE display retention, OFF, crossfades, and ACTION interruption/retrigger/return.
- gc.collect() only helps reclaim unused Python objects; it does not guarantee a fix for native memory shortages or crashes. Do not force collection every frame, add long waits or introduce threads as a workaround.
- Briefly state the memory-pressure measures taken and what remains untested on hardware. Guide beginners through prepare, run and check the actual device; do not require heap analysis or baseline implementation for normal use.`,
  zh: `## 防止内存压力的实现与验证
- 在保持作品效果、时序、明确指定的重复 ACTION 规则、GPIO、LED 数量、最大亮度及通信协议的前提下减少内存占用。不能为了绕过问题而删除功能或擅自关闭 BLE、Wi-Fi。
- LED bytearray 在初始化时只分配所需大小并重复使用。避免每帧重建大型列表、字典或字符串，避免巨大的预计算效果表及无界的历史、日志、队列。保留效果需要的当前值、恢复值及正在发送的固定快照，复用缓冲区不能破坏进行中的内容。
- 共用相同效果的逻辑，避免无用 import、内嵌整份程序，以及通过 read()/exec()/compile() 多次保留或重新编译完整源码。临时数据用完后不再保留引用，不能靠省略源码或删除功能缩小代码。
- 不预先生成并保留所有模式的全部帧，以当前相位、时刻及颜色为主。不能删除 PAUSE 画面保持、OFF、交叉渐变、ACTION 中断/重启/恢复所需的固定快照和基准值。
- gc.collect() 仅帮助回收不再使用的 Python 对象，不能保证解决原生内存不足或崩溃。不能每帧强制回收，也不要为此新增长时间等待或线程。
- 输出时简短说明为减少内存压力采取的措施和未实机验证的项目。一般用户按准备、运行、确认实物的流程操作，不要求先分析堆内存或实现基准代码。`,
}

const bleRules: Record<BaseLocale, string> = {
  ja: `### BLEを使う場合のメモリ上の注意
- NanoLED v2使用時はmodes/actionsのID・ラベルと固定controlsを初期化時に構築して再利用し、通知ごとに大きな辞書・リストを作り直さない。ただし毎回のSTATUSへcontrols全体を含める仕様は維持する。初回だけの送信へ変えず、共有オブジェクトの変更で送信中の固定スナップショットを壊さない。NanoLED未使用ならこのために追加しない。
- 通知は送信中の1行と待機最新1件まで。新しい待機状態は古い待機分だけを置き換え、送信中の行を変更しない。Notifyサイズが拡大してもキューやBLEバッファを無条件に増やさない。ログも無制限に出力・保持しない。
- NanoLEDのJSONはLFを除くUTF-8で4096バイト以下、pixelsは全LED分を維持する。v2のボタンが16個以内でも、日本語・絵文字・長いラベル・LED数の組合せをエンコード後バイト数で別途検証する。超過時は名前の短縮等を利用者と相談し、ボタンやpixelsを黙って省略・切り詰めない。16個以内ならRAM不足は起きないとは保証しない。
- Pythonのgc.mem_free()だけでBLE内部の空き容量を判断しない。ESP32系で調査が必要な場合は対象ファームウェアでAPIの有無を確認し、esp32.idf_heap_info(esp32.HEAP_DATA)の各領域の空き・最大連続領域も比較する。単一のログから原因を断定したり、特定の空きバイト数を全機器共通の安全閾値にしたりしない。
- BLE有効化などのネイティブ側panicや再起動はPythonのtry/exceptで必ず捕捉できるものではない。失敗を握りつぶして成功扱いせず、無制限の再初期化をしない。BLE初期化方法・順序の変更は実機確認なしに一般解として押し付けない。
- 受信・再試行を有界にする。停止時は可能な範囲でLEDと所有するBLEリソースを後始末し、切断時の途中データを破棄する。対象機種・UIFlow2版で、作品全体の起動、BLE接続・操作・切断・再接続、停止後の再実行を確認する。静的確認だけを実機成功としない。`,
  en: `### Memory considerations when BLE is used
- For NanoLED v2, build modes/actions IDs, labels and fixed controls at initialization and reuse them instead of rebuilding large dictionaries/lists for every notification. Still include all controls in every STATUS, not only the first one. Mutating shared objects must not corrupt the frozen in-flight snapshot. Do not introduce NanoLED where it is not used.
- Keep one line in flight and at most one latest pending state. New pending state replaces only the older pending state, never the in-flight line. Larger Notify chunks do not justify unconditionally enlarging queues or BLE buffers. Bound log retention and output too.
- NanoLED JSON remains at most 4096 UTF-8 bytes excluding LF, retaining pixels for every LED. Even within 16 v2 buttons, independently validate encoded byte size for Japanese/emoji/long labels and the LED count. If oversized, discuss shorter names or other feasible choices; never silently omit or truncate buttons or pixels. Do not guarantee that at most 16 controls prevents RAM exhaustion.
- gc.mem_free() alone does not establish memory available to BLE internals. If ESP32 investigation is needed, check API availability on the target firmware and also compare free space and largest free blocks per region using esp32.idf_heap_info(esp32.HEAP_DATA). Do not diagnose the cause from one log or treat a particular free-byte count as a universal safety threshold.
- Native panics or resets during BLE activation are not guaranteed to be caught by Python try/except. Do not swallow failures, claim success or retry initialization without bounds. Do not present changes to BLE initialization method or order as a general fix without hardware verification.
- Bound receive data and retries. On termination, clean up LEDs and owned BLE resources where possible; discard partial data on disconnect. On the target board and UIFlow2 version, verify full-artwork startup, BLE connection, commands, disconnect/reconnect and running again after stopping. Static checks are not hardware success.`,
  zh: `### 使用 BLE 时的内存注意事项
- NanoLED v2 的 modes/actions ID、名称及固定 controls 在初始化时构建并复用，不在每次通知重建大型字典/列表。但每个 STATUS 仍须包含完整 controls，不改成仅首次发送；修改共享对象不能破坏正在发送的固定快照。未使用 NanoLED 时不能为此添加它。
- 仅保留正在发送的一行及最多一份最新待发送状态，新状态只替换旧待发送状态，不能修改正在发送的行。Notify 片段增大不等于可以无条件增大队列或 BLE 缓冲区，日志输出和保留也必须有界。
- NanoLED JSON 不含 LF 最多 4096 个 UTF-8 字节，保留全部 LED 的 pixels。即使 v2 按钮不超过 16 个，也要独立按编码后的字节数验证日文、表情符号、长名称及 LED 数量的组合。超限时与用户商量缩短名称等方案，不能静默省略或截断按钮或 pixels，也不能保证 16 个以内就不会内存不足。
- 不能只根据 gc.mem_free() 判断 BLE 内部可用内存。需要排查 ESP32 时，先确认目标固件是否提供 API，再用 esp32.idf_heap_info(esp32.HEAP_DATA) 比较各区域的空闲空间及最大连续空闲块。不能根据单份日志断定原因，也不能将某个空闲字节数当作所有设备通用的安全阈值。
- BLE 启用期间原生层的 panic 或重启不保证能被 Python try/except 捕获。不要吞掉失败并宣称成功，也不能无限重试初始化。未经实机验证，不把改变 BLE 初始化方式或顺序当作通用修复。
- 接收及重试必须有界。停止时尽可能清理 LED 及自身持有的 BLE 资源，断开时丢弃未完成的数据。在目标设备及 UIFlow2 版本上验证完整作品启动、BLE 连接与操作、断开与重连、停止后重新运行。静态检查不代表实机成功。`,
}

export function buildMemoryPressureRules(locale: Locale, includeBle: boolean): string {
  const base = basePromptLocale(locale)
  return generalRules[base] + (includeBle ? `\n\n${bleRules[base]}` : '')
}
