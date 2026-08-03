export const APP_DISPLAY_NAME = 'Felt Craft Lab'
export const APP_ID = 'com.feltcraft.lab'

export const IPC_CHANNELS = {
  PING: 'felt:bootstrap:ping',
  RESOURCE_INSPECT: 'felt:resource:inspect',
  AI_HEALTH: 'felt:ai:health',
  AI_ASR_TRANSCRIBE: 'felt:ai:asr:transcribe',
  AI_QA_ASK: 'felt:ai:qa:ask',
  AI_TTS_SYNTHESIZE: 'felt:ai:tts:synthesize'
} as const

export interface BootstrapPingResult {
  ok: boolean
  appName: string
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  /** Whether the bootstrap runtime marker exists. Never an OS path. */
  markerFound: boolean
  timestamp: string
}
