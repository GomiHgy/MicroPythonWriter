# 提供側の検証用候補。対象UIFlow2版での実機動作を保証しない。
# main.py生成時にCONFIGをデータとして追加する。外部ライブラリは不要。
import machine
import time
import json

WS2812_TIMING_NS = (400, 850, 800, 450)
FADE_IN_MS = 200
REMOTE_OFF_FADE_MS = 200
DEBOUNCE_MS = 40
LONG_PRESS_MS = 800
DOUBLE_PRESS_MS = 350


class LedProgram:
    def __init__(self, config):
        self.config = config
        self.pin = machine.Pin(config["led_pin"], machine.Pin.OUT, value=0)
        # ボタンを使わない作品では入力GPIO自体を初期化・読み取りしない。
        use_button = config["while_held"] or any(
            config.get(key, "none") != "none"
            for key in ("short_press", "double_press", "long_press")
        )
        self.button = machine.Pin(config["button_pin"], machine.Pin.IN, machine.Pin.PULL_UP) if use_button else None
        self.count = config["led_count"]
        self.buffer = bytearray(self.count * 3)
        self.frame = [(0, 0, 0)] * self.count
        self.output = [(0, 0, 0)] * self.count
        self.modes = config["modes"]
        self.index = 0
        self.brightness = 100
        self.speed = 0
        self.playback = "off"
        self.phase = 0.0
        self.cycles = 0
        self.fade = 0.0
        self.remote_off_started = None
        self.remote_off_pixels = None
        self.remote_off_fade = 0.0
        self.remote_off_brightness = 100
        self.action = None
        self.action_elapsed = 0
        self.saved = None
        self.just_started = False
        self.dirty = True
        self.last = time.ticks_ms()
        self.raw = self.button.value() if self.button is not None else 1
        self.stable = 1
        self.raw_changed = self.last
        self.pressed_at = self.last
        self.long_handled = False
        self.pending_short_at = None
        self.second_press = False
        self.write()

    def write(self, now=None):
        # すべての出力が同じ安全上限を通る。通知はこの最終値をRGBで報告する。
        if self.remote_off_started is not None:
            now = time.ticks_ms() if now is None else now
            elapsed = max(0, time.ticks_diff(now, self.remote_off_started))
            remaining = max(0, REMOTE_OFF_FADE_MS - elapsed)
            if not remaining:
                self.off()
                return
            self.fade = self.remote_off_fade * remaining / REMOTE_OFF_FADE_MS
            # 上限適用済みの実出力を縮小する。設定変更で消灯途中に明るくしない。
            pixels = [tuple(c * remaining // REMOTE_OFF_FADE_MS for c in rgb)
                      for rgb in self.remote_off_pixels]
        else:
            scale = self.config["max_brightness"] / 100 * self.brightness / 100 * self.fade
            if self.playback == "off":
                scale = 0
            pixels = [tuple(int(max(0, min(255, c)) * scale) for c in rgb) for rgb in self.frame]
        for i, (r, g, b) in enumerate(pixels):
            self.output[i] = (r, g, b)
            self.buffer[3 * i:3 * i + 3] = bytes((g, r, b))
        machine.bitstream(self.pin, 0, WS2812_TIMING_NS, self.buffer)
        self.pin.value(0)
        # 同じループで複数コマンドを適用した場合にもリセット時間を確保する。
        time.sleep_us(80)

    def off(self):
        # 起動・例外・本体ボタン・有限再生終了の安全消灯は待たずに行う。
        self.remote_off_started = None
        self.remote_off_pixels = None
        self.action = None
        self.saved = None
        self.playback = "off"
        self.fade = 0.0
        self.frame = [(0, 0, 0)] * self.count
        self.write()
        self.dirty = True

    def fade_out(self):
        if self.remote_off_started is not None:
            # 連打で消灯時刻を延ばさない。
            self.write()
            self.dirty = True
            return
        self.cancel_action()
        if not any(any(rgb) for rgb in self.output):
            self.off()
            return
        self.remote_off_started = time.ticks_ms()
        self.remote_off_pixels = self.output[:]
        self.remote_off_fade = self.fade
        self.remote_off_brightness = self.brightness
        # PAUSE中の実出力も消灯する。黒を送信する前にoffとは報告しない。
        self.playback = "playing"
        self.just_started = False
        self.dirty = True

    def cancel_remote_off(self):
        if self.remote_off_started is not None:
            self.write()
            if self.remote_off_started is not None:
                # 消灯中に保存された輝度設定を適用しても、再開直後に急に明るくしない。
                self.fade = min(1.0, self.fade * self.remote_off_brightness / self.brightness) if self.brightness else 0.0
                self.remote_off_started = None
                self.remote_off_pixels = None

    def cancel_action(self):
        self.action = None
        self.saved = None

    def play(self):
        self.cancel_remote_off()
        was_off = self.playback == "off"
        self.cancel_action()
        self.playback = "playing"
        self.just_started = True
        if was_off:
            self.fade = 0.0
        mode = self.modes[self.index]
        if mode["repeats"] and self.cycles >= mode["repeats"]:
            self.phase = 0.0
            self.cycles = 0
        self.frame = self.render(mode, self.phase)
        self.write()
        self.dirty = True

    def pause(self):
        if self.remote_off_started is not None:
            # PAUSEで消灯の途中を固定しない。先に受けたOFFを最後まで実行する。
            self.write()
            self.dirty = True
            return
        self.cancel_action()
        if self.playback != "off":
            self.playback = "paused"
        self.dirty = True

    def select(self, index):
        self.index = index
        self.phase = 0.0
        self.cycles = 0
        self.speed = self.modes[index]["speed"]
        self.play()

    def sparkle(self):
        if self.action is not None:
            return
        self.cancel_remote_off()
        self.saved = (self.playback, self.frame[:], self.fade)
        was_off = self.playback == "off"
        self.action = "SPARKLE"
        self.action_elapsed = 0
        self.playback = "playing"
        self.just_started = True
        if was_off:
            self.fade = 0.0
        self.dirty = True

    def command(self, line):
        parts = line.strip().upper().split()
        if not parts:
            return False
        op = parts[0]
        if len(parts) == 1:
            if op == "STATUS":
                self.dirty = True
            elif op == "OFF":
                self.fade_out()
            elif op == "PLAY":
                self.play()
            elif op == "PAUSE":
                self.pause()
            else:
                return False
            return True
        if len(parts) != 2:
            return False
        arg = parts[1]
        if op == "MODE":
            for i, mode in enumerate(self.modes):
                if mode["id"] == arg:
                    self.select(i)
                    return True
            return False
        if op == "ACTION" and arg == "SPARKLE":
            self.sparkle()
            return True
        if op in ("BRIGHTNESS", "SPEED") and arg and all("0" <= c <= "9" for c in arg):
            value = int(arg)
            if not 0 <= value <= 100:
                return False
            if op == "BRIGHTNESS":
                self.brightness = value
                self.write()
            else:
                self.speed = value
            self.dirty = True
            return True
        return False

    def button_action(self, operation):
        if operation == "next":
            self.select(self.index if self.playback == "off" else (self.index + 1) % len(self.modes))
        elif operation == "toggle":
            if self.playback == "off":
                self.play()
            else:
                self.off()
        elif operation == "off":
            # 以前に保存した作品の「長く押すと消灯」は意味を変えずに維持する。
            self.off()

    def button_step(self, now):
        if self.button is None:
            return
        if self.config["while_held"]:
            # 押している間だけ光る設定は、3種類の押し方より優先する。
            self.pending_short_at = None
            self.second_press = False
        else:
            # 1回目を離してから、2回目の押下が安定するまで350ms未満なら2回押し。
            # 350msちょうどは1回押しを確定する。待機中も描画・BLEを止めない。
            if self.pending_short_at is not None and time.ticks_diff(now, self.pending_short_at) >= DOUBLE_PRESS_MS:
                self.pending_short_at = None
                self.button_action(self.config["short_press"])
            if self.stable == 0 and not self.long_handled and time.ticks_diff(now, self.pressed_at) >= LONG_PRESS_MS:
                self.long_handled = True
                self.pending_short_at = None
                self.second_press = False
                self.button_action(self.config["long_press"])

        raw = self.button.value()
        if raw != self.raw:
            self.raw = raw
            self.raw_changed = now
        if time.ticks_diff(now, self.raw_changed) >= DEBOUNCE_MS and raw != self.stable:
            self.stable = raw
            if raw == 0:
                self.pressed_at = now
                self.long_handled = False
                if self.config["while_held"]:
                    self.select(self.index)
                else:
                    # 2回目は離すまで確定しない。長押しに変われば1回目も取り消す。
                    self.second_press = self.pending_short_at is not None
                    self.pending_short_at = None
            elif self.config["while_held"]:
                self.off()
            elif not self.long_handled:
                if self.second_press:
                    self.second_press = False
                    self.button_action(self.config.get("double_press", "none"))
                else:
                    # 2回押しが「何もしない」でも1回押しへ読み替えない。
                    self.pending_short_at = now

    @staticmethod
    def wheel(position):
        value = int(position * 768) % 768
        section, part = value // 256, value % 256
        if section == 0:
            return (255 - part, part, 0)
        if section == 1:
            return (0, 255 - part, part)
        return (part, 0, 255 - part)

    def render(self, mode, phase):
        color = tuple(int(mode["color"][i:i + 2], 16) for i in (0, 2, 4))
        if mode["kind"] == "solid":
            return [color] * self.count
        if mode["kind"] == "rainbow":
            return [self.wheel((phase + i / self.count) % 1) for i in range(self.count)]
        if mode["kind"] == "chase":
            head = min(self.count - 1, int(phase * self.count))
            return [color if i == head else (0, 0, 0) for i in range(self.count)]
        # 固定の疑似乱数で毎回再現可能。時刻に依存するランダム待機を入れない。
        tick = int(phase * 32)
        return [color if ((i * 1103515245 + tick * 12345) % 13) < 3 else (0, 0, 0) for i in range(self.count)]

    def step(self, now):
        elapsed = max(0, time.ticks_diff(now, self.last))
        self.last = now
        self.button_step(now)
        if self.remote_off_started is not None:
            self.write(now)
            return
        if self.playback != "playing":
            return
        if self.just_started:
            # 開始前のループ経過時間をフェードに加算しない。最低200msを維持。
            elapsed = 0
            self.just_started = False
        self.fade = min(1.0, self.fade + elapsed / FADE_IN_MS)
        if self.action is not None:
            self.action_elapsed += elapsed
            if self.action_elapsed >= 1000:
                self.playback, self.frame, self.fade = self.saved
                self.cancel_action()
                self.dirty = True
            else:
                mode = {"kind": "twinkle", "color": "ffffff"}
                self.frame = self.render(mode, self.action_elapsed / 1000)
        else:
            mode = self.modes[self.index]
            phase = self.phase + elapsed / (3000 - 29 * self.speed)
            completed = int(phase + 1e-9)
            self.cycles += completed
            self.phase = max(0.0, phase - completed)
            if mode["repeats"] and self.cycles >= mode["repeats"]:
                if mode["end"] == "off":
                    self.off()
                    return
                self.phase = 0.999999
                self.playback = "paused"
                self.dirty = True
            self.frame = self.render(mode, self.phase)
        self.write()

    def status(self):
        return {"v": 2, "mode": self.modes[self.index]["id"], "brightness": self.brightness,
                "speed": self.speed, "pixels": "".join("%02x%02x%02x" % rgb for rgb in self.output),
                "playback": self.playback, "action": self.action,
                "controls": {"speed": True,
                             "modes": [{"id": m["id"], "label": m["label"]} for m in self.modes],
                             "actions": [{"id": "SPARKLE", "label": "キラッと光る"}]}}


class NanoBle:
    def __init__(self, program):
        import bluetooth
        self.program = program
        self.ble = bluetooth.BLE()
        self.conn = None
        self.ready = False
        self.rx = []
        self.overflow = False
        self.line = bytearray()
        self.discard = False
        self.tx = b""
        self.pending = None
        self.offset = 0
        self.failures = 0
        self.restart = False
        self.last_snapshot = time.ticks_ms()
        self.last_notify = self.last_snapshot
        try:
            self.ble.active(True)
            self.ble.gap_advertise(None)
            service = bluetooth.UUID("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
            tx = (bluetooth.UUID("6e400003-b5a3-f393-e0a9-e50e24dcca9e"), bluetooth.FLAG_NOTIFY)
            rx = (bluetooth.UUID("6e400002-b5a3-f393-e0a9-e50e24dcca9e"), bluetooth.FLAG_WRITE)
            ((self.tx_handle, self.rx_handle),) = self.ble.gatts_register_services(((service, (tx, rx)),))
            self.ble.gatts_set_buffer(self.rx_handle, 128, True)
            self.ble.irq(self.irq)
            name = program.config["name"].encode("utf-8")
            # 128-bit UUIDは広告に追加しない。Flags + 完全名だけで31バイト以内。
            self.advertisement = bytes((2, 1, 6, len(name) + 1, 9)) + name
            self.ble.gap_advertise(250000, adv_data=self.advertisement)
        except Exception:
            self.ble.active(False)
            raise

    def clear_connection(self):
        self.ready = False
        self.rx = []
        self.overflow = False
        self.line = bytearray()
        self.discard = False
        self.tx = b""
        self.pending = None
        self.offset = 0
        self.failures = 0

    def irq(self, event, data):
        # 受信IRQは有界コピーと接続状態だけ。描画・JSON化・待機はメインループ。
        if event == 1:
            self.conn = data[0]
            self.clear_connection()
        elif event == 2 and data[0] == self.conn:
            self.conn = None
            self.clear_connection()
            self.restart = True
        elif event == 3 and data[0] == self.conn and data[1] == self.rx_handle:
            chunk = self.ble.gatts_read(self.rx_handle)
            if len(self.rx) < 8 and len(chunk) < 128 and not self.overflow:
                self.rx.append(bytes(chunk))
            else:
                self.overflow = True

    def receive(self):
        if self.overflow:
            self.rx = []
            self.line = bytearray()
            self.discard = True
            self.overflow = False
            print("NanoLED: RX overflow; discard through next LF")
        # 最大8チャンク。IRQが続いても無制限に滞在しない。
        for _ in range(min(8, len(self.rx))):
            chunk = self.rx.pop(0)
            for value in chunk:
                if value == 10:
                    if not self.discard and 0 < len(self.line) <= 19:
                        try:
                            if any(value > 127 for value in self.line):
                                raise ValueError("ASCII commands only")
                            text = self.line.decode("utf-8")
                            if text.strip().upper() == "STATUS":
                                self.ready = True
                            if not self.program.command(text):
                                print("NanoLED: invalid command")
                        except (UnicodeError, ValueError):
                            print("NanoLED: invalid encoding")
                    self.line = bytearray()
                    self.discard = False
                elif not self.discard:
                    self.line.append(value)
                    if len(self.line) > 128:
                        self.line = bytearray()
                        self.discard = True

    def step(self, now):
        if self.restart:
            self.restart = False
            self.ble.gap_advertise(250000, adv_data=self.advertisement)
        self.receive()
        if self.conn is None or not self.ready:
            return
        age = time.ticks_diff(now, self.last_snapshot)
        if age >= 200 and (self.program.dirty or age >= 1000):
            row = json.dumps(self.program.status()).encode("utf-8")
            if len(row) > 4096:
                raise ValueError("NanoLED status exceeds 4096 bytes")
            self.pending = row + b"\n"
            self.program.dirty = False
            self.last_snapshot = now
        if not self.tx and self.pending is not None:
            self.tx, self.pending = self.pending, None
            self.offset = 0
        if self.tx and time.ticks_diff(now, self.last_notify) >= 10:
            self.last_notify = now
            try:
                self.ble.gatts_notify(self.conn, self.tx_handle, self.tx[self.offset:self.offset + 20])
                self.offset += 20
                self.failures = 0
                if self.offset >= len(self.tx):
                    self.tx = b""
            except OSError:
                self.failures += 1
                if self.failures >= 3:
                    # 途中のJSONを捨てて同一接続へ次行を混ぜない。再接続からやり直す。
                    conn = self.conn
                    self.conn = None
                    self.clear_connection()
                    self.ble.gap_disconnect(conn)
                    self.restart = True

    def close(self):
        self.ble.active(False)


def main():
    program = LedProgram(CONFIG)
    radio = None
    try:
        if CONFIG["wireless"]:
            radio = NanoBle(program)
        while True:
            now = time.ticks_ms()
            program.step(now)
            if radio is not None:
                radio.step(now)
            time.sleep_ms(10)
    finally:
        # 中断・例外でも消灯を試み、無線を終了する。成功は実機で確認する。
        try:
            program.off()
        finally:
            if radio is not None:
                radio.close()


if __name__ == "__main__":
    main()
