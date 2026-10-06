import type { BaseLocale, Locale } from '../../i18n/types'
import { basePromptLocale } from '../../i18n/locales'

// 利用者への質問やブラウザ設定は増やさず、生成・修正時の内部出力パラメータを共有する。
const rules: Record<BaseLocale, string> = {
  ja: `## RGBゲイン補正（利用者に質問しない内部パラメータ）
- 新しく生成するコードの設定部へ RGB_GAIN_R = 1.0、RGB_GAIN_G = 0.7、RGB_GAIN_B = 0.95 を置く。赤/緑/青 = 100%/70%/95% を標準値とし、利用者への質問・選択肢・確認必須項目にしない。色の希望とは区別し、RGBとGRBの並びを取り違えない。
- 元の演出の色・タイミング・GPIO・LED数・最大輝度は維持し、共通の最終出力処理でRGBを0〜255に制限した後、最大輝度・ユーザー輝度・フェード係数と各チャンネルのゲインを一度だけ掛け、整数化してGRBバッファへ格納する。通常描画の各色の例は int(clamp(channel, 0, 255) * maximum_level * user_level * fade_level * channel_gain)。各係数を0.0〜1.0に制限し、補正分を補うために最大輝度を上げたり色を再正規化したりしない。
- 本体ボタン・BLE・単色・アニメーション・ACTION・消灯のすべての出力経路で補正を抜かさない。保持中の色やOFF・ACTION再押下補間で使う最終送信済みスナップショットは補正済みなので、ゲインや最大輝度を二重適用しない。補間の始点と終点を同じ補正済み出力空間に揃える。輝度変更時は補正前の基準色から再計算し、補正済み色の繰り返し乗算による暗化を防ぐ。
- last_sent_frame、BLEのpixels、シミュレーターが採取するRGBは、ゲイン適用後の最終送信値とする。受信表示や推定電流の計算ではこのRGBを使い、100%/70%/95%をさらに掛けない。既存コードが未補正なら、補正されていると仮定して表示・推定を小さくしない。
- 保存作品・登録基準コード・実機確認記録を自動変更しない。修正では既存のゲイン補正があるか確認し、重複追加しない。既存の明示値や確認済み基準コードと異なる場合は変更点と再確認範囲を示し、黙って上書きしない。同梱候補を参照して新規生成するときも、候補の未補正出力へこの処理を一度だけ追加する。Webアプリ更新だけでは既存main.pyに適用されず、対応コードの明示的な書き込み・実行と実物確認が必要。`,
  en: `## RGB gain correction (internal parameters, not interview questions)
- Put RGB_GAIN_R = 1.0, RGB_GAIN_G = 0.7 and RGB_GAIN_B = 0.95 in the settings of newly generated code. Default red/green/blue to 100%/70%/95%; do not ask users about these gains, offer gain choices or require gain confirmation. Keep them separate from creative color choices and distinguish RGB from GRB order.
- Preserve the artwork's source colors, timing, GPIOs, LED count and brightness cap. In the shared final output path, clamp RGB to 0–255, multiply by maximum brightness, user brightness, fade and the corresponding channel gain exactly once, convert to integers, then store GRB. For ordinary rendering use int(clamp(channel, 0, 255) * maximum_level * user_level * fade_level * channel_gain). Bound each factor to 0.0–1.0; never raise the brightness cap or renormalize colors to compensate for correction.
- Apply correction to every onboard-button, BLE, solid-color, animation, ACTION and OFF output path. Held output and last-sent snapshots used by OFF/ACTION-retrigger interpolation are already corrected: never apply gains or maximum brightness twice. Interpolate endpoints in the same corrected output space. Recalculate brightness changes from uncorrected reference colors, avoiding cumulative dimming from repeatedly multiplying corrected colors.
- last_sent_frame, BLE pixels and simulator-captured RGB contain final transmitted values AFTER gain correction. Use these RGB values for received displays and current estimates; do not multiply by 100%/70%/95% again. If existing code lacks correction, never assume corrected output and understate its display or estimated current.
- Do not automatically modify saved artwork, registered baselines or verification records. When repairing, check for existing correction and do not add it twice. If existing explicit gains or a verified baseline differ, explain the change and required revalidation rather than silently overwriting them. When generating new code from the bundled candidate, add correction exactly once to its uncorrected output path. Updating the Web app does not apply this to existing main.py; updated code requires explicit writing/running and physical verification.`,
  zh: `## RGB 增益校正（内部参数，不作为用户问题）
- 在新生成代码的设置区定义 RGB_GAIN_R = 1.0、RGB_GAIN_G = 0.7、RGB_GAIN_B = 0.95。红/绿/蓝默认为 100%/70%/95%，不要向用户询问增益、提供增益选项或要求确认增益。将其与创作颜色选择分开，不能混淆 RGB 与 GRB 顺序。
- 保持作品原始颜色、时序、GPIO、LED 数量及最大亮度。在共用最终输出处理中将 RGB 限制在 0–255，再将最大亮度、用户亮度、渐变和各通道增益仅乘一次，转为整数后存入 GRB 缓冲区。普通绘制示例为 int(clamp(channel, 0, 255) * maximum_level * user_level * fade_level * channel_gain)。各系数限制在 0.0–1.0，不能为补偿校正而提高亮度上限或重新归一化颜色。
- 机身按钮、BLE、单色、动画、ACTION 和熄灭的所有输出路径都应用校正。保留的输出及 OFF/ACTION 再触发插值使用的最后发送快照已经校正，不能再次应用增益或最大亮度。插值两端必须处于同一已校正输出空间。亮度变化从未校正的基准色重新计算，防止重复乘以已校正颜色造成逐渐变暗。
- last_sent_frame、BLE pixels 和模拟器采集的 RGB 均为增益校正后的最终发送值。接收显示与电流估算直接使用这些 RGB，不能再乘 100%/70%/95%。若既有代码未校正，不能假设已校正而低估显示或电流。
- 不自动修改已保存作品、登记基准代码或实机验证记录。修复时先检查是否已有增益处理，不能重复添加。如果既有明确增益或已验证基准代码不同，说明变更及需要重新验证的范围，不静默覆盖。从内置候选代码生成新程序时，也应只向其未校正输出路径添加一次。更新网页应用不会更改既有 main.py，必须明确写入/运行对应代码并确认实物。`,
}

export function buildRgbGainRules(locale: Locale): string {
  return rules[basePromptLocale(locale)]
}
