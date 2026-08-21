import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { CreationIntentParser } from '@shared/creation-intent'
import {
  CreationIntentBlockedError,
  FallbackCreationIntentParser,
  LocalCreationIntentParser,
  readCreationIntentBlockedMessage,
  RemoteCreationIntentParser
} from '@shared/creation-intent'
import { gatewayCreationIntentParse } from '../ai/gateway-client'
import { getValidSessionToken } from '../ai/session-token'

function aiStateDir(): string {
  const root = join(app.getPath('userData'), 'ai')
  mkdirSync(root, { recursive: true })
  return root
}

/** Local rules always available; DeepSeek fills gaps when the gateway is reachable. */
export function createLiveCreationIntentParser(): CreationIntentParser {
  const local = new LocalCreationIntentParser()
  const remote = new RemoteCreationIntentParser(async (input) => {
    const packaged = app.isPackaged
    const session = await getValidSessionToken({
      aiDir: aiStateDir(),
      isPackaged: packaged
    })
    if (!session.ok) throw new Error(session.error.message || '暂时听不懂这句话。')

    const parsed = await gatewayCreationIntentParse({
      text: input.text,
      lockedRole: input.lockedRole,
      pendingField: input.pendingField,
      isPackaged: packaged,
      auth: {
        token: session.session.token,
        installationId: session.session.installationId
      }
    })
    if (!parsed.ok) {
      if (parsed.error.code === 'QA_BLOCKED') {
        throw new CreationIntentBlockedError(parsed.error.message)
      }
      throw new Error(parsed.error.message || '暂时听不懂这句话。')
    }
    const blocked = readCreationIntentBlockedMessage(parsed.body)
    if (blocked) throw new CreationIntentBlockedError(blocked)
    if (parsed.status >= 400) throw new Error('暂时听不懂这句话。')
    return parsed.body
  })
  return new FallbackCreationIntentParser({ primary: remote, fallback: local })
}
