/**
 * 浏览器 demo 专用 AudioService（非正式打包入口）
 * 正式实现：src/renderer/src/services/audio.service.ts
 * 语义：成功开始播放时 resolve；stop/替换会 settle 未完成 Promise
 */
(function (global) {
  function getHowl() {
    if (!global.Howl) throw new Error("Howler.js 未加载");
    return global.Howl;
  }

  function toPlayable(url) {
    if (global.toPlayableAudioUrl) return global.toPlayableAudioUrl(url);
    if (
      typeof url === "string" &&
      url.indexOf("felt-resource://audio/") === 0 &&
      !(global.window && global.window.electronAPI)
    ) {
      return "/generated-audio/" + url.slice("felt-resource://audio/".length);
    }
    return url;
  }

  function HowlerAudioService() {
    this.primary = null;
    this.effect = null;
    this.effectsEnabled = true;
    this.pending = {};
  }

  HowlerAudioService.prototype.play = async function (url, channel) {
    channel = channel || "primary";
    if (!url) return;
    if (channel === "effect" && !this.effectsEnabled) return;
    var playable = toPlayable(url);
    try {
      if (channel === "primary") {
        this.stop("primary");
        this.primary = this._create(playable);
        await this._play(this.primary, "primary");
        return;
      }
      this.stop("effect");
      this.effect = this._create(playable);
      await this._play(this.effect, "effect");
    } catch (e) {
      this._settle(channel);
      console.warn("[AudioService] play failed:", url, "→", playable, e);
    }
  };

  HowlerAudioService.prototype.stop = function (channel) {
    if (!channel || channel === "primary") {
      this._settle("primary");
      this._dispose("primary");
    }
    if (!channel || channel === "effect") {
      this._settle("effect");
      this._dispose("effect");
    }
  };

  HowlerAudioService.prototype.setEffectsEnabled = function (enabled) {
    this.effectsEnabled = !!enabled;
    if (!this.effectsEnabled) this.stop("effect");
  };

  HowlerAudioService.prototype._create = function (url) {
    var Howl = getHowl();
    return new Howl({ src: [url], html5: true, preload: true });
  };

  HowlerAudioService.prototype._play = function (sound, channel) {
    var self = this;
    return new Promise(function (resolve) {
      var settled = false;
      var done = function () {
        if (settled) return;
        settled = true;
        delete self.pending[channel];
        resolve();
      };
      self.pending[channel] = done;
      sound.on("play", done);
      sound.on("load", done);
      sound.on("loaderror", done);
      sound.on("playerror", done);
      sound.on("stop", done);
      try {
        sound.play();
      } catch (e) {
        done();
      }
    });
  };

  HowlerAudioService.prototype._settle = function (channel) {
    var done = this.pending[channel];
    if (!done) return;
    delete this.pending[channel];
    done();
  };

  HowlerAudioService.prototype._dispose = function (channel) {
    var cur = channel === "primary" ? this.primary : this.effect;
    if (!cur) return;
    try {
      cur.stop();
      cur.unload();
    } catch (e) {}
    if (channel === "primary") this.primary = null;
    else this.effect = null;
  };

  global.HowlerAudioService = HowlerAudioService;
})(typeof window !== "undefined" ? window : globalThis);
