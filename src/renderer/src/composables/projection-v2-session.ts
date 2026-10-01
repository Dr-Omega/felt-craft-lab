import { computed, ref } from 'vue'
import type { ProjectionLayerDescriptor } from '../projection/projection-layers'
import type { LoadedLayerImage } from '../projection/load-layer-image'
import {
  defaultSubjectSizeChoice,
  type SubjectSizeChoice
} from '../projection/subject-size'

export type ProjectionV2Screen = 'explode' | 'export'

const screen = ref<ProjectionV2Screen>('explode')
const includeBackground = ref(false)
const explodePercent = ref(45)
const descriptors = ref<ProjectionLayerDescriptor[]>([])
const loadedImages = ref<LoadedLayerImage[]>([])
const workName = ref('我的作品')
const subjectSize = ref<SubjectSizeChoice>(defaultSubjectSizeChoice())

export function useProjectionV2Session() {
  const explodeNormalized = computed(() => explodePercent.value / 100)
  const explodeLayers = computed(() =>
    descriptors.value.map((descriptor, index) => ({
      layerNumber: descriptor.layerNumber,
      label: descriptor.label,
      image: loadedImages.value[index]!
    }))
  )
  const layoutLayers = computed(() =>
    descriptors.value.map((descriptor, index) => ({
      descriptor,
      image: loadedImages.value[index]!
    }))
  )

  return {
    screen,
    includeBackground,
    explodePercent,
    explodeNormalized,
    descriptors,
    loadedImages,
    workName,
    subjectSize,
    explodeLayers,
    layoutLayers
  }
}
