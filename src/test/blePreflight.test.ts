import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildBlePreflightCommand } from '../services/micropython/BlePreflight'

const pythonCommands = [process.env.PYTHON, 'python3', 'python', ...(process.platform === 'win32' ? ['py', `${process.env.USERPROFILE}/.platformio/penv/Scripts/python.exe`] : [])].filter((value): value is string => Boolean(value))
const python = pythonCommands.find(command => spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5000 }).status === 0)

const harness = `import contextlib,gc,io,json,sys,types,weakref
config=json.load(sys.stdin)
real_gc=gc
calls=[]
refs=[]
collections=[]
state=[config.get('active',False)]
missing=object()
class BLE:
 def __init__(self):
  refs.append(weakref.ref(self))
 def active(self,value=missing):
  if value is missing:
   calls.append(['active'])
   return state[0]
  calls.append(['active',value])
  if config.get('activationError'):
   raise OSError('BLE activation failed')
  if not config.get('staysInactive'):
   state[0]=value
 def __getattr__(self,name):
  raise AssertionError('Unexpected BLE operation: '+name)
bluetooth=types.ModuleType('bluetooth')
bluetooth.BLE=BLE
sys.modules['bluetooth']=None if config.get('missingBluetooth') else bluetooth
fake_gc=types.ModuleType('gc')
def collect():
 collections.append(True)
 real_gc.collect()
fake_gc.collect=collect
if not config.get('missingPythonMemory'):
 def mem_alloc():
  if config.get('memoryError'):
   raise OSError('memory query failed')
  return 1234
 fake_gc.mem_alloc=mem_alloc
 fake_gc.mem_free=lambda:5678
sys.modules['gc']=fake_gc
esp32=types.ModuleType('esp32')
if not config.get('missingIdfMemory'):
 esp32.HEAP_DATA=4
 def idf_heap_info(capabilities):
  if config.get('memoryError'):
   raise OSError('heap query failed')
  assert capabilities==4
  return [(10000,9000,8000,7000)]
 esp32.idf_heap_info=idf_heap_info
sys.modules['esp32']=None if config.get('missingEsp32') else esp32
namespace={}
stdout=io.StringIO()
error=None
with contextlib.redirect_stdout(stdout):
 try:
  exec(config['command'],namespace)
 except BaseException as exc:
  error={'type':type(exc).__name__,'message':str(exc)}
print(json.dumps({'stdout':stdout.getvalue(),'error':error,'calls':calls,'collections':len(collections),'globalKeys':list(namespace),'liveBleReferences':sum(ref() is not None for ref in refs)}))`

interface Options {
  active?: boolean
  activationError?: boolean
  staysInactive?: boolean
  missingBluetooth?: boolean
  missingPythonMemory?: boolean
  missingIdfMemory?: boolean
  missingEsp32?: boolean
  memoryError?: boolean
}

interface Result {
  stdout: string
  error: { type: string, message: string } | null
  calls: Array<[string] | [string, boolean]>
  collections: number
  globalKeys: string[]
  liveBleReferences: number
}

function simulate(options: Options = {}): Result {
  const result = spawnSync(python!, ['-X', 'utf8', '-B', '-c', harness], {
    input: JSON.stringify({ ...options, command: buildBlePreflightCommand() }), encoding: 'utf8', timeout: 15000,
  })
  expect(result.status, result.stderr || result.error?.message).toBe(0)
  return JSON.parse(result.stdout) as Result
}

function expectReleased(result: Result) {
  expect(result.globalKeys).toEqual(['__builtins__'])
  expect(result.liveBleReferences).toBe(0)
}

describe('BLE preflight command structure', () => {
  it('is small and finite without changing device configuration or importing the artwork', () => {
    const command = buildBlePreflightCommand()
    expect(Buffer.byteLength(command, 'utf8')).toBeLessThan(2048)
    expect(command).not.toMatch(/active\(False\)|gap_|gatt|\.irq\(|network|open\(|compile\(|exec\(|reset\(|NVS|while /)
    expect(command).toContain("print('__M5_BLE_PREPARED__')")
    expect(command).toContain('finally:\n del _mpw_ble_prepare')
  })
})

describe.skipIf(!python)('BLE preflight: CPython host execution, not device verification', () => {
  it('activates BLE once and reports bounded before/after memory snapshots', () => {
    const result = simulate()
    expect(result.error).toBeNull()
    expect(result.calls).toEqual([['active'], ['active', true], ['active']])
    expect(result.collections).toBe(1)
    expect(result.stdout).toContain('[MPW BLE PREP] BEGIN\n')
    expect(result.stdout).toContain('[MPW BLE PREP] BEFORE_ACTIVE\n')
    expect(result.stdout).toContain('[MPW BLE PREP] BEFORE_ACTIVE PYTHON allocated= 1234 free= 5678\n')
    expect(result.stdout).toContain('[MPW BLE PREP] BEFORE_ACTIVE IDF_HEAPS [(10000, 9000, 8000, 7000)]\n')
    expect(result.stdout).toContain('[MPW BLE PREP] AFTER_ACTIVE\n')
    expect(result.stdout).toContain('[MPW BLE PREP] AFTER_ACTIVE PYTHON allocated= 1234 free= 5678\n')
    expect(result.stdout).toContain('[MPW BLE PREP] AFTER_ACTIVE IDF_HEAPS [(10000, 9000, 8000, 7000)]\n')
    expect(result.stdout.endsWith('__M5_BLE_PREPARED__\n')).toBe(true)
    expectReleased(result)
  })

  it('leaves an already-active singleton active without cycling or reconfiguring it', () => {
    const result = simulate({ active: true })
    expect(result.error).toBeNull()
    expect(result.calls).toEqual([['active'], ['active']])
    expect(result.stdout).toContain('__M5_BLE_PREPARED__')
    expectReleased(result)
  })

  it.each([
    { options: { missingBluetooth: true }, type: 'ModuleNotFoundError', after: false },
    { options: { activationError: true }, type: 'OSError', after: false },
    { options: { staysInactive: true }, type: 'RuntimeError', after: true },
  ])('propagates $type without reporting successful preparation', ({ options, type, after }) => {
    const result = simulate(options)
    expect(result.error?.type).toBe(type)
    expect(result.stdout).not.toContain('__M5_BLE_PREPARED__')
    expect(result.stdout.includes('[MPW BLE PREP] AFTER_ACTIVE\n')).toBe(after)
    expectReleased(result)
  })

  it.each([
    { missingPythonMemory: true }, { missingIdfMemory: true }, { missingEsp32: true },
    { missingPythonMemory: true, missingEsp32: true }, { memoryError: true },
  ])('keeps optional memory diagnostics from preventing activation (%j)', options => {
    const result = simulate(options)
    expect(result.error).toBeNull()
    expect(result.stdout).toContain('unavailable')
    expect(result.stdout).toContain('__M5_BLE_PREPARED__')
    expect(result.calls).toEqual([['active'], ['active', true], ['active']])
    expectReleased(result)
  })
})
