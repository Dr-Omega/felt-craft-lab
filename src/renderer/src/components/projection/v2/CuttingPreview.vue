<script setup lang="ts">
import { cutPath, type CuttingPlan } from '../../../projection/cutting-layout'
defineProps<{ plan: CuttingPlan }>()
</script>
<template>
  <div class="cutting-preview art-scrollbars" aria-label="按颜色分纸的裁片预览" tabindex="0">
    <p>成品 {{ plan.widthMm.toFixed(1) }} × {{ plan.heightMm.toFixed(1) }} mm · {{ plan.pieceCount }} 块 · {{ plan.pages.length }} 页<br />同色同页，按原比例排版；请核对轮廓后导出。</p>
    <div class="pages">
      <svg v-for="(page, i) in plan.pages" :key="i" viewBox="0 0 210 297" role="img" :aria-label="`第 ${i + 1} 页，颜色 ${page.color}，${page.pieces.length} 块裁片`">
        <rect width="210" height="297" fill="white" />
        <rect x="12" y="12" width="6" height="6" :fill="page.color" stroke="#333" stroke-width="0.2" />
        <text x="22" y="17" font-size="5">{{ page.color }} · {{ i + 1 }} / {{ plan.pages.length }}</text>
        <g v-for="piece in page.pieces" :key="piece.id">
          <path :d="cutPath(piece)" fill="none" stroke="#111" stroke-width="0.2" />
          <text :x="piece.x" :y="piece.y + piece.height + 4" font-size="3">{{ piece.number }} / E{{ piece.element }} / S{{ piece.step }}</text>
        </g>
        <path d="M12 277 V281 M12 279 H62 M62 277 V281" fill="none" stroke="#111" stroke-width="0.3" />
        <text x="28" y="276" font-size="4">50 mm</text>
        <text x="75" y="280" font-size="4">A4 · 100%</text>
      </svg>
    </div>
  </div>
</template>
<style scoped>
.cutting-preview { height: 100%; overflow: auto; pointer-events: auto; padding: 22px; box-sizing: border-box; background: #f4efdf; color: #594738; }
p { font-size: 24px; line-height: 1.5; margin: 0 0 16px; text-align: center; }
.pages { display: flex; flex-wrap: wrap; justify-content: center; gap: 24px; }
svg { width: 330px; height: auto; flex: 0 0 auto; border: 1px solid #b9ac93; }
.cutting-preview:focus-visible { outline: 3px solid #7d261a; outline-offset: -3px; }
</style>
