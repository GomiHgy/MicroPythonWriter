import { describe, expect, it } from 'vitest'
import { hasBleInitialization } from '../services/editor/bleProgram'

describe('Bluetooth先行初期化の候補を実行せず判定する', () => {
  it.each([
    'import bluetooth\nble = bluetooth.BLE()\nble.active(True)',
    'import bluetooth as bt\nradio.bt = bt.BLE()\nradio.bt.active(True)',
    'import machine, bluetooth as bt\nble = bt.BLE()\nble.active(True)',
    'from bluetooth import BLE\nble = BLE()\nble.active(True)',
    'from bluetooth import UUID, BLE as Radio\nble = Radio()\nble.active(True)',
    'from bluetooth import (\n BLE as Radio,\n UUID,\n)\nble = Radio()\nble.active(True)',
    'import bluetooth\nble: object = (bluetooth.BLE())\nble.active((True))',
    'import bluetooth\nble = bluetooth.BLE(\n)\nble.active(\n True, # enable\n)',
    'import bluetooth\nble = bluetooth.BLE()\ndef main():\n    ble.active(True)\nmain()',
    'class Radio:\n    def __init__(self):\n        import bluetooth\n        self.ble = bluetooth.BLE()\n    def start(self):\n        self.ble.active(True)',
    'def main():\n    import bluetooth as bt\n    ble = bt.BLE()\n    ble.active(True)',
    'import bluetooth; ble = bluetooth.BLE(); ble.active(True)',
  ])('既知のimport・コンストラクタ・True有効化を検出する: %s', source => {
    const original = source
    expect(hasBleInitialization(source)).toBe(true)
    expect(source).toBe(original)
  })

  it('添付作品と同じローカルimport・クラス・複数行形式を検出するが、設定値の実行は推測しない', () => {
    const source = 'CONFIG = {"wireless": False}\nclass NanoBle:\n    def __init__(self):\n        import bluetooth\n        self.ble = bluetooth.BLE()\n        try:\n            self.ble.active(\n                True\n            )\n        except Exception:\n            self.ble.active(False)\ndef main():\n    if CONFIG["wireless"]:\n        radio = NanoBle()\n'
    // チェックボックスは利用者の明示同意用。この判定だけで初期化してはいけない。
    expect(hasBleInitialization(source)).toBe(true)
  })

  it.each([
    '', 'print("LED only")', 'if :',
    '# import bluetooth\n# ble = bluetooth.BLE()\n# ble.active(True)',
    'text = "import bluetooth; ble = bluetooth.BLE(); ble.active(True)"',
    'text = """import bluetooth\nble = bluetooth.BLE()\nble.active(True)\n"""',
    'import bluetooth\nble = bluetooth.BLE()\ntext = f"{ble.active(True)}"',
    'import bluetooth\nble = bluetooth.BLE()\ncallback = lambda: ble.active(True)',
    'import bluetooth\nble = bluetooth.BLE()\nvalues = [ble.active(True) for _ in []]',
    'import bluetooth\nble = bluetooth.BLE()\nvalues = {ble.active(True) for _ in []}',
    'import bluetooth\nble = bluetooth.BLE()\nvalues = {key: ble.active(True) for key in []}',
    'import bluetooth\nble = bluetooth.BLE()\nvalues = (ble.active(True) for _ in [])',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(False)',
    'import bluetooth\nble = bluetooth.BLE()\nble.active()',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(1)',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(enabled)',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(True, False)',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(active=True)',
    'import bluetooth\nble = bluetooth.BLE()\nother.active(True)',
    'import bluetooth\nble = unrelated.BLE()\nble.active(True)',
    'import bluetooth\nble = wrap(bluetooth.BLE())\nble.active(True)',
    'import bluetooth\nble = bluetooth.BLE(123)\nble.active(True)',
    'import bluetooth\nble = radio = bluetooth.BLE()\nble.active(True)',
    'from bluetooth import *\nble = BLE()\nble.active(True)',
    'from other import BLE\nble = BLE()\nble.active(True)',
    'from .bluetooth import BLE\nble = BLE()\nble.active(True)',
    'import bluetooth.other\nble = bluetooth.other.BLE()\nble.active(True)',
    'def first():\n    import bluetooth\ndef second():\n    ble = bluetooth.BLE()\n    ble.active(True)',
    'import bluetooth\ndef first():\n    ble = bluetooth.BLE()\ndef second():\n    ble.active(True)',
    'import bluetooth\nclass First:\n    def __init__(self):\n        self.ble = bluetooth.BLE()\nclass Second:\n    def start(self):\n        self.ble.active(True)',
    'import bluetooth\nble = bluetooth.BLE()\nble.active(True)\ndef broken(:\n    pass',
  ])('無関係・遅延評価・曖昧・構文不正なコードを候補にしない: %s', source => expect(hasBleInitialization(source)).toBe(false))

  it('上限を超えるコードを解析しない', () => expect(hasBleInitialization('#'.repeat(1_000_001))).toBe(false))
})
