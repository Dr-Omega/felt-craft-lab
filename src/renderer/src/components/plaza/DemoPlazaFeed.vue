<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { createDemoPlazaCards, demoAvatarStyle, toggleDemoLike, type DemoPlazaCard } from '../../demo/plaza-demo'
import { rewardAssets } from '../../ui/reward-assets'
import { plazaAssets } from '../../ui/plaza-assets'
import { handDrawnBorderStyles } from '../../ui/hand-drawn-assets'
import DemoPlazaArtwork from './DemoPlazaArtwork.vue'

defineProps<{ viewerName?: string }>()
const emit = defineEmits<{ 'modal-change':[open:boolean] }>()
const cards = ref(createDemoPlazaCards())
const columns = computed(() => [cards.value.filter((_,i) => i%2===0),cards.value.filter((_,i) => i%2===1)])
const detail = ref<DemoPlazaCard | null>(null), commentsPost = ref<DemoPlazaCard | null>(null)
const storyDialog = ref<HTMLElement | null>(null), commentDialog = ref<HTMLElement | null>(null)
const menuId = ref<string | null>(null), removalAction = ref<'撤回发布' | '删除' | null>(null)
let storyOpener: HTMLButtonElement | null = null, commentOpener: HTMLButtonElement | null = null
const cardSkin = { borderImageSource:`url(${rewardAssets.communityCard})` }
const avatar = (post: DemoPlazaCard) => [plazaAssets.avatars.childOne,plazaAssets.avatars.childTwo,plazaAssets.avatars.childThree][post.avatar-1]

