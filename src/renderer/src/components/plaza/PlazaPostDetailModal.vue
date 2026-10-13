<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PlazaPost } from '@shared/contracts/plaza'
import type { UserRole } from '@shared/contracts/rewards'
import { friendlyShortDate } from '../../util/friendly-time'
import { loadPlazaSession } from '../../services/plaza-session'
import { likePlazaPost, submitTeacherReview } from '../../services/reward-api'
import { showCenterToast } from '../../composables/center-toast'
import type { SharedError } from '@shared/contracts'
import { rewardAssets } from '../../ui/reward-assets'

const props = defineProps<{
  post: PlazaPost | null
  open: boolean
  previewSrc: string
  role: UserRole
}>()

const emit = defineEmits<{
  close: []
  updated: [stats: { postId: string; likeCount: number; likedByMe: boolean; reviewCount: number }]
}>()

const dialogEl = ref<HTMLDivElement | null>(null)
const score = ref(8)
const comment = ref('')
const busy = ref(false)

const title = computed(() => props.post?.title ?? '作品详情')
const meta = computed(() => {
  if (!props.post) return ''
  return `${props.post.authorName} · ${friendlyShortDate(props.post.createdAt)}`
})
const canLike = computed(() => props.role === 'child' || props.role === 'parent')
const isTeacher = computed(() => props.role === 'art_teacher' || props.role === 'chinese_teacher')
const directionMatches = computed(() => {
  if (!props.post) return false
  return (
    (props.role === 'art_teacher' && props.post.outputType === 'collage') ||
    (props.role === 'chinese_teacher' && props.post.outputType === 'story')
  )
})

function errorMessage(error: unknown): string {
  const shared = error as SharedError
  return typeof shared?.message === 'string' && shared.message.trim() ? shared.message : '操作没有完成，请稍后再试。'
}

async function like(): Promise<void> {
  const session = loadPlazaSession()
  if (!session?.token || !props.post || busy.value) return
  const post = props.post
  busy.value = true
  try {
    const stats = await likePlazaPost(session.token, post.postId)
    emit('updated', { postId: post.postId, ...stats })
    showCenterToast('已点赞')
  } catch (error) {
    showCenterToast(errorMessage(error))
  } finally {
    busy.value = false
  }
}

async function review(): Promise<void> {
  const session = loadPlazaSession()
  if (!session?.token || !props.post || busy.value) return
  const post = props.post
  const cleanComment = comment.value.trim()
  if (!cleanComment || score.value < 1 || score.value > 10) {
    showCenterToast('请填写评语并给出 1-10 分评分')
    return
  }
  busy.value = true
  try {
    const result = await submitTeacherReview(session.token, {
      postId: post.postId,
      score: score.value,
      comment: cleanComment
    })
    emit('updated', {
      postId: post.postId,
      likeCount: post.likeCount,
      likedByMe: post.likedByMe,
      reviewCount: post.reviewCount + 1
    })
    if (props.post?.postId === post.postId) comment.value = ''
    showCenterToast(`点评已提交，获得 ${result.teacherRewardCoins} 金币`)
  } catch (error) {
    showCenterToast(errorMessage(error))
  } finally {
    busy.value = false
  }
}

function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))

watch(() => props.post?.postId, () => { comment.value = ''; score.value = 8 })

watch(
  () => props.open,
  (open) => {
    if (open) void Promise.resolve().then(() => dialogEl.value?.focus())
  }
)
</script>

