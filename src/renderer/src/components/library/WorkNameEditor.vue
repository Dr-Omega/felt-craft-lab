<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { handDrawnBorderStyles } from '../../ui/hand-drawn-assets'
const props=defineProps<{ name:string; disabled?:boolean; saveName:(name:string)=>Promise<void> }>()
const editing=ref(false),pending=ref(false),value=ref(''),error=ref('')
const input=ref<HTMLInputElement|null>(null),trigger=ref<HTMLButtonElement|null>(null)
const errorId=useId()
async function start():Promise<void> {
  if(props.disabled) return
  value.value=props.name;error.value='';editing.value=true
  await nextTick();input.value?.focus();input.value?.select()
}
async function cancel():Promise<void> {
  if(pending.value) return
  editing.value=false;error.value=''
  await nextTick();trigger.value?.focus()
}
async function save():Promise<void> {
  if(pending.value || props.disabled) return
  const name=value.value.trim()
  if(!name || name.length>80){error.value='作品名请填写 1～80 个字。';input.value?.focus();return}
  pending.value=true;error.value=''
  try { await props.saveName(name);editing.value=false;await nextTick();trigger.value?.focus() }
  catch(reason){error.value=reason instanceof Error?reason.message:'改名失败，请重试。'}
  finally{pending.value=false;if(error.value){await nextTick();input.value?.focus()}}
}
</script>
<template>
  <form v-if="editing" class="work-name-form" novalidate aria-label="修改作品名" @submit.prevent="save" @keydown.esc.stop.prevent="cancel">
    <input ref="input" v-model="value" aria-label="作品名" :aria-invalid="Boolean(error)" :aria-describedby="error ? errorId : undefined" maxlength="80" :disabled="pending" autocomplete="off" @keydown.enter="event => { if(event.isComposing) event.preventDefault() }" />
    <div class="work-name-actions">
      <button type="submit" :style="handDrawnBorderStyles.btnPrimary" :disabled="pending || disabled">{{ pending?'保存中…':'保存' }}</button>
      <button type="button" :style="handDrawnBorderStyles.btnSecondary" :disabled="pending" @click="cancel">取消</button>
    </div>
    <p v-if="error" :id="errorId" role="alert">{{ error }}</p>
  </form>
  <button v-else ref="trigger" type="button" class="work-name-trigger" :disabled="disabled" :aria-label="`修改作品名：${name}`" title="点击修改作品名" @click="start">{{ name }}</button>
</template>
<style scoped>
.work-name-trigger{display:block;max-width:100%;min-width:0;min-height:36px;border:0;padding:0;background:transparent;color:inherit;font:inherit;font-size:22px;font-weight:700;text-align:left;overflow-wrap:anywhere;cursor:pointer;}
.work-name-trigger:hover{text-decoration:underline;text-decoration-style:dotted;text-underline-offset:5px;}
.work-name-form{display:grid;gap:8px;min-width:0;}
.work-name-form input{box-sizing:border-box;width:100%;min-width:0;min-height:40px;padding:5px 8px;border:2px solid #71351c;border-radius:6px;background:#fff4bd;color:inherit;font:inherit;font-size:22px;}
.work-name-actions{display:flex;flex-wrap:wrap;gap:8px;}
.work-name-actions button{min-height:44px;color:inherit;font:inherit;font-weight:700;cursor:pointer;}
.work-name-form p{margin:0;color:#9b3023;font-size:17px;line-height:1.5;}
.work-name-trigger:focus-visible,.work-name-form :focus-visible{outline:3px solid #71351c;outline-offset:3px;}
button:disabled{cursor:default;opacity:.55;}
</style>
