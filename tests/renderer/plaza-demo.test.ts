import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createDemoPlazaCards, DEMO_PLAZA_POSTS, demoAvatarStyle, demoMaterialUrl, toggleDemoLike } from '../../src/renderer/src/demo/plaza-demo'
const source = (path: string) => readFileSync('src/renderer/src/'+path,'utf8')

describe('desktop plaza demo', () => {
  it('frames existing hand-drawn avatars instead of shrinking their full-screen transparent canvas', () => {
    const feed=source('components/plaza/DemoPlazaFeed.vue')
    expect(feed).toContain(':style="demoAvatarStyle(post.avatar)"')
    expect(feed).toContain('flex:0 0 40px')
    expect(feed).toContain('overflow:hidden')
    for(const id of [1,2,3]) {
      expect(existsSync(`assets/ui/avatars/child-${id}.png`)).toBe(true)
      const style=demoAvatarStyle(id)
      const size=1920/(parseFloat(style.width)/100)
      const x=-parseFloat(style.left)*size/100,y=-parseFloat(style.top)*size/100
      expect(size).toBeGreaterThan(250);expect(size).toBeLessThan(300)
      expect(x).toBeGreaterThan(1550);expect(x+size).toBeLessThan(1920)
      expect(y).toBeGreaterThan(30);expect(y+size).toBeLessThan(350)
      expect(parseFloat(style.height)/parseFloat(style.width)).toBeCloseTo(1080/1920)
    }
  })
  it('provides eight distinct saved-material scenes, with Fuwa in only one story', () => {
    expect(DEMO_PLAZA_POSTS).toHaveLength(8)
    expect(new Set(DEMO_PLAZA_POSTS.map(post => post.id)).size).toBe(8)
    expect(new Set(DEMO_PLAZA_POSTS.map(post => post.background)).size).toBe(8)
    expect(DEMO_PLAZA_POSTS.filter(post => post.parts.some(part => part[0]==='provided/fuwa'))).toHaveLength(1)
    for (const post of DEMO_PLAZA_POSTS) {
      expect(post.story.length).toBeGreaterThan(40)
      for (const id of [post.background,...post.parts.map(part => part[0])]) {
        const ref = demoMaterialUrl(id)
        expect(ref).toMatch(/^felt-resource:\/\/material\/snapshot_ywn_psd_20261017\//)
        expect(existsSync('assets/generated/'+ref.replace('felt-resource://',''))).toBe(true)
      }
    }
  })
  it('samples excerpt limits once per new feed, never on likes or fixture identity', () => {
    const samples=[.1,.8,.2,.9,.3,.7,.4,.6];let calls=0
    const cards=createDemoPlazaCards(()=>samples[calls++])
    const callsAfterLoad=calls
    expect(callsAfterLoad).toBeGreaterThan(0)
    expect(cards[0].excerptLines).not.toBe(cards[1].excerptLines)
    expect(cards.filter(post=>post.excerptLines===1)).toHaveLength(2)
    const limits=cards.map(post=>post.excerptLines)
    toggleDemoLike(cards[1]);toggleDemoLike(cards[1])
    expect(cards.map(post=>post.excerptLines)).toEqual(limits);expect(calls).toBe(callsAfterLoad)
    expect(createDemoPlazaCards(()=>.9).filter(post=>post.excerptLines===1)).toHaveLength(6)
  })
  it('varies the quota and first-pair orientation, while avoiding all-equal visits even at RNG extremes',()=>{
    const quotas=new Set<number>(),firsts=new Set<number>()
    for(const value of [0,.25,.5,.75,.999999]){
      const cards=createDemoPlazaCards(()=>value),ones=cards.filter(post=>post.excerptLines===1).length
      expect(ones).toBeGreaterThanOrEqual(2);expect(ones).toBeLessThanOrEqual(6)
      expect(cards[0].excerptLines).not.toBe(cards[1].excerptLines)
      expect(cards.every(post=>post.excerptLines===1||post.excerptLines===2)).toBe(true)
      quotas.add(ones);firsts.add(cards[0].excerptLines)
    }
    expect([...quotas]).toEqual([2,3,4,5,6]);expect(firsts.size).toBe(2)
  })
  it('shuffles which works receive each length instead of hardcoding work identities or alternating rows',()=>{
    const patterns=new Set<string>(),quotas=new Set<number>()
    for(let seed=0;seed<32;seed++){
      let state=Math.imul(seed+1,0x9e3779b1)>>>0
      const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
      const limits=createDemoPlazaCards(random).map(post=>post.excerptLines)
      patterns.add(limits.join(''));quotas.add(limits.filter(limit=>limit===1).length)
    }
    expect(patterns.size).toBeGreaterThan(10);expect(quotas.size).toBeGreaterThan(2)
    expect([...patterns].some(pattern=>/11|22/.test(pattern))).toBe(true)
  })
  it('shares one local like state for list/detail, allows undo, and resets on a new visit', () => {
    const cards=createDemoPlazaCards(),detail=cards[1],initial=detail.likes
    toggleDemoLike(detail);expect(cards[1].liked).toBe(true);expect(cards[1].likes).toBe(initial+1)
    toggleDemoLike(detail);expect(cards[1].liked).toBe(false);expect(cards[1].likes).toBe(initial)
    toggleDemoLike(detail)
    expect(createDemoPlazaCards()[1]).toMatchObject({liked:false,likes:initial})
    expect(DEMO_PLAZA_POSTS[1].likes).toBe(initial)
  })
  it('has real fixture comment bodies and empty states, not invented server records', () => {
    const cards=createDemoPlazaCards()
    expect(cards[2].comments).toHaveLength(3);expect(cards[3].comments).toEqual([])
    for(const post of cards)for(const item of post.comments){expect(item.author).toBeTruthy();expect(item.text.length).toBeGreaterThan(10)}
    expect(cards[0].comments).not.toBe(DEMO_PLAZA_POSTS[0].comments)
  })
  it('uses the shared real feed in both modes; only fixed image generation remains demo-only', () => {
    const page=source('pages/PlazaPage.vue')
    expect(page).not.toContain('VITE_PROVIDED_PSD_DEMO')
    expect(page).not.toContain('DemoPlazaFeed')
    expect(page).toContain('<PlazaFeed')
    expect(page).toContain('listPlazaPosts(session.token)');expect(page).toContain('getPlazaPost(session.token,post.postId)')
    const feed=source('components/plaza/PlazaFeed.vue')
    for(const forbidden of ['reward-api','plaza-api','fetch(','localStorage','indexedDB','发布成功','发现','关注','演示作品与创作故事'])expect(feed).not.toContain(forbidden)
    expect(feed).toContain('handDrawnBorderStyles.btnPrimary');expect(feed).toContain('rewardAssets.communityCard')
    expect(feed).toContain('查看评论');expect(feed).toContain('还没有评论。');expect(feed).toContain('inset:300px 300px auto')
    expect(feed).toContain('aspect-ratio:1686/960');expect(feed).toContain('object-fit:contain')
  })
})
