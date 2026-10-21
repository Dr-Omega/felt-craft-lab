<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PlazaPost, PlazaUser } from '@shared/contracts/plaza'
import { rewardAssets } from '../../ui/reward-assets'
import { plazaAssets } from '../../ui/plaza-assets'
import { handDrawnBorderStyles } from '../../ui/hand-drawn-assets'
import { excerptLineMix, plazaAvatarIndex, plazaAvatarCrop } from '../../services/plaza-presentation'

const props = defineProps<{
  posts: PlazaPost[]; previews: Record<string,string>; viewer?: PlazaUser
  loading: boolean; error: string; busyPostId: string; detailLoading: boolean; detailError: string
}>()
const emit = defineEmits<{
  retry: []; like: [post:PlazaPost]; inspect: [post:PlazaPost]; withdraw: [post:PlazaPost]
  review: [post:PlazaPost, score:number, comment:string]; 'modal-change':[open:boolean]
}>()
const columns = computed(() => [props.posts.filter((_,i)=>i%2===0),props.posts.filter((_,i)=>i%2===1)])
const excerptLines = ref<Record<string,1|2>>({})
watch(()=>props.posts.map(post=>post.postId),ids=>{
  const missing=ids.filter(id=>!excerptLines.value[id]), mix=excerptLineMix(missing.length)
  missing.forEach((id,i)=>{excerptLines.value[id]=mix[i]})
},{immediate:true})
const detailId=ref<string|null>(null), commentsId=ref<string|null>(null), menuId=ref<string|null>(null)
const removal=ref<{post:PlazaPost;action:string}|null>(null)
const detail=computed(()=>props.posts.find(post=>post.postId===detailId.value))
const commentsPost=computed(()=>props.posts.find(post=>post.postId===commentsId.value))
const storyDialog=ref<HTMLElement>(), commentDialog=ref<HTMLElement>()
const score=ref(8), comment=ref('')
let storyOpener:HTMLElement|null=null, commentOpener:HTMLElement|null=null
const cardSkin={borderImageSource:`url(${rewardAssets.communityCard})`}
const avatars=[plazaAssets.avatars.childOne,plazaAssets.avatars.childTwo,plazaAssets.avatars.childThree]
const canLike=(post:PlazaPost)=>Boolean(props.viewer && ['child','parent'].includes(props.viewer.role) && post.userId!==props.viewer.userId)
const canReview=(post:PlazaPost)=>props.viewer?.role===(post.outputType==='story'?'chinese_teacher':'art_teacher')
const isTeacher=computed(()=>['art_teacher','chinese_teacher'].includes(props.viewer?.role??''))
watch(()=>Boolean(detail.value||commentsPost.value),open=>emit('modal-change',open))
watch(detailId,()=>{score.value=8;comment.value=''})
async function openStory(post:PlazaPost,event:MouseEvent) {
  storyOpener=event.currentTarget as HTMLElement; menuId.value=null; detailId.value=post.postId
  emit('inspect',post); await nextTick(); storyDialog.value?.querySelector<HTMLButtonElement>('.close-story')?.focus()
}
async function closeStory() {commentsId.value=null;detailId.value=null;await nextTick();storyOpener?.focus()}
async function openComments(post:PlazaPost,event:MouseEvent) {
  commentOpener=event.currentTarget as HTMLElement;menuId.value=null;commentsId.value=post.postId
  emit('inspect',post);await nextTick();commentDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
async function closeComments() {commentsId.value=null;await nextTick();commentOpener?.focus()}
function submitReview(post:PlazaPost) {emit('review',post,score.value,comment.value.trim())}
function onKey(event:KeyboardEvent) {
  const panel=commentsPost.value?commentDialog.value:detail.value?storyDialog.value:null
  if(event.key==='Escape') {
    if(panel){event.preventDefault();event.stopPropagation();void(commentsPost.value?closeComments():closeStory())}
    else {menuId.value=null;removal.value=null}
  }
  if(event.key!=='Tab'||!panel)return
  const controls=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')]
  const first=controls[0],last=controls.at(-1)
  if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first?.focus()}
}
onMounted(()=>window.addEventListener('keydown',onKey,true))
onUnmounted(()=>{window.removeEventListener('keydown',onKey,true);emit('modal-change',false)})
</script>

