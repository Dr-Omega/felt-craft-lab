# 前端技术封装（组长）

## AudioService（第 6 步）

路径：
- `frontend/services/audio.service.ts`（给正式工程引用）
- `frontend/services/audio.service.js`（demo / 无打包环境）

接口：

```ts
play(url: string, channel?: 'primary' | 'effect'): Promise<void>
stop(channel?: 'primary' | 'effect'): void
setEffectsEnabled(enabled: boolean): void
```

规则：
- 新的 `primary` 会先停旧的 `primary`
- `effect` 不打断 `primary`
- 播放失败只打日志，不抛错（文字仍可显示）

## AnimationService（第 7 步）

路径：
- `frontend/services/animation.service.ts`
- `frontend/services/animation.service.js`

接口：

```ts
play(eventKey: string, target?: HTMLElement): Promise<void>
stop(eventKey?: string): void
```

预置 eventKey：`collect` / `save` / `loading`  
演示：http://127.0.0.1:8788/demo/animation
