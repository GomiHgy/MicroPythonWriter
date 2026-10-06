import type { Locale } from '../../i18n/types'
import { basePromptLocale } from '../../i18n/locales'

// ボタンを使わない設定では、手順や質問を追加しない。
export function buildButtonGestureRules(locale: Locale, enabled: boolean): string {
  if (!enabled) return ''
  if (basePromptLocale(locale) === 'en') return `## Physical-button gestures
- For new code using the physical button, support single click, double click and 1-second long press as the basic gesture choices. Single click is the basic operation; ask whether double click and 1-second long press should also be used, and assign only the chosen gestures. Do not invent actions for unselected gestures or require all three.
- Unless the artwork explicitly specifies otherwise, use LONG_PRESS_MS = 1000 and DOUBLE_CLICK_MS = 350. Read active-LOW input in the main loop, debounce for about 40ms, and measure elapsed time using time.ticks_ms()/time.ticks_diff(). Never sleep for the click window or hold duration; keep LEDs and enabled BLE responsive.
- When double click is enabled, defer the first single click until the window after the first debounced release expires. A second debounced press within that window followed by a short release completes one double click, with no extra single clicks. Reserve that pending second press until it is released or becomes a long press. An enabled long press fires once at the threshold, cancels pending clicks, and must not fire a single/double click on release or repeat while held. In particular, a long second press must not also trigger the first pending single click. Keep unselected gestures from invoking unrelated effects.
- Preserve explicitly specified artwork gestures, timing and hold-to-light behavior. This policy is not permission to add gestures or change timing during repairs of existing artwork or registered baselines. When generating new code from a bundled candidate, adapt button handling to the agreed gestures and 1000ms default rather than copying a different candidate threshold. Existing stored code and verification records remain unchanged; generated or modified code still needs hardware checks.`
  if (locale === 'zh') return `## 实体按钮手势
- 新建使用实体按钮的程序时，基本支持单击、双击、长按 1 秒三种可选操作。单击是基础操作，必须询问是否也使用双击和长按 1 秒，只为用户选定的手势分配动作。不擅自为未选择的手势添加动作，也不强迫使用全部三种。
- 作品没有明确指定其他条件时，使用 LONG_PRESS_MS = 1000 和 DOUBLE_CLICK_MS = 350。在主循环读取低电平有效的按钮，进行约 40ms 消抖，用 time.ticks_ms()/time.ticks_diff() 计算经过时间。不能用 sleep 等待双击窗口或长按时长，保持 LED 和已启用 BLE 的响应。
- 启用双击时，首次消抖后的松开启动等待窗口，超时后才确认单击。窗口内第二次稳定按下并短按松开，只触发一次双击，不额外触发单击；第二次按下未松开时，保留待定状态，直到松开或成为长按。启用的长按达到阈值时只触发一次并取消待定点击，松开时不触发单击/双击，持续按住不重复触发。尤其第二次按下变为长按时，不能同时触发待定的首次单击。未选择的手势不能调用无关效果。
- 保留作品明确指定的手势、时长及按住点亮行为。这不是修复既有作品或登记基准代码时添加手势或更改时长的许可。参考内置候选生成新程序时，按已确认手势和默认 1000ms 调整按钮处理，不直接照抄候选的其他阈值。已保存代码和验证记录不变；新生成或修改的程序仍需实机验证。`
  return `## 物理ボタンの押し方
- 物理ボタンを使う新規コードでは、シングルクリック・ダブルクリック・1秒長押しを基本の選択肢としてサポートする。シングルクリックを基本とし、ダブルクリック・1秒長押しも使うかを質問して、選ばれた押し方だけに動作を割り当てる。未選択の押し方に勝手な動作を追加せず、3種類すべての利用を強制しない。
- 作品に明示指定がなければ LONG_PRESS_MS = 1000、DOUBLE_CLICK_MS = 350 とする。アクティブLOWの入力を主ループで読み、約40msのチャタリング対策と time.ticks_ms()/time.ticks_diff() で経過時間を判定する。クリック待ち・長押し待ちにsleepを使わず、LEDと有効なBLEの処理を止めない。
- ダブルクリックを使う場合は1回目の安定した解放から判定待ちを開始し、待ち時間が過ぎてからシングルクリックを確定する。時間内に2回目の安定した押下があり短く解放された場合だけダブルクリックを1回発火し、シングルクリックを重ねない。2回目を押している間は、解放または長押し確定まで保留する。有効な長押しは閾値到達時に1回だけ発火し、保留中のクリックを取り消す。解放時のシングル・ダブルクリックと押し続けによる再発火を抑止し、特に2回目が長押しなら保留中の1回目も発火させない。未選択の押し方で別の演出を勝手に呼び出さない。
- 作品で明示された押し方・時間・押している間だけ光る動作は維持する。既存作品や登録済み基準コードの修正で、押し方を追加したり時間を変更したりする許可とは扱わない。同梱候補を参考に新規生成する場合は、候補の別の閾値をそのまま転記せず、合意した押し方と標準1000msに合わせてボタン処理を構成する。保存コード・確認記録は変更せず、生成・改造後のコードには実機確認が必要。`
}

export function buildButtonGestureQuestion(locale: Locale, enabled: boolean): string {
  if (!enabled) return ''
  if (basePromptLocale(locale) === 'en') return '- If physical-button control is chosen, ask: "Along with single click, would you like double click or a 1-second long press?" Offer "Single click only / Add double click / Add 1-second long press / Use all three / Choose for me". Count this within the maximum 6 questions and ask only one question per reply. Skip it for Web-remote-only or automatic-only control, a disabled button, or an already answered choice. If Choose for me is selected without other requirements, use single click only and briefly explain; do not silently add other gestures. Agree on each chosen gesture\'s effect within the existing questions and final summary, marking unused gestures as unused. Preserve explicitly specified gestures and durations.'
  if (locale === 'zh') return '- 选择实体按钮操作时，询问：“除了单击，还想使用双击或长按 1 秒吗？”提供“只用单击 / 增加双击 / 增加长按 1 秒 / 三种都用 / 帮我决定”五个选项。计入最多 6 题，每次只问一题。仅用网页遥控器、仅自动运行、按钮禁用或已经回答时，不再询问。无其他要求且选择“帮我决定”时，只采用单击并简短说明，不擅自增加其他手势。在现有问题及最终汇总中确认各选定手势的动作，并把未使用手势标为不使用。保留作品明确指定的手势和时长。'
  return '- 物理ボタンで操作する場合は「シングルクリックに加えて、ダブルクリックや1秒長押しも使いますか？」と質問し、「シングルクリックだけ / ダブルクリックも使う / 1秒長押しも使う / 3種類すべて使う / おまかせ」の5択を示す。最大6問の中に含め、1回に1問だけ聞く。Webリモコンだけ・自動動作だけを選んだ場合、ボタン無効時、回答済みの場合は質問しない。ほかに希望がなく「おまかせ」ならシングルクリックだけを採用して短く説明し、ほかの押し方を勝手に追加しない。選んだ各押し方の動作は既存の質問と最終仕様まとめの中で確認し、未使用は未使用と明記する。作品で明示された押し方・時間は維持する。'
}
