import type { Locale, MessageCatalog } from './types'

// Long-form prompt blocks are kept together so every language retains the same safety contract.
// User code, instructor baseline, logs and protocol identifiers are never translated.
export const promptMessages: MessageCatalog = {}

export const localizedPromptBlocks: Record<Exclude<Locale, 'ja'>, { led: string; ble: string; nanoLed: string; information: string }> = {
  en: {
    led: `## Fixed LED and button rules
- External LEDs use Grove G2, GPIO{ledPin}. Initialize machine.Pin(LED_PIN, machine.Pin.OUT). Do not use Grove G1. Connect 5V and GND and maintain a common ground.
- If the onboard button is enabled, use GPIO{buttonPin}, active LOW (pressed LOW, released HIGH), optionally machine.Pin.PULL_UP. Read it in the main loop with approximately 40ms debounce. Do not replace it with M5.BtnA or a guessed board API. Do not add button operations for kits without a button feature.
- {onboardRule}
- Use import machine and import time as the basis. Do not import neopixel. Use machine.bitstream() and bytearray for LED output.
- BITSTREAM_TIMING = 1 is only a fixed 800kHz label. Keep encoding=0 and WS2812_TIMING_NS = (400, 850, 800, 450), in nanoseconds, ordered T0H,T0L,T1H,T1L.
- Build one complete frame in bytearray(LED_COUNT * LED_BPP), then send machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer). Never pass the numeric 1 as the third argument. Do not send one LED at a time.
- Specify colors as RGB but store the buffer as GRB. At offset = led_index * LED_BPP, store green, red, blue. Follow each transmission with approximately time.sleep_us(80) for reset.
- Route all OFF, solid colors and animations through the same output function. Clamp RGB to 0–255, apply the instructor maximum brightness, user brightness and fade factor, then store GRB. Never raise the safety cap to satisfy a brighter request.
- On startup, send zero to every LED through the shared output function. Even a requested startup effect must obey the minimum 200ms OFF-to-ON fade for its first illumination.
- If a required API such as machine.bitstream is unverified in the target firmware, request instructor verification. Do not guess alternative APIs or libraries or ask participants to install external libraries.
- Do not add uasyncio, threads or GPIO interrupts unless explicitly specified by the instructor. Turn LEDs off where possible on termination or KeyboardInterrupt; do not obstruct Ctrl-C.

## Fixed OFF-to-ON fade rules
- Define MIN_OFF_TO_ON_FADE_MS = 200 at the top. Apply only when the current mode is OFF AND the last transmitted output of every LED is zero, then switching to a lighting mode. Include the first illumination after startup.
- Duration is the greater of the requested duration and 200ms. Use 200ms even when omitted or requested as immediate. Advance a factor from 0.0 to 1.0 without blocking, using time.ticks_ms() and time.ticks_diff(). Do not first transmit a frame at target brightness.
- Do not restart this fade for color changes, brightness changes or temporarily black animation frames while already in an ON mode. Do not impose 200ms on dimming or turning OFF.
- When switching to another ON mode during a fade, preserve fade progress and update only the target color. Switching to OFF cancels fade-in.
- Do not use long sleeps, time.sleep_ms(200), or loops that block until an effect completes. Keep main-loop waits at 10–20ms or less, accepting enabled button and BLE input during effects and fades.
- Advance one effect using time, current mode, animation position and last update time. Reset the previous effect state on mode change while preserving an active fade according to the rules above.
- Unless specified, start OFF; if the button is used, use one short press; use an approximately 3-second effect cycle and repeat until the next operation. Briefly explain the defaults adopted.`,
    ble: `## Preserve the BLE baseline
- The full baseline below corresponds to instructor-registered hardware verification. It does not mean this app or AI verified hardware behavior.
- Preserve BLE initialization, service and characteristic UUIDs, receive-callback argument format, device-name format and libraries. Never invent APIs or replace the BLE implementation.
- Receive callbacks only put received bytes in a bounded queue. Perform actual mode changes and LED updates in the main loop. Do not lose multiple commands by overwriting one variable.
- Bound fragmented receive buffers and command queues. If full, drop additional data with a short diagnostic. Do not wait or retry forever. Discard partial receive data on disconnect.
- Validate complete commands as UTF-8, trim surrounding whitespace, LF and CR, then compare uppercase commands. Invalid, unknown or undecodable commands must leave state unchanged; emit a short USB diagnostic if possible and keep running.
- If both onboard button and BLE are enabled, use one shared mode-change function rather than duplicating effects.`,
    nanoLed: `## NanoLED v1 communication contract
- The device is the Peripheral; the browser is the Central. Include the full device name in advertising or scan response using verified firmware APIs. Advertising the service UUID is optional. Do not force the full name and 128-bit UUID into one packet or invent advertising APIs.
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e. Browser-to-device Write with Response is required; Write Without Response alone is insufficient.
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e. Device-to-browser Notify is required; Read is optional and not a substitute. Matching UUIDs alone do not prove compatibility or successful operation.
- The browser enables TX notifications before STATUS. Lighting modes and sliders stay disabled until the first valid state; OFF may be sent once connected. A Write Response does not prove LED application or successful extinction.
- RX commands are UTF-8 ASCII, one command terminated by LF (\\n), at most 20 bytes including LF. The browser writes one line at a time sequentially with response, never concurrently.
- Join fragments and process complete LF-terminated lines in order, including multiple lines. Limit receive lines to 128 bytes; discard an oversized line until the next LF. Bound the command queue and diagnose discarded overflow.
- Preserve every command: PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS. PINK is solid pink; BLUE solid blue; MAGIC moves pink/purple/blue left to right; RAINBOW cycles all LEDs through rainbow colors.
- OFF immediately sends zero to every LED and cancels fade-in while the program and BLE continue. STATUS only reports state and changes nothing.
- n is an integer from 0 to 100. Missing arguments, fractions, out-of-range values or unknown commands leave state unchanged. BRIGHTNESS 100 means 100% of the instructor cap, not a changed cap. BRIGHTNESS 0 retains the mode. Brightness or speed changes while OFF do not turn LEDs on.
- SPEED 0 is slowest, not stopped; 100 is fastest. Default MAGIC/RAINBOW period_ms = 3000 - 29 * n, independent of LED count. Additional effects use the same direction of speed scaling and must not stop at 0.
- Default startup state is mode=OFF, brightness=100, speed=0. Explicit startup effects may override the mode only while respecting the cap and OFF-to-ON fade. Report the actual applied state.
- Additional mode tokens match ^[A-Z][A-Z0-9_]{0,15}$, at most 16 characters. STATUS, BRIGHTNESS and SPEED are reserved, not modes. Additional effects require firmware implementation.
- TX is one ASCII-only JSON line terminated by LF. Require v (number 1), mode (applied mode), brightness and speed (applied integers 0–100), and pixels (all LED RGB outputs). Keep logs on USB, not TX.
- pixels concatenates six hexadecimal RRGGBB digits per LED in LED order, either case. All zeros means all OFF. Support 1–300 RGB LEDs; count = pixels.length / 6. Never omit, subsample or change the configured LED count. Limit a line to 4096 bytes excluding LF.
- Report pixels in RGB order from the last output actually transmitted AFTER maximum-brightness, user-brightness and fade factors. Convert the LED GRB buffer back to RGB. This is a transmitted-output snapshot, not target colors or a physical light sensor measurement.
- For MTU23, split Notify into chunks of at most 20 bytes; put LF in the last chunk. Keep one snapshot fixed until its whole line is sent; never mix snapshots. Send small amounts from the main loop without blocking LEDs, buttons or commands. Bound pending sends and retries.
- Notify the latest state for STATUS, applied commands and enabled button changes, and approximately once per second even unchanged, at most 5 snapshots/second. Slow down if necessary. Finish the current line and keep only the newest pending snapshot; never replace JSON mid-line.
- Discard partial send and receive lines on disconnect. After reconnect/resubscribe start a complete new line. The browser discards old GATT objects and rediscovers services and characteristics.
- The browser delimits by LF, not Notify boundaries. Invalid JSON or oversized lines do not overwrite state. Clearly indicate missing or stale state. Do not update LED previews merely from sent settings.`,
    information: `## Information handling
Prioritize fixed specifications, instructor-verified baseline code, official M5Stack/MicroPython documentation, then general knowledge. If specifications and baseline materially conflict, do not silently reconcile them: stop the affected feature and ask the instructor. Never pretend to have read an inaccessible page. This prompt is self-contained; do not require external-page retrieval, repeating initial setup or pasting another URL. Do not switch to Arduino, C++, CircuitPython or desktop Python.`,
  },
  zh: {
    led: `## LED 和按钮的固定规则
- 外接 LED 使用 Grove G2 的 GPIO{ledPin}，通过 machine.Pin(LED_PIN, machine.Pin.OUT) 初始化。不要使用 Grove G1。连接 5V 和 GND，确保共地。
- 使用机身按钮时，使用 GPIO{buttonPin}、低电平有效（按下为 LOW，松开为 HIGH），按需使用 machine.Pin.PULL_UP。在主循环中读取，并进行约 40ms 的消抖。不要替换成 M5.BtnA 或猜测的设备 API。没有按钮功能的套件不能添加按钮操作。
- {onboardRule}
- 以 import machine 和 import time 为基础，不要 import neopixel。使用 machine.bitstream() 和 bytearray 输出 LED 数据。
- BITSTREAM_TIMING = 1 仅为 800kHz 的固定标签。保持 encoding=0 和 WS2812_TIMING_NS = (400, 850, 800, 450) 不变，单位为纳秒，顺序为 T0H,T0L,T1H,T1L。
- 在 bytearray(LED_COUNT * LED_BPP) 中构建全部 LED 的完整一帧，然后通过 machine.bitstream(led_pin, 0, WS2812_TIMING_NS, led_buffer) 一次发送。第三个参数不能直接传数字 1，不能逐个 LED 发送。
- 颜色使用 RGB 表示，发送缓冲区使用 GRB。offset = led_index * LED_BPP，依次存储 green、red、blue。每次发送后使用约 time.sleep_us(80) 的复位等待。
- 熄灭、单色和动画都必须经过同一个输出函数。将 RGB 限制在 0–255，应用讲师设置的最大亮度、用户亮度和渐变系数后，再按 GRB 存储。不能为满足更亮的要求而提高安全上限。
- 启动时，通过共用发送函数向全部 LED 发送 0，安全初始化为熄灭。即使指定了启动效果，首次点亮也必须遵守 OFF 到点亮至少 200ms 的渐亮规则。
- 如果 machine.bitstream 等必要 API 尚未在目标固件中确认，请要求讲师确认。不要猜测替代 API 或库，也不要要求参与者安装外部库。
- 未经讲师明确指定，不添加 uasyncio、线程或 GPIO 中断。停止或 KeyboardInterrupt 时尽可能熄灭 LED，不妨碍 Ctrl-C 停止。

## OFF 到点亮的固定渐变规则
- 在代码开头定义 MIN_OFF_TO_ON_FADE_MS = 200。仅当当前模式为 OFF 且最后发送的全部 LED 输出都为 0，然后切换到点亮模式时应用，包括启动后的首次点亮。
- 渐变时间取用户指定时间与 200ms 中的较大值。未指定或要求立即点亮时也使用 200ms。通过 time.ticks_ms() 和 time.ticks_diff() 非阻塞地将系数从 0.0 推进到 1.0，不能先发送目标亮度的一帧。
- 已点亮时的颜色变化、亮度变化，以及动画中暂时为黑色的一帧，都不能重新开始渐亮。变暗和熄灭不强制使用 200ms。
- 渐变中切换到另一点亮模式时，保持进度，仅更新目标颜色。切换到 OFF 时取消渐亮。
- 禁止长时间 sleep、time.sleep_ms(200) 或必须等待动画结束才能退出的循环。主循环等待时间保持 10–20ms 或更短，在动画和渐变中也要接受可用的按钮和 BLE 输入。
- 根据时间、当前模式、动画位置和上次更新时间推进一种效果。切换模式时适当重置旧效果状态，但必须按上述规则保持正在进行的渐亮进度。
- 未指定时，启动为 OFF；使用按钮时采用一次短按；效果周期约 3 秒，重复到下次操作。向参与者简短说明采用的默认设置。`,
    ble: `## 保持 BLE 基准代码
- 下方完整基准代码对应讲师登记的实机验证信息，不代表本应用或 AI 已验证实机行为。
- 保持 BLE 初始化方法、服务和特征 UUID、接收回调的参数形式、设备名称格式及库不变。不要猜测不存在或未确认的 API，也不要替换 BLE 实现。
- 接收回调只将接收到的字节保存到有界队列。实际模式切换和 LED 更新在主循环中处理，不能通过覆盖单一变量丢失多个命令。
- 分片接收缓冲区和命令队列必须有界。满时丢弃新增数据并给出简短诊断，不无限等待或重试。断开连接时丢弃未完成的接收数据。
- 将完整命令验证为 UTF-8，去除前后空白、LF 和 CR，并转成大写判断。无效、未知或解码失败的命令不能改变状态；如可行，在 USB 输出简短诊断并继续运行。
- 同时使用按钮和 BLE 时，共用一个模式切换函数，不重复实现同一效果。`,
    nanoLed: `## NanoLED v1 通信规范
- 设备为 Peripheral，浏览器为 Central。使用已确认的固件 API，在广播或 scan response 中包含完整设备名称。广播服务 UUID 为可选。不要强行把完整名称和 128-bit UUID 塞进同一个数据包，也不要猜测广播 API。
- Primary service UUID: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
- RX UUID: 6e400002-b5a3-f393-e0a9-e50e24dcca9e。必须支持浏览器到设备的 Write with Response；仅支持 Write Without Response 不够。
- TX UUID: 6e400003-b5a3-f393-e0a9-e50e24dcca9e。必须支持设备到浏览器的 Notify。Read 可选，不能代替 Notify。UUID 相同不代表兼容或操作成功。
- 浏览器先启用 TX 通知，再发送 STATUS。首次收到有效状态前禁用点亮模式和滑块，但连接后即可发送 OFF。Write Response 不代表 LED 已应用或已经熄灭。
- RX 命令使用 UTF-8 的 ASCII 字符，一条命令以 LF（\\n）结束，含 LF 最多 20 字节。浏览器逐行串行执行带响应写入，不并发写入。
- 设备合并分片，仅按顺序处理收到 LF 的完整行，并支持连续多行。接收行缓冲区最多 128 字节，超长行丢弃到下一个 LF。命令队列也必须有界，满时丢弃新增项并诊断。
- 保留全部命令：PINK / BLUE / MAGIC / RAINBOW / OFF / BRIGHTNESS n / SPEED n / STATUS。PINK 为全部粉色，BLUE 为全部蓝色，MAGIC 为粉、紫、蓝从左向右流动，RAINBOW 为全部 LED 的彩虹变化。
- OFF 立即熄灭全部 LED 并取消渐亮，但程序和 BLE 继续运行。STATUS 仅通知状态，不改变行为。
- n 为 0–100 的整数。缺少参数、小数、越界或未知命令不能改变状态。BRIGHTNESS 100 表示讲师安全亮度上限的 100%，不能更改上限本身。BRIGHTNESS 0 保持当前模式。OFF 时调整亮度或速度不能点亮 LED。
- SPEED 0 表示最慢而非停止，100 表示最快。标准 MAGIC/RAINBOW 的 period_ms = 3000 - 29 * n，不随 LED 数量变化。新增效果也使用同方向速度调整，0 不得停止。
- 默认启动状态为 mode=OFF、brightness=100、speed=0。明确指定启动效果时可以更改模式，但必须遵守安全亮度及 OFF 到 ON 渐变。通知返回实际已应用状态。
- 新增模式名称必须匹配 ^[A-Z][A-Z0-9_]{0,15}$，最多 16 个字符。STATUS、BRIGHTNESS、SPEED 为保留字，不能作为模式名。新增效果需要在设备程序中实现。
- TX 为一行仅含 ASCII 的 JSON，以 LF 结束。必须包含 v（数值 1）、mode（已应用模式）、brightness 和 speed（已应用的 0–100 整数）以及 pixels（全部 LED 的 RGB 输出）。日志走 USB，不能混入 TX。
- pixels 按 LED 顺序拼接每颗 LED 的六位 RRGGBB 十六进制数，大小写均可。全部为 0 表示全部熄灭。支持 1–300 颗 RGB LED，数量为 pixels.length / 6。不能省略、抽样或改变设定数量。每行不含 LF 最多 4096 字节。
- pixels 必须按 RGB 顺序报告经过最大亮度、用户亮度和渐变后最后实际发送的输出。将 LED 的 GRB 缓冲区还原为 RGB。它是已发送输出的快照，不是目标颜色，也不是传感器对实物发光的测量。
- 为兼容 MTU23，每次 Notify 最多 20 字节，LF 位于最后一个分片。整行发送期间固定同一快照，不混入其他快照。从主循环少量发送，不阻塞 LED、按钮和命令处理；待发送及重试必须有界。
- STATUS、命令应用和可用按钮状态变化时通知最新状态；无变化也约每秒通知一次，最多每秒 5 个快照。通信慢时延长周期。完成正在发送的整行，待发送仅保留最新一份，不能在行中途替换 JSON。
- 断开时丢弃发送和接收的半行。重连及重新订阅通知后，从完整新行开始。浏览器丢弃旧 GATT 对象并重新获取服务和特征。
- 浏览器按 LF 分行，而非 Notify 边界。无效 JSON 或超长行不能覆盖状态。明确提示未收到或停止更新，不能仅根据发送的设置改变 LED 预览。`,
    information: `## 信息处理
优先级为固定规范、讲师实机验证的基准代码、M5Stack 和 MicroPython 官方资料、一般知识。规范与基准代码存在实质矛盾时，不要擅自修正，应暂停相关功能并请讲师确认。无法读取外部页面时不能假装已读。本提示词已包含必要信息，不依赖外部页面获取、重新初始设置或再次粘贴 URL。不要切换到 Arduino、C++、CircuitPython 或电脑用 Python。`,
  },
}

export const interpolatePrompt = (text: string, values: Record<string, string | number>) => text.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match)
