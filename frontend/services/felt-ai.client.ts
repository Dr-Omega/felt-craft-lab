/**
 * 给 SXY 的轻量 HTTP 封装（TypeScript）
 * 详见 docs/ai-services/SXY对接指南.md
 */

export type AssetBrief = {
  assetId: string;
  nameZh: string;
  introZh: string;
  themeId: string;
};

export class FeltAiClient {
  baseUrl: string;

  constructor(baseUrl = "http://127.0.0.1:8788") {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
  }

  health() {
    return this.getJson("/api/health");
  }

  async transcribe(
    audioBlob: Blob,
    options: {
      filename?: string;
      language?: string;
      sessionId?: string;
      provider?: string;
    } = {}
  ) {
    const form = new FormData();
    form.append("file", audioBlob, options.filename || "recording.webm");
    if (options.language) form.append("language", options.language);
    if (options.sessionId) form.append("sessionId", options.sessionId);
    if (options.provider) form.append("provider", options.provider);
    const res = await fetch(`${this.baseUrl}/api/asr/transcribe`, {
      method: "POST",
      body: form,
    });
    return res.json();
  }

  ask(input: { question: string; asset: AssetBrief; provider?: string }) {
    return this.postJson("/api/qa/ask", input);
  }

  synthesize(
    text: string,
    voicePurpose: "qa_answer" = "qa_answer",
    provider?: string
  ) {
    return this.postJson("/api/tts/synthesize", {
      text,
      voicePurpose,
      provider,
    });
  }

  resolveAudioUrl(audioUrl: string) {
    if (!audioUrl) return "";
    if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
    return `${this.baseUrl}${audioUrl.startsWith("/") ? "" : "/"}${audioUrl}`;
  }

  private async getJson(path: string) {
    const res = await fetch(`${this.baseUrl}${path}`);
    return res.json();
  }

  private async postJson(path: string, body: unknown) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return res.json();
  }
}

export default FeltAiClient;
