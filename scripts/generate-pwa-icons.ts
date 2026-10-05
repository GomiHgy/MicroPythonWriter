import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

// favicon.svgのLEDケースとRGB発光を、依存パッケージなしでPNG化する。
// maskableは背景を四隅まで塗り、主要なLEDを中央の安全領域内に置く。
type Color = [number, number, number]
const mix = (a: Color, b: Color, alpha: number): Color => a.map((value, index) => value + (b[index] - value) * alpha) as Color
const distance = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy)
function roundedRect(x: number, y: number, left: number, top: number, width: number, height: number, radius: number): boolean {
  return x >= left && x <= left + width && y >= top && y <= top + height && distance(x, y, Math.max(left + radius, Math.min(x, left + width - radius)), Math.max(top + radius, Math.min(y, top + height - radius))) <= radius
}
function pixel(x: number, y: number, maskable: boolean): Color {
  let color = mix([48, 72, 103], [17, 28, 50], Math.min(1, (x + y) / 96))
  if (!maskable && !roundedRect(x, y, 0.5, 0.5, 47, 47, 14)) return [15, 23, 33]
  for (const cy of [18, 30]) for (const [left, right] of [[6, 11], [37, 42]]) {
    if (distance(x, y, Math.max(left, Math.min(x, right)), cy) <= 1.5) color = [233, 199, 126]
  }
  if (roundedRect(x, y, 9, 9, 30, 30, 8)) color = mix([255, 255, 255], [201, 216, 232], Math.min(1, (x + y - 18) / 60))
  if (distance(x, y, 24, 24) <= 11.5) color = [152, 173, 197]
  if (distance(x, y, 24, 24) <= 10.8) color = [27, 44, 69]
  for (const [cx, cy, glow, core] of [[20, 21, [255, 100, 139], [255, 211, 224]], [28, 21, [94, 245, 172], [205, 255, 229]], [24, 28, [114, 185, 255], [210, 234, 255]]] as [number, number, Color, Color][]) {
    const d = distance(x, y, cx, cy)
    if (d < 8 && distance(x, y, 24, 24) <= 10.8) color = mix(color, glow, (1 - d / 8) ** 1.4)
    if (d <= 2) color = core
  }
  if (x >= 11 && x <= 15 && y >= 33 && y <= 37 && y - 33 >= x - 11) color = [128, 149, 174]
  return color
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
function png(size: number, maskable = false): Buffer {
  const data = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0]
    for (const dy of [0.25, 0.75]) for (const dx of [0.25, 0.75]) {
      const color = pixel((x + dx) * 48 / size, (y + dy) * 48 / size, maskable)
      color.forEach((value, channel) => { sum[channel] += value })
    }
    const offset = y * (size * 4 + 1) + x * 4 + 1
    sum.forEach((value, channel) => { data[offset + channel] = Math.round(value / 4) })
    data[offset + 3] = 255
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))])
}
const output = fileURLToPath(new URL('../public/icons/', import.meta.url))
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'led-192.png'), png(192))
writeFileSync(join(output, 'led-512.png'), png(512))
writeFileSync(join(output, 'led-maskable-512.png'), png(512, true))
