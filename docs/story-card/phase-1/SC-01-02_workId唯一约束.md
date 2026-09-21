# SC-01-02：`workId` 唯一约束

**状态：** 已实现并通过专项测试，待后续任务接入正式确认流程  
**前置依赖：** SC-01-01 故事卡领域模型与仓储接口  
**范围：** 为正式故事卡建立以 `workId` 为主键的持久化唯一约束，并提供最小创建／覆盖仓储实现。

## 实现

- Dexie 数据库升级至版本 2，新增 `storyCards` 表，主键为 `workId`。
- `StoryCardStore.create` 使用新增操作；同一 `workId` 重复创建会被数据库拒绝。
- `StoryCardStore.replace` 使用覆盖操作；同一 `workId` 的新确认内容覆盖原卡，不新增记录。

## 非目标

- 不校验作品是否存在或是否完成；
- 不读取作品上下文；
- 不实现作品图片同步；
- 不实现录音、故事整理或正式确认服务入口。

## 验证方式

运行 `pnpm exec vitest run tests/persistence/story-card-store.test.ts`：重复创建同一 `workId` 必须失败，覆盖后表内仍只有一条记录，且查询结果为最新内容。
