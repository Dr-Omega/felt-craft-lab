import publicDemo1 from '../../../../assets/demo/plaza/demo-plaza-mid-autumn-1.png'
import publicDemo2 from '../../../../assets/demo/plaza/demo-plaza-mid-autumn-2.png'
import personalDemo1 from '../../../../assets/demo/plaza/demo-plaza-personal-1.png'
import personalDemo2 from '../../../../assets/demo/plaza/demo-plaza-personal-2.png'

export type PlazaV2DemoCard = {
  id: string
  title: string
  meta: string
  thumbUrl: string
  /** UI-only sample; actions show toasts except 展示 when scene wired later. */
  sampleKind: 'draft' | 'project'
  sharedToPublic?: boolean
}

export const PLAZA_V2_PUBLIC_DEMO_CARDS: PlazaV2DemoCard[] = [
  {
    id: 'public-demo-1',
    title: '中秋示例一',
    meta: '小艺 · 示例作品',
    thumbUrl: publicDemo1,
    sampleKind: 'project'
  },
  {
    id: 'public-demo-2',
    title: '中秋示例二',
    meta: '阿星 · 示例作品',
    thumbUrl: publicDemo2,
    sampleKind: 'project'
  }
]

export const PLAZA_V2_PERSONAL_DEMO_CARDS: PlazaV2DemoCard[] = [
  {
    id: 'personal-demo-1',
    title: '我的灯河小景',
    meta: '3 天前 · 草稿',
    thumbUrl: personalDemo1,
    sampleKind: 'draft'
  },
  {
    id: 'personal-demo-2',
    title: '灯会街景作品',
    meta: '1 周前 · 作品',
    thumbUrl: personalDemo2,
    sampleKind: 'project',
    sharedToPublic: false
  }
]
