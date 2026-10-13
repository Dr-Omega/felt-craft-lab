<script setup lang="ts">
import { getCurrentUserId } from '../../services/plaza-session'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { FabricationJob } from '@shared/fabrication-desktop'
const props = defineProps<{ sceneId?: string }>()
const jobs = ref<FabricationJob[]>([]), expanded = ref(false), error = ref(''), retrying = ref('')
const environment = ref('')
const active = computed(()=>jobs.value.filter(j=>['queued','background','fabrication'].includes(j.status)))
const complete = computed(()=>jobs.value.filter(j=>j.status==='complete').length)
const failed = computed(()=>jobs.value.filter(j=>['failed','timeout'].includes(j.status)).length)
const summary = computed(()=>error.value ? '图片处理 · 读取失败' : active.value.length ? `图片处理 · ${active.value.length} 张处理中` : failed.value ? `图片处理 · ${failed.value} 张未完成` : `图片处理 · ${complete.value} 张已完成`)
const visible = computed(()=>[...jobs.value].reverse().slice(0,20))
const status = {queued:'排队中',background:'准备前景',fabrication:'计算图层',complete:'分层完成',failed:'未完成',timeout:'超时'}
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
async function refresh(): Promise<void> {
  try {
    const next = await window.electronAPI.fabrication.list()
    if (disposed) return
    jobs.value = next.filter(job=>(!job.binding || job.binding.scene.userId===getCurrentUserId()) && (!props.sceneId || job.binding?.scene.sceneId === props.sceneId))
    error.value = ''
  } catch(e) { if (!disposed) error.value = `读取任务失败：${String(e)}` }
  finally { if (!disposed) timer=setTimeout(refresh,1500) }
}
async function retry(id: string): Promise<void> {
  if (retrying.value) return
  retrying.value=id
  try { await window.electronAPI.fabrication.retry(id) }
  catch(e) { error.value=String(e) }
  finally { retrying.value='' }
}
onMounted(async()=>{
  void refresh()
  try { const result=await window.electronAPI.fabrication.availability(); if(!disposed && !result.available) environment.value=result.message }
  catch(e) { if(!disposed) environment.value=String(e) }
})
onUnmounted(()=>{disposed=true;clearTimeout(timer)})
</script>
<template>
  <aside v-if="jobs.length || error" class="task-tray art-scrollbars" aria-label="图片处理任务">
    <button class="hand-btn-secondary" :aria-expanded="expanded" @click="expanded=!expanded" aria-label="查看图片处理任务">
      {{ summary }}
    </button>
    <span class="sr-status" role="status" aria-live="polite">{{ active.length }} 张处理中或排队，{{ complete }} 张分层完成</span>
    <section v-if="expanded">
      <p v-if="environment" role="alert">暂时无法拆分，请联系老师。</p>
      <p v-if="error" role="alert">任务读取失败，请重试。</p>
      <ol><li v-for="job in visible" :key="job.id">
        <b>{{ job.binding?.scene.workName || '图片' }} · {{ status[job.status] }}</b>
        <button v-if="['failed','timeout'].includes(job.status)" class="hand-btn-primary" :disabled="!!retrying" @click="retry(job.id)">重试此图片</button>
      </li></ol>
    </section>
  </aside>
</template>
<style scoped>
.task-tray{position:fixed;right:12px;bottom:10px;z-index:70;max-width:min(420px,calc(100vw - 24px));color:#652415}
.task-tray>button{font-size:13px}
section{background:#fff8e7;border:2px solid #652415;border-radius:12px;padding:12px;max-height:45vh;overflow:auto;font-size:13px}
ol{padding-left:20px} li{margin:10px 0} small{display:block} p{overflow-wrap:anywhere;margin:6px 0}
.sr-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
</style>
