<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { syncWorkspace, syncState } from '../../persistence/workspace-sync'
let timer: ReturnType<typeof setInterval>
onMounted(()=>{void syncWorkspace(); timer=setInterval(()=>{if(!syncState.conflict)void syncWorkspace()},60000)})
onUnmounted(()=>clearInterval(timer))
function resolve(choice:'local'|'remote') {
  if(confirm(choice==='remote'?'采用云端版本？当前本机数据会先保存在本机同步备份中。':'将本机版本保存到云端？将替换当前云端版本；请确认另一终端已经停止编辑。')) void syncWorkspace(choice)
}
</script>
<template>
  <details class="workspace-sync"><summary>作品同步{{ syncState.conflict ? ' · 有冲突' : syncState.busy ? '中' : '' }}</summary>
    <p role="status">{{ syncState.message }}</p>
    <button :disabled="syncState.busy" @click="syncWorkspace()">立即同步／重试</button>
    <template v-if="syncState.conflict"><button :disabled="syncState.busy" @click="resolve('remote')">采用云端并备份本机</button><button :disabled="syncState.busy" @click="resolve('local')">确认保留本机版本</button></template>
  </details>
</template>
<style scoped>
.workspace-sync{position:fixed;bottom:8px;left:8px;z-index:900;max-width:min(460px,90vw);background:#fff8dc;border:2px solid #7d261a;border-radius:12px;padding:8px;font-size:13px;max-height:45vh;overflow:auto}
summary{cursor:pointer}button{margin:4px}
</style>
