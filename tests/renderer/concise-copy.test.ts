import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { conciseCopy } from '../../src/renderer/src/ui/concise-copy'

const source = (file: string) => readFileSync(`src/renderer/src/${file}`, 'utf8')

describe('minimal user-facing copy', () => {
  it('keeps failures actionable without exposing configuration details', () => {
    expect(conciseCopy('问答服务尚未配置，请联系管理员。')).toBe('暂时无法回答，请联系老师。')
    expect(conciseCopy('语音识别服务尚未配置，请联系管理员；也可以先打字。')).toBe('暂时无法识别语音，可以打字。')
    expect(conciseCopy('图片生成服务尚未配置，请联系管理员；也可以上传自己的图片。')).toContain('上传图片')
    expect(conciseCopy('换色尚未保存')).toBe('换色尚未保存')
    expect(conciseCopy('两端都有修改：本机和云端均已保留，请选择。')).toContain('两端都有修改')
    expect(conciseCopy('')).toBe('')
  })
  it('does not make quality suggestions sound like fabrication certification', () => {
    expect(conciseCopy('边缘太碎，不适合手工剪贴。')).toContain('可能')
    expect(conciseCopy('颜色种类太多，不适合剪不织布。')).toContain('可能')
  })
  it('removes repeated always-on instructions without removing the real controls', () => {
    const learning = source('pages/LearningZonePage.vue')
    expect(learning).not.toContain('背景和主题贴纸均已收集。点击素材名称选择')
    expect(learning).toContain('material-question')
    const create = source('pages/CreateAssetPage.vue')
    expect(create).not.toContain('<p class="stage-hint">')
    expect(create).not.toContain('正在问这栏')
    expect(create).toContain('field.value || !field.optional')
    expect(create).toContain('helpOpen')
    expect(create).toContain("controller.quality.verdict !== 'PASS'")
    const intake = source('components/editor/CreationInputDialog.vue')
    expect(intake).toContain('自动去背景')
    expect(intake).toContain('图片已透明，保留现状')
    expect(intake.slice(intake.indexOf('<template>'))).not.toContain('BiRefNet')
  })
  it('retains destructive, synchronization and payment warnings', () => {
    expect(source('components/projection/LayerEditorPanel.vue')).toContain('本次换色还未保存。')
    expect(source('pages/StoryCardPage.vue')).toContain('这次未确认的录音和故事草稿不会保存')
    expect(source('components/shell/WorkspaceSyncStatus.vue')).toContain('将替换当前云端版本')
    expect(source('components/plaza/PaymentDialog.vue')).toContain('等待支付确认（未到账）')
    expect(source('pages/WorkDisplayPage.vue')).not.toContain('图纸尚未完成实物制作验证')
    expect(source('pages/PersonalCenterPage.vue')).toContain('分享广场中的发布不会自动撤回')
  })
  it('keeps story correction and rewrite validation without the removed transcript inspector', () => {
    const story = source('pages/StoryCardPage.vue')
    expect(story).not.toContain('v-model="transcript"')
    expect(story).not.toContain('aria-label="录音识别文字"')
    expect(story).toContain('v-model="supplementText"')
    expect(story).toContain('v-model="editText"')
    expect(story).toContain('::-webkit-slider-runnable-track')
    expect(conciseCopy('故事整理结果没有保留孩子表达中的英文词。')).not.toContain('补充英文内容')
    expect(source('pages/CreateAssetPage.vue')).toContain("controller.question ? ''")
    expect(source('pages/CreateAssetPage.vue')).toContain('choice-button hand-btn-secondary')
  })
})
