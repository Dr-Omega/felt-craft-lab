export const APP_DISPLAY_NAME = 'Felt Craft Lab'
export const APP_ID = 'com.feltcraft.lab'

export const IPC_CHANNELS = {
  PING: 'felt:bootstrap:ping',
  RESOURCE_INSPECT: 'felt:resource:inspect'
} as const

export interface BootstrapPingResult {
  ok: boolean
  appName: string
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  markerPath: string
  markerUrl: string
  timestamp: string
}
