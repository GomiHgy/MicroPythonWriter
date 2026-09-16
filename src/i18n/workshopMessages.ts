import type { Locale, MessageCatalog } from './types'

export const workshopMessages: MessageCatalog = {
  'M5NanoC6 LEDワークショップ': { en: 'M5NanoC6 LED workshop', zh: 'M5NanoC6 LED 工作坊' },
  'NanoC6 LEDワークショップ': { en: 'M5NanoC6 LED workshop', zh: 'M5NanoC6 LED 工作坊' },
  'AtomS3Lite LEDワークショップ': { en: 'AtomS3Lite LED workshop', zh: 'AtomS3Lite LED 工作坊' },
  '対応機器をM5NanoC6またはAtomS3Liteから選んでください。': { en: 'Select M5NanoC6 or AtomS3Lite as the target board.', zh: '请选择 M5NanoC6 或 AtomS3Lite 作为目标设备。' },
  '教材IDは半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。': { en: 'Material ID must start with an ASCII letter or digit and use at most 64 letters, digits, hyphens, underscores or dots.', zh: '教材 ID 必须以半角字母或数字开头，最多 64 个字母、数字、连字符、下划线或点。' },
  '教材の版は半角英数字で始まる64文字以内の英数字・ハイフン・アンダースコア・ドットにしてください。': { en: 'Material revision must start with an ASCII letter or digit and use at most 64 letters, digits, hyphens, underscores or dots.', zh: '教材版本必须以半角字母或数字开头，最多 64 个字母、数字、连字符、下划线或点。' },
  '教材の表示名を200文字以内で設定してください。空欄・改行・未記入のテンプレートは使えません。': { en: 'Set a display name of at most 200 characters, without blank values, line breaks or unresolved templates.', zh: '请设置最多 200 个字符的教材名称，不能留空、换行或包含未填写的模板。' },
  'キットIDを英数字で始まる12文字以内の英数字・ハイフン・アンダースコアで設定してください。先頭の0も番号の一部です。': { en: 'Kit ID must start with a letter or digit and use at most 12 ASCII letters, digits, hyphens or underscores. Leading zeros are part of the ID.', zh: '套件 ID 必须以字母或数字开头，最多 12 个半角字母、数字、连字符或下划线。开头的 0 也是编号的一部分。' },
  '対象UIFlow2ファームウェアの版を講師が設定してください。機器から取得したMicroPythonの版で代用しません。': { en: 'The instructor must set the target UIFlow2 firmware version. Do not substitute the MicroPython version read from the device.', zh: '请讲师设置目标 UIFlow2 固件版本，不能使用设备读取的 MicroPython 版本代替。' },
  'LEDの型番を講師が設定してください。空欄・改行・未記入のテンプレートは使えません。': { en: 'The instructor must set the LED model, without blank values, line breaks or unresolved templates.', zh: '请讲师设置 LED 型号，不能留空、换行或包含未填写的模板。' },
  'LED数を正の整数で設定してください。': { en: 'Set the LED count to a positive integer.', zh: '请将 LED 数量设置为正整数。' },
  'この教材はLED_BPP=3のRGB LEDのみ対応しています。RGBWなどへ勝手に変換せず、講師が仕様を確認してください。': { en: 'This material supports RGB LEDs with LED_BPP=3 only. Do not convert to RGBW; ask the instructor to verify the specification.', zh: '此教材仅支持 LED_BPP=3 的 RGB LED。请勿擅自改为 RGBW 等规格，请讲师确认。' },
  '最大輝度を0より大きく100以下の数値で講師が設定してください。範囲内でも実機の電源安全性は別途確認が必要です。': { en: 'The instructor must set maximum brightness above 0 and at most 100. Power safety must still be checked on the hardware.', zh: '请讲师将最大亮度设置为大于 0 且不超过 100 的数值。即使在此范围内，也需要另外确认实物供电安全。' },
  'Webコントローラを使うにはBLEも有効にしてください。': { en: 'Enable BLE to use the web controller.', zh: '使用网页控制器时，也需要启用 BLE。' },
  'BLE基準コードが未登録です。講師の準備が必要です。': { en: 'No BLE baseline code is registered. Instructor preparation is required.', zh: '尚未登记 BLE 基准代码，需要讲师准备。' },
  'BLE基準コードは100000文字以内にしてください。省略せず登録できる内容を講師が確認してください。': { en: 'BLE baseline code must fit within 100000 characters. The instructor must verify it can be registered without omissions.', zh: 'BLE 基准代码最多 100000 个字符。请讲师确认能完整登记，不能省略。' },
  'BLE基準コードに未記入のテンプレートまたは不正な文字が残っています。': { en: 'The BLE baseline contains unresolved templates or invalid characters.', zh: 'BLE 基准代码中仍有未填写的模板或无效字符。' },
  'BLE基準コードの実機確認情報が未登録です。講師の確認が必要です。': { en: 'Hardware verification of the BLE baseline is not registered. Instructor confirmation is required.', zh: '尚未登记 BLE 基准代码的实机验证信息，需要讲师确认。' },
  'BLEの確認対象機器が設定と一致しません。講師の再確認が必要です。': { en: 'The BLE verification board does not match this kit. Instructor re-verification is required.', zh: 'BLE 验证设备与套件设置不一致，需要讲师重新验证。' },
  '基準コードが確認時から変更されています。講師の再確認が必要です。': { en: 'The baseline code has changed since verification. Instructor re-verification is required.', zh: '基准代码自验证后已更改，需要讲师重新验证。' },
  'BLEの確認対象UIFlow2版が設定と一致しません。講師の再確認が必要です。': { en: 'The verified UIFlow2 version does not match the settings. Instructor re-verification is required.', zh: 'BLE 验证时的 UIFlow2 版本与设置不一致，需要讲师重新验证。' },
  'BLEを確認した講師名と確認日時を設定してください。': { en: 'Set the name of the instructor who verified BLE and the verification date.', zh: '请设置验证 BLE 的讲师姓名和验证日期。' },
  'NanoLED v1対応の実機確認が必要です。講師に確認してください。': { en: 'Hardware verification of NanoLED v1 compatibility is required. Ask the instructor.', zh: '需要在实机上验证 NanoLED v1 兼容性，请向讲师确认。' },
  'NanoLED v1はRGB・1〜300個のLEDに対応します。キットのLED数や形式を勝手に変更せず、講師が確認してください。': { en: 'NanoLED v1 supports 1–300 RGB LEDs. Do not change the kit count or format; ask the instructor to verify it.', zh: 'NanoLED v1 支持 1–300 个 RGB LED。请勿擅自更改套件的 LED 数量或格式，请讲师确认。' },
}

export const translateWorkshop = (locale: Locale, text: string) => locale === 'ja' ? text : workshopMessages[text]?.[locale] ?? text
