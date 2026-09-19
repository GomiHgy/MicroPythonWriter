import { buildStarterProgram } from '../projects/StarterProgram'
import type { ProjectRecipe, ProjectSettings } from '../projects/types'
import { isLedModel, isWorkshopProfile, validateWorkshopProfile, type WorkshopProfile } from './WorkshopProfile'

/** 無線を試す候補コードを作るだけ。機器への書込みや実機確認済み登録はしない。 */
export function buildControllerStarter(profile: WorkshopProfile): { settings: ProjectSettings; recipe: ProjectRecipe; source: string } {
  if (!isWorkshopProfile(profile)) throw new Error('機器とLEDの設定を確認してください。')
  const errors = validateWorkshopProfile(profile)
  if (errors.length) throw new Error(errors[0])
  // プロフィールでは未入力を許すが、試すコードには具体的な設定が必要。
  if (typeof profile.firmwareVersion !== 'string' || !isLedModel(profile.ledModel)
    || typeof profile.ledCount !== 'number' || typeof profile.ledPin !== 'number'
    || typeof profile.maxBrightnessPercent !== 'number') throw new Error('機器とLEDの設定を確認してください。')
  const settings: ProjectSettings = {
    boardId: profile.boardId,
    firmwareVersion: profile.firmwareVersion,
    ledModel: profile.ledModel,
    ledCount: profile.ledCount,
    ledPin: profile.ledPin,
    maxBrightnessPercent: profile.maxBrightnessPercent,
  }
  const recipe: ProjectRecipe = {
    modes: [
      { id: 'LIGHT', label: '黄色の光', icon: 'light', kind: 'solid', color: '#ffff00', speed: 50, repeats: 0, endState: 'hold' },
      { id: 'RAINBOW', label: 'にじいろ', icon: 'rainbow', kind: 'rainbow', color: '#ffff00', speed: 50, repeats: 0, endState: 'hold' },
    ],
    shortPress: profile.features.button ? 'next' : 'none',
    doublePress: 'none',
    longPress: profile.features.button ? 'toggle' : 'none',
    whileHeld: false,
    wireless: true,
  }
  return { settings, recipe, source: buildStarterProgram(settings, recipe) }
}
