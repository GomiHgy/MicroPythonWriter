import { describe, expect, it } from 'vitest'
import { isArduinoSource } from '../services/editor/sourceLanguage'
import { extractClipboardSource } from '../services/editor/clipboardSource'

const arduino = '#include <Arduino.h>\nvoid setup() { pinMode(2, OUTPUT); }\nvoid loop() { digitalWrite(2, HIGH); }\n'

describe('明確なArduinoコードの検出', () => {
  it.each([arduino, 'void setup(void)\n{\n}\n', 'void loop() { delay(10); }', '// example\n' + arduino, `次のコードです。\n\`\`\`cpp\n${arduino}\`\`\``])('Arduino固有の関数定義を検出する', source => {
    expect(isArduinoSource(source)).toBe(true)
    expect(extractClipboardSource(source)).toEqual({ ok: false, reason: 'arduino' })
  })
  it.each([
    '#include <Arduino.h>\n# void setup() {\nprint(1)',
    '# void loop() { delay(10); }\nimport time',
    'description = "void setup() { delay(10); }"\nprint(description)',
    "description = 'void loop() { }'\nprint(description)",
    'r"""#include <Arduino.h>\nvoid setup() { }\nvoid loop() { }\n"""\nimport machine',
    '"""Example:\n```cpp\nvoid setup() { }\n```\n"""\nLED_COUNT = 10',
    "'''void setup() { }'''\nprint(1)",
    'description = "escaped \\" void loop() { }"\nprint(1)',
    '/* void setup() { } */\nprint(1)',
    '// void loop() { }\nprint(1)',
    'def setup():\n    pass\ndef loop():\n    pass',
    'def broken(:\n    pass',
    'if True:\nprint(1)',
    'print("void setup() { }',
    'print("C++")\ndelay(10)',
  ])('コメント・文字列・Pythonの構文エラーをArduinoとして拒否しない: %s', source => {
    expect(isArduinoSource(source)).toBe(false)
  })
  it('有効なPythonブロックがあれば周辺のC++例で置換を拒否しない', () => {
    expect(extractClipboardSource(`\`\`\`cpp\n${arduino}\`\`\`\n\`\`\`python\nprint(1)\n\`\`\``)).toEqual({ ok: true, source: 'print(1)\n' })
  })
  it('英語の説明文に引用記号があってもC++コードブロックだけで識別する', () => {
    expect(extractClipboardSource(`Here's your code:\n\`\`\`cpp\n${arduino}\`\`\``)).toEqual({ ok: false, reason: 'arduino' })
  })
})
