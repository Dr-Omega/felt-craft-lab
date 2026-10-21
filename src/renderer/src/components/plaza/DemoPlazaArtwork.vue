<script setup lang="ts">
import { demoMaterialUrl, type DemoPlazaPost } from '../../demo/plaza-demo'
defineProps<{ post: DemoPlazaPost }>()
</script>
<template>
  <div class="demo-artwork">
    <img class="demo-artwork__scene" :src="demoMaterialUrl(post.background)" :alt="post.title" />
    <img v-for="(part,index) in post.parts" :key="index" class="demo-artwork__piece" :src="demoMaterialUrl(part[0])" alt=""
      :style="{ left:part[1]+'%',top:part[2]+'%',width:part[3]+'%',height:part[4]+'%',transform:`rotate(${part[5] ?? 0}deg)` }" />
  </div>
</template>
<style scoped>
.demo-artwork { position:relative; width:100%; aspect-ratio:1686/960; overflow:hidden; background:#fffdf4; isolation:isolate; }
.demo-artwork__scene { display:block; width:100%; height:100%; object-fit:contain; }
.demo-artwork__piece { position:absolute; object-fit:contain; }
</style>
