"""CPythonで状態機械を確認する。GPIO波形・UIFlow2・電源・実発光の検証ではない。"""
import copy
import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import patch

NOW = 0
FRAMES = []
LED_EVENTS = []


class Pin:
    OUT, IN, PULL_UP = 1, 2, 3

    def __init__(self, number, mode, pull=None, value=None):
        self.number = number
        self.level = value if value is not None else 1

    def value(self, value=None):
        if value is not None:
            self.level = value
            LED_EVENTS.append(("pin", self.number, value))
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
fake_time.sleep_us = lambda value: LED_EVENTS.append(("sleep_us", value))
fake_machine = types.ModuleType("machine")
fake_machine.Pin = Pin


def record_bitstream(pin, encoding, timing, data):
    # 呼び出し時点の値を固定する。再利用bytearrayへの参照を履歴に残さない。
    frame = bytes(data)
    FRAMES.append((encoding, timing, frame))
    LED_EVENTS.append(("bitstream", pin.number, encoding, timing, frame))


fake_machine.bitstream = record_bitstream
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
history_spec = importlib.util.spec_from_file_location(
    "starter_runtime_before_led_send_optimization",
    os.path.join(os.path.dirname(__file__), "fixtures", "runtime_before_led_send_optimization.py"),
)
historical_runtime = importlib.util.module_from_spec(history_spec)
history_spec.loader.exec_module(historical_runtime)

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
        LED_EVENTS.clear()
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

    def test_remote_off_fades_actual_pixels_at_0_100_199_200_ms(self):
        self.config["max_brightness"] = 100
        self.program = runtime.LedProgram(self.config)
        self.program.command("PLAY")
        self.step(210)
        initial = self.program.output[:]
        self.assertEqual(initial[0], (255, 128, 0))
        phase = self.program.phase
        self.program.command("OFF")
        self.assertEqual(self.program.output, initial)
        self.assertEqual(self.program.status()["playback"], "playing")
        previous = 0
        for elapsed in (100, 199, 200):
            self.step(elapsed - previous)
            previous = elapsed
            expected = [tuple(c * (200 - elapsed) // 200 for c in rgb) for rgb in initial]
            self.assertEqual(self.program.output, expected, elapsed)
            self.assertEqual(self.program.status()["pixels"], "".join("%02x%02x%02x" % rgb for rgb in expected))
            self.assertEqual(self.program.playback, "off" if elapsed == 200 else "playing")
            self.assertEqual(self.program.phase, phase)
        self.assertEqual(FRAMES[-1][2], bytes(30))
        self.assertEqual(self.program.brightness, 100)
        self.assertEqual(self.program.index, 0)

    def test_remote_off_from_pause_fade_in_and_action_uses_last_transmitted_output(self):
        for source in ("paused", "fade_in", "action"):
            with self.subTest(source=source):
                self.setUp()
                self.program.command("MODE FLOW")
                self.step(110 if source == "fade_in" else 400)
                if source == "paused":
                    self.program.command("PAUSE")
                elif source == "action":
                    self.program.command("ACTION SPARKLE")
                    self.step(250)
                initial = self.program.output[:]
                self.assertTrue(any(any(rgb) for rgb in initial))
                self.program.command("OFF")
                self.assertIsNone(self.program.action)
                self.assertIsNone(self.program.saved)
                self.assertEqual(self.program.playback, "playing")
                self.assertEqual(self.program.output, initial)
                self.step(100)
                self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in initial])
                self.step(100)
                self.assertEqual(self.program.playback, "off")
                self.step(1500)
                self.assertEqual(self.program.status()["pixels"], "0" * 60)
                self.assertEqual(self.program.index, 1)

    def test_remote_off_repeat_does_not_restart_or_extend_deadline(self):
        self.program.command("PLAY")
        self.step(210)
        self.program.command("OFF")
        started = self.program.remote_off_started
        self.step(100)
        self.program.command("OFF")
        self.assertEqual(self.program.remote_off_started, started)
        self.step(99)
        self.program.command("OFF")
        self.assertEqual(self.program.remote_off_started, started)
        self.step(1)
        self.assertEqual(self.program.playback, "off")

    def test_remote_off_pause_does_not_freeze_pending_fade(self):
        self.program.command("PLAY")
        self.step(210)
        self.program.command("OFF")
        self.step(100)
        self.program.command("PAUSE")
        self.assertEqual(self.program.playback, "playing")
        self.step(100)
        self.assertEqual(self.program.playback, "off")

    def test_remote_off_brightness_changes_cannot_brighten_snapshot(self):
        self.program.command("BRIGHTNESS 40")
        self.program.command("PLAY")
        self.step(210)
        initial = self.program.output[:]
        self.program.command("OFF")
        self.step(100)
        halfway = self.program.output[:]
        for value in (100, 0, 80):
            self.program.command("BRIGHTNESS " + str(value))
            self.assertEqual(self.program.output, halfway)
            self.assertEqual(self.program.brightness, value)
        self.program.command("SPEED 100")
        self.assertEqual(self.program.output, halfway)
        self.step(100)
        self.assertEqual(self.program.status()["pixels"], "0" * 60)
        self.assertEqual(self.program.brightness, 80)
        self.assertEqual(self.program.speed, 100)
        self.assertEqual(halfway, [tuple(c // 2 for c in rgb) for rgb in initial])

    def test_remote_off_play_mode_and_action_cancel_pending_off(self):
        for command in ("PLAY", "MODE FLOW", "ACTION SPARKLE"):
            with self.subTest(command=command):
                self.setUp()
                self.program.command("PLAY")
                self.step(210)
                self.program.command("OFF")
                self.step(100)
                self.program.command(command)
                self.assertIsNone(self.program.remote_off_started)
                self.assertIsNone(self.program.remote_off_pixels)
                self.assertAlmostEqual(self.program.fade, 0.5)
                self.assertEqual(self.program.playback, "playing")
                self.step(1500)
                self.assertEqual(self.program.playback, "playing")
                self.assertTrue(any(any(rgb) for rgb in self.program.output))
                self.assertEqual(self.program.index, 1 if command == "MODE FLOW" else 0)

    def test_remote_off_play_after_brightness_increase_preserves_effective_level(self):
        self.program.command("BRIGHTNESS 20")
        self.program.command("PLAY")
        self.step(210)
        self.program.command("OFF")
        self.step(100)
        before = self.program.output[:]
        self.program.command("BRIGHTNESS 100")
        self.program.command("PLAY")
        self.assertEqual(self.program.output, before)
        self.assertAlmostEqual(self.program.fade, 0.1)
        self.step(210)
        self.assertEqual(self.program.output[0], (51, 25, 0))

    def test_remote_off_already_black_is_immediate(self):
        for playing in (False, True):
            with self.subTest(playing=playing):
                self.setUp()
                if playing:
                    self.program.command("BRIGHTNESS 0")
                    self.program.command("PLAY")
                    self.step(210)
                self.program.command("OFF")
                self.assertEqual(self.program.playback, "off")
                self.assertIsNone(self.program.remote_off_started)
                self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_remote_off_safety_off_and_button_off_remain_immediate(self):
        for operation in ("safety", "button"):
            with self.subTest(operation=operation):
                self.setUp()
                self.program.command("PLAY")
                self.step(210)
                self.program.command("OFF")
                self.step(100)
                if operation == "safety":
                    self.program.off()
                else:
                    self.program.button_action("toggle")
                self.assertEqual(self.program.playback, "off")
                self.assertEqual(self.program.status()["pixels"], "0" * 60)
                self.assertIsNone(self.program.remote_off_started)
                self.step(1000)
                self.assertEqual(self.program.playback, "off")

    def test_remote_off_after_completion_still_uses_200ms_fade_in(self):
        self.program.command("PLAY")
        self.step(210)
        self.program.command("OFF")
        self.step(200)
        self.program.command("PLAY")
        self.assertEqual(self.program.output[0], (0, 0, 0))
        self.step(200)
        self.assertLess(self.program.fade, 1)
        self.step(10)
        self.assertEqual(self.program.fade, 1)

    def test_remote_off_wall_clock_handles_delayed_loop_and_ticks_wrap(self):
        global NOW
        NOW = (1 << 30) - 320
        self.program = runtime.LedProgram(self.config)
        self.program.command("PLAY")
        self.step(210)
        self.program.command("OFF")
        initial = self.program.output[:]
        NOW = (NOW + 100) % (1 << 30)
        self.program.step(NOW)
        self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in initial])
        NOW = (NOW + 150) % (1 << 30)
        self.program.step(NOW)
        self.assertEqual(self.program.playback, "off")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_remote_off_continues_ble_without_blocking_sleep(self):
        radio = self.radio()
        self.program.command("PLAY")
        self.step(210)
        radio.ble.incoming(b"OFF\nSTATUS\n")
        sleep_ms = fake_time.sleep_ms
        fake_time.sleep_ms = lambda value: self.fail("remote OFF must not block on sleep_ms")
        try:
            radio.receive()
            self.assertEqual(self.program.playback, "playing")
            self.step(100, radio)
            self.assertTrue(radio.ble.notifications)
            self.step(100, radio)
            self.assertEqual(self.program.playback, "off")
        finally:
            fake_time.sleep_ms = sleep_ms

    def test_remote_off_completes_after_bluetooth_disconnect(self):
        self.program.command("PLAY")
        self.step(210)
        radio = self.radio()
        radio.ble.incoming(b"OFF\n")
        radio.receive()
        self.step(100, radio)
        self.assertEqual(self.program.playback, "playing")
        radio.irq(2, (42, None, None))
        self.step(100, radio)
        self.assertIsNone(radio.conn)
        self.assertEqual(self.program.playback, "off")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_invalid_commands_do_not_change_state(self):
        before = self.program.status()
        for command in ["MODE ABSENT", "ACTION ABSENT", "BRIGHTNESS -1", "BRIGHTNESS 101", "SPEED 1.5", "PLAY EXTRA", "MODE", "PAUSE 0", "SPEED １", "SPEED +2"]:
            self.assertFalse(self.program.command(command), command)
            self.assertEqual(self.program.status(), before, command)

    def test_restarted_actions_return_to_first_base_state_after_latest_deadline(self):
        for playback in ("playing", "paused", "off"):
            self.setUp()
            self.program.command("PLAY")
            self.step(400)
            if playback == "paused":
                self.program.command("PAUSE")
            elif playback == "off":
                self.program.command("OFF")
                self.step(200)
            before = (self.program.phase, self.program.frame[:], self.program.playback)
            self.program.command("ACTION SPARKLE")
            self.step(400)
            saved = self.program.saved
            self.program.command("ACTION SPARKLE")
            self.assertEqual(self.program.action_elapsed, 0)
            self.assertIs(self.program.saved, saved)
            self.step(999)
            self.assertEqual(self.program.action, "SPARKLE")
            self.step(1)
            self.assertEqual(self.program.action, None)
            self.assertEqual((self.program.phase, self.program.frame, self.program.playback), before)

    def test_action_restart_blends_last_actual_pixels_at_0_100_199_200_ms(self):
        self.program.command("MODE FLOW")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(400)
        source = self.program.output[:]
        old_frame = self.program.frame[:]
        self.program.command("ACTION SPARKLE")
        self.assertEqual(self.program.output, source)
        self.assertEqual(self.program.action_blend_pixels, source)
        self.assertNotEqual(self.program.frame, old_frame)
        self.program.write()
        self.assertEqual(self.program.output, source)
        previous = 0
        for elapsed in (100, 199, 200):
            self.step(elapsed - previous)
            previous = elapsed
            rendered = self.program.render({"kind": "twinkle", "color": "ffffff"}, elapsed / 1000)
            target = [tuple(int(c * 0.2) for c in rgb) for rgb in rendered]
            expected = [tuple((old[c] * (200 - elapsed) + new[c] * elapsed) // 200 for c in range(3))
                        for old, new in zip(source, target)]
            self.assertEqual(self.program.output, expected, elapsed)
            self.assertEqual(self.program.status()["pixels"], "".join("%02x%02x%02x" % rgb for rgb in expected))
        self.assertIsNone(self.program.action_blend_pixels)
        self.assertIsNone(self.program.action_blend_started)

    def test_action_rapid_restarts_keep_only_latest_snapshot_and_original_saved_state(self):
        self.program.command("MODE FLOW")
        self.step(400)
        base_phase = self.program.phase
        self.program.command("ACTION SPARKLE")
        saved = self.program.saved
        for _ in range(20):
            self.step(37)
            source = self.program.output[:]
            self.program.command("ACTION SPARKLE")
            self.assertIs(self.program.saved, saved)
            self.assertEqual(self.program.action_blend_pixels, source)
            self.assertEqual(len(self.program.action_blend_pixels), self.program.count)
            self.assertTrue(all(len(pixel) == 3 for pixel in self.program.action_blend_pixels))
            self.assertEqual(self.program.action_elapsed, 0)
            self.assertEqual(self.program.phase, base_phase)
        self.step(999)
        self.assertEqual(self.program.action, "SPARKLE")
        self.step(1)
        self.assertIsNone(self.program.action)
        self.assertIsNone(self.program.saved)
        self.assertIsNone(self.program.action_blend_pixels)
        self.assertEqual(self.program.phase, base_phase)
        self.step(1100)
        self.assertIsNone(self.program.action)

    def test_action_restart_uses_last_output_even_when_loop_is_late(self):
        global NOW
        self.program.command("ACTION SPARKLE")
        self.step(400)
        source = self.program.output[:]
        NOW += 137
        self.program.command("ACTION SPARKLE")
        self.assertEqual(self.program.output, source)
        self.assertEqual(self.program.action_blend_pixels, source)
        self.assertEqual(self.program.action_started, NOW)
        self.step(1000)
        self.assertEqual(self.program.playback, "off")

    def test_action_restart_during_initial_fade_does_not_reset_or_double_apply_cap(self):
        self.program.command("ACTION SPARKLE")
        self.step(110)
        fade = self.program.fade
        source = self.program.output[:]
        self.program.command("ACTION SPARKLE")
        self.program.write()
        self.assertEqual(self.program.fade, fade)
        self.assertEqual(self.program.output, source)
        self.step(200)
        self.assertEqual(self.program.fade, 1)
        self.assertEqual(max(max(rgb) for rgb in self.program.output), 51)
        self.assertLessEqual(max(FRAMES[-1][2]), 51)

    def test_action_restart_pause_holds_actual_blended_output_and_resumes_base_phase(self):
        self.program.command("MODE FLOW")
        self.step(400)
        base_phase = self.program.phase
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        visible = self.program.output[:]
        self.program.command("PAUSE")
        self.assertEqual(self.program.output, visible)
        self.assertIsNone(self.program.action_blend_pixels)
        self.assertIsNone(self.program.action)
        self.step(2000)
        self.assertEqual(self.program.output, visible)
        self.assertEqual(self.program.phase, base_phase)
        self.program.command("BRIGHTNESS 50")
        self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in visible])
        self.program.command("PAUSE")
        self.program.command("BRIGHTNESS 0")
        self.program.command("PAUSE")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, visible)
        self.program.command("PLAY")
        self.assertIsNone(self.program.held_pixels)
        self.assertEqual(self.program.frame, self.program.render(self.program.modes[1], base_phase))
        self.step(500)
        self.assertEqual(self.program.playback, "playing")

    def test_action_restart_immediate_pause_does_not_jump_to_restart_target(self):
        self.program.command("ACTION SPARKLE")
        self.step(400)
        source = self.program.output[:]
        self.program.command("ACTION SPARKLE")
        self.program.command("PAUSE")
        self.program.write()
        self.assertEqual(self.program.output, source)
        self.step(2000)
        self.assertEqual(self.program.output, source)

    def test_normal_pause_at_zero_brightness_preserves_logical_frame(self):
        for action in (False, True):
            with self.subTest(action=action):
                self.setUp()
                self.program.command("ACTION SPARKLE" if action else "PLAY")
                self.step(400)
                visible = self.program.output[:]
                self.program.command("BRIGHTNESS 0")
                self.program.command("PAUSE")
                self.assertIsNone(self.program.held_pixels)
                self.program.command("PAUSE")
                self.program.command("BRIGHTNESS 100")
                self.assertEqual(self.program.output, visible)
                self.program.command("BRIGHTNESS 0")
                self.program.command("PAUSE")
                self.program.command("BRIGHTNESS 100")
                self.assertEqual(self.program.output, visible)

    def test_action_restart_pause_at_zero_restores_last_blended_reference_without_advancing(self):
        for zero_before_restart in (False, True):
            with self.subTest(zero_before_restart=zero_before_restart):
                self.setUp()
                self.program.command("MODE FLOW")
                self.step(400)
                base_phase = self.program.phase
                self.program.command("ACTION SPARKLE")
                self.step(400)
                if zero_before_restart:
                    self.program.command("BRIGHTNESS 0")
                self.program.command("ACTION SPARKLE")
                self.step(100)
                reference = self.program.output_reference[:]
                self.assertTrue(any(any(rgb) for rgb in reference))
                self.program.command("BRIGHTNESS 0")
                self.program.command("PAUSE")
                self.assertEqual(self.program.status()["pixels"], "0" * 60)
                self.program.command("PAUSE")
                self.step(2000)
                self.program.command("BRIGHTNESS 100")
                self.assertEqual(self.program.output, reference)
                self.assertEqual(self.program.phase, base_phase)
                self.assertIsNone(self.program.action)
                self.assertIsNone(self.program.action_blend_pixels)
                self.program.command("BRIGHTNESS 50")
                self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in reference])
                self.program.command("BRIGHTNESS 0")
                self.program.command("PAUSE")
                self.program.command("BRIGHTNESS 100")
                self.assertEqual(self.program.output, reference)

    def test_action_restart_pause_at_low_brightness_recovers_quantized_frame(self):
        self.program.command("PLAY")
        self.step(400)
        base_phase = self.program.phase
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        reference = self.program.output_reference[:]
        self.program.command("BRIGHTNESS 1")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)
        self.program.command("PAUSE")
        self.assertEqual(self.program.held_brightness, 1)
        self.program.command("BRIGHTNESS 1")
        self.assertEqual(self.program.status()["pixels"], "0" * 60)
        self.step(2000)
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, reference)
        self.assertTrue(any(any(rgb) for rgb in self.program.output))
        self.assertEqual(self.program.phase, base_phase)
        self.program.command("BRIGHTNESS 50")
        self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in reference])
        self.program.command("BRIGHTNESS 1")
        self.program.command("PAUSE")
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, reference)

    def test_saved_output_recovers_partial_color_quantization_only_on_brightness_change(self):
        pixels = [(1, 2, 0)] * self.program.count
        reference = [(21, 45, 6)] * self.program.count
        self.program.brightness = 5
        self.assertEqual(self.program.rescale_output(pixels, 5, reference), pixels)
        self.program.brightness = 100
        self.assertEqual(self.program.rescale_output(pixels, 5, reference), reference)
        self.program.brightness = 50
        self.assertEqual(self.program.rescale_output(pixels, 5, reference), [(10, 22, 3)] * self.program.count)
        self.program.brightness = 5
        self.assertEqual(self.program.rescale_output(pixels, 5, reference), pixels)

    def test_action_restart_brightness_zero_and_changes_preserve_safety_cap(self):
        self.program.command("BRIGHTNESS 40")
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        for brightness in (100, 0, 20, 100):
            self.program.command("BRIGHTNESS " + str(brightness))
            cap = int(255 * 0.2 * brightness / 100)
            self.assertLessEqual(max(FRAMES[-1][2]), cap)
            if brightness == 0:
                self.assertEqual(self.program.status()["pixels"], "0" * 60)
            self.step(10)
            self.assertLessEqual(max(FRAMES[-1][2]), cap)
        self.program.command("BRIGHTNESS 0")
        self.program.command("ACTION SPARKLE")
        self.step(200)
        self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_action_after_paused_restart_restores_visible_hold_not_hidden_target(self):
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        self.program.command("PAUSE")
        visible = self.program.output[:]
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(1000)
        self.assertEqual(self.program.playback, "paused")
        self.assertEqual(self.program.output, visible)
        self.program.command("BRIGHTNESS 0")
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, visible)

    def test_action_restart_off_and_safety_off_cancel_all_restart_state(self):
        for operation in ("OFF", "safety"):
            with self.subTest(operation=operation):
                self.setUp()
                self.program.command("ACTION SPARKLE")
                self.step(400)
                self.program.command("ACTION SPARKLE")
                self.step(100)
                source = self.program.output[:]
                if operation == "OFF":
                    self.program.command("OFF")
                    self.assertEqual(self.program.output, source)
                    self.step(100)
                    self.assertEqual(self.program.output, [tuple(c // 2 for c in rgb) for rgb in source])
                    self.step(100)
                else:
                    self.program.off()
                self.assertEqual(self.program.playback, "off")
                self.assertIsNone(self.program.action)
                self.assertIsNone(self.program.action_blend_started)
                self.assertIsNone(self.program.saved)
                self.step(2000)
                self.assertEqual(self.program.status()["pixels"], "0" * 60)

    def test_action_restart_mode_and_new_action_replace_saved_base(self):
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        self.program.command("MODE FLOW")
        self.assertIsNone(self.program.saved)
        self.assertIsNone(self.program.action_blend_pixels)
        self.step(400)
        base_phase = self.program.phase
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(1000)
        self.assertEqual(self.program.index, 1)
        self.assertEqual(self.program.phase, base_phase)
        self.assertEqual(self.program.playback, "playing")

    def test_action_restart_invalid_command_changes_nothing(self):
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        before = copy.deepcopy(self.program.__dict__)
        for command in ("ACTION ABSENT", "ACTION", "ACTION SPARKLE EXTRA", "BRIGHTNESS 101"):
            self.assertFalse(self.program.command(command))
            for key, value in before.items():
                if key not in ("pin", "button"):
                    self.assertEqual(self.program.__dict__[key], value, key)

    def test_action_restart_ticks_wrap_and_delayed_completion(self):
        global NOW
        NOW = (1 << 30) - 600
        self.program = runtime.LedProgram(self.config)
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(199)
        self.assertIsNotNone(self.program.action_blend_started)
        self.step(1)
        self.assertIsNone(self.program.action_blend_started)
        self.step(799)
        self.assertEqual(self.program.action, "SPARKLE")
        NOW = (NOW + 11) % (1 << 30)
        self.program.step(NOW)
        self.assertEqual(self.program.action_elapsed, 1010)
        self.assertIsNone(self.program.action)
        self.assertEqual(self.program.playback, "off")

    def test_action_restart_ble_processing_is_nonblocking_and_has_no_deferred_queue(self):
        radio = self.radio()
        self.program.command("ACTION SPARKLE")
        self.step(400)
        radio.ble.incoming(b"ACTION SPARKLE\nACTION SPARKLE\nSTATUS\n")
        sleep_ms = fake_time.sleep_ms
        fake_time.sleep_ms = lambda value: self.fail("ACTION restart must not block on sleep_ms")
        try:
            radio.receive()
            self.assertEqual(radio.rx, [])
            self.step(100, radio)
            self.assertTrue(radio.ble.notifications)
            self.step(900, radio)
            self.assertIsNone(self.program.action)
            self.assertEqual(self.program.playback, "off")
        finally:
            fake_time.sleep_ms = sleep_ms

    def test_main_exception_immediately_clears_action_restart_and_turns_off(self):
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(100)
        program_factory = runtime.LedProgram
        sleep_ms = fake_time.sleep_ms
        had_config = hasattr(runtime, "CONFIG")
        previous_config = getattr(runtime, "CONFIG", None)
        runtime.LedProgram = lambda config: self.program
        runtime.CONFIG = self.config

        def fail_sleep(value):
            raise RuntimeError("test loop failure")

        fake_time.sleep_ms = fail_sleep
        try:
            with self.assertRaisesRegex(RuntimeError, "test loop failure"):
                runtime.main()
        finally:
            runtime.LedProgram = program_factory
            fake_time.sleep_ms = sleep_ms
            if had_config:
                runtime.CONFIG = previous_config
            else:
                del runtime.CONFIG
        self.assertEqual(self.program.playback, "off")
        self.assertEqual(FRAMES[-1][2], bytes(30))
        self.assertIsNone(self.program.action_blend_pixels)
        self.assertIsNone(self.program.saved)

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


class LedTransmissionTests(unittest.TestCase):
    """送信完了とはAPI/LOW待機の完了。実物の発光を測定するテストではない。"""
    setUp = RuntimeTests.setUp
    step = RuntimeTests.step
    radio = RuntimeTests.radio

    def expected_events(self, frame):
        return [("pin", self.config["led_pin"], 0), ("sleep_us", 350),
                ("bitstream", self.config["led_pin"], 0, (400, 850, 800, 450), frame),
                ("pin", self.config["led_pin"], 0), ("sleep_us", 350)]

    def light(self):
        self.program.command("PLAY")
        self.step(210)

    def test_initial_black_is_sent_once_with_exact_low_order(self):
        self.assertEqual(runtime.LED_RESET_US, 350)
        self.assertEqual(FRAMES, [(0, (400, 850, 800, 450), bytes(30))])
        self.assertEqual(LED_EVENTS, self.expected_events(bytes(30)))
        self.assertTrue(self.program.last_sent_valid)
        self.assertIsInstance(self.program.buffer, bytearray)
        self.assertIsInstance(self.program.last_sent_buffer, bytearray)
        self.assertIsNot(self.program.buffer, self.program.last_sent_buffer)

    def test_same_final_output_skips_send_and_both_waits(self):
        self.light()
        LED_EVENTS.clear()
        frames = len(FRAMES)
        buffer_ids = (id(self.program.buffer), id(self.program.last_sent_buffer))
        self.assertFalse(self.program.write())
        self.step(1000)
        self.assertEqual(LED_EVENTS, [])
        self.assertEqual(len(FRAMES), frames)
        self.assertEqual((id(self.program.buffer), id(self.program.last_sent_buffer)), buffer_ids)

    def test_quantized_equal_output_updates_reference_without_sending(self):
        self.program.playback = "playing"
        self.program.fade = 1
        self.program.brightness = 1
        self.program.frame = [(10, 0, 0)] * self.program.count
        LED_EVENTS.clear()
        self.assertFalse(self.program.write())
        self.assertEqual(self.program.output_reference, [(2, 0, 0)] * self.program.count)
        self.program.frame = [(0, 10, 0)] * self.program.count
        self.assertFalse(self.program.write())
        self.assertEqual(self.program.output_reference, [(0, 2, 0)] * self.program.count)
        self.assertEqual(LED_EVENTS, [])
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, [(0, 2, 0)] * self.program.count)

    def test_one_byte_change_sends_full_grb_and_reuses_distinct_buffers(self):
        self.program.playback = "playing"
        self.program.fade = 1
        self.program.frame[-1] = (5, 0, 0)
        candidate_id, completed_id = id(self.program.buffer), id(self.program.last_sent_buffer)
        LED_EVENTS.clear()
        self.assertTrue(self.program.write())
        expected = bytes(28) + bytes((1, 0))
        self.assertEqual(LED_EVENTS, self.expected_events(expected))
        self.assertEqual(bytes(self.program.last_sent_buffer), expected)
        self.assertEqual((id(self.program.buffer), id(self.program.last_sent_buffer)), (candidate_id, completed_id))
        self.program.buffer[0] = 99
        self.assertEqual(self.program.last_sent_buffer[0], 0)
        self.assertEqual(FRAMES[-1][2], expected)

    def test_forced_black_and_invalid_cache_always_send(self):
        for operation in (lambda: self.program.off(), lambda: self.program.write(force=True)):
            LED_EVENTS.clear()
            previous = len(FRAMES)
            operation()
            self.assertEqual(len(FRAMES), previous + 1)
            self.assertEqual(LED_EVENTS, self.expected_events(bytes(30)))
        self.program.last_sent_valid = False
        LED_EVENTS.clear()
        self.assertTrue(self.program.write())
        self.assertEqual(LED_EVENTS, self.expected_events(bytes(30)))
        self.assertTrue(self.program.last_sent_valid)

    def test_failed_send_keeps_completed_cache_output_and_reference_and_invalidates(self):
        for stage in ("low_before", "wait_before", "bitstream", "low_after", "wait_after"):
            for exception_type in (OSError, KeyboardInterrupt):
                with self.subTest(stage=stage, exception=exception_type.__name__):
                    self.setUp()
                    self.light()
                    cache = bytes(self.program.last_sent_buffer)
                    output = self.program.output[:]
                    reference = self.program.output_reference[:]
                    status = self.program.status()["pixels"]
                    self.program.frame = [(0, 255, 255)] * self.program.count
                    calls = {"pin": 0, "wait": 0}
                    pin_value = self.program.pin.value

                    def fail_if(stage_name):
                        if stage == stage_name:
                            raise exception_type("injected send failure")

                    def pin(value=None):
                        if value is not None:
                            calls["pin"] += 1
                            fail_if("low_before" if calls["pin"] == 1 else
                                    "low_after" if calls["pin"] == 2 else "cleanup")
                        return pin_value(value)

                    def wait(value):
                        calls["wait"] += 1
                        self.assertEqual(value, 350)
                        # trailing LOW hold must finish before replacing the completed frame.
                        self.assertEqual(bytes(self.program.last_sent_buffer), cache)
                        self.assertEqual(self.program.status()["pixels"], status)
                        fail_if("wait_before" if calls["wait"] == 1 else "wait_after")

                    def send(*args):
                        self.assertEqual(bytes(self.program.last_sent_buffer), cache)
                        fail_if("bitstream")
                        record_bitstream(*args)

                    with patch.object(self.program.pin, "value", pin), \
                            patch.object(fake_time, "sleep_us", wait), \
                            patch.object(fake_machine, "bitstream", send):
                        with self.assertRaises(exception_type):
                            self.program.write()
                    self.assertFalse(self.program.last_sent_valid)
                    self.assertEqual(bytes(self.program.last_sent_buffer), cache)
                    self.assertEqual(self.program.output, output)
                    self.assertEqual(self.program.output_reference, reference)
                    self.assertEqual(self.program.status()["pixels"], status)
                    self.assertEqual(self.program.pin.level, 0)
                    # 失敗後に旧成功フレームへ戻しても、無効キャッシュでは実送信する。
                    self.program.frame = [(255, 128, 0)] * self.program.count
                    previous = len(FRAMES)
                    self.assertTrue(self.program.write())
                    self.assertEqual(len(FRAMES), previous + 1)
                    self.assertTrue(self.program.last_sent_valid)

    def test_low_cleanup_failure_does_not_swallow_original_send_failure(self):
        self.light()
        self.program.frame = [(0, 255, 0)] * self.program.count
        pin_value = self.program.pin.value
        calls = []

        def pin(value=None):
            calls.append(value)
            if len(calls) > 1:
                raise OSError("cleanup failed")
            return pin_value(value)

        with patch.object(self.program.pin, "value", pin), \
                patch.object(fake_machine, "bitstream", side_effect=KeyboardInterrupt("original failure")):
            with self.assertRaisesRegex(KeyboardInterrupt, "original failure"):
                self.program.write()
        self.assertFalse(self.program.last_sent_valid)
        self.assertEqual(calls, [0, 0])

    def test_all_configured_leds_are_sent_and_reported_without_extra_leds(self):
        for count in (1, 37, 88, 90, 110, 300):
            for board, button_pin, led_pin in (("m5nanoc6", 9, 2), ("atoms3lite", 41, 7)):
                with self.subTest(count=count, board=board):
                    self.setUp()
                    self.config.update(led_count=count, board=board, button_pin=button_pin,
                                       led_pin=led_pin, max_brightness=63)
                    self.program = runtime.LedProgram(self.config)
                    self.light()
                    self.assertEqual(len(self.program.buffer), 3 * count)
                    self.assertEqual(len(self.program.last_sent_buffer), 3 * count)
                    self.assertEqual(len(FRAMES[-1][2]), 3 * count)
                    self.assertEqual(len(self.program.status()["pixels"]), 6 * count)
                    self.assertEqual(FRAMES[-1][2], bytes((80, 160, 0)) * count)
                    self.assertEqual(self.program.pin.number, led_pin)
                    self.assertEqual(self.program.button.number, button_pin)

    def test_static_render_is_reused_but_color_change_invalidates_it(self):
        self.light()
        static_frame = self.program.frame
        self.step(500)
        self.assertIs(self.program.frame, static_frame)
        self.program.modes[0]["color"] = "0000ff"
        self.step(10)
        self.assertIsNot(self.program.frame, static_frame)
        self.assertEqual(self.program.output, [(0, 0, 51)] * self.program.count)

    def test_short_changed_frames_are_not_throttled_by_a_new_refresh_limit(self):
        global NOW
        self.light()
        for color in ((0, 255, 0), (0, 0, 255), (255, 255, 255), (0, 0, 0)):
            NOW += 1
            self.program.frame = [color] * self.program.count
            previous = len(FRAMES)
            self.assertTrue(self.program.write(NOW))
            self.assertEqual(len(FRAMES), previous + 1)
            expected = tuple(int(component * 0.2) for component in color)
            self.assertEqual(self.program.output, [expected] * self.program.count)

    def test_static_cache_and_action_pause_off_snapshots_remain_read_only_and_distinct(self):
        self.light()
        cached = self.program.solid_frame
        cached_pixels = cached[:]
        self.program.command("ACTION SPARKLE")
        self.assertIsNot(self.program.saved[4], cached)
        self.assertEqual(self.program.saved[4], cached_pixels)
        self.step(300)
        self.assertIsNone(self.program.solid_frame)
        self.program.command("ACTION SPARKLE")
        blend = self.program.action_blend_pixels
        blend_reference = self.program.action_blend_reference
        expected_blend, expected_reference = blend[:], blend_reference[:]
        self.assertIsNot(blend, self.program.output)
        self.assertIsNot(blend_reference, self.program.output_reference)
        self.step(100)
        self.assertEqual(blend, expected_blend)
        self.assertEqual(blend_reference, expected_reference)
        self.program.command("PAUSE")
        held, held_reference = self.program.held_pixels, self.program.held_reference
        expected_held, expected_held_reference = held[:], held_reference[:]
        self.assertIsNot(held, self.program.output)
        self.assertIsNot(held_reference, self.program.output_reference)
        self.program.command("BRIGHTNESS 0")
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(held, expected_held)
        self.assertEqual(held_reference, expected_held_reference)
        self.program.command("OFF")
        off, off_reference = self.program.remote_off_pixels, self.program.remote_off_reference
        expected_off, expected_off_reference = off[:], off_reference[:]
        self.assertIsNot(off, self.program.output)
        self.assertIsNot(off_reference, self.program.output_reference)
        self.step(100)
        self.assertEqual(off, expected_off)
        self.assertEqual(off_reference, expected_off_reference)
        self.assertEqual(cached, cached_pixels)

    def test_zero_output_advances_and_completes_action_and_finite_mode(self):
        self.program.command("BRIGHTNESS 0")
        self.program.command("MODE FLOW")
        LED_EVENTS.clear()
        self.step(400)
        phase = self.program.phase
        reference = self.program.output_reference[:]
        self.assertGreater(phase, 0)
        self.assertTrue(any(any(rgb) for rgb in reference))
        self.program.command("ACTION SPARKLE")
        self.step(400)
        self.program.command("ACTION SPARKLE")
        self.step(1000)
        self.assertIsNone(self.program.action)
        self.assertEqual(self.program.phase, phase)
        self.assertEqual(self.program.output_reference, reference)
        self.assertEqual(LED_EVENTS, [])
        self.program.command("PAUSE")
        self.step(300)
        self.assertEqual(self.program.phase, phase)
        self.program.command("BRIGHTNESS 100")
        self.assertEqual(self.program.output, reference)
        self.program.command("BRIGHTNESS 0")
        self.program.modes[1].update(repeats=1, end="hold")
        self.program.command("PLAY")
        LED_EVENTS.clear()
        self.step(3000)
        self.assertEqual(self.program.playback, "paused")
        self.assertGreaterEqual(self.program.cycles, 1)
        self.assertEqual(LED_EVENTS, [])

    def test_skipped_led_sends_do_not_block_dirty_status_or_periodic_ble(self):
        self.program.command("BRIGHTNESS 0")
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        LED_EVENTS.clear()
        self.step(900, radio)
        first_snapshot = radio.last_snapshot
        self.step(1000, radio)
        self.assertEqual(fake_time.ticks_diff(radio.last_snapshot, first_snapshot), 1000)
        for command, expected in ((b"MODE FLOW\n", "playing"), (b"PAUSE\n", "paused"),
                                  (b"ACTION SPARKLE\n", "playing")):
            radio.ble.notifications.clear()
            radio.ble.incoming(command)
            self.step(700, radio)
            rows = b"".join(radio.ble.notifications).split(b"\n")[:-1]
            self.assertTrue(rows)
            self.assertEqual(json.loads(rows[-1])["playback"], expected)
            self.assertEqual(json.loads(rows[-1])["pixels"], "0" * 60)
        self.assertEqual(LED_EVENTS, [])
        radio.irq(2, (42, None, None))
        self.step(10, radio)
        self.assertEqual(radio.ble.advertisements[-1][0], 250000)
        radio.irq(1, (42, None, None))
        radio.ble.notifications.clear()
        radio.ble.incoming(b"STATUS\n")
        self.step(700, radio)
        self.assertTrue(b"\n" in b"".join(radio.ble.notifications))
        self.assertEqual(LED_EVENTS, [])
        for _ in range(20):
            radio.ble.incoming(b"STATUS\n")
        self.assertLessEqual(len(radio.rx), 8)
        radio.receive()
        self.assertEqual(radio.rx, [])
        self.assertLessEqual(len(radio.line), 128)

    def test_main_exception_and_keyboard_interrupt_force_black_even_when_already_black(self):
        for failure in (RuntimeError, KeyboardInterrupt):
            with self.subTest(failure=failure):
                previous = len(FRAMES)
                with patch.object(runtime, "LedProgram", return_value=self.program), \
                        patch.object(runtime, "CONFIG", self.config, create=True), \
                        patch.object(fake_time, "sleep_ms", side_effect=failure):
                    with self.assertRaises(failure):
                        runtime.main()
                self.assertEqual(len(FRAMES), previous + 1)
                self.assertEqual(FRAMES[-1][2], bytes(30))

    def test_finally_closes_ble_even_when_forced_safety_black_fails(self):
        radio = runtime.NanoBle(self.program)
        with patch.object(runtime, "LedProgram", return_value=self.program), \
                patch.object(runtime, "NanoBle", return_value=radio), \
                patch.object(runtime, "CONFIG", self.config, create=True), \
                patch.object(fake_time, "sleep_ms", side_effect=KeyboardInterrupt), \
                patch.object(fake_machine, "bitstream", side_effect=OSError("safety send failed")) as send:
            with self.assertRaisesRegex(OSError, "safety send failed"):
                runtime.main()
        self.assertEqual(send.call_count, 1)
        self.assertFalse(self.program.last_sent_valid)
        self.assertFalse(radio.ble.enabled)

    def test_ble_pixels_do_not_report_a_failed_candidate_frame(self):
        self.light()
        completed_pixels = self.program.status()["pixels"]
        self.program.frame = [(0, 255, 255)] * self.program.count
        with patch.object(fake_machine, "bitstream", side_effect=OSError("send failed")):
            with self.assertRaises(OSError):
                self.program.write()
        self.assertFalse(self.program.last_sent_valid)
        radio = self.radio()
        radio.ble.incoming(b"STATUS\n")
        # write失敗後のテレメトリ単体を検査。通常のmainでは既存の安全終了へ伝播する。
        radio.receive()
        for now in range(NOW + 10, NOW + 900, 10):
            radio.step(now)
        rows = b"".join(radio.ble.notifications).split(b"\n")[:-1]
        self.assertTrue(rows)
        self.assertTrue(all(json.loads(row)["pixels"] == completed_pixels for row in rows))


class LedDifferentialTests(unittest.TestCase):
    """同じ時計/入力の最適化前後を比較。送信回数/LOW待機だけを比較から分離する。"""
    def run_scenario(self, module, config, events, start=0):
        global NOW
        NOW = start
        FRAMES.clear()
        LED_EVENTS.clear()
        program = module.LedProgram(copy.deepcopy(config))
        initial_output = FRAMES[-1][2]
        # 履歴側が持つ全データ状態を比較。PinのPythonオブジェクト同一性は比較しない。
        baseline_keys = tuple(key for key in historical_runtime.LedProgram(copy.deepcopy(config)).__dict__
                              if key not in ("pin", "button"))
        FRAMES.clear()
        LED_EVENTS.clear()
        # 初期強制全消灯は専用テストで検査し、ここからは観測できる最終出力を比較する。
        program.write()
        result = []

        def record(label):
            last_sent = FRAMES[-1][2] if FRAMES else initial_output
            # 論理frameだけでなく、最後にstubが記録した全GRB出力とstatusの一致も検査する。
            reported_grb = bytes(component for r, g, b in program.output for component in (g, r, b))
            self.assertEqual(reported_grb, last_sent)
            result.append((label, NOW, copy.deepcopy({key: getattr(program, key) for key in baseline_keys}),
                           copy.deepcopy(program.status()), last_sent))

        record("initial")
        for event, value in events:
            if event == "step":
                while value:
                    delta = min(value, 10)
                    value -= delta
                    NOW = (NOW + delta) % (1 << 30)
                    program.step(NOW)
                    record("step")
            elif event == "command":
                program.command(value)
                record(value)
            elif event == "button":
                program.button.level = value
                record("button")
            elif event == "color":
                program.modes[program.index]["color"] = value
                record("color")
            else:
                self.fail("unknown fixture event")
        return result, len(FRAMES), len([event for event in LED_EVENTS if event[0] == "sleep_us"])

    def compare(self, config, events, start=0):
        previous, old_sends, old_waits = self.run_scenario(historical_runtime, config, events, start)
        current, new_sends, new_waits = self.run_scenario(runtime, config, events, start)
        self.assertEqual(len(current), len(previous))
        for expected, actual in zip(previous, current):
            self.assertEqual(actual, expected, "clock/input: %s %s" % (actual[0], actual[1]))
        # 1実送信につき旧版の後待機1回→新版は前後2回。減った送信は状態差ではない。
        self.assertEqual(old_waits, old_sends)
        self.assertEqual(new_waits, 2 * new_sends)
        self.assertLessEqual(new_sends, old_sends)
        return old_sends, new_sends

    def test_all_modes_commands_buttons_fades_and_wrap_match_historical_states(self):
        events = [("command", "PLAY"), ("step", 40), ("command", "MODE FLOW"), ("step", 170),
                  ("command", "MODE WARM"), ("step", 500), ("color", "336699"), ("step", 100),
                  ("command", "BRIGHTNESS 0"), ("step", 400), ("command", "PAUSE"), ("step", 200),
                  ("command", "BRIGHTNESS 100"), ("command", "PLAY"), ("step", 200),
                  ("command", "ACTION SPARKLE"), ("step", 350), ("command", "ACTION SPARKLE"),
                  ("step", 100), ("command", "PAUSE"), ("step", 200), ("command", "PLAY"),
                  ("step", 100), ("command", "ACTION SPARKLE"), ("step", 200),
                  ("command", "ACTION SPARKLE"), ("step", 100), ("command", "OFF"),
                  ("step", 100), ("command", "OFF"), ("step", 100), ("command", "PLAY"),
                  ("step", 210), ("command", "ACTION SPARKLE"), ("step", 300),
                  ("command", "ACTION SPARKLE"), ("step", 1000),
                  ("button", 0), ("step", 100), ("button", 1), ("step", 450),
                  ("button", 0), ("step", 100), ("button", 1), ("step", 50),
                  ("button", 0), ("step", 100), ("button", 1), ("step", 450),
                  ("button", 0), ("step", 1000), ("button", 1), ("step", 450)]
        for kind in ("solid", "rainbow", "chase", "twinkle"):
            for start in (0, (1 << 30) - 500):
                with self.subTest(kind=kind, start=start):
                    config = copy.deepcopy(BASE)
                    config["modes"][0]["kind"] = kind
                    config["double_press"] = "next"
                    old_sends, new_sends = self.compare(config, events, start)
                    self.assertLess(new_sends, old_sends)

    def test_finite_repeats_zero_brightness_restore_and_completion_match_history(self):
        events = [("command", "BRIGHTNESS 0"), ("command", "PLAY"), ("step", 3010),
                  ("command", "BRIGHTNESS 100"), ("step", 50), ("command", "PLAY"),
                  ("step", 400), ("command", "ACTION SPARKLE"), ("step", 1000), ("step", 3010)]
        for kind in ("solid", "rainbow", "chase", "twinkle"):
            for end in ("hold", "off"):
                with self.subTest(kind=kind, end=end):
                    config = copy.deepcopy(BASE)
                    config["modes"][0].update(kind=kind, repeats=1, end=end)
                    self.compare(config, events)


if __name__ == "__main__":
    unittest.main()