async function openStory(post: DemoPlazaCard,event: MouseEvent): Promise<void> {
  storyOpener = event.currentTarget as HTMLButtonElement
  menuId.value = null; detail.value = post; emit('modal-change',true)
  await nextTick(); storyDialog.value?.querySelector<HTMLButtonElement>('.close-story')?.focus()
}
async function closeStory(): Promise<void> {
  commentsPost.value = null; detail.value = null; emit('modal-change',false)
  await nextTick(); storyOpener?.focus()
}
async function openComments(post: DemoPlazaCard,event: MouseEvent): Promise<void> {
  commentOpener = event.currentTarget as HTMLButtonElement
  menuId.value = null; commentsPost.value = post; emit('modal-change',true)
  await nextTick(); commentDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
async function closeComments(): Promise<void> {
  commentsPost.value = null; emit('modal-change',Boolean(detail.value))
  await nextTick(); commentOpener?.focus()
}
function removeDemoCard(post: DemoPlazaCard): void {
  cards.value = cards.value.filter(item => item.id !== post.id)
  menuId.value = null; removalAction.value = null
}
function onKey(event: KeyboardEvent): void {
  const panel = commentsPost.value ? commentDialog.value : detail.value ? storyDialog.value : null
  if (event.key === 'Escape') {
    if (panel) { event.preventDefault(); event.stopPropagation(); void (commentsPost.value ? closeComments() : closeStory()) }
    else { menuId.value = null; removalAction.value = null }
  }
  if (event.key !== 'Tab' || !panel) return
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const first = buttons[0], last = buttons.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
}
onMounted(() => window.addEventListener('keydown',onKey,true))
onUnmounted(() => { window.removeEventListener('keydown',onKey,true); emit('modal-change',false) })
</script>

<template>
  <section class="demo-feed" aria-label="童创空间作品" data-tour-id="tour-plaza-public" :inert="Boolean(detail || commentsPost)">
    <div class="demo-feed__scroll art-scrollbars">
      <div class="demo-columns">
        <ul v-for="(column,index) in columns" :key="index" class="demo-column">
          <li v-for="post in column" :key="post.id" class="demo-card" :style="cardSkin" :data-post-id="post.id">
            <button type="button" class="demo-art-button" :aria-label="`查看${post.title}的故事`" @click="openStory(post,$event)"><DemoPlazaArtwork :post="post" /></button>
            <div class="demo-title"><h3>{{ post.title }}</h3>
              <button v-if="post.own" type="button" class="demo-menu-toggle" aria-label="管理我的作品" :aria-expanded="menuId === post.id"
                @click="menuId = menuId === post.id ? null : post.id; removalAction = null">···</button>
            </div>
            <div v-if="menuId === post.id" class="demo-menu" :style="handDrawnBorderStyles.btnPrimary">
              <template v-if="removalAction"><span>确定{{ removalAction }}？</span><button type="button" @click="removeDemoCard(post)">确定</button><button type="button" @click="removalAction = null">取消</button></template>
              <template v-else><button type="button" @click="removalAction = '撤回发布'">撤回发布</button><button type="button" @click="removalAction = '删除'">删除</button></template>
            </div>
            <p class="demo-excerpt" :style="{ '-webkit-line-clamp':post.excerptLines }">{{ post.story }}</p>
            <div class="demo-byline"><span class="demo-avatar" aria-hidden="true"><img :src="avatar(post)" :style="demoAvatarStyle(post.avatar)" alt="" /></span><span>{{ post.own ? viewerName || post.author : post.author }}<small v-if="post.own"> · 我</small></span>
              <div class="demo-stats">
                <button type="button" class="demo-icon-button demo-list-like" :aria-label="`${post.liked ? '取消点赞' : '点赞'}：${post.title}，${post.likes} 赞`" :aria-pressed="post.liked" @click="toggleDemoLike(post)"><img :src="post.liked ? rewardAssets.likeOn : rewardAssets.likeOff" alt="" /><span>{{ post.likes }}</span></button>
                <button type="button" class="demo-icon-button" :aria-label="`查看${post.title}的专家评价`" @click="openComments(post,$event)"><img :src="rewardAssets.commentIcon" alt="" /><span>{{ post.comments.length }}</span></button>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>

  <section v-if="detail" ref="storyDialog" class="demo-story" :style="cardSkin" role="dialog" aria-modal="true" :aria-label="detail.title" :inert="Boolean(commentsPost)">
    <header><h2>{{ detail.title }}</h2><button class="demo-hand-button close-story" :style="handDrawnBorderStyles.btnPrimary" type="button" @click="closeStory">关闭</button></header>
    <div class="demo-story__content"><DemoPlazaArtwork :post="detail" />
      <div class="demo-story__side"><p>{{ detail.story }}</p><div class="demo-story__actions">
        <button type="button" class="demo-hand-button demo-detail-like" :style="handDrawnBorderStyles.btnPrimary" :aria-pressed="detail.liked" @click="toggleDemoLike(detail)"><img :src="detail.liked ? rewardAssets.likeOn : rewardAssets.likeOff" alt="" />{{ detail.liked ? '已赞' : '点赞' }} {{ detail.likes }}</button>
        <button type="button" class="demo-hand-button demo-detail-comments" :style="handDrawnBorderStyles.btnPrimary" @click="openComments(detail,$event)"><img :src="rewardAssets.commentIcon" alt="" />查看评论 {{ detail.comments.length }}</button>
      </div></div>
    </div>
  </section>
  <section v-if="commentsPost" ref="commentDialog" class="demo-comments" :style="cardSkin" role="dialog" aria-modal="true" :aria-label="`${commentsPost.title}的评论`">
    <h2>评论 {{ commentsPost.comments.length }}</h2>
    <ul v-if="commentsPost.comments.length" class="demo-comment-list art-scrollbars"><li v-for="(item,index) in commentsPost.comments" :key="index"><strong>{{ item.author }}</strong><p>{{ item.text }}</p></li></ul>
    <p v-else class="demo-comment-empty">还没有评论。</p>
    <button type="button" class="demo-hand-button close-comments" :style="handDrawnBorderStyles.btnPrimary" @click="closeComments">关闭</button>
  </section>
</template>

<style scoped>
.demo-feed { position:absolute; z-index:6; left:132px; top:268px; width:1656px; height:668px; padding:20px 42px 0; color:#61351f; }
.demo-feed__scroll { height:100%; overflow-y:auto; overflow-x:hidden; padding:0 12px 32px; scrollbar-width:thin; scrollbar-color:#c19b68 transparent; }
.demo-columns { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); align-items:start; max-width:1280px; margin:0 auto; gap:32px; }
.demo-column { display:flex; flex-direction:column; gap:28px; list-style:none; padding:0; margin:0; min-width:0; }
.demo-card { position:relative; min-width:0; padding:14px; border:9px solid transparent; border-image-slice:14 fill; border-image-width:3px; border-image-repeat:stretch; }
.demo-art-button { display:block; width:100%; padding:0; border:0; background:transparent; cursor:pointer; }
.demo-title { display:flex; align-items:flex-start; gap:16px; margin:14px 0 7px; }
.demo-title h3 { flex:1; min-width:0; margin:0; font-size:27px; line-height:1.35; overflow-wrap:anywhere; }
.demo-menu-toggle { border:0; background:transparent; padding:0 0 0 10px; font-size:26px; letter-spacing:3px; }
.demo-menu { position:absolute; z-index:2; right:16px; display:flex; align-items:center; gap:12px; font-size:22px; }
.demo-menu button { padding:6px; border:0; background:transparent; color:inherit; font:inherit; }
.demo-excerpt { display:-webkit-box; -webkit-box-orient:vertical; overflow:hidden; margin:0 0 12px; color:#8a674c; font-size:21px; line-height:1.5; }
.demo-byline { display:flex; align-items:center; gap:10px; font-size:21px; color:#7f6048; }
.demo-byline small { font-size:18px; }.demo-avatar { position:relative; flex:0 0 40px; width:40px; height:40px; border-radius:50%; background:#f2d493; overflow:hidden; }
.demo-avatar img { position:absolute; max-width:none; }
.demo-stats { display:flex; align-items:center; gap:12px; margin-left:auto; }
.demo-icon-button { display:inline-flex; align-items:center; gap:6px; min-height:44px; padding:4px; border:0; background:transparent; color:inherit; font:inherit; }
.demo-icon-button img { width:30px; height:30px; object-fit:contain; }
.demo-story,.demo-comments { position:absolute; color:#61351f; border:10px solid transparent; border-image-slice:14 fill; border-image-repeat:stretch; }
.demo-story { z-index:30; inset:300px 300px auto; min-height:560px; padding:30px 34px; display:flex; flex-direction:column; }
.demo-story header { display:flex; align-items:center; gap:20px; margin-bottom:16px; }
.demo-story h2 { flex:1; font-size:30px; margin:0; }
.demo-story__content { flex:1; display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:34px; align-items:center; }
.demo-story__side { display:flex; flex-direction:column; gap:26px; min-width:0; }
.demo-story__side > p { margin:0; font-size:26px; line-height:1.8; overflow-wrap:anywhere; }
.demo-story__actions { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.demo-hand-button { display:inline-flex; align-items:center; justify-content:center; gap:9px; min-height:64px; padding:0 13px; color:inherit; font:inherit; font-size:24px; }
.demo-hand-button img { width:30px; height:30px; object-fit:contain; }
.demo-comments { z-index:31; inset:345px 420px auto; padding:28px 32px; }
.demo-comments h2 { margin:0 0 18px; font-size:30px; }
.demo-comment-list { list-style:none; margin:0 0 22px; padding:0; max-height:340px; overflow-y:auto; scrollbar-width:thin; }
.demo-comment-list li { padding:15px 0; border-bottom:1px solid #c9aa6d; }.demo-comment-list li:last-child { border-bottom:0; }
.demo-comment-list strong { font-size:23px; }.demo-comment-list p { font-size:24px; line-height:1.65; margin:7px 0 0; }
.demo-comment-empty { padding:16px 0; font-size:25px; line-height:1.7; }
.close-comments { display:flex; margin-left:auto; }
button { cursor:pointer; }button:focus-visible { outline:4px solid #a74c26; outline-offset:4px; }
[aria-pressed="true"] { color:#9b3023; }
</style>
