// 作品の読込み・コンパイルより先にBLEを有効化する有限コマンド。
// 広告・GATT・IRQ・Wi-Fi・ファイル・起動設定には触れない。
export function buildBlePreflightCommand(): string {
  return `def _mpw_ble_prepare():
 print('[MPW BLE PREP] BEGIN')
 import bluetooth,gc
 def memory(stage):
  try:
   print('[MPW BLE PREP]',stage,'PYTHON allocated=',gc.mem_alloc(),'free=',gc.mem_free())
  except Exception:
   print('[MPW BLE PREP]',stage,'PYTHON unavailable')
  try:
   import esp32
   print('[MPW BLE PREP]',stage,'IDF_HEAPS',esp32.idf_heap_info(esp32.HEAP_DATA))
  except Exception:
   print('[MPW BLE PREP]',stage,'IDF_HEAPS unavailable')
 gc.collect()
 ble=bluetooth.BLE()
 print('[MPW BLE PREP] BEFORE_ACTIVE')
 memory('BEFORE_ACTIVE')
 if not ble.active():
  ble.active(True)
 print('[MPW BLE PREP] AFTER_ACTIVE')
 memory('AFTER_ACTIVE')
 if not ble.active():
  raise RuntimeError('BLE_NOT_ACTIVE')
 print('__M5_BLE_PREPARED__')
try:
 _mpw_ble_prepare()
finally:
 del _mpw_ble_prepare`
}
