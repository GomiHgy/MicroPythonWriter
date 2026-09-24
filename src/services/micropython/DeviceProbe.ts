import type { DeviceInfo } from '../../types'
import type { RawReplClient } from './RawReplClient'
import { boardDefinitions, identifyBoard, identifySoc } from '../../config/boards'

export class DeviceProbe {
  private readonly repl: RawReplClient
  constructor(repl: RawReplClient) { this.repl = repl }
  async probe(): Promise<DeviceInfo> {
    const code = `import os,sys
print('__M5_WEB_PROBE_BEGIN__')
print('uname='+repr(os.uname()))
print('impl='+repr(sys.implementation))
print('cwd='+repr(os.getcwd()))
print('files='+repr(os.listdir()))
try:
 import machine; print('uid='+repr(machine.unique_id()))
except Exception as e: print('uid_error='+repr(e))
try:
 import M5; print('m5=1'); print('board='+repr(M5.getBoard()))
except Exception as e: print('m5=0')
_mpw_boot=None
_mpw_boot_supported=False
try:
 import boot_option
 _mpw_boot_supported=callable(getattr(boot_option,'set_boot_option',None)) and callable(getattr(boot_option,'get_boot_option',None))
 if _mpw_boot_supported:
  try: _mpw_boot=boot_option.get_boot_option()
  except Exception: pass
except Exception: pass
print('boot_module='+str(int(_mpw_boot_supported)))
_mpw_nvs_supported=False
try:
 import esp32
 n=esp32.NVS('uiflow')
 _mpw_nvs_supported=callable(getattr(n,'set_u8',None)) and callable(getattr(n,'get_u8',None)) and callable(getattr(n,'commit',None))
 if _mpw_boot is None and _mpw_nvs_supported:
  try: _mpw_boot=n.get_u8('boot_option')
  except Exception: pass
except Exception: pass
print('nvs='+repr(_mpw_nvs_supported))
if _mpw_boot is not None: print('boot='+repr(_mpw_boot))
del _mpw_boot,_mpw_boot_supported,_mpw_nvs_supported
try:
 f=open('__m5_write_test__','wb');f.write(b'1');f.close();os.remove('__m5_write_test__');print('writable=True')
except Exception as e: print('writable=False')
print('__M5_WEB_PROBE_END__')`
    const { stdout } = await this.repl.execute(code); const block = stdout.match(/__M5_WEB_PROBE_BEGIN__([\s\S]*?)__M5_WEB_PROBE_END__/)?.[1] ?? ''; const value = (key: string) => block.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? ''
    const uname = value('uname'); const board = value('board'); const bootValue = value('boot'); const boot = bootValue === '' ? NaN : Number(bootValue)
    const boardId = identifyBoard(`${board} ${uname}`)
    const soc = identifySoc(uname) ?? (boardId ? boardDefinitions[boardId].soc : undefined)
    return { deviceName: boardId ? boardDefinitions[boardId].name : board || soc || 'MicroPython device', boardId, soc, boardConfirmed: boardId !== undefined, microPythonVersion: uname, firmwareInfo: value('impl'), bootOption: Number.isFinite(boot) ? boot : undefined, cwd: value('cwd'), files: value('files').match(/'([^']+)'/g)?.map(v => v.slice(1, -1)) ?? [], nanoC6Confirmed: boardId === 'm5nanoc6', bootOptionSupported: value('boot_module') === '1', nvsFallbackSupported: value('nvs') === 'True' }
  }
}
