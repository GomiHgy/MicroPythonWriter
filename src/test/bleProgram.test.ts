import { describe, expect, it } from 'vitest'
import { hasBleInitialization, shouldPrepareBle } from '../services/editor/bleProgram'
import { buildStarterProgram } from '../services/projects/StarterProgram'

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
    // 候補判定だけではFalse設定を考慮しない。自動準備の判断はshouldPrepareBleで行う。
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

describe('Bluetooth有効な作品は先行準備し、明示的な無効設定を優先する', () => {
  const ble = 'import bluetooth\nble = bluetooth.BLE()\nble.active(True)\n'

  it('利用者のCONFIG形式を読み、初期化が委譲されていてもTrueなら準備する', () => {
    const source = `CONFIG = {
    "board": "m5nanoc6",
    "firmware": "v2.5.3",
    "led_model": "WS2812B-MINI",
    "led_pin": 2,
    "led_count": 37,
    "max_brightness": 40,
    "button_pin": 9,
    "name": "NanoLED-M5NanoC6",
    "modes": [{"id": "YEL_SPARKLE", "label": "黄色キラキラ", "speed": 50}],
    "actions": [{"id": "YELLOW_FADE", "label": "黄色フェード"}],
    "wireless": True,
}
start_remote(CONFIG)
`
    const original = source
    expect(hasBleInitialization(source)).toBe(false)
    expect(shouldPrepareBle(source)).toBe(true)
    expect(source).toBe(original)
  })

  it.each([
    'CONFIG = {"wireless": True}',
    "CONFIG = {'wireless': True}",
    'CONFIG: dict = {"wireless": (True)}',
    'CONFIG = ({"wireless": True})',
    'CONFIG = {"wireless": False, "wireless": True}',
    'CONFIG = {"modes": [{"wireless": False}], "wireless": True}',
    'CONFIG = {\n "wireless": # choice\n True,\n}',
    'CONFIG = {}\nCONFIG["wireless"] = True',
    "CONFIG = {}; CONFIG['wireless'] = True",
    'CONFIG = {"wireless": False}\nCONFIG["wireless"] = (True)',
    'CONFIG = {"wireless": True}\nCONFIG["label"] = "hello"',
    'CONFIG = {"wireless": True}\nprint(CONFIG.get("wireless"))',
  ])('モジュール直下で明示的にTrueになった設定を採用する: %s', source => {
    expect(shouldPrepareBle(source)).toBe(true)
  })

  it.each([
    'CONFIG = {"wireless": False}',
    "CONFIG = {'wireless': False}",
    'CONFIG = {"wireless": True, "wireless": False}',
    'CONFIG = {"wireless": True}\nCONFIG["wireless"] = False',
    'CONFIG = {"wireless": False}\nCONFIG["label"] = "hello"',
    'CONFIG = {"wireless": False}\nprint(CONFIG.get("wireless"))',
    'CONFIG = {"wireless": True}; CONFIG = {"wireless": False}',
  ])('明示的なFalseはBLE初期化候補とAI準備のONより優先する: %s', source => {
    expect(shouldPrepareBle(`${source}\n${ble}`, true)).toBe(false)
    expect(shouldPrepareBle(`${source}\n${ble}`)).toBe(false)
  })

  it.each([
    'print("LED only")',
    'CONFIG = {"wireless": enabled}',
    'CONFIG = {"wireless": False}\nCONFIG["wireless"] = enabled',
    'CONFIG = {"wireless": False}\nCONFIG = load_config()',
    'CONFIG = {"wireless": False}\nCONFIG = {}',
    'CONFIG = {"wireless": False}\nCONFIG = other = load_config()',
    'CONFIG = {"wireless": False}\nother = CONFIG = load_config()',
    'CONFIG = {"wireless": False}\nCONFIG[key] = True',
    'CONFIG = {"wireless": False}\nCONFIG.update(other)',
    'CONFIG = {"wireless": False}\nCONFIG.clear()',
    'CONFIG = {"wireless": False}\nCONFIG.pop("wireless")',
    'CONFIG = {"wireless": False}\nCONFIG.__setitem__("wireless", enabled)',
    'CONFIG = {"wireless": False}\nCONFIG |= other',
    'CONFIG = {"wireless": False}\nCONFIG["wireless"] += enabled',
    'CONFIG = {"wireless": False}\ndel CONFIG["wireless"]',
    'CONFIG = {"wireless": False}\nif enabled:\n CONFIG["wireless"] = True',
    'CONFIG = {"wireless": False}\nif enabled:\n CONFIG.update(other)',
    'CONFIG = {"wireless": False}\nCONFIG = {**extra, "wireless": False}',
    'CONFIG = {"wireless": False}\nCONFIG = {key: value, "wireless": False}',
    'CONFIG = {"wireless": False}\nfrom settings import CONFIG',
    'CONFIG = {"wireless": False}\nfrom settings import value as CONFIG',
    'CONFIG = {"wireless": False}\nimport settings as CONFIG',
    'CONFIG = {"wireless": False}\nimport CONFIG.settings',
    'CONFIG = {"wireless": False}\nfrom settings import *',
    'CONFIG = {"wireless": False}\nfor CONFIG in configurations:\n pass',
    'CONFIG = {"wireless": False}\nfor CONFIG, other in configurations:\n pass',
    'CONFIG = {"wireless": False}\nwith connection as CONFIG:\n pass',
    'CONFIG = {"wireless": False}\ntry:\n pass\nexcept ValueError as CONFIG:\n pass',
    'CONFIG = {"wireless": False}\n(CONFIG := load_config())',
    'CONFIG = {"wireless": False}\nCONFIG, other = values',
    'CONFIG = {"wireless": False}\ndef CONFIG():\n pass',
    'CONFIG = {"wireless": False}\nclass CONFIG:\n pass',
  ])('不明または動的な設定では過去のFalseを残さず、照合済みの準備設定へ戻る: %s', source => {
    expect(shouldPrepareBle(source, true)).toBe(true)
    expect(shouldPrepareBle(source)).toBe(false)
    expect(shouldPrepareBle(`${source}\n${ble}`)).toBe(true)
  })

  it.each([
    '# CONFIG = {"wireless": True}',
    'text = "CONFIG = {\\"wireless\\": True}"',
    'text = """CONFIG = {"wireless": True}"""',
    'text = f"CONFIG = {enabled}"',
    'other = {"CONFIG": {"wireless": True}}',
    'CONFIG = {"modes": [{"wireless": True}]}',
    'def unused():\n CONFIG = {"wireless": True}',
    'class Other:\n CONFIG = {"wireless": True}',
    'if enabled:\n CONFIG = {"wireless": True}',
    'wireless = False\nprint(wireless)',
  ])('コメント・文字列・別スコープ・他のwirelessを有効設定とみなさない: %s', source => {
    expect(shouldPrepareBle(source)).toBe(false)
    expect(shouldPrepareBle(source, true)).toBe(true)
  })

  it('関数・クラス内の未実行設定がモジュール直下のFalseを上書きしない', () => {
    const source = `CONFIG = {"wireless": False}
def unused():
    CONFIG = {"wireless": True}
class Other:
    CONFIG = {"wireless": True}
${ble}`
    expect(shouldPrepareBle(source, true)).toBe(false)
  })

  it.each([
    'import bluetooth as bt\nradio.bt = bt.BLE()\nradio.bt.active(True)',
    'from bluetooth import BLE as Radio\nble = Radio()\nble.active(True)',
    'wireless = False\nimport bluetooth\nble = bluetooth.BLE()\nble.active(True)',
    'other = {"wireless": False}\nimport bluetooth\nble = bluetooth.BLE()\nble.active(True)',
  ])('CONFIGの明示設定がなければ既存の初期化候補判定を利用する: %s', source => {
    expect(shouldPrepareBle(source)).toBe(true)
  })

  it.each(['', ' ', 'if :', 'CONFIG = {"wireless": True}\ndef broken(:\n pass', '#'.repeat(1_000_001)])('構文不正・空・大きすぎるコードでは準備設定も採用しない', source => {
    expect(shouldPrepareBle(source, true)).toBe(false)
  })
})

