import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { BootModeService } from '../services/micropython/BootModeService'
import { DeviceProbe } from '../services/micropython/DeviceProbe'
import { BootModeUnsupportedError, type ExecutionResult } from '../types'

const supported = { bootOptionSupported: true, nvsFallbackSupported: true }
const nvsOnly = { bootOptionSupported: false, nvsFallbackSupported: true }
const confirmed = (mode: number): ExecutionResult => ({ stdout: `__M5_BOOT_MODE_SAVED__${mode}\n`, stderr: '', completed: true, interrupted: false, durationMs: 0 })
const failureMessage = '起動設定の変更を確認できませんでした。'

describe('BootModeService confirmation', () => {
  it.each([0, 1] as const)('accepts a confirmed mode %i without restarting or touching main.py', async mode => {
    const execute = vi.fn().mockResolvedValue(confirmed(mode))
    const reset = vi.fn()
    await expect(new BootModeService({ execute, reset } as never).set(mode, supported)).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
    const code: string = execute.mock.calls[0][0]
    expect(code).toContain(`set_boot_option(${mode})`)
    expect(code).toContain('get_boot_option()')
    expect(code).not.toMatch(/NVS|main\.py|open\(|remove\(|rename\(|reset\(/)
    expect(reset).not.toHaveBeenCalled()
  })

  it('commits the detected NVS u8 fallback before reading back', async () => {
    const execute = vi.fn().mockResolvedValue(confirmed(1))
    await new BootModeService({ execute } as never).set(1, nvsOnly)
    const code: string = execute.mock.calls[0][0]
    expect(code).toContain("n.set_u8('boot_option',1)")
    expect(code.indexOf('n.commit()')).toBeGreaterThan(code.indexOf('n.set_u8('))
    expect(code.indexOf('n.get_u8(')).toBeGreaterThan(code.indexOf('n.commit()'))
    expect(code).not.toContain('set_i32')
  })

  it.each([
    { ...confirmed(1), stdout: '' },
    { ...confirmed(1), stdout: '__M5_BOOT_MODE_SAVED__0\n' },
    { ...confirmed(1), stdout: 'prefix__M5_BOOT_MODE_SAVED__1\n' },
    { ...confirmed(1), stdout: '__M5_BOOT_MODE_SAVED__10\n' },
    { ...confirmed(1), stderr: 'OSError: NVS write failed' },
    { ...confirmed(1), completed: false },
    { ...confirmed(1), interrupted: true },
  ])('does not report success for incomplete or contradictory responses %#', async result => {
    const execute = vi.fn().mockResolvedValue(result)
    await expect(new BootModeService({ execute } as never).set(1, supported)).rejects.toThrow(failureMessage)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][0]).not.toContain('NVS')
  })

  it('preserves the underlying error details and never falls back after a write error', async () => {
    const execute = vi.fn().mockResolvedValue({ ...confirmed(1), stderr: 'OSError: commit failed' })
    await expect(new BootModeService({ execute } as never).set(1, supported)).rejects.toThrow('OSError: commit failed')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('propagates connection loss without retrying a different persistence method', async () => {
    const error = new Error('USB disconnected')
    const execute = vi.fn().mockRejectedValue(error)
    await expect(new BootModeService({ execute } as never).set(1, supported)).rejects.toBe(error)
    expect(execute).toHaveBeenCalledOnce()
  })

  it('rejects unsupported firmware and invalid modes before sending anything', async () => {
    const execute = vi.fn()
    const service = new BootModeService({ execute } as never)
    await expect(service.set(1, { bootOptionSupported: false, nvsFallbackSupported: false })).rejects.toBeInstanceOf(BootModeUnsupportedError)
    await expect(service.set(2 as 1, supported)).rejects.toBeInstanceOf(BootModeUnsupportedError)
    expect(execute).not.toHaveBeenCalled()
  })
})

const pythonCommands = [process.env.PYTHON, 'python3', 'python', ...(process.platform === 'win32' ? ['py', `${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])].filter((value): value is string => Boolean(value))
const python = pythonCommands.find(command => spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0)

// 送信するPythonを実行するホストテスト。NVSと機器APIは偽物であり、実機確認ではない。
const harness = `import sys, json, types, io, contextlib, builtins
request=json.loads(sys.stdin.read())
config=request.get('config',{})
calls=[]
stored=config.get('initial',0)
def fail(stage):
 if config.get('fail')==stage: raise OSError(stage+' failed')
def set_value(value):
 global stored
 fail('set')
 stored=value
def module_set(value):
 calls.append(['module_set',value])
 set_value(value)
def module_get():
 calls.append(['module_get'])
 fail('get')
 return config.get('readback',stored)
class NVS:
 def __init__(self,namespace): calls.append(['nvs_open',namespace])
 def set_u8(self,key,value):
  calls.append(['nvs_set',key,value])
  set_value(value)
 def commit(self):
  calls.append(['nvs_commit'])
  fail('commit')
 def get_u8(self,key):
  calls.append(['nvs_get',key])
  fail('get')
  return config.get('readback',stored)
if config.get('module',True):
 module=types.ModuleType('boot_option')
 module.get_boot_option=module_get
 if not config.get('missingSetter'): module.set_boot_option=module_set
 sys.modules['boot_option']=module
esp32=types.ModuleType('esp32')
esp32.NVS=NVS
sys.modules['esp32']=esp32
if config.get('missingU8'):
 del NVS.set_u8
 del NVS.get_u8
machine=types.ModuleType('machine')
machine.unique_id=lambda: b'test'
sys.modules['machine']=machine
m5=types.ModuleType('M5')
m5.getBoard=lambda: 'M5NanoC6'
sys.modules['M5']=m5
os_stub=types.ModuleType('os')
os_stub.uname=lambda: 'M5NanoC6 ESP32C6'
os_stub.getcwd=lambda: '/flash'
os_stub.listdir=lambda: ['main.py']
os_stub.remove=lambda path: calls.append(['remove',path])
sys.modules['os']=os_stub
def fake_open(path,mode):
 calls.append(['open',path,mode])
 return io.BytesIO()
builtins.open=fake_open
namespace={}
output=io.StringIO()
error=''
with contextlib.redirect_stdout(output):
 try: exec(request['code'],namespace)
 except BaseException as caught: error=type(caught).__name__+': '+str(caught)
print(json.dumps({'stdout':output.getvalue(),'error':error,'calls':calls,'stored':stored,'globals':list(namespace)}))`

interface HostResult { stdout: string; error: string; calls: (string | number)[][]; stored: number; globals: string[] }
function runPython(code: string, config: Record<string, unknown> = {}): HostResult {
  const result = spawnSync(python!, ['-X', 'utf8', '-B', '-c', harness], { input: JSON.stringify({ code, config }), encoding: 'utf8', timeout: 10000 })
  expect(result.status, result.stderr || result.error?.message).toBe(0)
  return JSON.parse(result.stdout) as HostResult
}

function hostRepl(config: Record<string, unknown> = {}) {
  const runs: HostResult[] = []
  return {
    runs,
    execute: vi.fn(async (code: string): Promise<ExecutionResult> => {
      const result = runPython(code, config)
      runs.push(result)
      return { stdout: result.stdout, stderr: result.error, completed: true, interrupted: false, durationMs: 0 }
    }),
  }
}

describe.skipIf(!python)('Boot mode generated Python: host execution only', () => {
  it.each([0, 1] as const)('reads back mode %i and removes its helper without modifying files', async mode => {
    const repl = hostRepl({ initial: 1 - mode })
    await new BootModeService(repl as never).set(mode, supported)
    expect(repl.runs[0].calls).toEqual([['module_set', mode], ['module_get']])
    expect(repl.runs[0].stored).toBe(mode)
    expect(repl.runs[0].globals).not.toContain('_mpw_set_boot_mode')
  })

  it('uses NVS set, commit, then get in order', async () => {
    const repl = hostRepl({ module: false })
    await new BootModeService(repl as never).set(1, nvsOnly)
    expect(repl.runs[0].calls).toEqual([['nvs_open', 'uiflow'], ['nvs_set', 'boot_option', 1], ['nvs_commit'], ['nvs_get', 'boot_option']])
  })

  it.each(['set', 'commit', 'get'])('does not emit success when NVS %s fails', async fail => {
    const repl = hostRepl({ module: false, fail })
    await expect(new BootModeService(repl as never).set(1, nvsOnly)).rejects.toThrow(failureMessage)
    expect(repl.runs[0].stdout).not.toContain('__M5_BOOT_MODE_SAVED__')
    expect(repl.runs[0].globals).not.toContain('_mpw_set_boot_mode')
    expect(repl.execute).toHaveBeenCalledOnce()
  })

  it.each([supported, nvsOnly])('rejects readback mismatch and still removes the helper (%j)', async capabilities => {
    const repl = hostRepl({ readback: 0 })
    await expect(new BootModeService(repl as never).set(1, capabilities)).rejects.toThrow('BOOT_MODE_READBACK_MISMATCH')
    expect(repl.runs[0].stdout).not.toContain('__M5_BOOT_MODE_SAVED__')
    expect(repl.runs[0].globals).not.toContain('_mpw_set_boot_mode')
  })

  it('reads the existing boot module setting without an unnecessary NVS get', async () => {
    const repl = hostRepl({ initial: 1 })
    expect(await new DeviceProbe(repl as never).probe()).toMatchObject({ bootOption: 1, bootOptionSupported: true, nvsFallbackSupported: true })
    expect(repl.runs[0].calls).toContainEqual(['module_get'])
    expect(repl.runs[0].calls.some(call => call[0] === 'nvs_get')).toBe(false)
  })

  it('reads the current boot mode through detected NVS when boot_option is absent', async () => {
    const repl = hostRepl({ module: false, initial: 0 })
    expect(await new DeviceProbe(repl as never).probe()).toMatchObject({ bootOption: 0, bootOptionSupported: false, nvsFallbackSupported: true })
    expect(repl.runs[0].calls).toContainEqual(['nvs_get', 'boot_option'])
    expect(repl.runs[0].calls.some(call => call[0] === 'nvs_set' || call[0] === 'nvs_commit')).toBe(false)
  })

  it('does not claim boot module support without its setter', async () => {
    const repl = hostRepl({ missingSetter: true, initial: 1 })
    expect(await new DeviceProbe(repl as never).probe()).toMatchObject({ bootOption: 1, bootOptionSupported: false, nvsFallbackSupported: true })
  })

  it('keeps unreadable boot values unknown', async () => {
    const repl = hostRepl({ fail: 'get' })
    const info = await new DeviceProbe(repl as never).probe()
    expect(info.bootOption).toBeUndefined()
    expect(info.bootOptionSupported).toBe(true)
    expect(repl.runs[0].stdout.match(/^boot_module=/gm)).toHaveLength(1)
    expect(repl.runs[0].stdout.match(/^nvs=/gm)).toHaveLength(1)
  })

  it('does not read or write an unsupported NVS type', async () => {
    const repl = hostRepl({ module: false, missingU8: true })
    expect(await new DeviceProbe(repl as never).probe()).toMatchObject({ bootOption: undefined, bootOptionSupported: false, nvsFallbackSupported: false })
    expect(repl.runs[0].calls.some(call => call[0] === 'nvs_get' || call[0] === 'nvs_set' || call[0] === 'nvs_commit')).toBe(false)
  })
})
