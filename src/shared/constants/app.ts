export const APP_DISPLAY_NAME = 'Felt Craft Lab'
export const APP_ID = 'com.feltcraft.lab'

export const IPC_CHANNELS = {
  PING: 'felt:bootstrap:ping',
  RESOURCE_INSPECT: 'felt:resource:inspect',
  PREVIEW_SAVE: 'felt:preview:save',
  PREVIEW_DELETE: 'felt:preview:delete',
  STORY_CARD_AUDIO_SAVE: 'felt:story-card-audio:save',
  STORY_CARD_AUDIO_READ: 'felt:story-card-audio:read',
  STORY_CARD_AUDIO_PROMOTE: 'felt:story-card-audio:promote',
  STORY_CARD_AUDIO_DELETE: 'felt:story-card-audio:delete',
  AI_HEALTH: 'felt:ai:health',
  AI_ASR_TRANSCRIBE: 'felt:ai:asr:transcribe',
  AI_STORY_REWRITE: 'felt:ai:story:rewrite',
  AI_QA_ASK: 'felt:ai:qa:ask',
  AI_TTS_SYNTHESIZE: 'felt:ai:tts:synthesize',
  IMAGE_UPLOAD: 'felt:image:upload'
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
