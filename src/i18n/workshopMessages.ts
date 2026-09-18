import type { Locale, MessageCatalog } from './types'

export const workshopMessages: MessageCatalog = {
  'NanoLED v1またはv2対応の実機確認が必要です。再生・停止・アクションにはv2の確認が必要です。': { en: 'Hardware verification of NanoLED v1 or v2 is required. Playback, pause and actions require v2 verification.', zh: '需要 NanoLED v1 或 v2 的实机验证。播放、暂停及动作需要验证 v2。' },
  'NanoLED v1/v2はRGB・1〜300個のLEDに対応します。使用するLED数や形式が対応しているか確認してください。': { en: 'NanoLED v1/v2 supports 1–300 RGB LEDs. Check the LED count and format.', zh: 'NanoLED v1/v2 支持 1–300 个 RGB LED。请确认 LED 数量和格式。' },
  '外部LEDピンは0〜48の整数で入力し、使用機器で出力可能なGPIOと配線を確認してください。': { en: 'Enter an external LED pin as an integer from 0 to 48. Check that your device supports output on this GPIO and verify the wiring.', zh: '外接 LED 引脚请输入 0 到 48 的整数，并确认设备支持该 GPIO 输出及接线正确。' },
  'M5NanoC6 LEDワークショップ': { en: 'M5NanoC6', zh: 'M5NanoC6' },
  'NanoC6 LEDワークショップ': { en: 'M5NanoC6', zh: 'M5NanoC6' },
  'AtomS3Lite LEDワークショップ': { en: 'AtomS3Lite', zh: 'AtomS3Lite' },
  '対応機器をM5NanoC6またはAtomS3Liteから選んでください。': { en: 'Select M5NanoC6 or AtomS3Lite as the target board.', zh: '请选择 M5NanoC6 或 AtomS3Lite 作为目标设备。' },
  '教材IDは半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。': { en: 'Material ID must start with an ASCII letter or digit and use at most 64 letters, digits, hyphens, underscores or dots.', zh: '教材 ID 必须以半角字母或数字开头，最多 64 个字母、数字、连字符、下划线或点。' },
  '教材の版は半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。': { en: 'Material revision must start with an ASCII letter or digit and use at most 64 letters, digits, hyphens, underscores or dots.', zh: '教材版本必须以半角字母或数字开头，最多 64 个字母、数字、连字符、下划线或点。' },
  '教材の表示名を200文字以内で設定してください。空欄・改行・未記入のテンプレートは使えません。': { en: 'Set a display name of at most 200 characters, without blank values, line breaks or unresolved templates.', zh: '请设置最多 200 个字符的教材名称，不能留空、换行或包含未填写的模板。' },
  '対象UIFlow2ファームウェアの版を入力してください。機器から取得したMicroPythonの版で代用しません。': { en: 'Enter the target UIFlow2 firmware version. Do not substitute the MicroPython version read from the device.', zh: '请输入目标 UIFlow2 固件版本，不能使用设备读取的 MicroPython 版本代替。' },
  'LEDの型番を選択してください。対応する5種類のRGB LEDから選べます。': { en: 'Choose your LED model from the five supported RGB LED types.', zh: '请选择 LED 型号，可从支持的五种 RGB LED 中选择。' },
  'LED数を正の整数で設定してください。': { en: 'Set the LED count to a positive integer.', zh: '请将 LED 数量设置为正整数。' },
  'LED_BPP=3のRGB LEDのみ対応しています。RGBWなどへ変換せず、使用するLEDの仕様を確認してください。': { en: 'Only RGB LEDs with LED_BPP=3 are supported. Do not convert to RGBW; check the specification of your LEDs.', zh: '仅支持 LED_BPP=3 的 RGB LED。请勿改为 RGBW 等规格，请确认所用 LED 的规格。' },
  '最大輝度を0より大きく100以下の数値で設定してください。範囲内でも実機の電源安全性は別途確認が必要です。': { en: 'Set maximum brightness above 0 and at most 100. Power safety must still be checked on the hardware.', zh: '请将最大亮度设置为大于 0 且不超过 100 的数值。即使在此范围内，也需要另外确认实物供电安全。' },
  'Webコントローラを使うにはBLEも有効にしてください。': { en: 'Enable BLE to use the web controller.', zh: '使用网页控制器时，也需要启用 BLE。' },
  'BLE基準コードが未登録です。対象機器で確認したコードを登録してください。': { en: 'No BLE baseline code is registered. Register code verified on your target device.', zh: '尚未登记 BLE 基准代码，请登记已在目标设备上验证的代码。' },
  'BLE基準コードは100000文字以内にしてください。省略せず登録できる内容か確認してください。': { en: 'BLE baseline code must fit within 100000 characters. Check that it can be registered without omissions.', zh: 'BLE 基准代码最多 100000 个字符。请确认能完整登记，不能省略。' },
  'BLE基準コードに未記入のテンプレートまたは不正な文字が残っています。': { en: 'The BLE baseline contains unresolved templates or invalid characters.', zh: 'BLE 基准代码中仍有未填写的模板或无效字符。' },
  'BLE基準コードの実機確認情報が未登録です。対象機器で動作を確認して登録してください。': { en: 'Hardware verification of the BLE baseline is not registered. Test it on your target device and register the verification.', zh: '尚未登记 BLE 基准代码的实机验证信息。请在目标设备上确认运行情况并登记。' },
  'BLEの確認対象機器が設定と一致しません。実機で再確認してください。': { en: 'The device used for BLE verification does not match your settings. Verify it again on the hardware.', zh: 'BLE 验证设备与设置不一致，请在实机上重新验证。' },
  '基準コードが確認時から変更されています。実機で再確認してください。': { en: 'The baseline code has changed since verification. Verify it again on the hardware.', zh: '基准代码自验证后已更改，请在实机上重新验证。' },
  'BLEの確認対象UIFlow2版が設定と一致しません。実機で再確認してください。': { en: 'The verified UIFlow2 version does not match the settings. Verify it again on the hardware.', zh: 'BLE 验证时的 UIFlow2 版本与设置不一致，请在实机上重新验证。' },
  'BLEを確認した人の名前と確認日時を設定してください。': { en: 'Set the name of the person who verified BLE and the verification date.', zh: '请设置验证 BLE 的人员姓名和验证日期。' },
  'NanoLED v1対応の実機確認が必要です。対象機器で操作・状態通知を確認してください。': { en: 'Hardware verification of NanoLED v1 compatibility is required. Test controls and state notifications on your target device.', zh: '需要在实机上验证 NanoLED v1 兼容性。请在目标设备上确认操作和状态通知。' },
  'NanoLED v1はRGB・1〜300個のLEDに対応します。使用するLED数や形式が対応しているか確認してください。': { en: 'NanoLED v1 supports 1–300 RGB LEDs. Check that your LED count and format are supported.', zh: 'NanoLED v1 支持 1–300 个 RGB LED。请确认所用 LED 的数量和格式是否受支持。' },
}

export const translateWorkshop = (locale: Locale, text: string) => locale === 'ja' ? text : workshopMessages[text]?.[locale] ?? text
