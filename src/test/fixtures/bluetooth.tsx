import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BluetoothPanel } from '../../components/BluetoothPanel'
import { NANO_LED_RX_UUID, type LedStatus } from '../../services/bluetooth/protocol'
import type { BluetoothCharacteristic, BluetoothDevice, BluetoothServer } from '../../services/bluetooth/BluetoothController'
import { isLocale, useLocale } from '../../i18n'
import '../../index.css'
import '../../App.css'

if (!import.meta.env.DEV) throw new Error('開発時だけ使うテスト画面です。')

// 実機用の基準コードではない。ブラウザ上だけで受信・送信と表示の連携を確認する。
const LED_COUNT = 10
const MAX_BRIGHTNESS = 0.2
const ACTION_DURATION_MS = 1200
const controls = {
  speed: true,
  modes: [
    { id: 'RAINBOW', label: 'にじいろ散歩' },
    { id: 'CALM', label: '落ち着いた光' },
    { id: 'TWINKLE', label: '星のまたたき' },
  ],
  actions: [{ id: 'SPARK', label: '一度だけ光る' }, { id: 'CHEER', label: 'お祝い演出' }],
}
type Playback = Extract<LedStatus, { v: 2 }>['playback']
type Color = readonly [number, number, number]
let notifications = true
let connected = false
let timer: ReturnType<typeof setInterval> | undefined
let phase = 0
let frame: Color[] = Array.from({ length: LED_COUNT }, () => [0, 0, 0])
let actionStartedAt = 0
let returnState: { playback: Playback; phase: number; frame: Color[] } | null = null
let status: LedStatus = initialStatus(2)

function initialStatus(version: 1 | 2): LedStatus {
  const common = { mode: version === 1 ? 'MAGIC' : 'RAINBOW', brightness: 50, speed: 30, pixels: '000000'.repeat(LED_COUNT) }
  return version === 1 ? { v: 1, ...common } : { v: 2, ...common, playback: 'playing', action: null, controls }
}

function makeFrame(mode: string, step: number): Color[] {
  const rainbow: Color[] = [[255, 0, 0], [255, 100, 0], [0, 255, 0], [0, 80, 255], [180, 0, 255]]
  return Array.from({ length: LED_COUNT }, (_, index) => {
    if (mode === 'OFF') return [0, 0, 0]
    if (mode === 'CALM' || mode === 'BLUE') return [0, 110, 255]
    if (mode === 'PINK') return [255, 30, 110]
    if (mode === 'TWINKLE') return (index + Math.floor(step)) % 3 === 0 ? [255, 240, 140] : [0, 0, 0]
    return rainbow[(index + Math.floor(step)) % rainbow.length]
  })
}

function applyOutput() {
  const black = status.v === 2 ? status.playback === 'off' : status.mode === 'OFF'
  const scale = MAX_BRIGHTNESS * status.brightness / 100
  const pixels = frame.map(color => color.map(channel => Math.floor(black ? 0 : channel * scale).toString(16).padStart(2, '0')).join('')).join('')
  status = { ...status, pixels }
}

function advanceAnimation() {
  if (status.v === 2 && status.action !== null) {
    const elapsed = Date.now() - actionStartedAt
    if (elapsed >= ACTION_DURATION_MS && returnState) {
      frame = returnState.frame
      phase = returnState.phase
      status = { ...status, action: null, playback: returnState.playback }
      returnState = null
    } else {
      const amount = Math.max(0, Math.round(255 * (1 - elapsed / ACTION_DURATION_MS)))
      frame = Array.from({ length: LED_COUNT }, (_, index) => status.v === 2 && status.action === 'CHEER' && index % 2 === 0 ? [amount, 0, amount] : [amount, amount, amount])
    }
  } else if (status.v === 1 || status.playback === 'playing') {
    phase += 0.1 + status.speed / 100
    frame = makeFrame(status.mode, phase)
  }
  applyOutput()
  notify()
}

function cancelAction() { returnState = null }