describe('標準入門コードと既知のJSON設定をPythonとして実行せず判定する', () => {
  const ble = '\nimport bluetooth\nble = bluetooth.BLE()\nble.active(True)\n'
  const literal = (config: object) => JSON.stringify(config).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

  it.each((['m5nanoc6', 'atoms3lite'] as const).flatMap(boardId => [false, true].map(wireless => ({ boardId, wireless }))))('生成済み入門コードの設定を優先する: $boardId / wireless=$wireless', ({ boardId, wireless }) => {
    const source = buildStarterProgram(
      { boardId, firmwareVersion: 'provider-test-only', ledModel: 'WS2812B', ledCount: 10, ledPin: 2, maxBrightnessPercent: 20 },
      { modes: [{ id: 'WARM', label: "黄色 'スター' \\ 🌟", icon: 'light', kind: 'solid', color: '#ffcc00', speed: 50, repeats: 0, endState: 'hold' }], shortPress: 'next', doublePress: 'none', longPress: 'toggle', whileHeld: false, wireless },
    )
    const original = source
    // 無線無効版にもBLE実装そのものは含まれるので、候補検出だけでは判別できない。
    expect(hasBleInitialization(source)).toBe(true)
    expect(shouldPrepareBle(source)).toBe(wireless)
    expect(shouldPrepareBle(source, true)).toBe(wireless)
    expect(source).toBe(original)
  })

  it.each([
    ['import json', 'json.loads'],
    ['import json as j', 'j.loads'],
    ['import sys, json as j', 'j.loads'],
    ['from json import loads', 'loads'],
    ['from json import loads as decode', 'decode'],
    ['from json import (loads as decode, dumps)', 'decode'],
  ])('既知のjson.loadsと別名をサポートする: %s / %s', (imports, call) => {
    for (const wireless of [false, true]) {
      const source = `${imports}\nCONFIG = ${call}('${literal({ wireless, label: "黄色 'スター' \\ \"🌟\"", modes: [{ wireless: !wireless }] })}')${ble}`
      expect(shouldPrepareBle(source, true)).toBe(wireless)
      expect(shouldPrepareBle(source)).toBe(wireless)
    }
  })

  it('Python側とJSON側のUnicodeエスケープをどちらも安全に読み取る', () => {
    const payload = '{"\\u0077ireless":false,"label":"\\u9ec4\\u8272"}'
    const source = `import json\nCONFIG = json.loads('${payload.replace(/\\/g, '\\\\')}')${ble}`
    expect(shouldPrepareBle(source, true)).toBe(false)
    const pythonEscaped = `import json\nCONFIG = json.loads('{"\\u0077ireless":false}')${ble}`
    expect(shouldPrepareBle(pythonEscaped, true)).toBe(false)
  })

  it.each([
    'CONFIG = json.loads(\'{"wireless":false}\')',
    'import unrelated as json\nCONFIG = json.loads(\'{"wireless":false}\')',
    'from unrelated import loads\nCONFIG = loads(\'{"wireless":false}\')',
    'import json\njson = unrelated\nCONFIG = json.loads(\'{"wireless":false}\')',
    'import json\njson.loads = custom\nCONFIG = json.loads(\'{"wireless":false}\')',
    'from json import loads\ndef loads(value):\n return {}\nCONFIG = loads(\'{"wireless":false}\')',
    'import json\nif enabled:\n import unrelated as json\nCONFIG = json.loads(\'{"wireless":false}\')',
    'import json\nCONFIG = json.loads(payload)',
    'import json\nCONFIG = json.loads(\'{"wireless":false}\', custom)',
    'import json\nCONFIG = json.loads(data=\'{"wireless":false}\')',
    'import json\nCONFIG = json.loads(\'{"wireless":false}\' + extra)',
    'import json\nCONFIG = json.loads(r\'{"wireless":false}\')',
    'import json\nCONFIG = json.loads(b\'{"wireless":false}\')',
    'import json\nCONFIG = json.loads(\'\'\'{"wireless":false}\'\'\')',
    'import json\nCONFIG = json.loads(\'{"wireless":False}\')',
    'import json\nCONFIG = json.loads(\'{"wireless":"false"}\')',
    'import json\nCONFIG = json.loads(\'[{"wireless":false}]\')',
    'import json\nCONFIG = json.loads(\'null\')',
    'import json\nCONFIG = json.loads(\'{"label":"\\q","wireless":false}\')',
  ])('不明な関数・動的引数・対象外文字列・不正JSONからFalseを推測しない: %s', source => {
    expect(shouldPrepareBle(source, true)).toBe(true)
    expect(shouldPrepareBle(`${source}${ble}`)).toBe(true)
  })
})
