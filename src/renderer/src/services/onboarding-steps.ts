import type { AppView } from '../app-nav'

export type OnboardingBubbleSide = 'left' | 'right' | 'top' | 'bottom'

export interface OnboardingStep {
  id: string
  view: AppView
  targetSelector: string
  title: string
  body: string
  waitingHint: string
  bubbleSide: OnboardingBubbleSide
  /** Optional: skip this step (e.g. rewards only for child accounts). */
  skipWhen?: (role: string) => boolean
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'lobby-create',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-create"]',
    title: '创作蘑菇',
    body: '点一下这个大蘑菇，就能进入画布、开始做自己的毛毡小作品啦！',
    waitingHint: '正在回到游戏大厅…',
    bubbleSide: 'right'
  },
  {
    id: 'lobby-learning',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-learning"]',
    title: '学习树',
    body: '这边是学习树！想跟着小任务慢慢学，就点这里进去玩。',
    waitingHint: '正在回到游戏大厅…',
    bubbleSide: 'left'
  },
  {
    id: 'lobby-share',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-share"]',
    title: '分享广场',
    body: '左边是分享板～别的小朋友做了什么，都可以在这里看到、点赞。',
    waitingHint: '正在回到游戏大厅…',
    bubbleSide: 'right'
  },
  {
    id: 'lobby-profile',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-profile"]',
    title: '你的小头像',
    body: '点你的头像，就能进个人空间，看自己存过的作品和草稿。',
    waitingHint: '正在回到游戏大厅…',
    bubbleSide: 'left'
  },
  {
    id: 'editor-add-image', view: 'editor', targetSelector: '[data-tour-id="tour-editor-add-image"]',
    title: '添加图片', body: '点「添加图片」，可以上传照片，也可以说说想画什么，让 AI 帮你生成图案。',
    waitingHint: '正在打开创作画布…', bubbleSide: 'left'
  },
  {
    id: 'editor-material', view: 'editor', targetSelector: '[data-tour-id="tour-editor-material"]',
    title: '素材盒', body: '这里装着已经解锁的小素材，选一个放进画布，再拖到喜欢的位置。',
    waitingHint: '正在打开创作画布…', bubbleSide: 'left'
  },  {
    id: 'editor-background', view: 'editor', targetSelector: '[data-tour-id="tour-editor-background"]',
    title: '换个背景', body: '点这里挑选画布背景，让小作品有自己的故事场景。',
    waitingHint: '正在打开创作画布…', bubbleSide: 'left'
  },

  {
    id: 'plaza-public',
    view: 'plaza',
    targetSelector: '[data-tour-id="tour-plaza-public"]',
    title: '广场逛逛',
    body: '这里是童创空间，看看大家分享的作品吧。自己的草稿和作品可以在个人中心找到。',
    waitingHint: '正在打开分享广场…',
    bubbleSide: 'right'
  },
  {
    id: 'learning-guided',
    view: 'learning',
    targetSelector: '[data-tour-id="tour-learning-guided"]',
    title: '学习区任务',
    body: '选一个主题，点「进入引导教学」，跟着步骤做，就能解锁新素材！',
    waitingHint: '正在打开学习区…',
    bubbleSide: 'top'
  },
  {
    id: 'rewards-bear',
    view: 'rewards',
    targetSelector: '[data-tour-id="tour-rewards-bear"]',
    title: '成长中心',
    body: '这里是小熊的家！可以选食物喂小熊，还能切换沙发场景。',
    waitingHint: '正在打开成长中心…',
    bubbleSide: 'left',
    skipWhen: (role) => role !== 'child'
  },
  {
    id: 'profile-works',
    view: 'profile',
    targetSelector: '[data-tour-id="tour-profile-works"]',
    title: '我的作品',
    body: '个人空间里可以切换草稿、图画、完成作品，找东西超方便。',
    waitingHint: '正在打开个人空间…',
    bubbleSide: 'right'
  },
  {
    id: 'profile-story',
    view: 'profile',
    targetSelector: '[data-tour-id="tour-profile-story"]',
    title: '故事卡',
    body: '做完作品还可以录故事！点「故事卡」，看看你讲的小故事作品。',
    waitingHint: '正在打开个人空间…',
    bubbleSide: 'right'
  }
]
