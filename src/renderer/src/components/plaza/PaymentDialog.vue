<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { action } from '../../services/reward-api'
const props = defineProps<{ token: string; userId: string }>()
const emit = defineEmits<{ close: []; paid: [] }>()
type Order = { orderId: string; status: 'PENDING' | 'PAID' | 'CANCELLED'; amountMinor: number; diamonds: number }
const capabilities = ref<{ available: boolean; message: string; packages: { packageId: string; amountMinor: number; diamonds: number }[] }>()
const order = ref<Order>(), busy = ref(false), message = ref(''), checkout = ref('')
const selected = ref('diamonds_10')
const key = `felt-payment-request:${props.userId}`
const panel = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? [])]
  const target = event.shiftKey ? controls.at(-1) : controls[0]
  if (!controls.length || (event.shiftKey ? document.activeElement === controls[0] : document.activeElement === controls.at(-1)) || !controls.includes(document.activeElement as HTMLElement)) {
    event.preventDefault(); (target ?? panel.value)?.focus()
  }
}
onMounted(()=>{void nextTick(()=>panel.value?.focus())})
onUnmounted(()=>{if(previousFocus?.isConnected)previousFocus.focus()})
async function run(task: () => Promise<void>) {
  busy.value = true; message.value = ''
  try { await task() } catch (e) { message.value = (e as Error).message || '请求失败，请查询原订单。' }
  finally { busy.value = false }
}
async function create() {
  await run(async () => {
    const saved = localStorage.getItem(key)
    const attempt = saved ? JSON.parse(saved) as { requestId: string; packageId: string } : { requestId: crypto.randomUUID(), packageId: selected.value }
    localStorage.setItem(key, JSON.stringify(attempt))
    const response = await action<{ order: Order; checkout?: { displayText?: string } }>(props.token, 'paymentCreate', attempt)
    order.value = response.order
    checkout.value = response.checkout?.displayText || '订单已创建。请按已配置渠道完成付款，再查询结果。'
    if (response.order.status !== 'PENDING') localStorage.removeItem(key)
    if (response.order.status === 'PAID') emit('paid')
  })
}
async function update(cancel = false) {
  if (!order.value) return
  await run(async () => {
    const response = await action<{ order: Order }>(props.token, cancel ? 'paymentCancel' : 'paymentQuery', { orderId: order.value!.orderId })
    order.value = response.order
    if (response.order.status !== 'PENDING') localStorage.removeItem(key)
    if (response.order.status === 'PAID') emit('paid')
  })
}
onMounted(() => run(async () => {
  capabilities.value = await action(props.token, 'paymentCapabilities')
  if (capabilities.value?.available && localStorage.getItem(key)) await create()
}))
</script>
<template>
  <div class="payment-backdrop">
    <section ref="panel" tabindex="-1" role="dialog" aria-modal="true" aria-label="支付订单" class="payment-dialog" @keydown="trapFocus" @keydown.esc="emit('close')">
      <h2>钻石充值</h2><p>{{ capabilities?.message || '正在检查支付服务……' }}</p>
      <p v-if="message" role="alert">{{ message }}</p>
      <template v-if="capabilities?.available && !order">
        <label>充值套餐<select v-model="selected" :disabled="busy"><option v-for="p in capabilities.packages" :key="p.packageId" :value="p.packageId">{{ p.amountMinor / 100 }} 元 / {{ p.diamonds }} 钻石</option></select></label>
        <button :disabled="busy" @click="create">创建支付订单</button>
      </template>
      <template v-if="order">
        <p>订单 {{ order.orderId }} · {{ order.amountMinor / 100 }} 元</p>
        <p role="status">{{ order.status === 'PAID' ? '服务端已确认支付到账' : order.status === 'CANCELLED' ? '订单已取消' : '等待支付确认（未到账）' }}</p>
        <p v-if="order.status === 'PENDING'">{{ checkout }}</p>
        <button v-if="order.status === 'PENDING'" :disabled="busy" @click="update()">查询支付结果</button>
        <button v-if="order.status === 'PENDING'" :disabled="busy" @click="update(true)">取消订单</button>
      </template>
      <button :disabled="busy" @click="emit('close')">关闭</button>
    </section>
  </div>
</template>
<style scoped>
.payment-backdrop{position:fixed;inset:0;z-index:1000;background:#0006;display:grid;place-items:center}
.payment-dialog{width:min(90vw,520px);padding:24px;background:#fff8dc;border:4px solid #7d261a;border-radius:20px;color:#594738;overflow-wrap:anywhere}
button,select{margin:8px;padding:10px;font:inherit}button:focus-visible,select:focus-visible{outline:3px solid #7d261a}
</style>
