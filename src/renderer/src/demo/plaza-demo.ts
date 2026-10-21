/** Ephemeral presentation fixtures: never published, persisted or sent to reward APIs. */
export type DemoPart = readonly [asset: string, x: number, y: number, width: number, height: number, rotation?: number]
export interface DemoComment { author: string; text: string }
export interface DemoPlazaPost {
  id: string; title: string; author: string; avatar: number; own?: boolean
  background: string; parts: readonly DemoPart[]; story: string; likes: number; comments: readonly DemoComment[]
}
export interface DemoPlazaCard extends DemoPlazaPost { liked: boolean; excerptLines: 1 | 2 }
const comment = (text: string): DemoComment => ({ author: '美育老师', text })
export const DEMO_PLAZA_POSTS: readonly DemoPlazaPost[] = [
  { id:'moon-mail', title:'月亮邮差出发啦', author:'小禾', avatar:1, own:true, likes:26,
    story:'月亮升起来的时候，小兔子的邮船出发了。它把圆圆的月饼装进船舱，要送给湖对岸还没有回家的朋友。船走得很慢，月亮也慢慢跟着它。小兔子说：“别着急，团圆的礼物一定会送到！”',
    background:'background_lake_moon_001', parts:[['sticker_rabbit_001',60,43,18,36],['sticker_mooncake_001',73,67,12,18]],
    comments:[comment('深蓝的夜空和暖黄色的小船形成了鲜明对比，小兔子的位置也让“送月饼”的故事更容易读懂。'),{author:'故事老师',text:'月亮慢慢跟着小船的描写，让这个夜晚有了温柔的感觉。'}] },
  { id:'autumn-letter', title:'捡一封秋天的信', author:'圆圆', avatar:2, likes:18,
    story:'金黄的小路上，落叶一片接着一片。我捡起一片红枫叶，觉得它像秋天寄来的信。信上没有字，只有沙沙的声音。我把它夹进书里，想等到冬天，再闻一闻秋天的味道。',
    background:'background_autumn_ginkgo_path_001', parts:[['sticker_maple_leaf_001',51,22,17,29,-18],['sticker_fallen_leaf_001',30,52,15,27,24],['sticker_persimmon_001',67,65,24,33]],
    comments:[comment('红色枫叶在金黄背景上很醒目，近处和远处不同大小的叶子，让画面更有空间感。')] },
  { id:'lotus-boat', title:'荷塘里的慢慢船', author:'豆豆', avatar:3, likes:32,
    story:'夏天的风把小船推到了荷塘中间。我没有急着划桨，因为一朵粉色荷花正要开放。小船停一停，水波也轻一点。我想把这一会儿安静的夏天，装进口袋带回家。',
    background:'background_summer_lotus_pond_001', parts:[['sticker_small_boat_001',28,32,40,52],['sticker_lotus_001',8,27,24,51]],
    comments:[comment('画面保留了舒服的留白，小船和荷花一左一右，水面的空间没有被塞满。'),{author:'美术老师',text:'小船和荷叶之间的距离，让水面显得很宽。'},{author:'故事老师',text:'“把夏天装进口袋”的想法很有趣，也和安静的画面呼应。'}] },
  { id:'snow-visitor', title:'雪人等来的小客人', author:'小米', avatar:1, likes:9,
    story:'雪人站在雪地里，等了好久好久。终于，一只小白兔蹦蹦跳跳地来了。雪人把围巾抖了抖，说：“你看，今天的雪花像小星星！”小白兔点点头，陪它一起数起了天上的白星星。',
    background:'background_winter_snowman_field_001', parts:[['sticker_rabbit_001',20,48,27,46],['sticker_snowflake_001',19,13,10,18],['sticker_snowflake_001',45,28,8,14]], comments:[] },
  { id:'kite-wish', title:'风把我的愿望带走了', author:'果果', avatar:2, likes:15,
    story:'我把“希望每天都能出去玩”悄悄告诉了风筝。风筝越飞越高，燕子从旁边轻轻掠过。它们是不是在替我传话呢？我拉住风筝线，决定明天再带一个新愿望来。',
    background:'background_kite_meadow_001', parts:[['sticker_swallow_001',44,18,20,27,-8],['sticker_peach_blossom_001',9,63,23,36]],
    comments:[comment('燕子和风筝的朝向让画面有了风吹动的感觉，浅浅的天空也很适合这个轻快的故事。')] },
  { id:'river-wish', title:'把心愿放进一盏小灯', author:'星星', avatar:3, likes:21,
    story:'夜晚的河边亮起了小灯。我把一盏粉色荷花灯放进水里，许了一个很小的愿望：希望奶奶每天都笑眯眯。灯顺着河水慢慢漂远，像一颗不着急的星星。',
    background:'background_river_lantern_001', parts:[['sticker_flower_lantern_001',35,56,20,29],['sticker_flower_lantern_001',68,51,14,20],['sticker_flower_lantern_001',52,40,9,13]],
    comments:[comment('荷花灯的粉色和河水的蓝色搭配清楚，远近几盏灯的大小变化让河流显得更长了。'),{author:'故事老师',text:'给奶奶许愿的小细节，让这个故事有了真切的心意。'}] },
  { id:'fuwa-new-year', title:'福娃来我家过年啦', author:'小满', avatar:1, likes:24,
    story:'左手拿饺子，右手拿红包，福娃来我家过年啦。小院门口挂起了灯笼，大家你一言我一语，围在一起说着新年愿望。我最喜欢的不是红包，而是大家都在家里的热闹。',
    background:'provided/beijing', parts:[['provided/fuwa',40,47,23,46],['provided/jiaozi',33,73,10,10,-18],['provided/hongbao',59,68,9,17,18]],
    comments:[comment('福娃和红色的小配件呼应了春节主题，院落背景与人物的前后关系也很清楚。')] },
  { id:'spring-tea', title:'请春风喝一杯茶', author:'阿朵', avatar:2, likes:12,
    story:'午后的茶桌上，茶壶和小杯子排排坐。窗外吹来一阵风，叶子轻轻晃了一下。我给春风也留了一个杯子，告诉它：“慢一点呀，喝完这杯茶再走。”',
    background:'background_classical_tea_room_001', parts:[['sticker_teapot_001',32,45,27,32],['sticker_teacup_001',51,54,14,21],['sticker_teacup_001',27,58,13,19]], comments:[] }
]

