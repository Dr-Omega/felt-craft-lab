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
    body: '点一下这个大大蘑菇，就能去选主题、开始做自己的毛毡小作品啦！',
    waitingHint: '先回到游戏大厅，找到中间的大蘑菇，点它一下～',
    bubbleSide: 'right'
  },
  {
    id: 'lobby-learning',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-learning"]',
    title: '学习树',
    body: '这边是学习树！想跟着小任务慢慢学，就点这里进去玩。',
    waitingHint: '回到大厅，点右边那棵会发光的学习树哦。',
    bubbleSide: 'left'
  },
  {
    id: 'lobby-share',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-share"]',
    title: '分享广场',
    body: '左边是分享板～别的小朋友做了什么，都可以在这里看到、点赞。',
    waitingHint: '回到大厅，点左边大大的分享区域试试看。',
    bubbleSide: 'right'
  },
  {
    id: 'lobby-profile',
    view: 'lobby',
    targetSelector: '[data-tour-id="tour-lobby-profile"]',
    title: '你的小头像',
    body: '点你的头像，就能进个人空间，看自己存过的作品和草稿。',
    waitingHint: '回到大厅，点右上角你的头像框。',
    bubbleSide: 'left'
  },
  {
    id: 'library-new',
    view: 'library',
    targetSelector: '[data-tour-id="tour-library-new"]',
    title: '新建作品',
    body: '在这里点「新建作品」，选个喜欢的主题，画布就准备好啦！',
    waitingHint: '先点大厅的蘑菇进创作库，再点「新建作品」按钮。',
    bubbleSide: 'bottom'
  },
  {
    id: 'editor-add-image',
    view: 'editor',
    targetSelector: '[data-tour-id="tour-editor-add-image"]',
    title: '添加图片',
    body: '画画的地方在这里！点「添加图片」，可以把照片或素材放进作品里。',
    waitingHint: '先新建并进入编辑器，再点「添加图片」。',
    bubbleSide: 'left'
  },
  {
    id: 'create-asset',
    view: 'library',
    targetSelector: '[data-tour-id="tour-nav-create"]',
    title: '生成小素材',
    body: '想要 AI 帮你画小图案？点这里「生成作品」，进去说说你想要什么就好啦。',
    waitingHint: '先在大厅点蘑菇进创作库，在页面上方找到「生成作品」点一下。',
    bubbleSide: 'bottom'
  },
  {
    id: 'fabrication-start',
    view: 'library',
    targetSelector: '[data-tour-id="tour-nav-fabrication"]',
    title: '拆分工具',
    body: '想把一张图拆成好多层毛毡？点「拆分工具」进去，选图后点「开始处理」。',
    waitingHint: '在创作库页面上方点「拆分工具」，进去后再操作也可以先点这里认路～',
    bubbleSide: 'bottom'
  },
  {
    id: 'plaza-public',
    view: 'plaza',
    targetSelector: '[data-tour-id="tour-plaza-public"]',
    title: '广场逛逛',
    body: '这里是广场！点「公共空间」，看看大家分享的作品吧。',
    waitingHint: '从大厅进分享广场，再点「公共空间」标签。',
    bubbleSide: 'right'
  },
  {
    id: 'learning-guided',
    view: 'learning',
    targetSelector: '[data-tour-id="tour-learning-guided"]',
    title: '学习区任务',
    body: '选一个主题，点「进入引导创作」，跟着步骤做，就能解锁新素材！',
    waitingHint: '从大厅的学习树进来，选主题后点下面的大按钮。',
    bubbleSide: 'top'
  },
  {
    id: 'rewards-bear',
    view: 'rewards',
    targetSelector: '[data-tour-id="tour-rewards-bear"]',
    title: '成长中心',
    body: '做任务、登录会得钻石和金币，这里还能喂小熊、换装扮，超好玩！',
    waitingHint: '进个人空间 → 点「成长中心」→ 再点「小熊房间」标签。',
    bubbleSide: 'left',
    skipWhen: (role) => role === 'parent' || role === 'admin'
  },
  {
    id: 'profile-works',
    view: 'profile',
    targetSelector: '[data-tour-id="tour-profile-works"]',
    title: '我的作品',
    body: '个人空间里可以切换草稿、图画、完成作品，找东西超方便。',
    waitingHint: '点头像进个人空间，再点侧边「作品」图标。',
    bubbleSide: 'right'
  },
  {
    id: 'profile-story',
    view: 'profile',
    targetSelector: '[data-tour-id="tour-profile-story"]',
    title: '故事卡',
    body: '做完作品还可以录故事！点「故事卡」，看看你讲的小故事作品。',
    waitingHint: '在个人空间先点左边「作品」，再点「故事卡」小图标。',
    bubbleSide: 'right'
  }
]
