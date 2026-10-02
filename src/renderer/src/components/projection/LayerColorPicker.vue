<script setup lang="ts">
import { ref, watch } from 'vue'
import { hsvHex } from '../../fabrication/recolor'
import { rgbHex } from '@shared/fabrication-colors'
const props = defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const hue = ref(0), saturation = ref(100), brightness = ref(100)
const channels = ref([0, 0, 0])
const presets = ['#FFFFFF','#242424','#F44336','#FF8C32','#FFD54F','#8BC34A','#26865B','#35B8CB','#3575CF','#7457BB','#F29EC2','#805335']
watch(() => props.modelValue, value => {
  channels.value = value.slice(1).match(/../g)!.map(v => parseInt(v, 16))
  const [r,g,b] = channels.value.map(v => v / 255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min
  hue.value = d === 0 ? 0 : ((max === r ? (g-b)/d : max === g ? (b-r)/d+2 : (r-g)/d+4)*60+360)%360
  saturation.value = max === 0 ? 0 : d/max*100; brightness.value = max*100
}, { immediate: true })
function changeHsv(): void { emit('update:modelValue', hsvHex(hue.value, saturation.value/100, brightness.value/100)) }
function point(event: PointerEvent): void {
  if (props.disabled) return
  const target = event.currentTarget as HTMLElement
  if (event.type === 'pointerdown') target.setPointerCapture(event.pointerId)
  if (event.type !== 'pointerdown' && !target.hasPointerCapture(event.pointerId)) return
  const box = target.getBoundingClientRect()
  hue.value = (Math.atan2(event.clientY-box.top-box.height/2,event.clientX-box.left-box.width/2)*180/Math.PI+450)%360
  changeHsv()
}
function rgbChange(index: number, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isInteger(value) || value < 0 || value > 255) return
  const next = [...channels.value]; next[index] = value; emit('update:modelValue', rgbHex(next))
}
</script>
<template>
  <fieldset :disabled="disabled" class="picker">
    <legend>整层换色</legend>
    <div class="wheel" aria-label="自由色轮（也可使用下方色相滑杆）" @pointerdown="point" @pointermove="point">
      <span :style="{ background: modelValue }">{{ modelValue }}</span>
    </div>
    <label>色相 <input v-model.number="hue" type="range" min="0" max="359" @input="changeHsv" /></label>
    <label>饱和度 <input v-model.number="saturation" type="range" min="0" max="100" @input="changeHsv" /></label>
    <label>明度 <input v-model.number="brightness" type="range" min="0" max="100" @input="changeHsv" /></label>
    <div class="rgb"><label v-for="(label, index) of ['R','G','B']" :key="label">{{ label }}<input :value="channels[index]" type="number" min="0" max="255" @change="rgbChange(index, $event)" /></label></div>
    <label>自由颜色 <input type="color" :value="modelValue" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.toUpperCase())" /></label>
    <div class="palette" aria-label="预设色盘"><button v-for="hex of presets" :key="hex" type="button" :style="{ background: hex }" :aria-label="`预设颜色 ${hex}`" :aria-pressed="modelValue === hex" @click="emit('update:modelValue', hex)" /></div>
  </fieldset>
</template>
<style scoped>
.picker { display: grid; gap: 6px; border: 1px solid var(--line); min-width: 0; align-content: start; }
.wheel { width: 110px; height: 110px; border-radius: 50%; background: conic-gradient(red,yellow,lime,cyan,blue,magenta,red); display: grid; place-items: center; touch-action: none; cursor: crosshair; }
.wheel span { width: 65px; height: 65px; border: 4px solid white; border-radius: 50%; display: grid; place-items: center; font-size: 11px; color: white; text-shadow: 0 1px 3px black; }
label { display: grid; gap: 4px; font-size: 13px; } input { max-width: 100%; min-width: 0; }
.rgb { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
.palette { display: flex; flex-wrap: wrap; gap: 8px; }
.palette button { width: 28px; height: 28px; padding: 0; border: 1px solid #777; }
button[aria-pressed=true], :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
</style>
