import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const quickTools = readFileSync(resolve('src/renderer/src/components/editor/ObjectQuickTools.vue'), 'utf8')
const page = readFileSync(resolve('src/renderer/src/pages/EditorPage.vue'), 'utf8')

describe('V4.6 Phase 3 OQT full layer quick actions', () => {
  it('exposes 往前 / 往后 / 置顶 / 置底 / 拿掉 buttons', () => {
    expect(quickTools).toContain('aria-label="往前"')
    expect(quickTools).toContain('aria-label="往后"')
    expect(quickTools).toContain('aria-label="置顶"')
    expect(quickTools).toContain('aria-label="置底"')
    expect(quickTools).toContain('aria-label="拿掉"')
  })

  it('emits dedicated events for the new top/bottom actions', () => {
    expect(quickTools).toContain("emit('bringToFront')")
    expect(quickTools).toContain("emit('sendToBack')")
    expect(quickTools).toContain("emit('forward')")
    expect(quickTools).toContain("emit('backward')")
    expect(quickTools).toContain("emit('remove')")
  })

  it('routes the new actions through EditorSessionService using selection.objectId', () => {
    expect(page).toContain('function quickBringToFront()')
    expect(page).toContain('function quickSendToBack()')
    expect(page).toContain('function quickBringForward()')
    expect(page).toContain('function quickSendBackward()')
    expect(page).toContain('function quickRemove()')
    expect(page).toContain('session.value.bringForward(selection.objectId)')
    expect(page).toContain('session.value.sendBackward(selection.objectId)')
    expect(page).toContain('session.value.bringToFront(selection.objectId)')
    expect(page).toContain('session.value.sendToBack(selection.objectId)')
    expect(page).toContain('session.value.deleteObject(selection.objectId)')
  })

  it('binds the new emits to the OQT component in the EditorPage template', () => {
    expect(page).toContain('@forward="quickBringForward"')
    expect(page).toContain('@backward="quickSendBackward"')
    expect(page).toContain('@bring-to-front="quickBringToFront"')
    expect(page).toContain('@send-to-back="quickSendToBack"')
    expect(page).toContain('@remove="quickRemove"')
  })

  it('keeps the Remove action paired with the existing Remove + Undo toast flow', () => {
    expect(page).toContain('function quickRemove()')
    expect(page).toContain('showRemoveToast()')
    expect(quickTools).toContain('oqt-remove')
  })

  it('does not touch Fabric, DOM, or SceneDocument from the OQT handlers', () => {
    for (const handlerName of ['quickBringForward', 'quickSendBackward', 'quickBringToFront', 'quickSendToBack', 'quickRemove']) {
      const body = page.match(new RegExp(`function ${handlerName}\\(\\)[:\\s\\S]*?\\n\\}`))?.[0] ?? ''
      expect(body).not.toContain('adapter.')
      expect(body).not.toContain('canvas.')
      expect(body).not.toContain('fabric')
      expect(body).not.toContain('bringSelected')
      expect(body).not.toContain('sendSelected')
    }
  })
})
