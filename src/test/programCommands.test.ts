import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileTransferService } from '../services/micropython/FileTransferService'
import {
  clearPreparedProgramCommand,
  prepareProgramCommand,
  startPreparedProgramCommand,
  verifyPreparedProgramCommand,
  type PreparedProgram,
} from '../services/micropython/ProgramCommands'

const pythonCommands = [process.env.PYTHON, 'python3', 'python', ...(process.platform === 'win32' ? ['py', `${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])].filter((value): value is string => Boolean(value))
const python = pythonCommands.find(command => spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0)
const harness = fileURLToPath(new URL('../../scripts/test-program-commands.py', import.meta.url))
const mainPath = '/flash/main.py'
const tempPath = `${mainPath}.tmp`

type Action = { command: string } | { write: { path: string, source: string } } | { copy: { from: string, to: string } } | { remove: string } | { reset: true }
interface Step {
  stdout: string
  error: { type: string, message: string, traceback: string } | null
  compileCount: number
  globalKeys: string[]
  sourceReferences: string[]
  cachePresent: boolean
  cacheToken: string | null
  reads: { path: string, size: number }[]
  collections: number
  openFiles: string[]
}
interface Result { steps: Step[], compilations: { filename: string, mode: string }[], files: Record<string, string> }

function program(source: string, path = mainPath, token = 'prepared-1'): PreparedProgram {
  return { token, path, byteLength: Buffer.byteLength(source, 'utf8'), digest: createHash('sha256').update(source, 'utf8').digest('hex') }
}

function simulate(files: Record<string, string>, actions: Action[]): Result {
  const result = spawnSync(python!, ['-X', 'utf8', '-B', harness], { input: JSON.stringify({ files, actions }), encoding: 'utf8', timeout: 15000 })
  expect(result.status, result.stderr || result.error?.message).toBe(0)
  return JSON.parse(result.stdout) as Result
}

function command(value: string): Action { return { command: value } }
function promote(path = mainPath): Action { return { copy: { from: `${path}.tmp`, to: path } } }

function expectReleased(step: Step) {
  expect(step.sourceReferences).toEqual([])
  expect(step.openFiles).toEqual([])
  for (const name of ['s', 'source', 'namespace', '_mpw_compile', '_mpw_verify', '_mpw_read']) expect(step.globalKeys).not.toContain(name)
}

function readFixture(files: Record<string, string>) {
  const executions: Result[] = []
  const repl = {
    async execute(code: string) {
      // readMainが実際に生成したコマンドを実行し、その出力をサービスへ返す。
      const result = simulate(files, [command(code)])
      executions.push(result)
      const step = result.steps[0]
      return { stdout: step.stdout, stderr: step.error?.traceback ?? '', completed: true, interrupted: false, durationMs: 0 }
    },
  }
  return { service: new FileTransferService(repl as never), executions }
}

describe.skipIf(!python)('prepared program commands: CPython host execution, not device verification', () => {
  it.each(['print("EXECUTED")\n', 'print("日本語🌟")\n', '', '# padding\n'.repeat(100) + 'print("STREAMED")\n'])('compiles the verified snapshot once and releases source buffers (%s)', source => {
    const prepared = program(source)
    const result = simulate({ [tempPath]: source }, [
      command(prepareProgramCommand(tempPath, prepared, true)), promote(),
      command(verifyPreparedProgramCommand(prepared)), command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.compilations).toEqual([{ filename: mainPath, mode: 'exec' }])
    expect(result.steps.every(step => step.error === null)).toBe(true)
    expect(result.steps[0].stdout).toContain(`__SIZE__${prepared.byteLength}`)
    expect(result.steps[0].stdout).toContain('__M5_COMPILE_OK__')
    expect(result.steps[0].cacheToken).toBe(prepared.token)
    expect(result.steps[2].stdout).toContain('__M5_COMPILE_OK__')
    expect(result.steps[3].cachePresent).toBe(false)
    for (const step of [result.steps[0], result.steps[2], result.steps[3]]) {
      expectReleased(step)
      expect(step.collections).toBeGreaterThan(0)
    }
    expect(result.steps[0].reads).toEqual([{ path: tempPath, size: -1 }])
    for (const step of result.steps.slice(2)) expect(step.reads.every(read => read.size === 384)).toBe(true)
    if (source.includes('EXECUTED')) expect(result.steps[3].stdout).toContain('EXECUTED')
    if (source.includes('日本語')) expect(result.steps[3].stdout).toContain('日本語🌟')
  })

  it.each(['verify', 'start'] as const)('rejects same-size changes during %s and discards the prepared code', stage => {
    const source = 'print("ORIGINAL")\n'
    const changed = 'print("MODIFIED")\n'
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(source))
    const prepared = program(source)
    const actions: Action[] = [command(prepareProgramCommand(tempPath, prepared, true)), promote()]
    if (stage === 'start') actions.push(command(verifyPreparedProgramCommand(prepared)))
    actions.push({ write: { path: mainPath, source: changed } }, command(stage === 'verify' ? verifyPreparedProgramCommand(prepared) : startPreparedProgramCommand(prepared)))
    const result = simulate({ [tempPath]: source }, actions)
    const rejected = result.steps.at(-1)!
    expect(rejected.error?.message).toContain('PROGRAM_CHANGED')
    expect(rejected.stdout).not.toContain('ORIGINAL')
    expect(rejected.stdout).not.toContain('MODIFIED')
    expect(rejected.compileCount).toBe(1)
    expect(rejected.cachePresent).toBe(false)
    expectReleased(rejected)
  })

  it.each(['missing', 'stale', 'reset'] as const)('rejects %s preparation without compiling or running the file as a fallback', state => {
    const source = 'print("SHOULD_NOT_RUN")\n'
    const prepared = program(source)
    const actions: Action[] = []
    if (state !== 'missing') actions.push(command(prepareProgramCommand(tempPath, prepared, true)))
    if (state === 'reset') actions.push({ reset: true })
    actions.push(command(startPreparedProgramCommand(state === 'stale' ? { ...prepared, token: 'different-write' } : prepared)))
    const result = simulate({ [tempPath]: source, [mainPath]: source }, actions)
    const rejected = result.steps.at(-1)!
    expect(rejected.error?.message).toContain('PROGRAM_NOT_PREPARED')
    expect(rejected.compileCount).toBe(state === 'missing' ? 0 : 1)
    expect(rejected.reads).toEqual([])
    expect(rejected.stdout).not.toContain('SHOULD_NOT_RUN')
    expect(rejected.cachePresent).toBe(false)
    expectReleased(rejected)
  })

  it('consumes the prepared program once and gives each run a fresh namespace', () => {
    const path = "/flash/custom's program.py"
    const source = 'print(__name__, __file__, "sentinel" in globals())\nrun_value=42\n'
    const prepared = program(source, path)
    const result = simulate({ [`${path}.tmp`]: source }, [
      command('sentinel="outside-user-namespace"'), command(prepareProgramCommand(`${path}.tmp`, prepared, true)), promote(path),
      command(startPreparedProgramCommand(prepared)), command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.steps[3].stdout).toContain(`__main__ ${path} False`)
    expect(result.steps[3].globalKeys).not.toContain('run_value')
    expect(result.steps[4].error?.message).toContain('PROGRAM_NOT_PREPARED')
    expect(result.steps[4].compileCount).toBe(1)
    expect(result.steps[4].reads).toEqual([])
    expect(result.compilations[0].filename).toBe(path)
  })

  it('does not run source with a syntax error or keep an older prepared program', () => {
    const source = 'print("OLD")\n'
    const invalid = 'print("SHOULD_NOT_RUN")\nif (\n'
    const prepared = program(source)
    const broken = program(invalid, mainPath, 'prepared-2')
    const result = simulate({ [tempPath]: source, [mainPath]: source }, [
      command(prepareProgramCommand(tempPath, prepared, true)), { write: { path: tempPath, source: invalid } },
      command(prepareProgramCommand(tempPath, broken, true)), command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.steps[2].error?.type).toBe('SyntaxError')
    expect(result.steps[2].stdout).not.toContain('SHOULD_NOT_RUN')
    expect(result.steps[2].stdout).not.toContain('__M5_COMPILE_OK__')
    expect(result.steps[2].cachePresent).toBe(false)
    expectReleased(result.steps[2])
    expect(result.steps[3].error?.message).toContain('PROGRAM_NOT_PREPARED')
    expect(result.files[mainPath]).toBe(source)
  })

  it.each(['size', 'digest'] as const)('rejects a %s mismatch before compilation and clears the previous preparation', mismatch => {
    const source = 'print("ORIGINAL")\n'
    const prepared = program(source)
    const incorrect = mismatch === 'size' ? { ...prepared, byteLength: prepared.byteLength + 1 } : { ...prepared, digest: '0'.repeat(64) }
    const result = simulate({ [tempPath]: source }, [
      command(prepareProgramCommand(tempPath, prepared, true)), command(prepareProgramCommand(tempPath, incorrect, true)),
    ])
    expect(result.steps[1].error?.message).toContain(mismatch === 'size' ? 'PROGRAM_SIZE_MISMATCH' : 'PROGRAM_CONTENT_MISMATCH')
    expect(result.steps[1].compileCount).toBe(1)
    expect(result.steps[1].cachePresent).toBe(false)
    expectReleased(result.steps[1])
  })

  it('checks save-only syntax without retaining executable code', () => {
    const source = 'print("SAVED_ONLY")\n'
    const prepared = program(source)
    const result = simulate({ [tempPath]: source, [mainPath]: source }, [
      command(prepareProgramCommand(tempPath, prepared, false)), command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.steps[0].error).toBeNull()
    expect(result.steps[0].stdout).toContain('__M5_COMPILE_OK__')
    expect(result.steps[0].cachePresent).toBe(false)
    expectReleased(result.steps[0])
    expect(result.steps[1].error?.message).toContain('PROGRAM_NOT_PREPARED')
    expect(result.steps[1].compileCount).toBe(1)
  })

  it.each(['RuntimeError', 'KeyboardInterrupt'] as const)('cleans up after %s while preserving the custom filename in the traceback', errorType => {
    const path = '/flash/custom_runtime.py'
    const source = `raise ${errorType}("USER_FAILURE")\n`
    const prepared = program(source, path)
    const result = simulate({ [`${path}.tmp`]: source, [path]: source }, [
      command(prepareProgramCommand(`${path}.tmp`, prepared, true)), command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.steps[1].error?.type).toBe(errorType)
    expect(result.steps[1].error?.traceback).toContain(`File "${path}", line 1`)
    expect(result.steps[1].error?.message).toBe('USER_FAILURE')
    expect(result.steps[1].cachePresent).toBe(false)
    expectReleased(result.steps[1])
  })

  it('rejects a removed saved file without falling back to the cached code', () => {
    const source = 'print("SHOULD_NOT_RUN")\n'
    const prepared = program(source)
    const result = simulate({ [tempPath]: source, [mainPath]: source }, [
      command(prepareProgramCommand(tempPath, prepared, true)), { remove: mainPath }, command(startPreparedProgramCommand(prepared)),
    ])
    expect(result.steps[2].error?.type).toBe('FileNotFoundError')
    expect(result.steps[2].cachePresent).toBe(false)
    expect(result.steps[2].compileCount).toBe(1)
    expect(result.steps[2].stdout).not.toContain('SHOULD_NOT_RUN')
    expectReleased(result.steps[2])
  })

  it('clears writer-owned references without clearing the old namespace dictionary itself', () => {
    const result = simulate({}, [
      command('s=b"legacy bytes"\nsource="legacy text"\nnamespace={"alive":42}\nalias=namespace\n_mpw_prepared=("old",)'),
      command(clearPreparedProgramCommand()), command('print(alias["alive"])'),
    ])
    expect(result.steps[1].error).toBeNull()
    expect(result.steps[1].cachePresent).toBe(false)
    expectReleased(result.steps[1])
    expect(result.steps[1].collections).toBeGreaterThan(0)
    expect(result.steps[2].stdout).toBe('42\n')
  })

  it.each([
    { label: 'empty file', source: '' },
    { label: 'UTF-8 character across a 384-byte boundary', source: 'a'.repeat(383) + '🌟日本語'.repeat(100) + '\n' },
  ])('reads $label through the actual generated command without retaining the source', async ({ source }) => {
    const { service, executions } = readFixture({ [mainPath]: source })
    await expect(service.readMain(Buffer.byteLength(source, 'utf8'))).resolves.toBe(source)
    expect(executions).toHaveLength(1)
    expect(executions[0].compilations).toEqual([])
    const step = executions[0].steps[0]
    expect(step.error).toBeNull()
    expect(step.reads.length).toBeGreaterThan(0)
    expect(step.reads.every(read => read.path === mainPath && read.size === 384)).toBe(true)
    expectReleased(step)
  })

  it('returns an empty source for a missing file and closes the generated reader', async () => {
    const { service, executions } = readFixture({})
    await expect(service.readMain()).resolves.toBe('')
    const step = executions[0].steps[0]
    expect(step.stdout).toBe('__FILE__None\n')
    expect(step.error).toBeNull()
    expect(step.reads).toEqual([])
    expectReleased(step)
  })

  it('rejects the device-side byte limit before reading or returning a partial source', async () => {
    const source = '日本語'
    const { service, executions } = readFixture({ [mainPath]: source })
    await expect(service.readMain(Buffer.byteLength(source, 'utf8') - 1)).rejects.toThrow('PROGRAM_TOO_LARGE')
    const step = executions[0].steps[0]
    expect(step.error?.type).toBe('ValueError')
    expect(step.stdout).toBe('')
    expect(step.reads).toEqual([])
    expectReleased(step)
  })
})
