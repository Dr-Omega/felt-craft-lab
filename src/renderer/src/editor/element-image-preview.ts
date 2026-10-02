/** Temporary visual editing only: never a new asset, history entry, or persisted scene. */
export interface PreviewImage {
  width?: number
  height?: number
  getElement(): CanvasImageSource
  setElement(image: CanvasImageSource, options: { width: number; height: number }): unknown
  setCoords(): unknown
}

export class ElementImagePreview {
  private generation = 0
  private restore?: () => void
  private target?: PreviewImage
  get active(): boolean { return Boolean(this.restore) }

  async show(target: PreviewImage, decode: () => Promise<CanvasImageSource>, render: () => void): Promise<void> {
    const version = ++this.generation
    const image = await decode()
    if (version !== this.generation) return
    if (this.target !== target) {
      this.restore?.()
      const original = target.getElement()
      const dimensions = { width: target.width!, height: target.height! }
      if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error('无效元素尺寸，无法预览。')
      this.target = target
      this.restore = () => { target.setElement(original, dimensions); target.setCoords(); render() }
    }
    // Keep the same Fabric object in the same stack slot: transforms and occlusion remain real.
    target.setElement(image, { width: target.width!, height: target.height! })
    target.setCoords(); render()
  }

  clear(): void {
    ++this.generation
    this.restore?.()
    this.restore = undefined; this.target = undefined
  }
}
