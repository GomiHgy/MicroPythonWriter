import type { MessageCatalog } from './types'
export const ledCodeMessages: MessageCatalog = {
  'コード内のLED設定': { en: 'LED settings in code', zh: '代码中的LED设置' },
  'コードから読み取った値を変更できます。反映後、上の「実行」で機器を動かしてください。': { en: 'Edit values read from your code. After applying, use Run above to start the device.', zh: '可修改从代码读取的数值。应用后，点击上方“运行”启动设备。' },
  'LED数（個）': { en: 'LED count', zh: 'LED数量（颗）' },
  '最大輝度（%）': { en: 'Maximum brightness (%)', zh: '最大亮度（%）' },
  '対応する設定名が見つかりません。': { en: 'No supported setting name found.', zh: '未找到支持的设置名称。' },
  '複数の定義があるため、自動変更できません。': { en: 'Multiple definitions found; automatic editing is unavailable.', zh: '存在多个定义，无法自动修改。' },
  '計算式や処理内の設定は自動変更できません。トップレベルの数値設定に対応しています。': { en: 'Expressions and nested settings cannot be edited automatically. Only top-level numeric settings are supported.', zh: '无法自动修改表达式或处理内部的设置。仅支持顶层数值设置。' },
  'コードを解析できません。構文やコードのサイズを確認してください。': { en: 'Cannot parse this code. Check its syntax and size.', zh: '无法解析代码。请检查语法及代码大小。' },
  'LED数は1以上の整数、最大輝度は0〜100%で入力してください。': { en: 'Enter a positive integer LED count and a maximum brightness from 0 to 100%.', zh: 'LED数量请输入大于等于1的整数，最大亮度请输入0至100%。' },
  'コードに反映': { en: 'Apply to code', zh: '应用到代码' },
  '設定変更を元に戻す': { en: 'Undo settings change', zh: '撤销设置修改' },
  'コードに反映しました。機器への書き込み・実行はまだ行っていません。': { en: 'Applied to code. Nothing has been written to or run on the device yet.', zh: '已应用到代码。尚未写入设备或运行。' },
  '読み取れる設定と注意点': { en: 'Supported settings and notes', zh: '支持的设置及注意事项' },
  'LED_COUNT / NUM_LEDS と MAX_BRIGHTNESS（0〜1）/ MAX_BRIGHTNESS_PERCENT（0〜100）の単純な数値代入に対応します。各項目の定義が1つの場合のみ変更できます。': { en: 'Supports simple numeric assignments to LED_COUNT / NUM_LEDS and MAX_BRIGHTNESS (0–1) / MAX_BRIGHTNESS_PERCENT (0–100). Each setting must have only one definition.', zh: '支持LED_COUNT / NUM_LEDS及MAX_BRIGHTNESS（0至1）/ MAX_BRIGHTNESS_PERCENT（0至100）的简单数值赋值。每项设置必须只有一个定义。' },
  '最大輝度を上げると消費電流が増えます。配線・電源を確認してください。AIの準備やシミュレーターの表示設定は変更しません。シミュレーションにはリセット後に反映されます。': { en: 'Higher brightness increases current consumption. Check wiring and power. AI preparation and simulator display settings are unchanged. Reset the simulation to use the edited code.', zh: '提高最大亮度会增加耗电流。请检查接线和电源。不会修改AI准备及模拟器显示设置。重置模拟后使用修改后的代码。' },
}
