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
