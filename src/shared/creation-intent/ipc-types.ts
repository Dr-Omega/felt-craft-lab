import type { SharedError } from '../contracts/error'
import type { PersonalAssetRole } from '../contracts/personal-asset'
import type { CreationSessionSnapshot } from './session'

export const MAX_CREATION_INTENT_TEXT_CHARS = 120
export const MAX_CREATION_INTENT_SESSIONS = 8

export interface CreationIntentStartRequest {
  lockedRole?: PersonalAssetRole
}

export interface CreationIntentSessionRequest {
  sessionId: string
}

export interface CreationIntentSubmitRequest {
  sessionId: string
  text: string
}

export interface CreationIntentAccepted {
  personalAssetId: string
  versionId: string
  sourceImageRef: string
  name: string
  role: PersonalAssetRole
}

export type CreationIntentIpcResult =
  | {
      ok: true
      sessionId: string
      snapshot: CreationSessionSnapshot
      accepted?: CreationIntentAccepted
    }
  | {
      ok: false
      error: SharedError
    }
