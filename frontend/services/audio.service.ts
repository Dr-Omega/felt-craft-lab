/**
 * AudioService — 组长交付，SXY 在页面里调用
 *
 * 规则（规范 9.4）：
 * - primary：主要朗读（名称/介绍/问答语音）；新播放前先停旧的
 * - effect：操作音效；可与 primary 并行；可被总开关关闭
 * - 播放失败不抛到页面业务层，避免挡住文字展示
 */

export type AudioChannel = "primary" | "effect";

export interface AudioService {
  play(url: string, channel?: AudioChannel): Promise<void>;
  stop(channel?: AudioChannel): void;
  setEffectsEnabled(enabled: boolean): void;
}

type HowlInstance = {
  play: () => number | undefined;
  stop: () => void;
  unload: () => void;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
};

type HowlConstructor = new (options: Record<string, unknown>) => HowlInstance;

function getHowl(): HowlConstructor {
  const g = globalThis as unknown as { Howl?: HowlConstructor };
  if (!g.Howl) {
    throw new Error("Howler.js 未加载：请先引入 howler");
  }
  return g.Howl;
}

export class HowlerAudioService implements AudioService {
  private primary: HowlInstance | null = null;
  private effect: HowlInstance | null = null;
  private effectsEnabled = true;

  async play(url: string, channel: AudioChannel = "primary"): Promise<void> {
    if (!url) return;
    if (channel === "effect" && !this.effectsEnabled) return;

    try {
      if (channel === "primary") {
        this.stop("primary");
        this.primary = this.createHowl(url);
        await this.playHowl(this.primary);
        return;
      }

      // effect：不打断 primary
      this.stop("effect");
      this.effect = this.createHowl(url);
      await this.playHowl(this.effect);
    } catch {
      // 音频失败不得阻塞文字展示
      console.warn("[AudioService] play failed:", url);
    }
  }

  stop(channel?: AudioChannel): void {
    if (!channel || channel === "primary") {
      this.dispose("primary");
    }
    if (!channel || channel === "effect") {
      this.dispose("effect");
    }
  }

  setEffectsEnabled(enabled: boolean): void {
    this.effectsEnabled = Boolean(enabled);
    if (!this.effectsEnabled) {
      this.stop("effect");
    }
  }

  private createHowl(url: string): HowlInstance {
    const Howl = getHowl();
    return new Howl({
      src: [url],
      html5: true, // 远程 mp3 / 较长语音更稳
      preload: true,
    });
  }

  private playHowl(sound: HowlInstance): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      sound.on("end", done);
      sound.on("loaderror", done);
      sound.on("playerror", done);
      try {
        sound.play();
      } catch {
        done();
      }
    });
  }

  private dispose(channel: AudioChannel): void {
    const current = channel === "primary" ? this.primary : this.effect;
    if (!current) return;
    try {
      current.stop();
      current.unload();
    } catch {
      // ignore
    }
    if (channel === "primary") this.primary = null;
    else this.effect = null;
  }
}

/** 默认单例，页面直接用 */
export const audioService: AudioService = new HowlerAudioService();