// Existing avatar PNGs are full 1920×1080 UI layers. Frame only their artwork,
// without rewriting the shared assets or displaying their transparent margins.
export function demoAvatarStyle(avatar: number): Record<string, string> {
  const [x, y, size] = [[1564,48,264], [1576,61,280], [1573,62,272]][avatar-1] ?? [1564,48,264]
  return { width:`${1920/size*100}%`, height:`${1080/size*100}%`, left:`${-x/size*100}%`, top:`${-y/size*100}%` }
}

export function demoMaterialUrl(asset: string): string {
  const path = asset.startsWith('provided/') ? `${asset}/composite` : asset
  return `felt-resource://material/snapshot_ywn_psd_20261017/${path}.png`
}
export function createDemoPlazaCards(random: () => number = Math.random): DemoPlazaCard[] {
  // Vary the visit's mix, rather than independently flipping eight coins (which
  // often makes the first visible pair identical). Keep the first pair mixed;
  // shuffle the remainder, without enforcing an alternating pattern.
  const oneLineCount = 2 + Math.floor(random() * 5)
  const first: 1 | 2 = random() < .5 ? 1 : 2
  const rest: Array<1 | 2> = [
    ...Array<1>(oneLineCount-1).fill(1),
    ...Array<2>(DEMO_PLAZA_POSTS.length-oneLineCount-1).fill(2)
  ]
  for (let i=rest.length-1;i>0;i--) {
    const j=Math.floor(random()*(i+1))
    ;[rest[i],rest[j]]=[rest[j],rest[i]]
  }
  const lines: Array<1 | 2> = [first,first===1?2:1,...rest]
  return DEMO_PLAZA_POSTS.map((post,index) => ({ ...post, comments:post.comments.map(item => ({ ...item })),
    liked:false, excerptLines:lines[index] }))
}
export function toggleDemoLike(post: DemoPlazaCard): void {
  post.liked = !post.liked
  post.likes += post.liked ? 1 : -1
}
