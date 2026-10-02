<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import type { LoadedLayerImage } from '../../projection/load-layer-image'

export interface ExplodeLayerInput {
  layerNumber: number
  label: string
  image: LoadedLayerImage
}

const props = defineProps<{
  layers: ExplodeLayerInput[]
  explode: number
}>()

const hostEl = ref<HTMLDivElement | null>(null)

let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let layerGroup: THREE.Group | undefined
let layerMeshes: THREE.Mesh[] = []
let resizeObserver: ResizeObserver | undefined
let animationId = 0
let yaw = 0.35
let pitch = 0.25
let cameraDistance = 4.2
const MIN_CAMERA_DISTANCE = 2.2
const MAX_CAMERA_DISTANCE = 14
let dragging = false
let lastX = 0
let lastY = 0
let rebuildGeneration = 0
let sceneReady = false

function layersFingerprint(layers: ExplodeLayerInput[]): string {
  return layers.map((layer) => `${layer.layerNumber}:${layer.image.objectUrl}`).join('|')
}

function disposeMaterial(material: THREE.Material): void {
  if (material instanceof THREE.MeshBasicMaterial && material.map) {
    material.map.dispose()
  }
  material.dispose()
}

function disposeMesh(mesh: THREE.Mesh): void {
  layerGroup?.remove(mesh)
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial)
  } else {
    disposeMaterial(material)
  }
}

async function rebuildLayers(): Promise<void> {
  if (!scene || !layerGroup) return
  const generation = ++rebuildGeneration

  for (const mesh of layerMeshes) {
    disposeMesh(mesh)
  }
  layerMeshes = []

  const loader = new THREE.TextureLoader()
  for (const layer of props.layers) {
    if (generation !== rebuildGeneration) return
    const texture = await loadTexture(loader, layer.image.objectUrl)
    if (generation !== rebuildGeneration) {
      texture.dispose()
      return
    }
    texture.colorSpace = THREE.SRGBColorSpace
    const aspect = layer.image.width / Math.max(1, layer.image.height)
    const planeW = 2.2
    const planeH = planeW / aspect
    const geometry = new THREE.PlaneGeometry(planeW, planeH)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.baseZ = 0
    layerGroup.add(mesh)
    layerMeshes.push(mesh)
  }
  if (generation !== rebuildGeneration) return
  applyExplode()
}

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, () => reject(new Error('3D 纹理加载失败')))
  })
}

function applyExplode(): void {
  const separation = props.explode * 0.55
  layerMeshes.forEach((mesh, index) => {
    mesh.position.set(0, 0, index * separation)
  })
}

function applyCameraDistance(): void {
  if (!camera) return
  camera.position.set(0, 0, cameraDistance)
}

function renderFrame(): void {
  if (!renderer || !scene || !camera || !layerGroup) return
  layerGroup.rotation.x = pitch
  layerGroup.rotation.y = yaw
  renderer.render(scene, camera)
}

function startLoop(): void {
  const tick = (): void => {
    animationId = requestAnimationFrame(tick)
    renderFrame()
  }
  cancelAnimationFrame(animationId)
  animationId = requestAnimationFrame(tick)
}

function resize(): void {
  if (!hostEl.value || !renderer || !camera) return
  const width = hostEl.value.clientWidth
  const height = hostEl.value.clientHeight
  if (width <= 0 || height <= 0) return
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderFrame()
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 2) return
  event.preventDefault()
  dragging = true
  lastX = event.clientX
  lastY = event.clientY
  hostEl.value?.setPointerCapture(event.pointerId)
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  yaw += dx * 0.008
  pitch += dy * 0.008
  pitch = Math.max(-1.1, Math.min(1.1, pitch))
}

function onPointerUp(event: PointerEvent): void {
  dragging = false
  hostEl.value?.releasePointerCapture(event.pointerId)
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  event.stopPropagation()
  cameraDistance = Math.max(
    MIN_CAMERA_DISTANCE,
    Math.min(MAX_CAMERA_DISTANCE, cameraDistance + event.deltaY * 0.004)
  )
  applyCameraDistance()
  renderFrame()
}

onMounted(() => {
  if (!hostEl.value) return
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#f5ecd8')
  layerGroup = new THREE.Group()
  scene.add(layerGroup)
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  applyCameraDistance()
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  hostEl.value.appendChild(renderer.domElement)
  renderer.domElement.classList.add('projection-three-canvas')
  sceneReady = true
  void rebuildLayers()
  resize()
  startLoop()
  window.addEventListener('resize', resize)
  hostEl.value.addEventListener('wheel', onWheel, { passive: false })
  hostEl.value.addEventListener('contextmenu', onContextMenu)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(hostEl.value)
  }
})

onUnmounted(() => {
  hostEl.value?.removeEventListener('wheel', onWheel)
  hostEl.value?.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('resize', resize)
  resizeObserver?.disconnect()
  cancelAnimationFrame(animationId)
  for (const mesh of layerMeshes) {
    disposeMesh(mesh)
  }
  if (renderer) {
    hostEl.value?.removeChild(renderer.domElement)
    renderer.dispose()
  }
  layerMeshes = []
  sceneReady = false
  rebuildGeneration += 1
  scene = undefined
  camera = undefined
  renderer = undefined
})

watch(
  () => layersFingerprint(props.layers),
  () => {
    if (!sceneReady) return
    void rebuildLayers()
  }
)

watch(
  () => props.explode,
  () => {
    applyExplode()
  }
)
</script>

<template>
  <div
    ref="hostEl"
    class="projection-explode-host"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @contextmenu.prevent
  />
</template>

<style scoped>
.projection-explode-host {
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
}

.projection-explode-host:active {
  cursor: grabbing;
}

.projection-explode-host :deep(.projection-three-canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
