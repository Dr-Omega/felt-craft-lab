<script setup lang="ts">
import { computed } from 'vue'
import { suppliedArt } from '../../ui/supplied-controls'

const props = defineProps<{ role: 'user' | 'assistant'; text: string }>()
const source = computed(() => props.role === 'user' ? { x: 959, y: 207 } : { x: 480, y: 363 })
// Stretch only the original PNG's middle strip, preserving border thickness and tail.
const slices = [{ name: 'top', offset: 0, height: 20 }, { name: 'middle', offset: 20, height: 70 }, { name: 'bottom', offset: 90, height: 59 }]
</script>

<template>
  <div class="qa-bubble" :class="role === 'user' ? 'qa-question' : 'qa-answer'">
    <svg v-for="slice in slices" :key="slice.name" class="qa-bubble-art" :class="`qa-bubble-art--${slice.name}`" :viewBox="`${source.x} ${source.y + slice.offset} 479 ${slice.height}`" preserveAspectRatio="none" aria-hidden="true">
      <image :href="role === 'user' ? suppliedArt.qaUser : suppliedArt.qaAssistant" width="1920" height="1080" />
    </svg>
    <p :class="role === 'user' ? 'qa-question-text' : 'qa-answer-text'" :aria-label="role === 'user' ? '我的提问' : '回答'">{{ text }}</p>
  </div>
</template>

<style scoped>
.qa-bubble { position: relative; box-sizing: border-box; flex: 0 0 auto; width: 479px; min-height: 149px; padding: 17px 35px 67px 30px; }
.qa-question { align-self: flex-end; }
.qa-answer { align-self: flex-start; }
.qa-bubble-art { position: absolute; left: 0; width: 100%; pointer-events: none; }
.qa-bubble-art--top { top: 0; height: 20px; }
.qa-bubble-art--middle { top: 20px; height: calc(100% - 79px); }
.qa-bubble-art--bottom { bottom: 0; height: 59px; }
p { position: relative; margin: 0; font-size: 24px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
