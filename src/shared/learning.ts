export const LEARNING_CHANNEL = 'felt:learning:request'
export type LearningCompletion = {
  userId: string
  themeId: string
  sessionId: string
  assetSnapshotId: string
  stickerIds: string[]
  completedAt: string
}
