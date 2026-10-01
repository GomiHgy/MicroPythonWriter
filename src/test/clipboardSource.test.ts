import { describe, expect, it } from 'vitest'
import { extractClipboardSource, MAX_CLIPBOARD_SOURCE_LENGTH } from '../services/editor/clipboardSource'

describe('extractClipboardSource', () => {
  it.each([
    'from machine import Pin\nfrom neopixel import NeoPixel\nnp = NeoPixel(Pin(2), 37)\nnp.fill((255, 178, 242))\nnp.write()\n',
    'LED_COUNT = 37',
    'print("こんにちは")',
    'np[0] = (255, 0, 0)',
    'brightness += 1',
    '# 日本語の説明\n"""プログラムの説明"""\nimport time\nwhile True:\n    time.sleep_ms(10)\n',
    '@micropython.native\ndef update():\n    return 1\n',
    'async def animate():\n    await asyncio.sleep_ms(10)\n',
    'class Light:\n    def show(self):\n        pass\n',
    'try:\n    np.write()\nexcept Exception as error:\n    print(error)\nfinally:\n    np.fill((0, 0, 0))\n',
    'with open("main.py") as file:\n    source = file.read()\n',
    'buffer = bytearray([\n    70, 100, 95,  # GRB\n    0, 0, 0,\n])\n',
    '\n\nif True:\n\tprint("タブも維持")\n\n',
    '"""Example:\n```python\nprint(1)\n```\n"""\nimport time\n',
  ])('Python のコードと空白をそのまま取り出す: %s', source => {
    expect(extractClipboardSource(source)).toEqual({ ok: true, source })
  })

  it('BOM と Windows 改行だけを正規化する', () => {
    expect(extractClipboardSource('\uFEFFimport time\r\n\r\nwhile True:\r\n    time.sleep_ms(10)\r\n'))
      .toEqual({ ok: true, source: 'import time\n\nwhile True:\n    time.sleep_ms(10)\n' })
  })

  it.each(['python', 'py', 'micropython', 'Python', ''])('単一の %s コードブロックを取り出す', language => {
    const source = '\nfrom machine import Pin\nif True:\n    print("LED")\n\n'
    expect(extractClipboardSource(`以下を main.py に貼り付けてください。\n\n\`\`\`${language}\n${source}\`\`\`\nコードの説明です。`))
      .toEqual({ ok: true, source })
  })

  it('チルダのコードブロックにも対応する', () => {
    expect(extractClipboardSource('~~~python\nprint(1)\n~~~')).toEqual({ ok: true, source: 'print(1)\n' })
  })

  it('別言語のブロックと Python のブロックがある場合は Python だけを取り出す', () => {
    expect(extractClipboardSource('```json\n{"leds": 37}\n```\n```python\nLED_COUNT = 37\n```'))
      .toEqual({ ok: true, source: 'LED_COUNT = 37\n' })
  })

  it.each([
    '```python\nprint(1)\n```\n```python\nprint(2)\n```',
    '```\nprint(1)\n```\n```py\nprint(2)\n```',
    '```python\n\n```\n```python\nprint(2)\n```',
  ])('貼り付けるコードが複数ある場合は選ばない', source => {
    expect(extractClipboardSource(source)).toEqual({ ok: false, reason: 'ambiguous' })
  })

  it.each(['', ' \n\t', '\uFEFF\r\n', '```python\n```', '```\n  \n```'])('空のコードで置換しない', source => {
    expect(extractClipboardSource(source)).toEqual({ ok: false, reason: 'empty' })
  })

  it.each([
    'LED の明るさを変更してください。',
    'hello world', 'hello', 'こんにちは', '# コメントだけ', '"説明だけです"',
    '37', '(255, 0, 0)', '[1, 2, 3]', '{"leds": 37, "brightness": 20}',
    'ValueError: invalid', 'Error: failed', 'status: ready',
    'Traceback (most recent call last):\n  File "main.py", line 3\nValueError: invalid',
    '>>> print(1)\n1\n>>>', 'OK__MAIN_SIZE__207',
    'def foo(:\n    pass', 'if True:\nprint(1)', 'np.fill((255, 0, 0)',
    '```javascript\nconsole.log("test")\n```',
    '```makefile\nLED_COUNT = 37\n```',
    '```python\nprint(1)', '````python\nprint(1)\n```',
    '```python\nLED を点灯してください\n```',
    'import time\n\u0000print(1)', 'import time\n\u001B[31mprint(1)',
  ])('文章・ログ・未完成コードを貼り付けない: %s', source => {
    expect(extractClipboardSource(source)).toEqual({ ok: false, reason: 'not-python' })
  })

  it('大きすぎるテキストは構文解析前に拒否する', () => {
    expect(extractClipboardSource('print(1)\n' + '#'.repeat(MAX_CLIPBOARD_SOURCE_LENGTH)))
      .toEqual({ ok: false, reason: 'too-large' })
  })

  it('コードらしさの判定であり危険なコードを実行しない', () => {
    const source = 'import machine\nmachine.reset()\n'
    expect(extractClipboardSource(source)).toEqual({ ok: true, source })
  })
})
