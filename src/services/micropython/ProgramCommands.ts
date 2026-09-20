// 構文確認した同じコードを単発実行する。全文は準備関数の外へ保持しない。
export interface PreparedProgram {
  token: string
  path: string
  byteLength: number
  digest: string
}

const quote = (value: string) => JSON.stringify(value)
const collect = 'import gc as _mpw_gc\n_mpw_gc.collect()\ndel _mpw_gc'

export function clearPreparedProgramCommand(): string {
  // s/source/namespace は旧WriterがREPLへ残していた参照。辞書の中身は壊さず参照だけ外す。
  return `for _mpw_key in ('_mpw_prepared','s','source','namespace'):\n globals().pop(_mpw_key,None)\ndel _mpw_key\n${collect}`
}

export function prepareProgramCommand(tempPath: string, program: PreparedProgram, retainCompiled: boolean): string {
  const cache = `(${quote(program.token)},${quote(program.path)},${quote(program.digest)},${program.byteLength},_mpw_compile())`
  return `def _mpw_compile():
 import hashlib,binascii
 data=None
 try:
  with open(${quote(tempPath)},'rb') as f:
   data=f.read()
  print('__SIZE__'+str(len(data)))
  if len(data)!=${program.byteLength}:
   raise ValueError('PROGRAM_SIZE_MISMATCH')
  if binascii.hexlify(hashlib.sha256(data).digest()).decode()!=${quote(program.digest)}:
   raise ValueError('PROGRAM_CONTENT_MISMATCH')
  return compile(data,${quote(program.path)},'exec')
 finally:
  data=None
globals().pop('_mpw_prepared',None)
try:
 ${retainCompiled ? `_mpw_prepared=${cache}` : '_mpw_compile()'}
 print('__M5_COMPILE_OK__')
except BaseException:
 globals().pop('_mpw_prepared',None)
 raise
finally:
 del _mpw_compile
 ${collect.replaceAll('\n', '\n ')}`
}

function verificationFunction(program: PreparedProgram): string {
  // 全文を再読込みせず小さいチャンクで保存内容を照合する。同サイズの変更も拒否。
  return `def _mpw_verify():
 import hashlib,binascii
 prepared=globals().get('_mpw_prepared')
 if prepared is None or prepared[:4]!=(${quote(program.token)},${quote(program.path)},${quote(program.digest)},${program.byteLength}):
  raise RuntimeError('PROGRAM_NOT_PREPARED: run the write step again')
 digest=hashlib.sha256()
 size=0
 with open(${quote(program.path)},'rb') as f:
  while True:
   chunk=f.read(384)
   if not chunk:
    break
   size+=len(chunk)
   digest.update(chunk)
 if size!=${program.byteLength} or binascii.hexlify(digest.digest()).decode()!=${quote(program.digest)}:
  raise RuntimeError('PROGRAM_CHANGED: run the write step again')`
}

export function verifyPreparedProgramCommand(program: PreparedProgram): string {
  return `${verificationFunction(program)}
try:
 _mpw_verify()
 print('__M5_COMPILE_OK__')
except BaseException:
 globals().pop('_mpw_prepared',None)
 raise
finally:
 del _mpw_verify
 ${collect.replaceAll('\n', '\n ')}`
}

export function startPreparedProgramCommand(program: PreparedProgram): string {
  // 準備関数は既に終了済み。常駐execの間にソース全文や検証チャンクを保持しない。
  return `${verificationFunction(program)}
try:
 try:
  _mpw_verify()
 finally:
  del _mpw_verify
 ${collect.replaceAll('\n', '\n ')}
 exec(globals().pop('_mpw_prepared')[4],{'__name__':'__main__','__file__':${quote(program.path)}})
finally:
 globals().pop('_mpw_prepared',None)
 ${collect.replaceAll('\n', '\n ')}`
}
