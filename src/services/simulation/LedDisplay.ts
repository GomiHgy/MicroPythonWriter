export type LedDisplayMode = 'visible' | 'output'
type Rgb = readonly [number, number, number]

/**
 * LEDのPWM出力を、画面で見やすいsRGBの値へ変換する。
 * https://www.w3.org/TR/css-color-4/#color-conversion-code
 * フレームごとの最大値では正規化しないため、光量の差とフェードを保持する。
 * コード適用済みの輝度・RGBゲインは掛け直さない。電流推定には使わない。
 */
export function ledDisplayRgb(pixel: Rgb, mode: LedDisplayMode): [number, number, number] {
  if (mode === 'output') return [pixel[0], pixel[1], pixel[2]]
  return pixel.map(channel => {
    const linear = Math.min(255, Math.max(0, channel)) / 255
    const srgb = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
    return Math.round(srgb * 255)
  }) as [number, number, number]
}
