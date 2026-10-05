/**
 * コメント・引用文字列内のサンプルを除外し、Arduino固有の関数定義だけを識別する。
 * Pythonの構文検証ではなく、普通の構文エラーは従来の修正フローへ残す。
 */
export function isArduinoSource(source: string): boolean {
  if (!/\bvoid\s+(?:setup|loop)\s*\(/.test(source)) return false
  const visible: string[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === '#' || source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') index++
      visible.push('\n')
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end < 0 ? source.length : end + 2
      visible.push(' ')
      continue
    }
    if (character === '"' || character === "'") {
      const delimiter = source.startsWith(character.repeat(3), index) ? character.repeat(3) : character
      index += delimiter.length
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue }
        if (source.startsWith(delimiter, index)) { index += delimiter.length; break }
        index++
      }
      visible.push(' ')
      continue
    }
    visible.push(character)
    index++
  }
  // setup()/loop()の「void関数定義＋波括弧」はPythonにはない。
  // #include単独、delay()の文字列、C++というラベルだけでは拒否しない。
  return /\bvoid\s+(?:setup|loop)\s*\(\s*(?:void\s*)?\)\s*\{/.test(visible.join(''))
}
