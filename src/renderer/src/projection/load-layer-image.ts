import { loadResourceObjectUrl } from '../services/resource.service'

export interface LoadedLayerImage {
  width: number
  height: number
  /** Same-origin object URL; caller should revoke when done. */
  objectUrl: string
}

export async function loadLayerImage(imageUrl: string): Promise<LoadedLayerImage> {
  const objectUrl = await loadResourceObjectUrl(imageUrl)
  const image = await decodeImage(objectUrl)
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    objectUrl
  }
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图层图片加载失败'))
    image.src = src
  })
}

export function revokeLoadedLayerImages(images: LoadedLayerImage[]): void {
  for (const image of images) {
    URL.revokeObjectURL(image.objectUrl)
  }
}
