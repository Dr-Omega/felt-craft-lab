import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const read = (path: string) => readFileSync(resolve('src/renderer/src', path), 'utf8')

describe('confirmed creation UI flow', () => {
  it('saves the canvas before entering story without a destination menu', () => {
    const page = read('pages/EditorPage.vue')
    expect(page).not.toContain('saveMenuOpen')
    expect(page).toContain('@save="finish"')
    const finish = page.split('async function finish()')[1].split('async function quickBringForward')[0]
    expect(finish).toContain("openSavedWork(projectId, 'story-card', 'editor')")
    expect(finish.indexOf('await saveNewProject')).toBeLessThan(finish.indexOf('await openSavedWork'))
    expect(page.split('function requestBack()')[1].split('async function saveProgressAndBack')[0]).toContain('void saveProgressAndBack()')
  })
  it('only offers story continuation after confirmation and opens explosion directly', () => {
    const story = read('pages/StoryCardPage.vue')
    expect(story.split('v-if="phase === \'detail\' && confirmedCard"')[1].split('</template>')[0]).toContain('aria-label="下一步：爆炸图"')
    expect(story).toContain('await continueStoryToExplode(props.workContext.workId)')
    expect(read('pages/WorkDisplayPage.vue')).toContain("ref<'picture' | 'explode' | 'export'>(entryScreen)")
  })
  it('uses the existing lower text-button style for all four profile tabs', () => {
    const nav = read('pages/PersonalCenterPage.vue').split('class="profile-side-nav"')[1].split('</nav>')[0]
    expect(nav.match(/class="profile-text-tab"/g)).toHaveLength(4)
    expect(nav).not.toContain('<img')
  })
  it('keeps source bubble images, stretches vertically, and has no fake greeting or nested scroll', () => {
    const sheet = read('components/editor/AssetQaSheet.vue')
    expect(sheet).not.toContain('emptyTitleCopy')
    expect(sheet).toContain('v-if="turn.answer"')
    const bubble = read('components/editor/QaMessageBubble.vue')
    expect(bubble).toContain('suppliedArt.qaUser : suppliedArt.qaAssistant')
    expect(bubble).toContain('preserveAspectRatio="none"')
    expect(bubble).toContain('height: calc(100% - 79px)')
    expect(bubble).toContain('width: 479px')
    expect(bubble).not.toContain('overflow-y: auto')
  })
})
