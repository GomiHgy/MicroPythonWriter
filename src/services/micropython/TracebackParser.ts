import type { ParsedTraceback } from '../../types'
export class TracebackParser {
  parse(output: string, source = '', intentionalStop = false): ParsedTraceback | undefined {
    const start = output.lastIndexOf('Traceback (most recent call last):'); const body = start >= 0 ? output.slice(start) : output
    const match = body.match(/File "main\.py", line (\d+)/g); const lineMatch = match?.at(-1)?.match(/(\d+)/); const line = lineMatch ? Number(lineMatch[1]) : undefined
    const exception = body.match(/(?:^|\n)(SyntaxError|IndentationError|NameError|TypeError|ValueError|ImportError|ModuleNotFoundError|OSError|MemoryError|RuntimeError|KeyboardInterrupt)(?::\s*(.*))?\s*$/m)
    if (!exception && start < 0) return undefined
    const exceptionType = exception?.[1] ?? 'Traceback'; const intentionalInterrupt = exceptionType === 'KeyboardInterrupt' && intentionalStop
    return { exceptionType, message: exception?.[2] ?? '', traceback: body, line, codeLine: line ? source.split(/\r?\n/)[line - 1] : undefined, intentionalInterrupt }
  }
}