<template>
  <button
    v-if="open && post"
    class="plaza-detail-backdrop"
    type="button"
    aria-label="关闭详情"
    @click="emit('close')"
  ></button>
  <div
    v-if="open && post"
    ref="dialogEl"
    class="plaza-detail-modal text-box-surface"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    tabindex="-1"
  >
    <header class="plaza-detail-head">
      <div>
        <h3>{{ title }}</h3>
        <p class="muted">{{ meta }}</p>
      </div>
      <button type="button" class="ghost" @click="emit('close')">关闭</button>
    </header>
    <div class="plaza-detail-preview">
      <img v-if="previewSrc" :src="previewSrc" :alt="title" />
      <p v-else class="muted">预览加载中…</p>
    </div>
    <div class="plaza-detail-stats">
      <span>{{ post.outputType === 'story' ? '故事卡' : '拼贴作品' }}</span>
      <strong class="stat-with-icon"><img :src="post.likedByMe ? rewardAssets.likeOn : rewardAssets.likeOff" alt="爱心" />{{ post.likeCount }} 赞</strong>
      <strong class="stat-with-icon"><img :src="rewardAssets.commentIcon" alt="评论" />{{ post.reviewCount }} 条点评</strong>
    </div>

    <div v-if="canLike" class="plaza-detail-action-band">
      <button type="button" class="primary" :disabled="post.likedByMe || busy" @click="like">
        <img :src="post.likedByMe ? rewardAssets.likeOn : rewardAssets.likeOff" alt="" />{{ post.likedByMe ? '已点赞' : '点赞' }}
      </button>
    </div>

    <form v-if="isTeacher" class="teacher-review-form" :style="{ backgroundImage: `url(${rewardAssets.reviewFrame})` }" @submit.prevent="review">
      <template v-if="directionMatches">
        <label>
          <span>评分</span>
          <input v-model.number="score" type="number" min="1" max="10" :disabled="busy" />
        </label>
        <label class="teacher-comment" :style="{ backgroundImage: `url(${rewardAssets.reviewInput})` }">
          <span>评语</span>
          <textarea v-model="comment" rows="3" maxlength="500" :disabled="busy"></textarea>
        </label>
        <button type="submit" class="primary" :disabled="busy || !comment.trim()">提交点评</button>
      </template>
      <p v-else class="direction-note">
        {{ role === 'art_teacher' ? '美术教师点评拼贴作品' : '语文教师点评故事卡' }}
      </p>
    </form>
  </div>
</template>

<style scoped>
.plaza-detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 320;
  margin: 0;
  padding: 0;
  border: 0;
  background: rgba(40, 30, 20, 0.45);
  cursor: pointer;
}

.plaza-detail-modal {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 321;
  width: min(720px, 92vw);
  max-height: 88vh;
  padding: 20px 24px 24px;
  transform: translate(-50%, -50%);
  overflow: auto;
}

.plaza-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.plaza-detail-head h3 {
  margin: 0 0 6px;
}

.plaza-detail-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.35);
}

.plaza-detail-preview img {
  max-width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.plaza-detail-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  color: #6d5e51;
}

.plaza-detail-stats span {
  padding: 4px 8px;
  border-radius: 4px;
  background: #e7f0eb;
  color: #2d6d5b;
}

.stat-with-icon { display: inline-flex; align-items: center; gap: 6px; }
.stat-with-icon img, .plaza-detail-action-band img { width: 24px; height: 24px; object-fit: contain; }

.plaza-detail-action-band {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid rgba(89, 71, 56, 0.18);
}

.plaza-detail-action-band button { display: inline-flex; align-items: center; gap: 7px; }

.teacher-review-form {
  display: grid;
  grid-template-columns: 110px 1fr auto;
  align-items: end;
  gap: 12px;
  min-height: 250px;
  padding: 54px 36px 22px;
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  border-top: 1px solid rgba(89, 71, 56, 0.18);
}

.teacher-review-form label {
  display: grid;
  gap: 6px;
}

.teacher-review-form input,
.teacher-review-form textarea {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #bfae9e;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.82);
  color: #493d33;
  font: inherit;
}

.teacher-comment { min-height: 130px; padding: 18px 20px 10px; background-repeat: no-repeat; background-position: center; background-size: 100% 100%; }
.teacher-comment textarea { resize: vertical; background: rgba(255, 255, 255, 0.7); }
.direction-note { grid-column: 1 / -1; margin: 0; color: #796d61; }
</style>
