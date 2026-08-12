# QA Core handoff

阶段4 Core只提供Renderer-facing多轮文字问答Contract，不包含聊天UI或会话持久化。

```ts
const result = await aiClient.qaAsk({
  question,
  asset,
  history
})
```

`history`由当前素材的Renderer会话维护，元素为：

```ts
{ role: 'user' | 'assistant', content: string }
```

客户端请求最多携带最近6个完整问答轮次（12条消息），单条最多500字符。Renderer只在回答成功后追加user和assistant两条消息；请求失败不追加半轮。关闭问答面板或切换素材时清空history。

Core会通过Preload/Main发送结构化history。Backend会再次校验并只投影`assetId`、`nameZh`、`introZh`、`themeId`，禁止`system` role和未知asset字段进入模型上下文。响应仍为已校验的`QaResult`，安全结果继续使用`allow`、`redirect`、`reject`。

语音输入沿用现有：

```text
MediaRecorder → Blob/Base64 → aiClient.asrTranscribe → transcript输入框
→ 用户确认/修改 → aiClient.qaAsk
```

ASR不会自动发送QA。QA history不写入SceneDocument、Draft、Project或Dexie；ASR的`sessionId`也不是QA Conversation ID。
