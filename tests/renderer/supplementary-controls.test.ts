import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = (file: string) => readFileSync(`src/renderer/src/${file}`, 'utf8')
describe('Screenshot-reported supplementary controls', () => {
  it('uses the child-space plaza banner and keeps uncropped previews without blending artwork', () => {
    const page = source('pages/PlazaPage.vue')
    expect(page).toContain('plazaV2Assets.titleBanner')
    expect(page).toContain('enterCreationStudio')
    expect(page).not.toContain('public-tab')
    expect(page).toContain('object-fit: contain')
    expect(page).not.toContain('mix-blend-mode: multiply')
  })
  it('keeps account transaction and sync conflict safeguards while applying asset skins', () => {
    const page = source('pages/PersonalCenterPage.vue')
    expect(page).toContain('wallet-detail hand-btn-secondary')
    expect(page).toContain('1 钻石 = 10 金币')
    expect(page).toContain('分享广场中的发布不会自动撤回。')
    const sync = source('components/shell/WorkspaceSyncStatus.vue')
    expect(sync).toContain(':open="syncState.conflict"')
    expect(sync).toContain('当前本机数据会先保存在本机同步备份中。')
    expect(sync).toContain('class="hand-btn-secondary" :disabled="syncState.busy"')
  })
  it('reuses source art on work display and distinguishes queued/failed jobs in task details', () => {
    const display = source('pages/WorkDisplayPage.vue')
    expect(display).toContain('handDrawnAssets.btnBack')
    expect(display).toContain('class="hand-btn-primary" :disabled="!display"')
    expect(display).toContain('不是精确制造纸样')
    const tray = source('components/projection/FabricationTaskTray.vue')
    expect(tray).toContain("queued:'排队中'")
    expect(tray).toContain("['failed','timeout'].includes(job.status)")
    expect(tray).toContain('task-tray art-scrollbars')
  })
})
