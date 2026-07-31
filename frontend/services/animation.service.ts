/**
 * AnimationService — 组长交付，SXY 只负责在页面事件后调用
 *
 * play(eventKey, target?)
 * stop(eventKey?)
 *
 * 资源：开发期用公开示例 Lottie；正式由 YWN 交付后替换映射表即可。
 */

export type AnimationEventKey = "collect" | "save" | "loading" | string;

export interface AnimationService {
  play(eventKey: string, target?: HTMLElement | null): Promise<void>;
  stop(eventKey?: string): void;
}

type LottieAnimationItem = {
  destroy: () => void;
  stop: () => void;
  play: () => void;
  addEventListener: (name: string, cb: () => void) => void;
};

type LottiePlayer = {
  loadAnimation: (opts: Record<string, unknown>) => LottieAnimationItem;
};

/** eventKey → Lottie JSON 地址（后续可改为本地 YWN 资源） */
export const DEFAULT_LOTTIE_MAP: Record<string, string> = {
  collect:
    "https://assets1.lottiefiles.com/packages/lf20_jbrw3hcz.json",
  save:
    "https://assets1.lottiefiles.com/packages/lf20_jbrw3hcz.json",
  loading:
    "https://assets9.lottiefiles.com/packages/lf20_p8bfn5to.json",
};

function getLottie(): LottiePlayer {
  const g = globalThis as unknown as { lottie?: LottiePlayer };
  if (!g.lottie) {
    throw new Error("lottie-web 未加载");
  }
  return g.lottie;
}

export class LottieAnimationService implements AnimationService {
  private running = new Map<string, LottieAnimationItem>();
  private overlayHosts = new Map<string, HTMLElement>();
  private map: Record<string, string>;

  constructor(map: Record<string, string> = DEFAULT_LOTTIE_MAP) {
    this.map = { ...map };
  }

  /** 允许后续用 YWN 资源索引覆盖 */
  setResourceMap(map: Record<string, string>): void {
    this.map = { ...this.map, ...map };
  }

  async play(eventKey: string, target?: HTMLElement | null): Promise<void> {
    const path = this.map[eventKey];
    if (!path) {
      console.warn("[AnimationService] unknown eventKey:", eventKey);
      return;
    }

    this.stop(eventKey);

    const host = this.resolveHost(eventKey, target);
    const loop = eventKey === "loading";

    try {
      const lottie = getLottie();
      const anim = lottie.loadAnimation({
        container: host,
        renderer: "svg",
        loop,
        autoplay: true,
        path,
      });
      this.running.set(eventKey, anim);

      if (loop) {
        // loading：调用方自行 stop；这里不自动结束
        return;
      }

      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          this.stop(eventKey);
          resolve();
        };
        anim.addEventListener("complete", finish);
        // 兜底：极端情况下 complete 不触发
        setTimeout(finish, 4000);
      });
    } catch (e) {
      console.warn("[AnimationService] play failed:", eventKey, e);
      this.cleanupHost(eventKey);
    }
  }

  stop(eventKey?: string): void {
    if (!eventKey) {
      for (const key of [...this.running.keys()]) {
        this.stop(key);
      }
      return;
    }
    const anim = this.running.get(eventKey);
    if (anim) {
      try {
        anim.stop();
        anim.destroy();
      } catch {
        // ignore
      }
      this.running.delete(eventKey);
    }
    this.cleanupHost(eventKey);
  }

  private resolveHost(eventKey: string, target?: HTMLElement | null): HTMLElement {
    if (target) return target;

    let host = this.overlayHosts.get(eventKey);
    if (host && document.body.contains(host)) return host;

    host = document.createElement("div");
    host.dataset.animKey = eventKey;
    host.style.cssText = [
      "position:fixed",
      "right:24px",
      "bottom:24px",
      "width:120px",
      "height:120px",
      "z-index:9999",
      "pointer-events:none",
    ].join(";");
    document.body.appendChild(host);
    this.overlayHosts.set(eventKey, host);
    return host;
  }

  private cleanupHost(eventKey: string): void {
    const host = this.overlayHosts.get(eventKey);
    if (!host) return;
    // 仅清理我们自动创建的浮层
    if (!host.dataset.animKey) return;
    try {
      host.remove();
    } catch {
      // ignore
    }
    this.overlayHosts.delete(eventKey);
  }
}

export const animationService: AnimationService = new LottieAnimationService();
