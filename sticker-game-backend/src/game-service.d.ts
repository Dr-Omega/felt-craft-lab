export class GameService {
  constructor(options?: { createId?: () => string; random?: () => number })
  createSession(levelId: string): any
  getSession(sessionId: string): any
  deleteSession(sessionId: string): void
  placeSticker(sessionId: string, input: unknown): any
}
export class GameError extends Error { status: number; code: string }
