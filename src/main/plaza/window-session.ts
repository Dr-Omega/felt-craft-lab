/** User identity comes only from a successful backend login, never a Renderer field. */
const users = new Map<number, string>()
export function bindWindowUser(id: number, userId: string): void { users.set(id, userId) }
export function clearWindowUser(id: number): void { users.delete(id) }
export function requireWindowUser(id: number): string {
  const userId = users.get(id)
  if (!userId) throw new Error('请先登录后再操作。')
  return userId
}
