import type { DeviceInfo } from '../../types'
import type { RawReplClient } from './RawReplClient'
import { boardDefinitions, identifyBoard, identifySoc } from '../../config/boards'

export class DeviceProbe {
  private readonly repl: RawReplClient
  constructor(repl: RawReplClient) { this.repl = repl }
  async probe(): Promise<DeviceInfo> {
    const code = `import os,sys\nprint('__M5_WEB_PROBE_BEGIN__')\nprint('uname='+repr(os.uname()))\nprint('impl='+repr(sys.implementation))\nprint('cwd='+repr(os.getcwd()))\nprint('files='+repr(os.listdir()))\ntry:\n import machine; print('uid='+repr(machine.unique_id()))\nexcept Exception as e: print('uid_error='+repr(e))\ntry:\n import M5; print('m5=1'); print('board='+repr(M5.getBoard()))\nexcept Exception as e: print('m5=0')\ntry:\n import boot_option; print('boot_module=1'); print('boot='+repr(boot_option.get_boot_option()))\nexcept Exception as e: print('boot_module=0')\ntry:\n import esp32; n=esp32.NVS('uiflow'); print('nvs='+repr(hasattr(n,'set_u8') and hasattr(n,'get_u8') and hasattr(n,'commit')))\nexcept Exception as e: print('nvs=False')\ntry:\n f=open('__m5_write_test__','wb');f.write(b'1');f.close();os.remove('__m5_write_test__');print('writable=True')\nexcept Exception as e: print('writable=False')\nprint('__M5_WEB_PROBE_END__')`
    const { stdout } = await this.repl.execute(code); const block = stdout.match(/__M5_WEB_PROBE_BEGIN__([\s\S]*?)__M5_WEB_PROBE_END__/)?.[1] ?? ''; const value = (key: string) => block.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] ?? ''
    const uname = value('uname'); const board = value('board'); const bootValue = value('boot'); const boot = bootValue === '' ? NaN : Number(bootValue)
    const boardId = identifyBoard(`${board} ${uname}`)
    const soc = identifySoc(uname) ?? (boardId ? boardDefinitions[boardId].soc : undefined)
    return { deviceName: boardId ? boardDefinitions[boardId].name : board || soc || 'MicroPython device', boardId, soc, boardConfirmed: boardId !== undefined, microPythonVersion: uname, firmwareInfo: value('impl'), bootOption: Number.isFinite(boot) ? boot : undefined, cwd: value('cwd'), files: value('files').match(/'([^']+)'/g)?.map(v => v.slice(1, -1)) ?? [], nanoC6Confirmed: boardId === 'm5nanoc6', bootOptionSupported: value('boot_module') === '1', nvsFallbackSupported: value('nvs') === 'True' }
  }
}
