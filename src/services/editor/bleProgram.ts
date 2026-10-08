import { pythonLanguage } from '@codemirror/lang-python'

type Node = ReturnType<typeof pythonLanguage.parser.parse>['topNode']
const excluded = new Set(['Comment', 'String', 'StringConcat', 'FormatString', 'LambdaExpression', 'ComprehensionExpression', 'ArrayComprehensionExpression', 'SetComprehensionExpression', 'DictionaryComprehensionExpression', 'GeneratorExpression'])
const scopeNames = new Set(['Script', 'FunctionDefinition', 'ClassDefinition'])

function children(node: Node): Node[] {
  const result: Node[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child)
  return result
}

function unwrap(node: Node | null): Node | null {
  while (node?.name === 'ParenthesizedExpression') {
    const content = children(node).filter(child => !['(', ')', 'Comment'].includes(child.name))
    if (content.length !== 1) return null
    node = content[0]
  }
  return node
}

function nameOf(node: Node | null, source: string): string | null {
  node = unwrap(node)
  if (node?.name === 'VariableName' || node?.name === 'PropertyName') return source.slice(node.from, node.to)
  if (node?.name !== 'MemberExpression') return null
  const parts = children(node).filter(child => child.name !== 'Comment')
  if (parts.length !== 3 || parts[1].name !== '.') return null
  const base = nameOf(parts[0], source), property = nameOf(parts[2], source)
  return base && property ? `${base}.${property}` : null
}

function scopes(node: Node): string[] {
  const result: string[] = []
  for (let current: Node | null = node; current; current = current.parent) {
    if (scopeNames.has(current.name)) result.push(`${current.name}:${current.from}`)
  }
  return result
}

function receiverScopes(node: Node, receiver: string): string[] {
  // selfのメンバーは同じクラス内の別メソッドからも使用される。
  if (receiver.startsWith('self.')) {
    for (let current: Node | null = node; current; current = current.parent) {
      if (current.name === 'ClassDefinition') return [`${current.name}:${current.from}`]
    }
  }
  return scopes(node)
}

function literalBoolean(node: Node | null, source: string): boolean | undefined {
  node = unwrap(node)
  if (node?.name !== 'Boolean') return undefined
  const text = source.slice(node.from, node.to)
  return text === 'True' ? true : text === 'False' ? false : undefined
}

