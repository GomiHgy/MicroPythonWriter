"""CPythonで状態機械を確認する。GPIO波形・UIFlow2・電源・実発光の検証ではない。"""
import copy
import importlib.util
import json
import os
import sys
import types
import unittest

NOW = 0
FRAMES = []


class Pin:
    OUT, IN, PULL_UP = 1, 2, 3

    def __init__(self, number, mode, pull=None, value=None):
        self.number = number
        self.level = value if value is not None else 1

    def value(self, value=None):
        if value is not None:
            self.level = value
        return self.level


class FakeBle:
    def __init__(self):
        self.notifications = []
        self.received = b""
        self.fail_notify = False
        self.disconnections = []
        self.advertisements = []

    def active(self, enabled):
        self.enabled = enabled

    def gap_advertise(self, interval, **kwargs):
        self.advertisements.append((interval, kwargs))

    def gatts_register_services(self, services):
        self.services = services
        return ((1, 2),)

    def gatts_set_buffer(self, handle, length, append):
        self.buffer = (handle, length, append)

    def irq(self, callback):
        self.callback = callback

    def gatts_read(self, handle):
        data, self.received = self.received, b""
        return data

    def gatts_notify(self, conn, handle, chunk):
        if self.fail_notify:
            raise OSError("busy")
        self.notifications.append(bytes(chunk))

    def gap_disconnect(self, conn):
        self.disconnections.append(conn)

    def incoming(self, data):
        self.received = data
        self.callback(3, (42, 2))


