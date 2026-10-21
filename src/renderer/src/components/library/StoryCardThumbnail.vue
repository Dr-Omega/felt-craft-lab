<script setup lang="ts">
import type { StoryCard } from '@shared/contracts'
defineProps<{ card: StoryCard }>()
const files = import.meta.glob('../../assets/story-card/*.png', { eager:true, query:'?url', import:'default' }) as Record<string,string>
const layers = ['大背景（放在最底层）.png','背景01.png','画展示框02.png','名称框03.png','内容文本框04.png','日期框05.png','播放音频按钮06.png','背景边框（放在第二高的顶层）.png']
const image = (file:string) => files['../../assets/story-card/' + file]
const box = (x:number,y:number,w:number,h:number) => ({left:x/1920*100+'%',top:y/1080*100+'%',width:w/1920*100+'%',height:h/1080*100+'%'})
</script>
<template>
  <div class="story-card-thumbnail" role="img" :aria-label="`故事卡：${card.title}`">
    <img v-for="file in layers" :key="file" class="story-card-thumbnail__layer" :src="image(file)" alt="" aria-hidden="true" />
    <img class="story-card-thumbnail__artwork" :src="card.artworkImageRef" :style="box(317,184,765,610)" alt="" />
    <strong class="story-card-thumbnail__title" :style="box(1220,188,335,90)">{{ card.title }}</strong>
    <p class="story-card-thumbnail__story" :style="box(1210,333,360,455)">{{ card.storyText }}</p>
    <time class="story-card-thumbnail__date" :style="box(770,867,320,45)">{{ new Date(card.confirmedAt).toLocaleDateString('zh-CN') }}</time>
  </div>
</template>
<style scoped>
.story-card-thumbnail { position:relative; width:100%; aspect-ratio:16/9; overflow:hidden; container-type:inline-size; color:#591608; text-align:left; font-family:"Microsoft YaHei",sans-serif; }
.story-card-thumbnail__layer { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.story-card-thumbnail__artwork { position:absolute; object-fit:contain; }
.story-card-thumbnail__title,.story-card-thumbnail__story,.story-card-thumbnail__date { position:absolute; margin:0; overflow:hidden; }
.story-card-thumbnail__title { display:grid; place-items:center; text-align:center; font-size:1.65cqw; line-height:1.25; }
.story-card-thumbnail__story { white-space:pre-wrap; font-size:1.25cqw; line-height:1.55; }
.story-card-thumbnail__date { text-align:center; font-size:1.25cqw; }
</style>