function literalString(node: Node, source: string): string | null {
  if (node.name !== 'String') return null
  const text = source.slice(node.from, node.to)
  // CONFIGのキーは通常の引用符付き文字列だけを扱う。評価・エスケープ展開はしない。
  const match = /^(['"])([^\\\r\n]*?)\1$/.exec(text)
  return match?.[2] ?? null
}

type ConfigTarget = 'config' | 'wireless' | 'other' | 'unknown'

function configTarget(node: Node | null, source: string): ConfigTarget | null {
  node = unwrap(node)
  if (node?.name === 'VariableName' && source.slice(node.from, node.to) === 'CONFIG') return 'config'
  if (node?.name !== 'MemberExpression') return null
  const parts = children(node).filter(child => child.name !== 'Comment')
  if (parts[0]?.name !== 'VariableName' || source.slice(parts[0].from, parts[0].to) !== 'CONFIG') return null
  if (parts.length !== 4 || parts[1].name !== '[' || parts[3].name !== ']') return 'unknown'
  const key = literalString(parts[2], source)
  return key === 'wireless' ? 'wireless' : key === null ? 'unknown' : 'other'
}

function dictionaryWireless(node: Node | null, source: string): boolean | undefined {
  node = unwrap(node)
  if (node?.name !== 'DictionaryExpression') return undefined
  const parts = children(node).filter(child => !['{', '}', 'Comment'].includes(child.name))
  let wireless: boolean | undefined
  for (let index = 0; index < parts.length;) {
    const key = literalString(parts[index], source)
    // 動的なキー・辞書の展開は既知のwirelessを上書きし得るので、不明として扱う。
    if (key === null || parts[index + 1]?.name !== ':' || !parts[index + 2]) return undefined
    if (key === 'wireless') wireless = literalBoolean(parts[index + 2], source)
    index += 3
    if (index < parts.length && parts[index++].name !== ',') return undefined
  }
  return wireless
}

type JsonBinding = 'module' | 'loads'

function importedBindings(node: Node, source: string): { name: string; json?: JsonBinding }[] {
  const parts = children(node).filter(child => !['(', ')', 'Comment'].includes(child.name))
  const from = parts[0]?.name === 'from'
  const importIndex = parts.findIndex(child => child.name === 'import')
  if (importIndex < 0) return []
  const fromJson = from && importIndex === 2 && parts[1].name === 'VariableName' && source.slice(parts[1].from, parts[1].to) === 'json'
  const result: { name: string; json?: JsonBinding }[] = []
  for (let index = importIndex + 1; index < parts.length;) {
    const end = parts.findIndex((child, next) => next >= index && child.name === ',')
    const group = parts.slice(index, end < 0 ? parts.length : end)
    index = end < 0 ? parts.length : end + 1
    if (group[0]?.name === '*') { result.push({ name: '*' }); continue }
    if (group[0]?.name !== 'VariableName') continue
    const as = group.findIndex(child => child.name === 'as')
    const binding = as < 0 ? group[0] : group[as + 1]
    if (binding?.name !== 'VariableName') continue
    const name = source.slice(binding.from, binding.to)
    const imported = source.slice(group[0].from, group[0].to)
    const ordinary = group.length === 1 || (group.length === 3 && as === 1)
    const json = ordinary && ((!from && imported === 'json') || (fromJson && imported === 'loads')) ? from ? 'loads' : 'module' : undefined
    result.push({ name, json })
  }
  return result
}

function pythonString(node: Node | null, source: string): string | null {
  node = unwrap(node)
  if (node?.name !== 'String') return null
  const text = source.slice(node.from, node.to), quote = text[0]
  if (!['"', "'"].includes(quote) || text.at(-1) !== quote || text.startsWith(quote.repeat(3))) return null
  const escapes: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\x0b' }
  let value = ''
  for (let index = 1; index < text.length - 1; index++) {
    const char = text[index]
    if (char !== '\\') { value += char; continue }
    const escaped = text[++index]
    if (escaped in escapes) { value += escapes[escaped]; continue }
    const length = escaped === 'x' ? 2 : escaped === 'u' ? 4 : escaped === 'U' ? 8 : 0
    if (!length) return null
    const hex = text.slice(index + 1, index + 1 + length)
    if (hex.length !== length || !/^[0-9a-f]+$/i.test(hex)) return null
    const codepoint = Number.parseInt(hex, 16)
    if (codepoint > 0x10ffff) return null
    value += String.fromCodePoint(codepoint)
    index += length
  }
  return value
}

function jsonWireless(node: Node | null, source: string, aliases: Map<string, JsonBinding>): boolean | undefined {
  node = unwrap(node)
  if (node?.name !== 'CallExpression' || node.lastChild?.name !== 'ArgList') return undefined
  const callee = nameOf(node.firstChild, source)
  if (!callee || !(aliases.get(callee) === 'loads' || (callee.endsWith('.loads') && aliases.get(callee.slice(0, -'.loads'.length)) === 'module'))) return undefined
  const args = children(node.lastChild).filter(child => !['(', ')', ',', 'Comment'].includes(child.name))
  if (args.length !== 1) return undefined
  const literal = pythonString(args[0], source)
  if (literal === null) return undefined
  try {
    const config: unknown = JSON.parse(literal)
    if (!config || typeof config !== 'object' || Array.isArray(config) || !('wireless' in config)) return undefined
    return typeof config.wireless === 'boolean' ? config.wireless : undefined
  } catch { return undefined }
}

function targetBindings(node: Node, source: string): string[] {
  const target = unwrap(node)
  if (target?.name === 'VariableName') return [source.slice(target.from, target.to)]
  if (!target || target.name === 'MemberExpression' || excluded.has(target.name)) return []
  return children(target).flatMap(child => targetBindings(child, source))
}

function moduleBindings(node: Node, source: string): Set<string> {
  if (excluded.has(node.name)) return new Set()
  const parts = children(node)
  if (['FunctionDefinition', 'ClassDefinition'].includes(node.name)) {
    const name = parts.find(child => child.name === 'VariableName')
    return new Set(name ? [source.slice(name.from, name.to)] : [])
  }
  if (node.name === 'ImportStatement') return new Set(importedBindings(node, source).map(binding => binding.name))
  const result = new Set<string>()
  if (['AssignStatement', 'UpdateStatement', 'NamedExpression'].includes(node.name)) {
    let operator = -1
    for (let index = 0; index < parts.length; index++) if (['AssignOp', 'UpdateOp'].includes(parts[index].name)) operator = index
    for (const part of parts.slice(0, Math.max(0, operator))) for (const name of targetBindings(part, source)) result.add(name)
  }
  if (node.name === 'ForStatement') {
    const end = parts.findIndex(child => child.name === 'in')
    for (const part of parts.slice(1, end)) for (const name of targetBindings(part, source)) result.add(name)
  }
  if (['WithStatement', 'TryStatement'].includes(node.name)) {
    for (let index = 0; index < parts.length; index++) {
      if (parts[index].name === 'as' && parts[index + 1]) for (const name of targetBindings(parts[index + 1], source)) result.add(name)
    }
  }
  if (node.name === 'DeleteStatement') for (const part of parts) for (const name of targetBindings(part, source)) result.add(name)
  for (const part of parts) for (const name of moduleBindings(part, source)) result.add(name)
  return result
}

function mayChangeJsonMember(node: Node, source: string, alias: string): boolean {
  if (excluded.has(node.name) || ['FunctionDefinition', 'ClassDefinition'].includes(node.name)) return false
  if (['AssignStatement', 'UpdateStatement', 'DeleteStatement'].includes(node.name)) {
    const parts = children(node)
    const operator = parts.findIndex(child => ['AssignOp', 'UpdateOp'].includes(child.name))
    const targets = node.name === 'DeleteStatement' ? parts : parts.slice(0, operator)
    if (targets.some(target => nameOf(target, source) === `${alias}.loads`)) return true
  }
  return children(node).some(child => mayChangeJsonMember(child, source, alias))
}

const configMutators = new Set(['update', 'clear', 'pop', 'popitem', 'setdefault', '__setitem__', '__delitem__'])

function mayChangeWireless(node: Node, source: string): boolean {
  // 別スコープ内のCONFIGは、モジュールの設定として採用しない。
  if (excluded.has(node.name) || ['FunctionDefinition', 'ClassDefinition'].includes(node.name)) return false
  if (['AssignStatement', 'UpdateStatement'].includes(node.name)) {
    const parts = children(node)
    let operator = -1
    for (let index = 0; index < parts.length; index++) {
      if (['AssignOp', 'UpdateOp'].includes(parts[index].name)) operator = index
    }
    if (parts.slice(0, operator).some(child => {
      const target = configTarget(child, source)
      return target !== null && target !== 'other'
    })) return true
  }
  if (node.name === 'DeleteStatement' && children(node).some(child => {
    const target = configTarget(child, source)
    return target !== null && target !== 'other'
  })) return true
  if (node.name === 'CallExpression') {
    const callee = nameOf(node.firstChild, source)
    if (callee?.startsWith('CONFIG.') && configMutators.has(callee.slice('CONFIG.'.length))) return true
  }
  return children(node).some(child => mayChangeWireless(child, source))
}

function moduleWireless(root: Node, source: string): boolean | undefined {
  let wireless: boolean | undefined
  const jsonAliases = new Map<string, JsonBinding>()
  const statements = children(root).flatMap(statement => statement.name === 'StatementGroup' ? children(statement) : [statement])
  for (const statement of statements) {
    if (statement.name === 'ImportStatement') {
      for (const binding of importedBindings(statement, source)) {
        if (binding.name === '*') { wireless = undefined; jsonAliases.clear(); continue }
        if (binding.name === 'CONFIG') wireless = undefined
        jsonAliases.delete(binding.name)
        if (binding.json) jsonAliases.set(binding.name, binding.json)
      }
      continue
    }
    let assigned = false
    if (statement.name === 'AssignStatement') {
      const parts = children(statement).filter(child => !['Comment', 'TypeDef'].includes(child.name))
      if (parts.length === 3 && parts[1].name === 'AssignOp' && source.slice(parts[1].from, parts[1].to) === '=') {
        const target = configTarget(parts[0], source)
        if (target === 'config') {
          wireless = dictionaryWireless(parts[2], source) ?? jsonWireless(parts[2], source, jsonAliases)
          assigned = true
        }
        if (target === 'wireless') {
          wireless = literalBoolean(parts[2], source)
          assigned = true
        }
      }
    }
    const bindings = moduleBindings(statement, source)
    for (const alias of jsonAliases.keys()) {
      if (bindings.has(alias) || bindings.has('*') || mayChangeJsonMember(statement, source, alias)) jsonAliases.delete(alias)
    }
    if (assigned) continue
    // 条件分岐・動的な変更があれば、前のリテラル設定を確定値として残さない。
    if (bindings.has('CONFIG') || bindings.has('*') || mayChangeWireless(statement, source)) wireless = undefined
  }
  return wireless
}

/**
 * BLEを使う作品の先行準備を、コードを実行せず判定する。
 * モジュール直下のCONFIG["wireless"]リテラルと既知のjson.loads文字列を優先し、不明なら初期化候補または
 * 呼び出し元が照合済みのAI準備設定を使用する。任意のPythonの実行結果は保証しない。
 */
export function shouldPrepareBle(source: string, preparationBleEnabled = false): boolean {
  if (!source.trim() || source.length > 1_000_000) return false
  try {
    const tree = pythonLanguage.parser.parse(source)
    const cursor = tree.cursor()
    do { if (cursor.type.isError) return false } while (cursor.next())
    const wireless = moduleWireless(tree.topNode, source)
    return wireless ?? (preparationBleEnabled || hasBleInitialization(source))
  } catch {
    return false
  }
}

/** BLE初期化を含む候補の判定だけを行う。条件分岐や実行時の有効設定は推測しない。 */
export function hasBleInitialization(source: string): boolean {
  if (!source.trim() || source.length > 1_000_000) return false
  try {
    const tree = pythonLanguage.parser.parse(source)
    const cursor = tree.cursor()
    do { if (cursor.type.isError) return false } while (cursor.next())
    const imports = new Map<string, Set<string>>()
    const receivers = new Map<string, Set<string>>()
    const statements: Node[] = [], calls: Node[] = []
    const visit = (node: Node) => {
      if (excluded.has(node.name)) return
      if (node.name === 'ImportStatement') {
        const parts = children(node).filter(child => !['(', ')', 'Comment'].includes(child.name))
        const fromBluetooth = parts[0]?.name === 'from' && parts[1]?.name === 'VariableName'
          && source.slice(parts[1].from, parts[1].to) === 'bluetooth' && parts[2]?.name === 'import'
        const direct = parts[0]?.name === 'import'
        if (fromBluetooth || direct) {
          const names = imports.get(scopes(node)[0]) ?? new Set<string>()
          for (let index = fromBluetooth ? 3 : 1; index < parts.length; index++) {
            const part = parts[index]
            const expected = fromBluetooth ? 'BLE' : 'bluetooth'
            if (part.name !== 'VariableName' || source.slice(part.from, part.to) !== expected
              || (index > (fromBluetooth ? 3 : 1) && parts[index - 1].name !== ',')) continue
            const alias = parts[index + 1]?.name === 'as' ? parts[index + 2] : part
            if (alias?.name === 'VariableName') names.add(`${source.slice(alias.from, alias.to)}${fromBluetooth ? '' : '.BLE'}`)
          }
          imports.set(scopes(node)[0], names)
        }
      }
      if (node.name === 'AssignStatement') statements.push(node)
      if (node.name === 'CallExpression') calls.push(node)
      for (const child of children(node)) visit(child)
    }
    visit(tree.topNode)
    for (const statement of statements) {
      const parts = children(statement).filter(child => !['Comment', 'TypeDef'].includes(child.name))
      if (parts.length !== 3 || parts[1].name !== 'AssignOp' || source.slice(parts[1].from, parts[1].to) !== '=') continue
      const receiver = nameOf(parts[0], source), call = unwrap(parts[2])
      if (!receiver || call?.name !== 'CallExpression') continue
      const callee = nameOf(call.firstChild, source)
      const args = call.lastChild?.name === 'ArgList' ? children(call.lastChild).filter(child => !['(', ')', 'Comment'].includes(child.name)) : null
      if (!callee || !args || args.length || !scopes(statement).some(scope => imports.get(scope)?.has(callee))) continue
      const key = receiverScopes(statement, receiver)[0]
      const names = receivers.get(key) ?? new Set<string>()
      names.add(receiver); receivers.set(key, names)
    }
    return calls.some(call => {
      const callee = nameOf(call.firstChild, source)
      if (!callee?.endsWith('.active') || call.lastChild?.name !== 'ArgList') return false
      const args = children(call.lastChild).filter(child => !['(', ')', ',', 'Comment'].includes(child.name))
      const argument = args.length === 1 ? unwrap(args[0]) : null
      if (argument?.name !== 'Boolean' || source.slice(argument.from, argument.to) !== 'True') return false
      const receiver = callee.slice(0, -'.active'.length)
      return receiverScopes(call, receiver).some(scope => receivers.get(scope)?.has(receiver))
    })
  } catch {
    // 構文解析ができないコードを、無線初期化の同意対象にしない。
    return false
  }
}
