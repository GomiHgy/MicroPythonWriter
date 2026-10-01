import { LED_MODELS } from '../workshop/WorkshopProfile'

export type LedModel = typeof LED_MODELS[number]
type Rgb = readonly [number, number, number]

export interface LedCurrentObservation {
  ledCount: number
  currentMa: Record<LedModel, number>
  peakMa: Record<LedModel, number>
}

export const LED_CURRENT_WARNING_MA = 600

/**
 * 電流は実測値ではなく参考推定。同じ型番でも世代・互換品・電源条件で変わる。
 * WS2812B/SK6812は旧仕様も想定した60mA/白に、アプリ側で1mA/灯の待機分を加える。
 * ほかは下記データシートの特定品種を参考にし、型番全体の最大値とは扱わない。
 */
export const LED_CURRENT_PROFILES: Record<LedModel, { channelMa: number; idleMa: number; reference: string; sourceUrl: string }> = {
  WS2812B: {
    channelMa: 20, idleMa: 1,
    reference: 'WS2812B/SK6812 RGB strip: 60 mA full white + 1 mA idle allowance',
    sourceUrl: 'https://www.adafruit.com/product/1138',
  },
  'WS2812B-MINI': {
    channelMa: 12, idleMa: 0.6,
    reference: 'Worldsemi WS2812B-MINI V3/W',
    sourceUrl: 'https://www.gainer-led.com/uploads/42875/files/WS2812B-MINI-V3W.pdf?rnd=594',
  },
  'WS2812C-2020': {
    channelMa: 5, idleMa: 0.5,
    reference: 'Worldsemi WS2812C-2020',
    sourceUrl: 'https://www.mouser.com/pdfDocs/WS2812C-2020_Datasheet.pdf',
  },
  SK6812: {
    channelMa: 20, idleMa: 1,
    reference: 'WS2812B/SK6812 RGB strip: 60 mA full white + 1 mA idle allowance',
    sourceUrl: 'https://www.adafruit.com/product/1138',
  },
  SK6812MINI: {
    channelMa: 12, idleMa: 1,
    reference: 'OPSCO SK6812MINI-HS A/0',
    sourceUrl: 'https://cdn-shop.adafruit.com/product-files/2659/2304101800_OPSCO-Optoelectronics-SK6812MINI-HS_C2922787.pdf',
  },
}

function channelTotal(pixels: readonly Rgb[]): number {
  return pixels.reduce((sum, [red, green, blue]) => sum + red + green + blue, 0)
}

function fromOutput(ledCount: number, channels: number, model: LedModel): number {
  const profile = LED_CURRENT_PROFILES[model]
  return ledCount * profile.idleMa + channels / 255 * profile.channelMa
}

/** 検証済みの送信RGB値から計算。コード適用済みの輝度・RGBゲインを二重に掛けない。 */
export function estimateLedCurrent(pixels: readonly Rgb[], model: LedModel): number {
  return fromOutput(pixels.length, channelTotal(pixels), model)
}

/** UIの表示間引きより前に毎回呼び、短いフラッシュも実行中の最大値へ残す。 */
export function observeLedCurrent(previous: LedCurrentObservation | null, pixels: readonly Rgb[]): LedCurrentObservation {
  const channels = channelTotal(pixels)
  const currentMa = Object.fromEntries(LED_MODELS.map(model => [model, fromOutput(pixels.length, channels, model)])) as Record<LedModel, number>
  const peakMa = Object.fromEntries(LED_MODELS.map(model => [model, Math.max(previous?.peakMa[model] ?? 0, currentMa[model])])) as Record<LedModel, number>
  return { ledCount: pixels.length, currentMa, peakMa }
}
