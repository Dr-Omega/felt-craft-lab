export const LEARNING_CHANNEL = 'felt:learning:request'
export type LearningCompletion = {
  /** Exact lesson completed; absent on legacy whole-theme receipts. */
  levelId?: string
  userId: string
  themeId: string
  sessionId: string
  assetSnapshotId: string
  stickerIds: string[]
  completedAt: string
}
