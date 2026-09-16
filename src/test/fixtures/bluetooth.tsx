import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BluetoothPanel } from '../../components/BluetoothPanel'
import { NANO_LED_RX_UUID, type LedStatus } from '../../services/bluetooth/protocol'
import type { BluetoothCharacteristic, BluetoothDevice, BluetoothServer } from '../../services/bluetooth/BluetoothController'
import '../../index.css'
import '../../App.css'

if (!import.meta.env.DEV) throw new Error('開発時だけ使うテスト画面です。')

let notifications = true
let connected = false
let timer: ReturnType<typeof setInterval> | undefined
let status: LedStatus = { v: 1, mode: 'MAGIC', brightness: 50, speed: 30, pixels: '3f001f001f3f1f003f'.repeat(12) + '000000' }

class Characteristic extends EventTarget implements BluetoothCharacteristic {
  value: DataView | null = null
  async startNotifications() { return this }
  async writeValueWithResponse(data: BufferSource) {
    const command = new TextDecoder().decode(data).trim()
    const [token, parameter] = command.split(' ')
    if (token === 'BRIGHTNESS') status = { ...status, brightness: Number(parameter) }
    else if (token === 'SPEED') status = { ...status, speed: Number(parameter) }
    else if (token !== 'STATUS') status = { ...status, mode: token }
    if (token !== 'STATUS') {
      const channel = Math.floor(127 * status.brightness / 100).toString(16).padStart(2, '0')
      status = { ...status, pixels: (status.mode === 'OFF' ? '000000' : status.mode === 'BLUE' ? `0000${channel}` : `${channel}00${channel}`).repeat(37) }
    }
    notify()
  }
}

const rx = new Characteristic()
const tx = new Characteristic()
const device = new EventTarget() as EventTarget & BluetoothDevice
const server: BluetoothServer = {
  async connect() {
    connected = true
    timer = setInterval(notify, 1000)
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
  const [paused, setPaused] = useState(false)
  const [dark, setDark] = useState(false)
  return <main className="app">
    <div className="notice warn"><h1>テスト専用：実機とは通信しません</h1><p>20バイト分割の模擬通知でUIを確認する画面です。製品の入口には含まれません。</p><div className="device-actions">
      <button onClick={() => { notifications = !notifications; setPaused(!notifications) }}>{paused ? '模擬通知を再開' : '模擬通知を止める'}</button>
      <button onClick={() => server.disconnect()}>模擬切断</button>
      <button onClick={() => { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light' }}>{dark ? 'テストをライト表示' : 'テストをダーク表示'}</button>
    </div></div>
    <BluetoothPanel onOpenProgram={() => { location.href = '/' }} />
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
