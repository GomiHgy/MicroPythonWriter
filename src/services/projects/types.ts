import type { BoardId } from '../../config/boards'
import type { LED_MODELS } from '../workshop/WorkshopProfile'

export interface ProjectSettings {
  boardId: BoardId
  firmwareVersion: string
  ledModel: typeof LED_MODELS[number]
  ledCount: number
  ledPin: number
  maxBrightnessPercent: number
}
export type EffectKind = 'solid' | 'rainbow' | 'chase' | 'twinkle'
export type EffectIcon = 'light' | 'star' | 'rainbow' | 'heart'
export interface ProjectEffect {
  id: string
  label: string
  icon: EffectIcon
  kind: EffectKind
  color: string
  speed: number
  repeats: number
  endState: 'hold' | 'off'
}
export interface ProjectRecipe {
  modes: ProjectEffect[]
  shortPress: 'next' | 'toggle' | 'none'
  longPress: 'off' | 'none'
  whileHeld: boolean
  wireless: boolean
}
export interface RemoteButton {
  kind: 'mode' | 'action'
  id: string
  label: string
  icon: EffectIcon
}
export interface ProjectSnapshot {
  source: string
  settings: ProjectSettings
  recipe: ProjectRecipe
  remoteButtons: RemoteButton[]
}
export interface ArtworkProject {
  format: 'micropython-writer-project'
  version: 1
  name: string
  updatedAt: string
  draft: ProjectSnapshot
  // 利用者が実際の動きを確認した保存点。提供側のBLE検証証明ではない。
  working: { snapshot: ProjectSnapshot; confirmedAt: string } | null
}
export const effectIcons: Record<EffectIcon, string> = { light: '●', star: '✦', rainbow: '🌈', heart: '♥' }
