import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const read=(path:string)=>readFileSync('src/renderer/src/'+path,'utf8')
it('temporarily hides the legacy layer-display entry without removing story or PDF flows',()=>{
  const page=read('pages/PersonalCenterPage.vue')
  expect(page).not.toContain('查看图层展示')
  expect(page).not.toContain("'work-display'")
  expect(page).toContain("openProjectFlow(previewProject, 'story-card')")
  expect(page).toContain("openProjectFlow(projectFor(item)!, 'work-export')")
  expect(read('pages/WorkDisplayPage.vue')).toContain("screen === 'explode'")
})
it('removes the upload shortcut while keeping explicit publish and guarded removal flows',()=>{
  const page=read('pages/PersonalCenterPage.vue')
  expect(page).not.toContain('profile-upload');expect(page).not.toContain('uploadFirstAvailable')
  expect(page).toContain('PlazaUploadDialog');expect(page).toContain('分享广场中的发布不会自动撤回')
})
it('requires re-export before downloading a legacy full-bleed print archive',()=>{
  const page=read('pages/PersonalCenterPage.vue')
  expect(page).toContain('artifact.printRevision !== CUTTING_PRINT_REVISION')
  expect(page).toContain('这份图纸是旧版打印排版，请点击打开后重新导出。')
})
it('uses a real story-card preview, first printed sheet preview and one three-module row per completed work',()=>{
  const page=read('pages/PersonalCenterPage.vue')
  for(const part of ['StoryCardThumbnail','blueprintFor(item)!.thumbnail','work-grid--completed','completed-artwork','completed-story','completed-actions'])expect(page).toContain(part)
  expect(page).toContain('.work-grid--completed { grid-template-columns:minmax(0,1fr)')
  expect(page).toContain("return blueprints.value.has(record.projectId)")
  expect(page).toContain("'work-export'")
  expect(page).toContain('<div class="work-actions completed-actions" aria-label="作品操作">')
  const thumb=read('components/library/StoryCardThumbnail.vue')
  for(const field of ['card.title','card.storyText','card.artworkImageRef','内容文本框04.png'])expect(thumb).toContain(field)
})
it('archives the exact PDF and first planned sheet before downloading, restoring prior background mode without a watch race',()=>{
  const page=read('pages/WorkDisplayPage.vue')
  expect(page).toContain('pdf:blob, thumbnail:await cuttingPageThumbnail(next.pages[0])')
  expect(page.indexOf('new BlueprintStore().save')).toBeLessThan(page.indexOf('anchor.click()'))
  expect(page).toContain('saved.backgroundMode');expect(page).toContain('await nextTick()')
})
