<script setup lang="ts">
import { computed } from 'vue'
import {
  frameAssetBySlug,
  frameBoundsBySlug,
  psdBoxStyle,
  psdFooterStripStyle,
  type FrameSlug
} from '../../ui/psd160-assets'

const props = withDefaults(
  defineProps<{
    frame: FrameSlug
    /** When false, UI controls may extend slightly outside the bounds box. */
    clipOverflow?: boolean
  }>(),
  { clipOverflow: true }
)

const frameStyle = computed(() => psdBoxStyle(props.frame))
const boundsStyle = computed(() => psdBoxStyle(frameBoundsBySlug[props.frame]))
const footerStyle = computed(() => psdFooterStripStyle(props.frame))
const artSrc = computed(() => frameAssetBySlug[props.frame])
</script>

<template>
  <div class="psd-frame-stage">
    <img
      class="psd-frame-stage__art"
      :style="frameStyle"
      :src="artSrc"
      alt=""
      aria-hidden="true"
    />
    <div
      class="psd-frame-stage__content"
      :class="{ 'psd-frame-stage__content--clip': clipOverflow }"
      :style="boundsStyle"
    >
      <slot />
    </div>
    <div v-if="$slots.footer" class="psd-frame-stage__footer" :class="{ 'psd-frame-stage__footer--clip': clipOverflow }" :style="footerStyle">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.psd-frame-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.psd-frame-stage__art {
  position: absolute;
  z-index: 1;
  display: block;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

/* 功能内容在装饰框之上，避免画框 PNG 中间不透明区域挡住画布 */
.psd-frame-stage__content {
  position: absolute;
  z-index: 2;
  overflow: visible;
  pointer-events: auto;
}

.psd-frame-stage__content--clip {
  overflow: hidden;
}

.psd-frame-stage__footer {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  overflow: visible;
  pointer-events: auto;
}

.psd-frame-stage__footer--clip {
  overflow: hidden;
}
</style>
