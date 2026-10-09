import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../src/renderer/src/workflows/saved-work', () => ({ loadSavedWork: vi.fn(), savedWorkStoryContext: vi.fn() }))
import { clearPlazaSession, getCurrentUserId, savePlazaSession } from '../../src/renderer/src/services/plaza-session'
import { completeLogin, enterCreationStudio, getAppView, getEditorLaunch, logout, openEditor, openLearning, openLobby, openLogin, openPersonalCenter, openPlaza, openRewards } from '../../src/renderer/src/app-nav'
import { validFeltProject } from '../persistence/fixtures'
import { bindWindowUser, clearWindowUser, requireWindowUser } from '../../src/main/plaza/window-session'
import { createUnlockedAccess } from '../../src/renderer/src/catalog/asset-access-helpers'

beforeEach(() => {
  const data = new Map<string,string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string,value: string) => data.set(key,value), removeItem: (key: string) => data.delete(key) })
  vi.stubGlobal('window', { electronAPI: { plaza: { logout: vi.fn().mockResolvedValue(undefined) } } })
})
afterEach(() => { vi.unstubAllGlobals() })
function login(userId = 'user_demo_001') { savePlazaSession({ token: 'test-token', user: { userId, username: '测试', role: 'child' } }); completeLogin() }
describe('authenticated lobby connections', () => {
  it('binds temporary guided asset allowances to the real account, not the demo owner', () => {
    login('account-a')
    expect(createUnlockedAccess('sticker-moon', undefined, getCurrentUserId()).userId).toBe('account-a')
  })
  it('requires login before entering account and creation pages', () => {
    for (const enter of [openLobby, openPersonalCenter, openPlaza, openRewards, enterCreationStudio]) { enter(); expect(getAppView()).toBe('login') }
  })
  it('routes login -> lobby; avatar and share are different destinations', () => {
    login(); expect(getAppView()).toBe('lobby')
    openPersonalCenter(); expect(getAppView()).toBe('profile')
    openLobby(); openPlaza(); expect(getAppView()).toBe('plaza')
    openLobby(); openLearning(); expect(getAppView()).toBe('learning')
    enterCreationStudio(); expect(getAppView()).toBe('library')
  })
  it('rejects another account scene instead of changing its owner', () => {
    login('account-b')
    expect(() => openEditor({ mode: 'project', scene: validFeltProject().scene })).toThrow('不属于')
  })
  it('clears stale launch and identity when logging out', async () => {
    login(); openEditor({ mode: 'new', scene: validFeltProject().scene })
    await logout(); expect(getAppView()).toBe('login'); expect(getEditorLaunch()).toBeUndefined()
    expect(window.electronAPI.plaza.logout).toHaveBeenCalled()
    openPersonalCenter(); expect(getAppView()).toBe('login')
    login('account-b'); expect(getCurrentUserId()).toBe('account-b')
  })
  it('malformed local session never grants navigation', () => {
    localStorage.setItem('felt.plaza.token', 'bad'); localStorage.setItem('felt.plaza.user', '{')
    openLobby(); expect(getAppView()).toBe('login')
    clearPlazaSession(); openLogin(); expect(getAppView()).toBe('login')
  })
  it('Main learning identity is window-specific and must be explicitly bound', () => {
    expect(() => requireWindowUser(9001)).toThrow('登录')
    bindWindowUser(9001, 'account-a'); bindWindowUser(9002, 'account-b')
    expect(requireWindowUser(9001)).toBe('account-a'); expect(requireWindowUser(9002)).toBe('account-b')
    clearWindowUser(9001); expect(() => requireWindowUser(9001)).toThrow('登录')
    expect(requireWindowUser(9002)).toBe('account-b'); clearWindowUser(9002)
  })
})
