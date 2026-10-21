import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../src/main/ai/gateway-client',()=>({gatewayJson:vi.fn().mockResolvedValue({ok:true,status:201,body:{ok:true,result:{}}})}))
import { gatewayJson } from '../../src/main/ai/gateway-client'
import { plazaPublishPost } from '../../src/main/plaza/gateway-plaza'
import { plazaRewardAction } from '../../src/main/plaza/gateway-rewards'
beforeEach(()=>vi.clearAllMocks())
it('carries a real confirmed story snapshot through multipart publishing',async()=>{
  await plazaPublishPost({token:'test-token',projectId:'project',title:'画面',previewBytes:Buffer.from([137,80,78,71]),storyTitle:'故事标题',storyText:'真实发布正文'})
  const [url,options]=vi.mocked(gatewayJson).mock.calls[0]
  expect(url).toBe('/api/plaza/posts')
  const form=options?.body as FormData
  expect(form.get('storyTitle')).toBe('故事标题');expect(form.get('storyText')).toBe('真实发布正文')
  expect(form.get('projectId')).toBe('project');expect(form.get('file')).toBeInstanceOf(Blob)
})
it('maps unlike to authenticated DELETE rather than another rewarding POST',async()=>{
  await plazaRewardAction({token:'test-token',action:'unlike',payload:{postId:'p/1'}})
  expect(gatewayJson).toHaveBeenCalledWith('/api/plaza/posts/p%2F1/like',expect.objectContaining({method:'DELETE',plazaUserToken:'test-token'}))
})
