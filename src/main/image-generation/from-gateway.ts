import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { GenerationSpec } from '@shared/contracts/generation-spec'
import type {
  GenerationQualityReport,
  ProviderPromptPayload
} from '@shared/contracts/generation-candidate'
import { gatewayImageGenerate } from '../ai/gateway-client'
import { getValidSessionToken } from '../ai/session-token'
import { decodeGatewayImagePng } from './decode-gateway-png'

export type GeneratedCandidateImage = {
  bytes: Uint8Array
  quality?: GenerationQualityReport
  width: number
  height: number
}

function aiStateDir(): string {
  const root = join(app.getPath('userData'), 'ai')
  mkdirSync(root, { recursive: true })
  return root
}

/**
 * Ask Gateway to generate + normalize + quality-check.
 * Fail closed: do not substitute a local color block if the cloud call fails.
 */
export async function generateCandidatePng(
  payload: ProviderPromptPayload,
  spec: GenerationSpec
): Promise<GeneratedCandidateImage> {
  const packaged = app.isPackaged
  const session = await getValidSessionToken({
    aiDir: aiStateDir(),
    isPackaged: packaged
  })
  if (!session.ok) {
    throw new Error(session.error.message || '画图暂时无法完成，请稍后重试。')
  }

  const generated = await gatewayImageGenerate({
    positivePrompt: payload.positiveText,
    negativePrompt: payload.negativeText,
    width: payload.width,
    height: payload.height,
    assetRole: spec.assetRole,
    isPackaged: packaged,
    auth: {
      token: session.session.token,
      installationId: session.session.installationId
    }
  })
  if (!generated.ok) {
    throw new Error(generated.error.message || '画图暂时无法完成，请稍后重试。')
  }

  const decoded = decodeGatewayImagePng(generated.body)
  if (!decoded.ok) {
    throw new Error('画出来的图打不开，请再试一次。')
  }
  return {
    bytes: decoded.bytes,
    width: decoded.width ?? payload.width,
    height: decoded.height ?? payload.height,
    quality: decoded.quality
  }
}
