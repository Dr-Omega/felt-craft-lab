<script setup lang="ts">
import background from '../../../../../assets/ui/drawing/background.png'
import board from '../../../../../assets/ui/drawing/board.png'
import border from '../../../../../assets/ui/drawing/border.png'
import back from '../../../../../assets/ui/drawing/back.png'
import undoImage from '../../../../../assets/ui/drawing/undo.png'
import redoImage from '../../../../../assets/ui/drawing/redo.png'
import saveImage from '../../../../../assets/ui/drawing/save.png'

defineProps<{ busy: boolean; canUndo: boolean; canRedo: boolean; canSave: boolean }>()
defineEmits<{ back: []; undo: []; redo: []; save: [] }>()
</script>

<template>
  <div class="drawing-viewport">
    <div class="drawing-artboard">
      <img class="drawing-art drawing-background" :src="background" alt="" />
      <img class="drawing-art drawing-board" :src="board" alt="" />
      <main class="drawing-content" aria-label="绘画画框"><slot /></main>
      <img class="drawing-art drawing-border" :src="border" alt="" />
      <div class="drawing-toolbar"><slot name="tools" /></div>
      <button class="drawing-button drawing-back" aria-label="返回书本" @click="$emit('back')">
        <svg viewBox="39 35 208 112" aria-hidden="true"><image :href="back" width="1920" height="1080" /></svg>
      </button>
      <button class="drawing-button drawing-undo" aria-label="撤销" :disabled="busy || !canUndo" @click="$emit('undo')">
        <svg viewBox="595 867 172 164" aria-hidden="true"><image :href="undoImage" width="1920" height="1080" /></svg>
      </button>
      <button class="drawing-button drawing-redo" aria-label="重做" :disabled="busy || !canRedo" @click="$emit('redo')">
        <svg viewBox="1158 867 168 164" aria-hidden="true"><image :href="redoImage" width="1920" height="1080" /></svg>
      </button>
      <button class="drawing-button drawing-save editor-save-psd" aria-label="保存作品" :disabled="busy || !canSave" @click="$emit('save')">
        <svg viewBox="832 880 257 139" aria-hidden="true"><image :href="saveImage" width="1920" height="1080" /></svg>
        <span class="sr-only">完成啦</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.drawing-viewport { position: fixed; inset: 0; display: grid; place-items: center; background: #fcf3bd; pointer-events: auto; }
/* These are coordinated full-artboard PSD exports, not independently stretched decorations. */
.drawing-artboard { position: relative; width: min(100vw, calc(100dvh * 16 / 9)); aspect-ratio: 16 / 9; }
.drawing-art { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; user-select: none; }
.drawing-background { z-index: 0; } .drawing-board { z-index: 1; }
.drawing-content { position: absolute; left: 18.75%; top: 15%; width: 62.5%; height: 64%; z-index: 2; }
.drawing-border { z-index: 3; }
.drawing-toolbar { position: absolute; left: 22%; right: 22%; top: 10.8%; z-index: 4; display: flex; justify-content: center; gap: 8px; }
.drawing-button { position: absolute; z-index: 5; padding: 0; border: 0; border-radius: 12px; background: transparent; pointer-events: auto; }
.drawing-button svg { display: block; width: 100%; height: 100%; }
.drawing-back { left: 2.03125%; top: 3.24074%; width: 10.83333%; height: 10.37037%; }
.drawing-undo { left: 30.98958%; top: 80.27778%; width: 8.95833%; height: 15.18519%; }
.drawing-redo { left: 60.3125%; top: 80.27778%; width: 8.75%; height: 15.18519%; }
.drawing-save { left: 43.33333%; top: 81.48148%; width: 13.38542%; height: 12.87037%; }
@media (max-width: 1000px) { .drawing-toolbar { top: 10%; left: 18%; right: 18%; gap: 4px; } }
</style>