fake_time = types.ModuleType("time")
fake_time.ticks_ms = lambda: NOW
fake_time.ticks_diff = lambda a, b: ((a - b + (1 << 29)) % (1 << 30)) - (1 << 29)
fake_time.sleep_ms = lambda value: None
fake_time.sleep_us = lambda value: None
fake_machine = types.ModuleType("machine")
fake_machine.Pin = Pin
fake_machine.bitstream = lambda pin, encoding, timing, data: FRAMES.append((encoding, timing, bytes(data)))
fake_bluetooth = types.ModuleType("bluetooth")
fake_bluetooth.BLE = FakeBle
fake_bluetooth.UUID = str
fake_bluetooth.FLAG_NOTIFY, fake_bluetooth.FLAG_WRITE = 16, 8
sys.modules["machine"] = fake_machine
sys.modules["bluetooth"] = fake_bluetooth
sys.modules["time"] = fake_time
spec = importlib.util.spec_from_file_location("starter_runtime", os.path.join(os.path.dirname(__file__), "runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

BASE = {"board": "m5nanoc6", "firmware": "TEST ONLY", "led_model": "WS2812B", "led_pin": 2,
        "button_pin": 9, "led_count": 10, "max_brightness": 20, "name": "NanoLED-M5NanoC6",
        "short_press": "next", "double_press": "none", "long_press": "toggle", "while_held": False, "wireless": True,
        "modes": [{"id": "WARM", "label": "あたたかい光", "kind": "solid", "color": "ff8000",
                   "speed": 0, "repeats": 0, "end": "hold"},
                  {"id": "FLOW", "label": "流れる光", "kind": "chase", "color": "00ffff",
                   "speed": 50, "repeats": 0, "end": "hold"}]}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        global NOW
        NOW = 0
        FRAMES.clear()
        self.config = copy.deepcopy(BASE)
        self.program = runtime.LedProgram(self.config)

    def step(self, duration, radio=None):
        global NOW
        remaining = duration
        while remaining:
            delta = min(10, remaining)
            remaining -= delta
            NOW = (NOW + delta) % (1 << 30)
            self.program.step(NOW)
            if radio is not None:
                radio.step(NOW)

    def press(self, duration=100):
        self.program.button.level = 0
        self.step(duration)
        self.program.button.level = 1
        self.step(50)

    def stable_button(self, level):
        """変化を現在時刻で観測し、40ms後の安定した押下・解放まで進める。"""
        self.program.button.level = level
        self.program.button_step(NOW)
        self.step(runtime.DEBOUNCE_MS)

    def record_button_actions(self):
        operations = []
        apply_action = self.program.button_action

        def record(operation):
            operations.append(operation)
            apply_action(operation)

        self.program.button_action = record
        return operations

    def radio(self):
        radio = runtime.NanoBle(self.program)
        radio.irq(1, (42, None, None))
        return radio

    def test_startup_off_grb_timing_and_safe_cap(self):
        self.assertEqual(self.program.status()["playback"], "off")
        self.assertEqual(FRAMES[-1], (0, (400, 850, 800, 450), bytes(30)))
        self.program.command("PLAY")
        self.step(200)
        self.assertLess(self.program.output[0][0], 51)
        self.step(10)
        self.assertEqual(self.program.output[0], (51, 25, 0))
        self.assertEqual(FRAMES[-1][2][:3], bytes((25, 51, 0)))
        self.assertEqual(self.program.status()["pixels"][:6], "331900")

    def test_button_cycle_and_long_press_does_not_short_press_on_release(self):
        self.press()
        self.step(350)
        self.assertEqual(self.program.index, 0)
        self.assertEqual(self.program.playback, "playing")
        self.press()
        self.step(350)
        self.assertEqual(self.program.index, 1)
        self.press(1000)
        self.assertEqual(self.program.playback, "off")
        self.assertEqual(self.program.index, 1)

    def test_debounce_rejects_bounce(self):
        for _ in range(10):
            self.program.button.level = 0
            self.step(10)
            self.program.button.level = 1
            self.step(10)
        self.assertEqual(self.program.playback, "off")

    def test_held_mode_release_and_long_press(self):
        self.program.config["while_held"] = True
        self.program.button.level = 0
        self.step(50)
        self.assertEqual(self.program.playback, "playing")
        self.assertEqual(self.program.fade, 0)
        self.step(190)
        self.assertLess(self.program.fade, 1)
        self.step(10)
        self.assertEqual(self.program.fade, 1)
        self.step(1000)
        self.assertEqual(self.program.playback, "playing")
        self.program.button.level = 1
        self.step(50)
        self.assertEqual(self.program.playback, "off")
        self.press(1000)
        self.assertEqual(self.program.playback, "off")

    def test_pause_brightness_and_resume_preserve_phase(self):
        self.program.command("MODE FLOW")
        self.step(400)
        self.program.command("PAUSE")
        phase, frame = self.program.phase, self.program.frame[:]
        self.step(3000)
        self.assertEqual(self.program.phase, phase)
        self.assertEqual(self.program.frame, frame)
        self.program.command("BRIGHTNESS 50")
        self.assertEqual(self.program.phase, phase)
        self.assertLessEqual(max(max(rgb) for rgb in self.program.output), 25)
        self.program.command("PLAY")
        self.step(100)
        self.assertNotEqual(self.program.phase, phase)

    def test_off_brightness_speed_cannot_illuminate(self):
        self.program.command("BRIGHTNESS 50")
        self.program.command("SPEED 100")
        self.step(5000)
        self.assertEqual(self.program.status()["pixels"], "0" * 60)
        self.assertEqual(self.program.status()["mode"], "WARM")

    def test_invalid_commands_do_not_change_state(self):
        before = self.program.status()
        for command in ["MODE ABSENT", "ACTION ABSENT", "BRIGHTNESS -1", "BRIGHTNESS 101", "SPEED 1.5", "PLAY EXTRA", "MODE", "PAUSE 0", "SPEED １", "SPEED +2"]:
            self.assertFalse(self.program.command(command), command)
            self.assertEqual(self.program.status(), before, command)

    def test_actions_return_to_every_playback_and_ignore_repeat(self):
        for playback in ("playing", "paused", "off"):
            self.program.command("PLAY")
            self.step(400)
            if playback == "paused":
                self.program.command("PAUSE")
            elif playback == "off":
                self.program.command("OFF")
            before = (self.program.phase, self.program.frame[:], self.program.playback)
            self.program.command("ACTION SPARKLE")
            self.step(400)
            elapsed = self.program.action_elapsed
            self.program.command("ACTION SPARKLE")
            self.assertEqual(self.program.action_elapsed, elapsed)
            self.step(610)
            self.assertEqual(self.program.action, None)
            self.assertEqual((self.program.phase, self.program.frame, self.program.playback), before)

    def test_action_pause_holds_action_frame_and_play_restores_base(self):
        self.program.command("MODE FLOW")
        self.step(400)
        base_phase = self.program.phase
        self.program.command("ACTION SPARKLE")
        self.step(400)
        action_frame = self.program.frame[:]
        self.program.command("PAUSE")
        self.step(2000)
        self.assertEqual(self.program.frame, action_frame)
        self.assertEqual(self.program.phase, base_phase)
        self.program.command("PLAY")
        self.assertEqual(self.program.frame, self.program.render(self.program.modes[1], base_phase))

    def test_action_interrupts_for_off_mode_and_play(self):
        for command in ("OFF", "MODE FLOW", "PLAY"):
            self.program.command("ACTION SPARKLE")
            self.step(250)
            self.program.command(command)
            self.assertIsNone(self.program.action)
            self.step(1500)
            self.assertEqual(self.program.playback, "off" if command == "OFF" else "playing")

    def test_off_to_action_has_minimum_fade_and_returns_off(self):
        self.program.command("ACTION SPARKLE")
        self.step(200)
        self.assertLess(self.program.fade, 1)
        self.step(10)
        self.assertEqual(self.program.fade, 1)
        self.step(800)
        self.assertEqual(self.program.playback, "off")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_mode_change_preserves_active_fade_progress(self):
        self.program.command("PLAY")
        self.step(110)
        fade = self.program.fade
        self.program.command("MODE FLOW")
        self.assertEqual(self.program.fade, fade)
        self.step(110)
        self.assertEqual(self.program.fade, 1)

    def test_toggle_and_no_button_action(self):
        self.program.config["short_press"] = "toggle"
        self.press()
        self.step(350)
        self.assertEqual(self.program.playback, "playing")
        self.press()
        self.step(350)
        self.assertEqual(self.program.playback, "off")
        self.program.config["short_press"] = "none"
        self.press()
        self.step(350)
        self.assertEqual(self.program.playback, "off")

    def test_disabled_button_never_initializes_or_reads_input_pin(self):
        for legacy_missing_double in (False, True):
            with self.subTest(legacy_missing_double=legacy_missing_double):
                self.setUp()
                self.config.update(short_press="none", double_press="none", long_press="none", while_held=False)
                if legacy_missing_double:
                    del self.config["double_press"]
                initialized = []

                class NoInputPin(Pin):
                    def __init__(self, number, mode, pull=None, value=None):
                        if mode == Pin.IN:
                            raise AssertionError("disabled button must never initialize an input GPIO")
                        initialized.append(number)
                        super().__init__(number, mode, pull, value)

                fake_machine.Pin = NoInputPin
                try:
                    self.program = runtime.LedProgram(self.config)
                    self.assertIsNone(self.program.button)
                    self.assertEqual(initialized, [self.config["led_pin"]])
                    self.program.button_step(NOW)
                    self.program.command("MODE FLOW")
                    self.step(1000)
                    self.assertEqual(self.program.playback, "playing")
                    self.assertGreater(self.program.phase, 0)
                    radio = self.radio()
                    radio.ble.incoming(b"STATUS\nBRIGHTNESS 35\nPAUSE\n")
                    self.step(1000, radio)
                    self.assertEqual(self.program.brightness, 35)
                    self.assertEqual(self.program.playback, "paused")
                    self.assertTrue(radio.ble.notifications)
                finally:
                    fake_machine.Pin = Pin

    def test_any_enabled_gesture_initializes_the_board_button(self):
        for key in ("short_press", "double_press", "long_press"):
            with self.subTest(key=key):
                self.setUp()
                self.config.update(short_press="none", double_press="none", long_press="none", while_held=False)
                self.config[key] = "toggle"
                self.program = runtime.LedProgram(self.config)
                self.assertIsNotNone(self.program.button)
                self.assertEqual(self.program.button.number, self.config["button_pin"])

    def test_while_held_initializes_button_even_when_all_gestures_are_none(self):
        self.config.update(short_press="none", double_press="none", long_press="none", while_held=True)
        self.program = runtime.LedProgram(self.config)
        self.assertIsNotNone(self.program.button)
        self.stable_button(0)
        self.step(1000)
        self.assertEqual(self.program.playback, "playing")
        self.stable_button(1)
        self.assertEqual(self.program.playback, "off")

    def test_each_gesture_applies_each_action_exactly_once(self):
        for gesture in ("short_press", "double_press", "long_press"):
            for operation in ("next", "toggle", "none"):
                for initially_on in (False, True):
                    with self.subTest(gesture=gesture, operation=operation, initially_on=initially_on):
                        self.setUp()
                        self.program.config[gesture] = operation
                        if initially_on:
                            self.program.play()
                        operations = self.record_button_actions()
                        self.stable_button(0)
                        if gesture == "long_press":
                            self.step(799)
                            self.assertEqual(operations, [])
                            self.step(1)
                            self.assertEqual(operations, [operation])
                            self.step(500)
                            self.stable_button(1)
                        else:
                            self.step(40)
                            self.stable_button(1)
                            if gesture == "double_press":
                                self.step(100)
                                self.stable_button(0)
                                self.assertEqual(operations, [])
                                self.step(40)
                                self.stable_button(1)
                            else:
                                self.step(349)
                                self.assertEqual(operations, [])
                                self.step(1)
                        self.assertEqual(operations, [operation])
                        self.step(1000)
                        self.assertEqual(operations, [operation])
                        expected_on = initially_on if operation == "none" else not initially_on if operation == "toggle" else True
                        self.assertEqual(self.program.playback, "playing" if expected_on else "off")
                        self.assertEqual(self.program.index, 1 if operation == "next" and initially_on else 0)

    def test_double_none_does_not_become_two_single_presses(self):
        self.program.config["short_press"] = "next"
        self.program.config["double_press"] = "none"
        operations = self.record_button_actions()
        self.press()
        self.press()
        self.step(1000)
        self.assertEqual(operations, ["none"])
        self.assertEqual(self.program.playback, "off")

    def test_long_none_suppresses_release_short_press(self):
        self.program.config["long_press"] = "none"
        operations = self.record_button_actions()
        self.press(2000)
        self.step(1000)
        self.assertEqual(operations, ["none"])
        self.assertEqual(self.program.playback, "off")

    def test_triple_click_is_one_double_then_one_single(self):
        self.program.config["double_press"] = "toggle"
        operations = self.record_button_actions()
        for _ in range(3):
            self.press()
        self.assertEqual(operations, ["toggle"])
        self.step(350)
        self.assertEqual(operations, ["toggle", "next"])
        self.assertEqual(self.program.index, 1)
        self.step(1000)
        self.assertEqual(operations, ["toggle", "next"])

    def test_second_long_press_cancels_pending_single_and_double(self):
        self.program.config.update(short_press="next", double_press="next", long_press="toggle")
        operations = self.record_button_actions()
        self.press()
        self.step(100)
        self.stable_button(0)
        self.step(799)
        self.assertEqual(operations, [])
        self.step(1)
        self.assertEqual(operations, ["toggle"])
        self.step(500)
        self.stable_button(1)
        self.step(1000)
        self.assertEqual(operations, ["toggle"])
        self.assertEqual(self.program.index, 0)

    def test_double_window_uses_stable_down_and_exact_350ms_boundary(self):
        for gap in (349, 350, 351):
            with self.subTest(gap=gap):
                self.setUp()
                self.program.config["double_press"] = "toggle"
                operations = self.record_button_actions()
                self.stable_button(0)
                self.stable_button(1)
                self.step(gap - runtime.DEBOUNCE_MS)
                self.stable_button(0)
                self.assertEqual(operations, [] if gap < 350 else ["next"])
                self.stable_button(1)
                self.step(350)
                self.assertEqual(operations, ["toggle"] if gap < 350 else ["next", "next"])

    def test_long_press_at_exact_stable_release_boundary_still_wins(self):
        operations = self.record_button_actions()
        self.stable_button(0)
        self.step(760)
        self.stable_button(1)
        self.step(1000)
        self.assertEqual(operations, ["toggle"])

    def test_release_before_long_threshold_remains_one_short_press(self):
        operations = self.record_button_actions()
        self.stable_button(0)
        self.step(759)
        self.stable_button(1)
        self.assertEqual(operations, [])
        self.step(350)
        self.assertEqual(operations, ["next"])

    def test_single_wait_does_not_block_animation_or_ble_notifications(self):
        self.program.command("MODE FLOW")
        operations = self.record_button_actions()
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        radio.receive()
        self.stable_button(0)
        self.stable_button(1)
        phase = self.program.phase
        self.step(300, radio)
        self.assertEqual(operations, [])
        self.assertGreater(self.program.phase, phase)
        self.assertTrue(radio.ble.notifications)
        self.step(50, radio)
        self.assertEqual(operations, ["next"])

    def test_bounced_press_and_release_do_not_add_gestures(self):
        self.program.config["double_press"] = "toggle"
        operations = self.record_button_actions()
        for _ in range(2):
            for level in (0, 1, 0, 1):
                self.program.button.level = level
                self.step(10)
            self.stable_button(0)
            for level in (1, 0, 1, 0):
                self.program.button.level = level
                self.step(10)
            self.stable_button(1)
        self.step(1000)
        self.assertEqual(operations, ["toggle"])

    def test_while_held_overrides_every_gesture_even_after_800ms(self):
        self.program.config.update(while_held=True, short_press="next", double_press="next", long_press="toggle")
        operations = self.record_button_actions()
        for duration in (100, 100, 1000):
            self.stable_button(0)
            self.step(duration)
            self.assertEqual(self.program.playback, "playing")
            self.assertEqual(self.program.index, 0)
            self.stable_button(1)
            self.assertEqual(self.program.playback, "off")
        self.step(1000)
        self.assertEqual(operations, [])

    def test_startup_held_uses_debounce_and_only_one_long_action(self):
        operations = self.record_button_actions()
        self.program.button.level = 0
        self.program.raw = 0
        self.step(39)
        self.assertEqual(self.program.stable, 1)
        self.step(1)
        self.assertEqual(self.program.stable, 0)
        self.step(799)
        self.assertEqual(operations, [])
        self.step(1)
        self.assertEqual(operations, ["toggle"])
        self.step(1000)
        self.stable_button(1)
        self.step(1000)
        self.assertEqual(operations, ["toggle"])

    def test_startup_held_in_held_mode_lights_after_debounce(self):
        self.program.config["while_held"] = True
        self.program.button.level = 0
        self.program.raw = 0
        self.step(39)
        self.assertEqual(self.program.playback, "off")
        self.step(1)
        self.assertEqual(self.program.playback, "playing")
        self.assertEqual(self.program.fade, 0)
        self.step(1000)
        self.assertEqual(self.program.playback, "playing")
        self.stable_button(1)
        self.assertEqual(self.program.playback, "off")

    def test_button_gestures_cross_ticks_rollover(self):
        global NOW
        for gesture in ("single", "double", "long"):
            with self.subTest(gesture=gesture):
                self.setUp()
                NOW = (1 << 30) - 100
                self.program = runtime.LedProgram(self.config)
                self.program.config["double_press"] = "none"
                operations = self.record_button_actions()
                self.stable_button(0)
                if gesture == "long":
                    self.step(800)
                self.stable_button(1)
                if gesture == "double":
                    self.stable_button(0)
                    self.stable_button(1)
                self.step(350)
                self.assertEqual(operations, [{"single": "next", "double": "none", "long": "toggle"}[gesture]])

    def test_legacy_off_stays_off_and_missing_double_defaults_to_none(self):
        self.program.config["long_press"] = "off"
        del self.program.config["double_press"]
        operations = self.record_button_actions()
        self.press(1000)
        self.assertEqual(self.program.playback, "off")
        self.program.play()
        self.press(1000)
        self.assertEqual(self.program.playback, "off")
        self.press()
        self.press()
        self.step(350)
        self.assertEqual(operations, ["off", "off", "none"])

    def test_ble_partial_initialization_shuts_down_radio(self):
        failed = FakeBle()
        def fail_services(services):
            raise OSError("unsupported firmware")
        failed.gatts_register_services = fail_services
        fake_bluetooth.BLE = lambda: failed
        try:
            with self.assertRaises(OSError):
                runtime.NanoBle(self.program)
            self.assertFalse(failed.enabled)
        finally:
            fake_bluetooth.BLE = FakeBle

    def test_finite_repeat_hold_off_and_restart(self):
        self.program.modes[0]["repeats"] = 1
        self.program.command("PLAY")
        self.step(3010)
        self.assertEqual(self.program.playback, "paused")
        self.program.command("PLAY")
        self.assertEqual(self.program.cycles, 0)
        self.program.modes[0]["end"] = "off"
        self.step(3010)
        self.assertEqual(self.program.playback, "off")

    def test_every_effect_stays_inside_cap_at_all_speeds(self):
        for effect in ("solid", "rainbow", "chase", "twinkle"):
            self.program.modes[0]["kind"] = effect
            for speed in (0, 50, 100):
                self.program.select(0)
                self.program.command("SPEED " + str(speed))
                self.step(4000)
                self.assertLessEqual(max(FRAMES[-1][2]), 51)

    def test_ticks_wrap(self):
        global NOW
        NOW = (1 << 30) - 100
        self.program.last = NOW
        self.program.command("PLAY")
        self.step(400)
        self.assertEqual(self.program.fade, 1)
        self.assertGreater(self.program.phase, 0)

    def test_transport_uuid_properties_name_and_wait_for_status(self):
        radio = self.radio()
        service = radio.ble.services[0]
        self.assertEqual(service[0], "6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        self.assertEqual([item[1] for item in service[1]], [16, 8])
        self.assertIn(b"NanoLED-M5NanoC6", radio.advertisement)
        self.assertLessEqual(len(radio.advertisement), 31)
        self.step(2000, radio)
        self.assertEqual(radio.ble.notifications, [])
        radio.ble.incoming(b"STATUS\n")
        self.step(1000, radio)
        rows = b"".join(radio.ble.notifications).split(b"\n")
        self.assertGreater(len(rows), 1)
        self.assertEqual(json.loads(rows[0])["v"], 2)
        self.assertTrue(all(len(chunk) <= 20 for chunk in radio.ble.notifications))

    def test_transport_split_multiple_and_malformed_commands(self):
        radio = self.radio()
        radio.ble.incoming(b"MO")
        radio.receive()
        self.assertEqual(self.program.playback, "off")
        radio.ble.incoming(b"DE FLOW\nPAUSE\n")
        radio.receive()
        self.assertEqual(self.program.index, 1)
        self.assertEqual(self.program.playback, "paused")
        radio.ble.incoming(b"\xff\n")
        radio.receive()
        self.assertEqual(self.program.playback, "paused")
        for _ in range(7):
            radio.ble.incoming(b"x" * 20)
            radio.receive()
        radio.ble.incoming(b"PLAY\nOFF\n")
        radio.receive()
        self.assertEqual(self.program.playback, "off")

    def test_unicode_chunk_boundaries_and_maximum_led_catalog_snapshot(self):
        self.config["led_count"] = 300
        self.config["modes"] = [dict(BASE["modes"][0], id="M%d" % i, label="星🌟" * 12) for i in range(8)]
        self.program = runtime.LedProgram(self.config)
        radio = self.radio()
        original_json = runtime.json
        runtime.json = types.SimpleNamespace(dumps=lambda value: json.dumps(value, ensure_ascii=False))
        try:
            radio.ble.incoming(b"STATUS\n")
            self.step(4000, radio)
        finally:
            runtime.json = original_json
        rows = b"".join(radio.ble.notifications).split(b"\n")[:-1]
        self.assertTrue(rows)
        for row in rows:
            self.assertLessEqual(len(row), 4096)
            status = json.loads(row.decode("utf-8"))
            self.assertEqual(len(status["pixels"]), 1800)
            self.assertEqual(status["controls"]["modes"][0]["label"], "星🌟" * 12)
        broken_chunks = 0
        for chunk in radio.ble.notifications:
            try:
                chunk.decode("utf-8")
            except UnicodeError:
                broken_chunks += 1
        self.assertGreater(broken_chunks, 0)

    def test_oversized_status_never_sends_partial_fake_snapshot(self):
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        original_json = runtime.json
        runtime.json = types.SimpleNamespace(dumps=lambda value: "x" * 4097)
        try:
            with self.assertRaises(ValueError):
                self.step(200, radio)
        finally:
            runtime.json = original_json
        self.assertEqual(radio.ble.notifications, [])

    def test_transport_overflow_resync_and_command_limit(self):
        radio = self.radio()
        for _ in range(10):
            radio.ble.incoming(b"PLAY\n")
        self.assertLessEqual(len(radio.rx), 8)
        radio.receive()
        radio.ble.incoming(b"PLAY\nMODE FLOW\n")
        radio.receive()
        self.assertEqual(self.program.index, 1)
        self.assertEqual(self.program.playback, "playing")
        radio.ble.incoming(b"PAUSE" + b" " * 15 + b"\n")
        radio.receive()
        self.assertEqual(self.program.playback, "playing")

    def test_transport_pending_only_latest_and_no_interleaved_rows(self):
        self.config["led_count"] = 300
        self.program = runtime.LedProgram(self.config)
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        self.step(200, radio)
        first_tx = radio.tx
        self.program.command("PLAY")
        self.step(200, radio)
        self.assertEqual(radio.tx, first_tx)
        self.program.command("BRIGHTNESS 23")
        self.step(200, radio)
        self.step(1500, radio)
        for row in b"".join(radio.ble.notifications).split(b"\n")[:-1]:
            self.assertEqual(json.loads(row)["v"], 2)

    def test_disconnect_resets_partial_rows_and_readvertises(self):
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        self.step(200, radio)
        self.assertTrue(radio.tx)
        radio.irq(2, (42, None, None))
        self.assertFalse(radio.tx)
        self.assertFalse(radio.ready)
        self.step(10, radio)
        self.assertEqual(radio.ble.advertisements[-1][0], 250000)

    def test_notify_failure_is_bounded_and_requires_fresh_connection(self):
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        radio.ble.fail_notify = True
        self.step(300, radio)
        self.assertEqual(radio.ble.disconnections, [42])
        self.assertEqual(radio.conn, None)
        self.assertFalse(radio.tx)


if __name__ == "__main__":
    unittest.main()
