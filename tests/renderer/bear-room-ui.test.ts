import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve('src/renderer/src/pages/RewardCenterPage.vue'), 'utf8')
const bearView = page.split('class="reward-content bear-view"')[1].split('activeTab === \'admin\'')[0]

describe('bear room artwork and supported controls', () => {
  it('routes to the fullscreen home and keeps shared gateway error messages', () => {
    const app = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
    const home = readFileSync(resolve('src/renderer/src/pages/BearHomePage.vue'), 'utf8')
    expect(app).toContain('<BearHomePage v-else-if="view === \'rewards\' && getRewardEntry() === \'bear\'"')
    expect(home).toContain("typeof shared?.message === 'string'")
    expect(home).not.toContain('error instanceof Error')
    expect(home).toContain('await feedBear(session.token, food.foodId, currency)')
    expect(home).toContain('revision: roomRevision.value')
  })

  it('renders the original flattened artwork without pretending to replace its layers', () => {
    expect(bearView).toContain(':src="rewardAssets.bearRoom"')
    expect(page).not.toMatch(/hue-rotate|bearRoomStyle|selectedFurniture|selectedIp|runIpAction/)
    expect(bearView).not.toMatch(/房间配色|文字互动|IP 角色|保存房间|重新载入房间/)
    expect(page).toMatch(/\.bear-room-image\s*\{[^}]*height:\s*auto/)
    expect(page).toMatch(/\.bear-view\s*\{[^}]*align-items:\s*start/)
  })

  it('does not overwrite legacy room settings while loading or feeding', () => {
    expect(page).not.toContain('saveBearRoom')
    expect(page).not.toContain('dashboard.value.room')
    const api = readFileSync(resolve('src/renderer/src/services/reward-api.ts'), 'utf8')
    expect(api).toContain('export function saveBearRoom')
  })

  it('keeps server-backed feeding with labelled artwork buttons and a busy guard', () => {
    expect(page).toContain('await feedBear(session.token, food.foodId, currency)')
    expect(page).toContain('if (busyKey.value) return')
    expect(bearView.match(/class="hand-btn-secondary"/g)).toHaveLength(2)
    expect(bearView.match(/:disabled="Boolean\(busyKey\)"/g)).toHaveLength(2)
    expect(bearView).toContain('用 ${food.coinPrice} 金币喂${food.name}')
    expect(bearView).toContain('用 ${food.diamondPrice} 钻石喂${food.name}')
    expect(page).toContain('reward-scroll art-scrollbars')
  })
})
