export const APP_DISPLAY_NAME = 'Felt Craft Lab'
export const APP_ID = 'com.feltcraft.lab'

export const IPC_CHANNELS = {
  PLAZA_AUTH_REGISTER: 'felt:plaza:auth:register',
  PLAZA_AUTH_LOGIN: 'felt:plaza:auth:login',
  PLAZA_LOGOUT: 'felt:plaza:auth:logout',
  PLAZA_LIST_POSTS: 'felt:plaza:posts:list',
  PLAZA_GET_POST: 'felt:plaza:posts:get',
  PLAZA_PUBLISH: 'felt:plaza:posts:publish',
  PLAZA_WITHDRAW: 'felt:plaza:posts:withdraw',
  PLAZA_MY_PROJECT_IDS: 'felt:plaza:posts:mine-project-ids',
  PLAZA_ONBOARDING_COMPLETE: 'felt:plaza:onboarding:complete',
  PLAZA_PREVIEW_BYTES: 'felt:plaza:preview:bytes',
  PLAZA_REWARD_ACTION: 'felt:plaza:rewards:action',
  PING: 'felt:bootstrap:ping',
  RESOURCE_INSPECT: 'felt:resource:inspect',
  PERSONAL_ASSET_RESOURCE_INGEST: 'felt:personal-asset-resource:ingest',
  PERSONAL_ASSET_IMAGE_INGEST: 'felt:personal-asset-image:ingest',
  PREVIEW_SAVE: 'felt:preview:save',
  PREVIEW_DELETE: 'felt:preview:delete',
  STORY_CARD_AUDIO_SAVE: 'felt:story-card-audio:save',
  STORY_CARD_AUDIO_READ: 'felt:story-card-audio:read',
  STORY_CARD_AUDIO_PROMOTE: 'felt:story-card-audio:promote',
  STORY_CARD_AUDIO_DELETE: 'felt:story-card-audio:delete',
  AI_STORY_REWRITE: 'felt:ai:story:rewrite',
  AI_HEALTH: 'felt:ai:health',
  AI_ASR_TRANSCRIBE: 'felt:ai:asr:transcribe',
  AI_QA_ASK: 'felt:ai:qa:ask',
  AI_TTS_SYNTHESIZE: 'felt:ai:tts:synthesize',
  CREATION_INTENT_START: 'felt:creation-intent:start',
  CREATION_INTENT_SUBMIT: 'felt:creation-intent:submit',
  CREATION_INTENT_CONFIRM: 'felt:creation-intent:confirm',
  CREATION_INTENT_DECIDE_FOR_ME: 'felt:creation-intent:decide-for-me',
  CREATION_INTENT_REGENERATE: 'felt:creation-intent:regenerate',
  CREATION_INTENT_SNAPSHOT: 'felt:creation-intent:snapshot',
  CREATION_INTENT_ACCEPT: 'felt:creation-intent:accept'
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
