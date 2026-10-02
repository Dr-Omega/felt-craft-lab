import { describe, expect, it, vi } from 'vitest'
import { ElementImagePreview } from '../../src/renderer/src/editor/element-image-preview'

function image() {
  const source = {} as CanvasImageSource
  let current = source
  const target = { objectId: 'element', left: 24, top: 65, angle: 30, scaleX: 2, scaleY: 2,
    width: 200, height: 300,
    getElement: () => current,
    setElement: vi.fn((next: CanvasImageSource, dimensions: { width: number; height: number }) => { current = next; Object.assign(target, dimensions) }),
    setCoords: vi.fn() }
  return { source, target }
}
describe('In-scene temporary recolor preview', () => {
  it('changes only the existing image pixels, retaining object identity, transform, size and stack slot', async () => {
    const { source, target } = image(), manager = new ElementImagePreview(), render = vi.fn()
    const scene = [{ id:'background' }, target, { id:'upper-neighbour' }]
    const replacement = {} as CanvasImageSource
    await manager.show(target, async () => replacement, render)
    expect(manager.active).toBe(true); expect(scene[1]).toBe(target)
    expect(target).toMatchObject({objectId:'element',left:24,top:65,angle:30,scaleX:2,scaleY:2,width:200,height:300})
    expect(target.getElement()).toBe(replacement)
    manager.clear()
    expect(target.getElement()).toBe(source); expect(manager.active).toBe(false)
    expect(render).toHaveBeenCalledTimes(2)
  })
  it('always restores the original rather than the previous temporary color', async () => {
    const { source,target } = image(), manager = new ElementImagePreview()
    await manager.show(target,async()=>({} as CanvasImageSource),()=>{})
    await manager.show(target,async()=>({} as CanvasImageSource),()=>{})
    manager.clear(); expect(target.getElement()).toBe(source)
  })
  it('ignores a late decode after closing', async () => {
    const { source,target } = image(), manager = new ElementImagePreview()
    let finish!: (image: CanvasImageSource)=>void
    const done = manager.show(target,()=>new Promise(resolve=>{finish=resolve}),()=>{})
    manager.clear(); finish({} as CanvasImageSource); await done
    expect(target.getElement()).toBe(source); expect(manager.active).toBe(false)
  })
  it('ignores stale colors arriving out of order', async () => {
    const { target } = image(), manager = new ElementImagePreview()
    let finish!: (image: CanvasImageSource)=>void
    const old = manager.show(target,()=>new Promise(resolve=>{finish=resolve}),()=>{})
    const newest = {} as CanvasImageSource
    await manager.show(target,async()=>newest,()=>{})
    finish({} as CanvasImageSource); await old
    expect(target.getElement()).toBe(newest)
  })
  it('does not touch the original if decoding fails', async () => {
    const { source,target } = image(), manager = new ElementImagePreview()
    await expect(manager.show(target,async()=>{throw new Error('decode')},()=>{})).rejects.toThrow('decode')
    expect(target.getElement()).toBe(source); expect(manager.active).toBe(false)
  })
})
