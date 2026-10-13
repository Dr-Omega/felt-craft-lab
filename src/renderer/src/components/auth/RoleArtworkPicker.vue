<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { suppliedArt, suppliedRoles, sourceBox } from '../../ui/supplied-controls'
import type { UserRole } from '@shared/contracts/rewards'
import { handDrawnAssets } from '../../ui/hand-drawn-assets'
defineProps<{ disabled?: boolean }>()
defineEmits<{ select: [role: UserRole]; cancel: [] }>()
const root = ref<HTMLElement>()
onMounted(() => root.value?.querySelector('button')?.focus({ preventScroll: true }))
</script>
<template>
  <div ref="root" class="role-art-picker" role="group" aria-label="请选择你的身份" @keydown.esc.prevent="$emit('cancel')">
    <img class="role-source" :src="suppliedArt.rolePanel" alt="" />
    <button v-for="item in suppliedRoles" :key="item.value" type="button" class="role-art-choice" :style="sourceBox(item.bounds)" :aria-label="item.label" :disabled="disabled" @click="$emit('select', item.value)">
      <svg :viewBox="item.bounds.join(' ')" aria-hidden="true"><image :href="item.image" width="1920" height="1080" /></svg>
    </button>
    <button type="button" class="role-cancel hand-icon-btn" aria-label="返回" @click="$emit('cancel')"><img :src="handDrawnAssets.btnBack" alt="" /></button>
  </div>
</template>
<style scoped>
.role-art-picker { position: absolute; inset: 0; }
.role-source { position: absolute; inset: 0; width: 1920px; height: 1080px; pointer-events: none; }
.role-art-choice { margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; }
.role-art-choice svg { display: block; width: 100%; height: 100%; }
.role-art-choice:focus-visible { outline: 5px solid #71331d; outline-offset: 5px; }
.role-cancel { position: absolute; left: 880px; top: 920px; width: 104px; height: 55.4px; }
.role-cancel:focus-visible { outline: 4px solid #71331d; outline-offset: 4px; }
</style>
