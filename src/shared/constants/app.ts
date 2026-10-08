export const APP_DISPLAY_NAME = 'Felt Craft Lab'
export const APP_ID = 'com.feltcraft.lab'

export const IPC_CHANNELS = {
  PING: 'felt:bootstrap:ping',
  RESOURCE_INSPECT: 'felt:resource:inspect',
  PREVIEW_SAVE: 'felt:preview:save',
  PREVIEW_DELETE: 'felt:preview:delete',
  AI_HEALTH: 'felt:ai:health',
  AI_ASR_TRANSCRIBE: 'felt:ai:asr:transcribe',
  AI_QA_ASK: 'felt:ai:qa:ask',
  AI_TTS_SYNTHESIZE: 'felt:ai:tts:synthesize',
  IMAGE_UPLOAD: 'felt:image:upload',
  PLAZA_AUTH_REGISTER: 'felt:plaza:auth:register',
  PLAZA_AUTH_LOGIN: 'felt:plaza:auth:login',
  PLAZA_LIST_POSTS: 'felt:plaza:posts:list',
  PLAZA_GET_POST: 'felt:plaza:posts:get',
  PLAZA_PUBLISH: 'felt:plaza:posts:publish',
  PLAZA_WITHDRAW: 'felt:plaza:posts:withdraw',
  PLAZA_MY_PROJECT_IDS: 'felt:plaza:posts:mine-project-ids',
  PLAZA_PREVIEW_BYTES: 'felt:plaza:preview:bytes',
  PLAZA_REWARD_ACTION: 'felt:plaza:rewards:action'
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
