"""Browser-only approximation of selected MicroPython LED/button/NanoLED APIs.

配線・電力・無線・実機タイミングは再現しない。未対応APIは明示的に失敗させる。
Worker isolation is required: this compatibility layer is NOT a security boundary
against hostile Python introspection. No user code is sent to a remote runtime.
"""
import builtins as _builtins
import sys as _sys
import types as _types
import json as _json
import time as _host_time
import math as _math
import random as _random
import struct as _struct
import binascii as _binascii
import collections as _collections
import array as _array
import errno as _errno
import codecs as _codecs
from pyodide.ffi import run_sync as _run_sync

_config = _json.loads(_sim_config)
_led_pin = int(_config["ledPin"])
_button_pin = int(_config["buttonPin"])
_led_count = int(_config["ledCount"])
if not 1 <= _led_count <= 300:
    raise ValueError("Simulation supports 1 to 300 LEDs")
_ble_instances = []
_pins = {}
_last_yield = _host_time.monotonic()
_polling = False


def _unsupported(name):
    raise NotImplementedError("Simulation does not support " + name)


def _missing_attribute(name):
    # hasattr/getattr(..., default)による実機API有無の確認を妨げない。
    raise AttributeError("Simulation does not support " + name)


def _module(name, **attributes):
    result = _types.ModuleType(name)
    result.__dict__.update(attributes)
    result.__all__ = tuple(attributes)
    result.__getattr__ = lambda attribute: _missing_attribute(name + "." + attribute)
    return result


def _poll_ble():
    global _polling
    if _polling:
        return
    _polling = True
    try:
        commands = _json.loads(str(_sim_bridge.drainCommands()))
        for ble in tuple(_ble_instances):
            ble._poll(commands)
    finally:
        _polling = False


def _wait(milliseconds):
    global _last_yield
    if not isinstance(milliseconds, (int, float)) or milliseconds < 0 or not _math.isfinite(milliseconds):
        raise ValueError("sleep duration must be a finite non-negative number")
    _poll_ble()
    _run_sync(_sim_bridge.wait(milliseconds))
    _last_yield = _host_time.monotonic()
    _poll_ble()


def _trace(frame, event, argument):
    if frame.f_code.co_filename == "main.py" and event == "line":
        if _host_time.monotonic() - _last_yield >= 0.02:
            _wait(0)
    return _trace


_TICKS_PERIOD = 1 << 30


def _ticks_ms():
    return int(_sim_bridge.now()) % _TICKS_PERIOD


def _ticks_us():
    return int(_sim_bridge.now() * 1000) % _TICKS_PERIOD


