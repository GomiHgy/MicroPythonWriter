import type { Locale } from '../../i18n/types'

// 初回準備・コピー/保存・修正依頼で同じ対策を共有する。実測値を必要容量の閾値にしない。
const generalRules: Record<Locale, string> = {
  ja: `## メモリ圧迫を防ぐ実装と確認
- 作品の演出・タイミング・ACTION再押下の明示仕様、GPIO、LED数、最大輝度、通信仕様を維持したまま、メモリ使用量を抑える。対策のために機能を削除したり、BLEやWi-Fiを無断で無効にしたりしない。
- LEDのbytearrayは初期化時に必要量だけ確保し再利用する。フレームごとの大きなリスト・辞書・文字列の作り直し、巨大な事前計算済み演出表、無制限の履歴・ログ・キューを避ける。演出に必要な現在値・復帰値や送信中の固定スナップショットは保持し、再利用で進行中の内容を壊さない。
- 同じ演出や処理を共通化し、不要なimport・コード全文の埋め込み・read()/exec()/compile()による全文の多重保持や再コンパイルを避ける。一時データは使用後に参照を残さない。コード全文の省略や機能削除で小さくしない。
- gc.collect()は不要なPythonオブジェクトの回収を補助するだけで、ネイティブ側のメモリ不足やクラッシュを必ず直せるとは説明しない。毎フレームの強制回収や新たな長い待ち時間を対策にしない。
- 出力時に「メモリ圧迫を減らすために行ったこと」と「実機未確認の項目」を短く示す。通常の利用者には準備→実行→実物確認の流れを案内し、ヒープ解析や基準コードの実装を必須にしない。`,
  en: `## Memory-pressure prevention and verification
- Reduce memory use while preserving the artwork's effects, timing, explicit repeated-ACTION policy, GPIOs, LED count, maximum brightness and protocol. Do not remove features or disable BLE or Wi-Fi without permission as a workaround.
- Allocate only the needed LED bytearray at initialization and reuse it. Avoid rebuilding large lists, dictionaries or strings every frame, giant precomputed effect tables, and unbounded history, logs or queues. Preserve required current/return state and the fixed snapshot being transmitted; buffer reuse must not corrupt work in progress.
- Share common effect logic. Avoid unnecessary imports, embedded copies of the whole program, and retaining or recompiling full source repeatedly with read()/exec()/compile(). Release references to temporary data after use. Do not shrink output by omitting source or removing features.
- gc.collect() only helps reclaim unused Python objects; it does not guarantee a fix for native memory shortages or crashes. Do not force collection every frame or add long waits as a workaround.
- Briefly state the memory-pressure measures taken and what remains untested on hardware. Guide beginners through prepare, run and check the actual device; do not require heap analysis or baseline implementation for normal use.`,
  zh: `## 防止内存压力的实现与验证
- 在保持作品效果、时序、明确指定的重复 ACTION 规则、GPIO、LED 数量、最大亮度及通信协议的前提下减少内存占用。不能为了绕过问题而删除功能或擅自关闭 BLE、Wi-Fi。
- LED bytearray 在初始化时只分配所需大小并重复使用。避免每帧重建大型列表、字典或字符串，避免巨大的预计算效果表及无界的历史、日志、队列。保留效果需要的当前值、恢复值及正在发送的固定快照，复用缓冲区不能破坏进行中的内容。
- 共用相同效果的逻辑，避免无用 import、内嵌整份程序，以及通过 read()/exec()/compile() 多次保留或重新编译完整源码。临时数据用完后不再保留引用，不能靠省略源码或删除功能缩小代码。
- gc.collect() 仅帮助回收不再使用的 Python 对象，不能保证解决原生内存不足或崩溃。不能每帧强制回收，也不要为此新增长时间等待。
- 输出时简短说明为减少内存压力采取的措施和未实机验证的项目。一般用户按准备、运行、确认实物的流程操作，不要求先分析堆内存或实现基准代码。`,
}

const bleRules: Record<Locale, string> = {
  ja: `### BLEを使う場合のメモリ上の注意
- Pythonのgc.mem_free()だけでBLE内部の空き容量を判断しない。ESP32系で調査が必要な場合は対象ファームウェアでAPIの有無を確認し、esp32.idf_heap_info(esp32.HEAP_DATA)の各領域の空き・最大連続領域も比較する。単一のログから原因を断定したり、特定の空きバイト数を全機器共通の安全閾値にしたりしない。
- BLE有効化などのネイティブ側panicや再起動はPythonのtry/exceptで必ず捕捉できるものではない。失敗を握りつぶして成功扱いせず、無制限の再初期化をしない。BLE初期化方法・順序の変更は実機確認なしに一般解として押し付けない。
- 受信・送信待ち・再試行を有界にし、送信中の1行は維持して待機分は最新だけにする。停止時は可能な範囲でLEDと所有するBLEリソースを後始末し、切断時の途中データを破棄する。対象機種・UIFlow2版で、作品全体の起動、BLE接続・操作・切断・再接続、停止後の再実行を確認する。静的確認だけを実機成功としない。`,
  en: `### Memory considerations when BLE is used
- gc.mem_free() alone does not establish memory available to BLE internals. If ESP32 investigation is needed, check API availability on the target firmware and also compare free space and largest free blocks per region using esp32.idf_heap_info(esp32.HEAP_DATA). Do not diagnose the cause from one log or treat a particular free-byte count as a universal safety threshold.
- Native panics or resets during BLE activation are not guaranteed to be caught by Python try/except. Do not swallow failures, claim success or retry initialization without bounds. Do not present changes to BLE initialization method or order as a general fix without hardware verification.
- Bound receive data, pending sends and retries; preserve the line being sent and keep only the latest pending snapshot. On termination, clean up LEDs and owned BLE resources where possible; discard partial data on disconnect. On the target board and UIFlow2 version, verify full-artwork startup, BLE connection, commands, disconnect/reconnect and running again after stopping. Static checks are not hardware success.`,
  zh: `### 使用 BLE 时的内存注意事项
- 不能只根据 gc.mem_free() 判断 BLE 内部可用内存。需要排查 ESP32 时，先确认目标固件是否提供 API，再用 esp32.idf_heap_info(esp32.HEAP_DATA) 比较各区域的空闲空间及最大连续空闲块。不能根据单份日志断定原因，也不能将某个空闲字节数当作所有设备通用的安全阈值。
- BLE 启用期间原生层的 panic 或重启不保证能被 Python try/except 捕获。不要吞掉失败并宣称成功，也不能无限重试初始化。未经实机验证，不把改变 BLE 初始化方式或顺序当作通用修复。
- 接收、待发送及重试必须有界；保留正在发送的整行，待发送仅保留最新快照。停止时尽可能清理 LED 及自身持有的 BLE 资源，断开时丢弃未完成的数据。在目标设备及 UIFlow2 版本上验证完整作品启动、BLE 连接与操作、断开与重连、停止后重新运行。静态检查不代表实机成功。`,
}

export function buildMemoryPressureRules(locale: Locale, includeBle: boolean): string {
  return generalRules[locale] + (includeBle ? `\n\n${bleRules[locale]}` : '')
}