<template>
  <section class="plaza-feed" aria-label="童创空间作品" data-tour-id="tour-plaza-public" :inert="Boolean(detail||commentsPost)">
    <div class="plaza-feed__scroll art-scrollbars">
      <p v-if="loading" role="status">正在加载分享作品…</p>
      <p v-if="error" role="alert">{{ error }} <button class="hand-btn-secondary" @click="emit('retry')">重试</button></p>
      <p v-if="!loading&&!error&&!posts.length">还没有人分享作品，来做第一个吧。</p>
      <div class="plaza-columns">
        <ul v-for="(column,index) in columns" :key="index" class="plaza-column">
          <li v-for="post in column" :key="post.postId" class="plaza-card" :style="cardSkin" :data-post-id="post.postId">
            <button class="plaza-art-button" type="button" :aria-label="`查看${post.title}的故事`" @click="openStory(post,$event)">
              <img v-if="previews[post.postId]" :src="previews[post.postId]" :alt="post.title"/><span v-else>画面加载中…</span>
            </button>
            <div class="plaza-title"><h3>{{ post.title }}</h3><button v-if="post.userId===viewer?.userId" class="plaza-menu-toggle" type="button" aria-label="管理我的作品" :aria-expanded="menuId===post.postId" @click="menuId=menuId===post.postId?null:post.postId;removal=null">···</button></div>
            <div v-if="menuId===post.postId" class="plaza-menu" :style="handDrawnBorderStyles.btnPrimary">
              <template v-if="removal?.post.postId===post.postId"><span>{{ removal.action }}？仅移除分享，保留本机作品。</span><button type="button" :disabled="Boolean(busyPostId)" @click="emit('withdraw',post)">确定</button><button type="button" @click="removal=null">取消</button></template>
              <template v-else><button type="button" @click="removal={post,action:'撤回发布'}">撤回发布</button><button type="button" @click="removal={post,action:'删除'}">删除</button></template>
            </div>
            <p v-if="post.storyText" class="plaza-excerpt" :style="{'-webkit-line-clamp':excerptLines[post.postId]}">{{ post.storyText }}</p>
            <div class="plaza-byline"><span class="plaza-avatar" aria-hidden="true"><img :src="avatars[plazaAvatarIndex(post.userId)]" :style="plazaAvatarCrop(plazaAvatarIndex(post.userId))" alt=""/></span><span>{{ post.authorName }}<small v-if="post.userId===viewer?.userId"> · 我</small></span>
              <div class="plaza-stats"><button type="button" class="plaza-icon-button plaza-list-like" :disabled="!canLike(post)||busyPostId===post.postId" :aria-label="`${post.likedByMe?'取消点赞':'点赞'}：${post.title}，${post.likeCount} 赞`" :aria-pressed="post.likedByMe" @click="emit('like',post)"><img :src="post.likedByMe?rewardAssets.likeOn:rewardAssets.likeOff" alt=""/><span>{{ post.likeCount }}</span></button>
                <button type="button" class="plaza-icon-button" :aria-label="`查看${post.title}的专家评价`" @click="openComments(post,$event)"><img :src="rewardAssets.commentIcon" alt=""/><span>{{ post.reviewCount }}</span></button></div>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </section>
  <section v-if="detail" ref="storyDialog" class="plaza-story art-scrollbars" :style="cardSkin" role="dialog" aria-modal="true" :aria-label="detail.title" :inert="Boolean(commentsPost)">
    <header><h2>{{ detail.title }}</h2><button type="button" class="plaza-hand-button close-story" :style="handDrawnBorderStyles.btnPrimary" @click="closeStory">关闭</button></header>
    <div class="plaza-story__content"><div class="plaza-artwork"><img v-if="previews[detail.postId]" :src="previews[detail.postId]" :alt="detail.title"/></div>
      <div class="plaza-story__side"><strong v-if="detail.storyTitle">{{ detail.storyTitle }}</strong><p>{{ detail.storyText||'这幅作品还没有附上故事。' }}</p>
        <div class="plaza-story__actions"><button type="button" class="plaza-hand-button plaza-detail-like" :style="handDrawnBorderStyles.btnPrimary" :disabled="!canLike(detail)||busyPostId===detail.postId" :aria-pressed="detail.likedByMe" @click="emit('like',detail)"><img :src="detail.likedByMe?rewardAssets.likeOn:rewardAssets.likeOff" alt=""/>{{ detail.likedByMe?'已赞':'点赞' }} {{ detail.likeCount }}</button>
          <button type="button" class="plaza-hand-button" :style="handDrawnBorderStyles.btnPrimary" @click="openComments(detail,$event)"><img :src="rewardAssets.commentIcon" alt=""/>查看评论 {{ detail.reviewCount }}</button></div>
      </div>
    </div>
    <form v-if="isTeacher&&canReview(detail)" class="plaza-review-form" @submit.prevent="submitReview(detail)"><label>评分<input v-model.number="score" type="number" min="1" max="10" required :disabled="busyPostId===detail.postId"/></label><label>评语<textarea v-model="comment" rows="2" maxlength="500" required :disabled="busyPostId===detail.postId"/></label><button type="submit" class="plaza-hand-button" :style="handDrawnBorderStyles.btnPrimary" :disabled="busyPostId===detail.postId||!comment.trim()">提交点评</button></form>
    <p v-else-if="isTeacher">{{ viewer?.role==='art_teacher'?'美术教师点评拼贴作品':'语文教师点评故事卡' }}</p>
  </section>
  <section v-if="commentsPost" ref="commentDialog" class="plaza-comments" :style="cardSkin" role="dialog" aria-modal="true" :aria-label="`${commentsPost.title}的评论`">
    <h2>评论 {{ commentsPost.reviewCount }}</h2><p v-if="detailLoading" role="status">正在加载评论…</p>
    <p v-else-if="detailError" role="alert">{{ detailError }} <button type="button" @click="emit('inspect',commentsPost)">重试</button></p>
    <ul v-else-if="commentsPost.reviews?.length" class="plaza-comment-list art-scrollbars"><li v-for="item in commentsPost.reviews" :key="item.reviewId"><strong>{{ item.authorName }} · {{ item.score }} 分</strong><p>{{ item.comment }}</p></li></ul><p v-else>还没有评论。</p>
    <button type="button" class="plaza-hand-button close-comments" :style="handDrawnBorderStyles.btnPrimary" @click="closeComments">关闭</button>
  </section>
