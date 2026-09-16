import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'

export interface WorkshopPreset {
  id: string
  profile: WorkshopProfile
}

const sharedProfile: WorkshopProfile = {
  materialId: 'nano-c6-led-workshop',
  revision: 'writer-ai-1',
  displayName: 'NanoC6 LEDワークショップ',
  kitId: null,
  firmwareVersion: null,
  ledModel: null,
  ledCount: null,
  ledBpp: 3,
  maxBrightnessPercent: null,
  features: { button: true, ble: false, controller: false },
  baseline: { code: '', verification: null },
}

export const workshopPresets: WorkshopPreset[] = [
  { id: 'nano-c6-led-default', profile: { ...sharedProfile, features: { ...sharedProfile.features }, baseline: { ...sharedProfile.baseline } } },
]
