<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { syncWorkspace, syncState } from '../../persistence/workspace-sync'
const props = defineProps<{ backgroundOnly?: boolean; displayOnly?: boolean }>()
let timer: ReturnType<typeof setInterval>
onMounted(()=>{if (!props.displayOnly) {void syncWorkspace(); timer=setInterval(()=>{if(!syncState.conflict)void syncWorkspace()},60000)}})
onUnmounted(()=>clearInterval(timer))
function resolve(choice:'local'|'remote') {
  if(confirm(choice==='remote'?'采用云端版本？当前本机数据会先保存在本机同步备份中。':'将本机版本保存到云端？将替换当前云端版本；请确认另一终端已经停止编辑。')) void syncWorkspace(choice)
}
</script>
<template>
  <details v-if="!backgroundOnly" class="workspace-sync art-scrollbars" :open="syncState.conflict"><summary>作品同步{{ syncState.conflict ? ' · 有冲突，请选择保留版本' : syncState.busy ? '中' : '' }}</summary>
    <p role="status">{{ syncState.message }}</p>
    <button class="hand-btn-secondary" :disabled="syncState.busy" @click="syncWorkspace()">{{ syncState.busy ? '同步中…' : '同步' }}</button>
    <template v-if="syncState.conflict"><button class="hand-btn-secondary" :disabled="syncState.busy" @click="resolve('remote')">采用云端并备份本机</button><button class="hand-btn-secondary" :disabled="syncState.busy" @click="resolve('local')">确认保留本机版本</button></template>
  </details>
</template>
<style scoped>
.workspace-sync{max-width:100%;background:transparent;border:0;padding:12px 0;font-size:18px;overflow:auto}
summary{cursor:pointer}button{margin:4px}
</style>