class Characteristic extends EventTarget implements BluetoothCharacteristic {
  value: DataView | null = null
  async startNotifications() { return this }
  async writeValueWithResponse(data: BufferSource) {
    const [token, parameter] = new TextDecoder().decode(data).trim().split(' ')
    if (token === 'BRIGHTNESS' || token === 'SPEED') {
      const value = Number(parameter)
      if (!Number.isInteger(value) || value < 0 || value > 100) return
      status = { ...status, [token === 'BRIGHTNESS' ? 'brightness' : 'speed']: value }
    } else if (status.v === 1) {
      if (token !== 'STATUS') {
        status = { ...status, mode: token }
        frame = makeFrame(status.mode, phase)
      }
    } else if (token === 'PLAY' || token === 'PAUSE' || token === 'OFF') {
      cancelAction()
      status = { ...status, action: null, playback: token === 'PLAY' ? 'playing' : token === 'PAUSE' ? 'paused' : 'off' }
      if (token === 'PLAY') frame = makeFrame(status.mode, phase)
    } else if (token === 'MODE' && controls.modes.some(mode => mode.id === parameter)) {
      cancelAction()
      phase = 0
      status = { ...status, mode: parameter, playback: 'playing', action: null }
      frame = makeFrame(status.mode, phase)
    } else if (token === 'ACTION' && status.action === null && controls.actions.some(action => action.id === parameter)) {
      returnState = { playback: status.playback, phase, frame }
      actionStartedAt = Date.now()
      status = { ...status, playback: 'playing', action: parameter }
      frame = Array.from({ length: LED_COUNT }, () => [255, 255, 255])
    }
    applyOutput()
    notify()
  }
}

const rx = new Characteristic()
const tx = new Characteristic()
const device = new EventTarget() as EventTarget & BluetoothDevice
const server: BluetoothServer = {
  async connect() {
    connected = true
    clearInterval(timer)
    timer = setInterval(advanceAnimation, 200)
    frame = makeFrame(status.mode, phase)
    applyOutput()
    return server
  },
  disconnect() {
    const wasConnected = connected
    connected = false
    clearInterval(timer)
    if (wasConnected) device.dispatchEvent(new Event('gattserverdisconnected'))
  },
  async getPrimaryService() { return { getCharacteristic: async (uuid: string) => uuid === NANO_LED_RX_UUID ? rx : tx } },
}
device.name = 'NanoLED-UI-TEST'
device.gatt = server
Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } })

function notify() {
  if (!connected || !notifications) return
  const bytes = new TextEncoder().encode(JSON.stringify(status) + '\n')
  for (let index = 0; index < bytes.length; index += 20) {
    const chunk = bytes.slice(index, index + 20)
    tx.value = new DataView(chunk.buffer)
    tx.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

export function Fixture() {
  const { locale, setLocale } = useLocale()
  const [paused, setPaused] = useState(false)
  const [dark, setDark] = useState(false)
  const [version, setVersion] = useState<1 | 2>(2)
  return <main className="app">
    <div className="notice warn"><h1>テスト専用：実機とは通信しません</h1><p>20バイト分割の模擬通知でUIを確認する画面です。10 LED・最大輝度20%の模擬出力であり、実機動作の証明ではありません。製品の入口には含まれません。</p><div className="device-actions">
      <label>表示言語（テスト用）<select value={locale} onChange={event => { if (isLocale(event.target.value)) setLocale(event.target.value) }}><option value="ja">日本語</option><option value="en">English</option><option value="zh">简体中文</option></select></label>
      <label>模擬プログラム<select value={version} onChange={event => {
        const next = event.target.value === '1' ? 1 : 2
        server.disconnect(); cancelAction(); phase = 0; status = initialStatus(next); setVersion(next)
      }}><option value="2">v2 作品専用リモコン</option><option value="1">v1 旧プログラム</option></select></label>
      <button onClick={() => { notifications = !notifications; setPaused(!notifications); if (notifications) notify() }}>{paused ? '模擬通知を再開' : '模擬通知を止める'}</button>
      <button onClick={() => server.disconnect()}>模擬切断</button>
      <button onClick={() => { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light' }}>{dark ? 'テストをライト表示' : 'テストをダーク表示'}</button>
    </div></div>
    <BluetoothPanel onOpenProgram={() => { location.href = '/' }} onOpenPreparation={() => { location.href = '/' }} />
  </main>
}

const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Fixture /></StrictMode>)

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // 模擬画面の差し替え前にReactと模擬通知を片付け、二重描画・古いタイマーを残さない。
    root.unmount()
    server.disconnect()
    cancelAction()
  })
}