def _ticks_diff(left, right):
    return ((left - right + _TICKS_PERIOD // 2) % _TICKS_PERIOD) - _TICKS_PERIOD // 2


class _Pin:
    IN = 0
    OUT = 1
    OPEN_DRAIN = 2
    PULL_UP = 1
    PULL_DOWN = 2

    def __new__(cls, pin, *arguments, **keywords):
        if isinstance(pin, cls):
            return pin
        number = int(pin)
        if not 0 <= number <= 48:
            raise ValueError("Simulation GPIO must be between 0 and 48")
        if number not in _pins:
            instance = super().__new__(cls)
            instance.id = number
            instance._value = 0
            instance.mode = cls.IN
            _pins[number] = instance
        return _pins[number]

    def __init__(self, pin, mode=None, pull=None, *, value=None):
        if mode is not None:
            self.mode = mode
        if value is not None:
            self._value = int(bool(value))
        elif pull is not None:
            self._value = int(pull == self.PULL_UP)

    def init(self, mode=None, pull=None, *, value=None):
        self.__init__(self.id, mode, pull, value=value)

    def value(self, value=None):
        if value is not None:
            self._value = int(bool(value))
            return None
        if self.id == _button_pin and self.mode == self.IN:
            return 0 if _sim_bridge.button() else 1
        return self._value

    __call__ = value

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)


def _emit(pin, pixels):
    number = pin.id if isinstance(pin, _Pin) else int(pin)
    if number != _led_pin:
        # 内蔵LEDや電源GPIOへの出力を外部テープの光として偽表示しない。
        return
    if not 1 <= len(pixels) <= 300:
        raise ValueError("Simulation supports 1 to 300 output LEDs")
    _sim_bridge.frame(number, _json.dumps(pixels))


def _bitstream(pin, encoding, timing, data):
    if encoding != 0 or len(timing) != 4:
        return _unsupported("machine.bitstream encoding/timing")
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise TypeError("Simulation bitstream requires a bytes-like buffer")
    # バッファコピー・RGB配列の構築より先に上限を確認する。
    size = data.nbytes if isinstance(data, memoryview) else len(data)
    if not 3 <= size <= 900:
        raise ValueError("Simulation supports 1 to 300 output LEDs")
    if size % 3:
        raise ValueError("Simulation bitstream expects three-byte GRB LEDs")
    data = bytes(data)
    _emit(pin, [[data[i + 1], data[i], data[i + 2]] for i in range(0, len(data), 3)])


class _NeoPixel:
    ORDER = (1, 0, 2, 3)

    def __init__(self, pin, n, bpp=3, timing=1):
        if bpp != 3:
            return _unsupported("NeoPixel bpp other than RGB (3)")
        if not 1 <= int(n) <= 300:
            raise ValueError("Simulation supports 1 to 300 NeoPixels")
        self.pin = pin
        self.n = int(n)
        self.bpp = bpp
        self.buf = bytearray(self.n * bpp)

    def __len__(self):
        return self.n

    def __setitem__(self, index, color):
        if not 0 <= index < self.n or len(color) != 3:
            raise ValueError("NeoPixel index or RGB color is invalid")
        for channel in range(3):
            self.buf[index * 3 + self.ORDER[channel]] = color[channel]

    def __getitem__(self, index):
        if not 0 <= index < self.n:
            raise IndexError(index)
        return tuple(self.buf[index * 3 + self.ORDER[channel]] for channel in range(3))

    def fill(self, color):
        for index in range(self.n):
            self[index] = color

    def write(self):
        _bitstream(self.pin, 0, (400, 850, 800, 450), self.buf)


class _UUID:
    def __init__(self, value):
        if isinstance(value, int):
            if not 0 <= value <= 0xffffffff:
                raise ValueError("invalid UUID")
            self._bytes = value.to_bytes(2 if value <= 0xffff else 4, "little")
            self.value = str(value)
        elif isinstance(value, (bytes, bytearray)):
            if len(value) not in (2, 4, 16):
                raise ValueError("invalid UUID")
            self._bytes = bytes(value)
            self.value = self._bytes[::-1].hex()
            if len(self._bytes) == 16:
                self.value = "-".join((self.value[:8], self.value[8:12], self.value[12:16], self.value[16:20], self.value[20:]))
        else:
            self.value = str(value).lower()
            self._bytes = bytes.fromhex(self.value.replace("-", ""))[::-1]
            if len(self._bytes) != 16:
                raise ValueError("invalid UUID")

    def __bytes__(self):
        return self._bytes

    def __eq__(self, other):
        return isinstance(other, _UUID) and self.value == other.value

    def __hash__(self):
        return hash(self.value)

    def __repr__(self):
        return "UUID(%r)" % self.value


class _BLE:
    def __init__(self):
        self._active = False
        self._advertising = False
        self._connected = False
        self._handler = None
        self._values = {}
        self._rx = None
        self._tx = None
        self._buffers = {}
        self._configuration = {"mtu": 247, "gap_name": "NanoLED-Simulation"}
        self._decoder = _codecs.getincrementaldecoder("utf-8")("strict")
        _ble_instances.append(self)

    def active(self, enabled=None):
        if enabled is not None:
            self._active = bool(enabled)
            if not self._active:
                self._connected = False
                self._advertising = False
                _sim_bridge.bleActive(False)
        return self._active

    def config(self, parameter=None, **values):
        if parameter is not None:
            if parameter not in self._configuration:
                raise ValueError("unknown config param")
            return self._configuration[parameter]
        for key, value in values.items():
            if key not in self._configuration:
                raise ValueError("unknown config param")
            self._configuration[key] = value

    def irq(self, handler):
        self._handler = handler

    def gatts_register_services(self, services):
        if not self._active:
            raise OSError("BLE is not active")
        results = []
        handle = 1
        for service in services:
            handles = []
            for characteristic in service[1]:
                uuid = characteristic[0].value
                self._values[handle] = b""
                handles.append(handle)
                if uuid == "6e400002-b5a3-f393-e0a9-e50e24dcca9e":
                    self._rx = handle
                if uuid == "6e400003-b5a3-f393-e0a9-e50e24dcca9e":
                    self._tx = handle
                handle += 1
            results.append(tuple(handles))
        return tuple(results)

    def gatts_set_buffer(self, handle, size, append=False):
        if handle not in self._values or not isinstance(size, int) or not 1 <= size <= 4097:
            raise ValueError("Simulation GATT buffer must be between 1 and 4097 bytes")
        self._buffers[handle] = (size, append)

    def gatts_read(self, handle):
        value = self._values[handle]
        if self._buffers.get(handle, (0, False))[1]:
            self._values[handle] = b""
        return value

    def gatts_write(self, handle, value, send_update=False):
        if len(value) > 4097:
            raise ValueError("Simulation GATT value exceeds 4097 bytes")
        self._values[handle] = bytes(value)
        if send_update:
            self.gatts_notify(1, handle, value)
        return len(value)

    def gatts_notify(self, connection, handle, data=None):
        if not self._connected or connection != 1:
            raise OSError("Virtual BLE is not connected")
        if handle != self._tx:
            return _unsupported("BLE notification outside NanoLED TX")
        data = self._values[handle] if data is None else data
        if len(data) > 4097:
            raise ValueError("Simulation GATT notification exceeds 4097 bytes")
        data = bytes(data)
        text = self._decoder.decode(data)
        if text:
            _sim_bridge.bleOutput(text)

    def gap_advertise(self, interval_us, adv_data=None, resp_data=None, connectable=True):
        self._advertising = interval_us is not None and connectable

    def gap_disconnect(self, connection):
        if self._connected and connection == 1:
            self._connected = False
            _sim_bridge.bleActive(False)
            if self._handler:
                self._handler(2, (1, 0, b"\x00" * 6))
            return True
        return False

    def _poll(self, commands):
        if not self._active or not self._handler:
            return
        if self._advertising and not self._connected and self._rx is not None and self._tx is not None:
            self._connected = True
            self._advertising = False
            self._handler(1, (1, 0, b"\x00" * 6))
            self._handler(21, (1, 247))
            _sim_bridge.bleActive(True)
        if not self._connected:
            return
        for command in commands:
            encoded = command.encode("ascii")
            if not encoded.endswith(b"\n"):
                encoded += b"\n"
            limit, append = self._buffers.get(self._rx, (128, False))
            if len(encoded) > limit:
                raise ValueError("Virtual BLE command exceeds RX buffer")
            if append and len(self._values[self._rx]) + len(encoded) > limit:
                raise ValueError("Virtual BLE RX buffer is full")
            self._values[self._rx] = (self._values[self._rx] + encoded) if append else encoded
            self._handler(3, (1, self._rx))


class _Button:
    def __init__(self):
        self._pressed = False
        self._previous = False

    def _update(self):
        self._previous = self._pressed
        self._pressed = bool(_sim_bridge.button())

    def isPressed(self):
        return self._pressed

    def isReleased(self):
        return not self._pressed

    def wasPressed(self):
        return self._pressed and not self._previous

    def wasReleased(self):
        return not self._pressed and self._previous


_m5_button = _Button()
_time = _module("time", ticks_ms=_ticks_ms, ticks_us=_ticks_us,
                ticks_diff=_ticks_diff, ticks_add=lambda tick, delta: (tick + delta) % _TICKS_PERIOD,
                sleep=lambda seconds: _wait(seconds * 1000), sleep_ms=_wait,
                sleep_us=lambda microseconds: _wait(microseconds / 1000),
                time=lambda: _sim_bridge.now() / 1000, monotonic=lambda: _sim_bridge.now() / 1000)
_machine = _module("machine", Pin=_Pin, bitstream=_bitstream)
_bluetooth = _module("bluetooth", BLE=_BLE, UUID=_UUID, FLAG_READ=2, FLAG_WRITE=8,
                    FLAG_WRITE_NO_RESPONSE=4, FLAG_NOTIFY=16, FLAG_INDICATE=32)
_micropython = _module("micropython", const=lambda value: value,
                       native=lambda function: function, viper=lambda function: function)
_modules = {
    "machine": _machine, "neopixel": _module("neopixel", NeoPixel=_NeoPixel),
    "time": _time, "utime": _time, "json": _json, "ujson": _json,
    "math": _math, "random": _random, "urandom": _random,
    "struct": _struct, "ustruct": _struct, "binascii": _binascii, "ubinascii": _binascii,
    "collections": _collections, "ucollections": _collections, "array": _array,
    "errno": _errno, "micropython": _micropython, "bluetooth": _bluetooth,
    "M5": _module("M5", begin=lambda: None, update=_m5_button._update, BtnA=_m5_button),
    # ヒープ量を仮の実機値として捏造しない。メモリ計測APIは未対応として報告。
    "gc": _module("gc", collect=lambda: None),
}


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name not in _modules:
        raise ModuleNotFoundError("Simulation does not support import " + name)
    return _modules[name]


def _sim_execute(source):
    """Run the unchanged editor text; the host must terminate/reset the Worker."""
    safe_builtins = dict(vars(_builtins))
    safe_builtins["__import__"] = _import
    for name in ("open", "exec", "eval", "compile", "input", "breakpoint"):
        safe_builtins[name] = lambda *args, _name=name, **kwargs: _unsupported(_name)
    namespace = {"__name__": "__main__", "__file__": "main.py", "__builtins__": safe_builtins}
    compiled = compile(source, "main.py", "exec")
    _sys.settrace(_trace)
    try:
        exec(compiled, namespace, namespace)
    finally:
        _sys.settrace(None)
