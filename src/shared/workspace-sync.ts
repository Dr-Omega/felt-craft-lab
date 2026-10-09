export const WORKSPACE_SYNC_CHANNEL = 'workspace:sync'
export const SYNC_TABLES = ['drafts', 'projects', 'storyCards', 'personalAssets', 'personalAssetVersions', 'assetAccess', 'favorites', 'learningProgress'] as const
export type SyncTables = Record<typeof SYNC_TABLES[number], Record<string, unknown>[]>
export interface SyncFile { key: string; sha256: string; size: number; chunks: string[] }
export interface WorkspaceDocument {
  schema: 'account-workspace/1'; userId: string; tables: SyncTables;
  recolor: Record<string, unknown>; files: SyncFile[]
}
export interface WorkspaceSnapshot { revision: number; document: WorkspaceDocument | null }
export type SyncRequest = { token: string; action: 'read' | 'push' | 'restore'; revision?: number; document?: WorkspaceDocument }
export interface SyncResponse { revision: number; document?: WorkspaceDocument | null }

/** Deterministic logical data identity, excluding transport files and row order. */
export function workspaceFingerprint(document: WorkspaceDocument): string {
  const normalize = (value: unknown): unknown => Array.isArray(value)
    ? value.map(normalize).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalize(v)])) : value
  // Preserve nested scene array ordering: only sort table ROWS, not arbitrary arrays.
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])) : v
  return JSON.stringify({ userId: document.userId, tables: Object.fromEntries(SYNC_TABLES.map(name=>[name, normalize(document.tables[name].map(row=>JSON.stringify(canonical(row))))])), recolor: canonical(document.recolor) })
}
