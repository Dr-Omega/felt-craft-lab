import type {
  CreationIntentIpcResult,
  CreationIntentSessionRequest,
  CreationIntentStartRequest,
  CreationIntentSubmitRequest
} from '@shared/creation-intent'

function requireCreationIntentApi(): NonNullable<Window['electronAPI']>['creationIntent'] {
  const api = window.electronAPI?.creationIntent
  if (!api) {
    throw new Error('electronAPI.creationIntent 不可用：请在 Electron 中通过 Preload 调用创作服务。')
  }
  return api
}

export const creationIntentClient = {
  start: (input: CreationIntentStartRequest = {}): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().start(input),
  submitText: (input: CreationIntentSubmitRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().submitText(input),
  confirm: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().confirm(input),
  decideForMe: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().decideForMe(input),
  regenerate: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().regenerate(input),
  snapshot: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().snapshot(input),
  accept: (input: CreationIntentSessionRequest): Promise<CreationIntentIpcResult> =>
    requireCreationIntentApi().accept(input)
}