</template>

<style scoped>
.plaza-feed{position:absolute;z-index:6;left:132px;top:268px;width:1656px;height:668px;padding:20px 42px 0;color:#61351f}
.plaza-feed__scroll{height:100%;overflow-y:auto;overflow-x:hidden;padding:0 12px 32px;scrollbar-width:thin;scrollbar-color:#c19b68 transparent}
.plaza-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;max-width:1280px;margin:0 auto;gap:32px}
.plaza-column{display:flex;flex-direction:column;gap:28px;list-style:none;padding:0;margin:0;min-width:0}
.plaza-card{position:relative;min-width:0;padding:14px;border:9px solid transparent;border-image-slice:14 fill;border-image-width:3px;border-image-repeat:stretch}
.plaza-art-button,.plaza-artwork{display:grid;place-items:center;width:100%;aspect-ratio:1686/960;overflow:hidden;background:#fffdf4}
.plaza-art-button{padding:0;border:0;cursor:pointer}.plaza-art-button img,.plaza-artwork img{width:100%;height:100%;min-height:0;object-fit:contain}
.plaza-title{display:flex;align-items:flex-start;gap:16px;margin:14px 0 7px}.plaza-title h3{flex:1;min-width:0;margin:0;font-size:27px;line-height:1.35;overflow-wrap:anywhere}
.plaza-menu-toggle{border:0;background:transparent;padding:0 0 0 10px;font-size:26px;letter-spacing:3px}
.plaza-menu{position:absolute;z-index:2;right:16px;max-width:90%;display:flex;align-items:center;gap:12px;font-size:22px}.plaza-menu button{padding:6px;border:0;background:transparent;color:inherit;font:inherit}
.plaza-excerpt{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 12px;color:#8a674c;font-size:21px;line-height:1.5}
.plaza-byline{display:flex;align-items:center;gap:10px;font-size:21px;color:#7f6048}.plaza-byline>span:nth-child(2){min-width:0;overflow-wrap:anywhere}.plaza-byline small{font-size:18px}
.plaza-avatar{position:relative;flex:0 0 40px;width:40px;height:40px;border-radius:50%;background:#f2d493;overflow:hidden}.plaza-avatar img{position:absolute;max-width:none}
.plaza-stats{display:flex;align-items:center;gap:12px;margin-left:auto}.plaza-icon-button{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:4px;border:0;background:transparent;color:inherit;font:inherit}
.plaza-icon-button img,.plaza-hand-button img{width:30px;height:30px;object-fit:contain}
.plaza-story,.plaza-comments{position:absolute;color:#61351f;border:10px solid transparent;border-image-slice:14 fill;border-image-repeat:stretch}
.plaza-story{z-index:30;inset:300px 300px auto;min-height:560px;max-height:680px;overflow:auto;padding:30px 34px;display:flex;flex-direction:column}
.plaza-story header{display:flex;align-items:center;gap:20px;margin-bottom:16px}.plaza-story h2{flex:1;font-size:30px;margin:0;overflow-wrap:anywhere}
.plaza-story__content{flex:1;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:34px;align-items:center}.plaza-story__side{display:flex;flex-direction:column;gap:26px;min-width:0}
.plaza-story__side>p{margin:0;font-size:26px;line-height:1.8;overflow-wrap:anywhere;white-space:pre-wrap}.plaza-story__actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.plaza-hand-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:64px;padding:0 13px;color:inherit;font:inherit;font-size:24px}
.plaza-comments{z-index:31;inset:345px 420px auto;padding:28px 32px}.plaza-comments h2{margin:0 0 18px;font-size:30px}.plaza-comments>p{font-size:25px;line-height:1.7}
.plaza-comment-list{list-style:none;margin:0 0 22px;padding:0;max-height:340px;overflow-y:auto;scrollbar-width:thin}.plaza-comment-list li{padding:15px 0;border-bottom:1px solid #c9aa6d}.plaza-comment-list li:last-child{border-bottom:0}
.plaza-comment-list strong{font-size:23px}.plaza-comment-list p{font-size:24px;line-height:1.65;margin:7px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.close-comments{display:flex;margin-left:auto}
.plaza-review-form{display:grid;grid-template-columns:100px minmax(0,1fr) auto;align-items:end;gap:16px;margin-top:24px;font-size:22px}.plaza-review-form label{display:grid;gap:8px}.plaza-review-form input,.plaza-review-form textarea{width:100%;font:inherit;color:inherit;background:#fff7d7;border:2px solid #a47c4b;padding:8px}
button{cursor:pointer}button:disabled{cursor:default;opacity:.6}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:4px solid #a74c26;outline-offset:4px}[aria-pressed="true"]{color:#9b3023}
</style>
