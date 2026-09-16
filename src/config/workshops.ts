import type { WorkshopProfile } from '../services/workshop/WorkshopProfile'

export interface WorkshopPreset {
  id: string
  profile: WorkshopProfile
}

const sharedProfile: WorkshopProfile = {
  boardId: 'm5nanoc6',
  materialId: 'nano-c6-led-workshop',
  revision: 'writer-ai-1',
  displayName: 'M5NanoC6',
  firmwareVersion: null,
  ledModel: null,
  ledCount: 10,
  ledPin: 2,
  ledBpp: 3,
  maxBrightnessPercent: 20,
  features: { button: true, ble: false, controller: false },
  baseline: { code: '', verification: null },
}

export const workshopPresets: WorkshopPreset[] = [
  { id: 'nano-c6-led-default', profile: { ...sharedProfile, features: { ...sharedProfile.features }, baseline: { ...sharedProfile.baseline } } },
  { id: 'atom-s3-lite-led-default', profile: { ...sharedProfile, boardId: 'atoms3lite', materialId: 'atom-s3-lite-led-workshop', displayName: 'AtomS3Lite', features: { ...sharedProfile.features }, baseline: { ...sharedProfile.baseline } } },
]
