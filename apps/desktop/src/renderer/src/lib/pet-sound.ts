/**
 * 桌宠音效合成器。
 *
 * 用 Web Audio API 实时合成简短提示音，避免引入音频资源依赖。
 * 所有音频只在用户已开启 soundEnabled 时实际发声。
 */

type SoundKind = "hover" | "click" | "drop" | "happy" | "error";

interface ActiveNode {
  oscillator: OscillatorNode;
  gain: GainNode;
  stopAt: number;
}

export class PetSoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: ActiveNode[] = [];
  private muted = true;

  /** 设置静音状态（来自 snapshot.config.interaction.soundEnabled） */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) {
      this.master.gain.value = muted ? 0 : 0.18;
    }
  }

  /** 播放一个音效（如果静音则直接返回） */
  play(kind: SoundKind): void {
    if (this.muted) return;
    if (typeof window === "undefined") return;
    const AudioCtor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.18;
        this.master.connect(this.ctx.destination);
      } catch {
        return;
      }
    }

    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }

    const now = this.ctx.currentTime;
    const profile = PROFILES[kind];
    for (const note of profile) {
      this.scheduleNote(note, now);
    }
  }

  /** 在应用退出 / 桌宠销毁时调用，释放 AudioContext */
  dispose(): void {
    for (const entry of this.active) {
      try {
        entry.oscillator.stop();
      } catch {
        // ignore
      }
    }
    this.active = [];
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.master = null;
    }
  }

  private scheduleNote(note: NoteSpec, baseTime: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.startHz, baseTime + note.at);
    if (note.endHz != null) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, note.endHz),
        baseTime + note.at + note.duration,
      );
    }
    gain.gain.setValueAtTime(0, baseTime + note.at);
    gain.gain.linearRampToValueAtTime(note.peak, baseTime + note.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + note.at + note.duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(baseTime + note.at);
    osc.stop(baseTime + note.at + note.duration + 0.05);
    const stopAt = baseTime + note.at + note.duration + 0.05;
    this.active.push({ oscillator: osc, gain, stopAt });
    osc.onended = (): void => {
      this.active = this.active.filter((entry) => entry.oscillator !== osc);
    };
  }
}

interface NoteSpec {
  type: OscillatorType;
  startHz: number;
  endHz?: number;
  duration: number;
  peak: number;
  /** 距 baseTime 的偏移（秒） */
  at: number;
}

const PROFILES: Record<SoundKind, NoteSpec[]> = {
  hover: [{ type: "sine", startHz: 880, duration: 0.06, peak: 0.4, at: 0 }],
  click: [
    { type: "triangle", startHz: 660, endHz: 990, duration: 0.08, peak: 0.5, at: 0 },
    { type: "sine", startHz: 1320, duration: 0.06, peak: 0.25, at: 0.04 },
  ],
  drop: [{ type: "sine", startHz: 660, endHz: 330, duration: 0.14, peak: 0.45, at: 0 }],
  happy: [
    { type: "triangle", startHz: 660, duration: 0.08, peak: 0.4, at: 0 },
    { type: "triangle", startHz: 880, duration: 0.08, peak: 0.4, at: 0.08 },
    { type: "triangle", startHz: 1320, duration: 0.16, peak: 0.45, at: 0.16 },
  ],
  error: [
    { type: "square", startHz: 220, duration: 0.1, peak: 0.35, at: 0 },
    { type: "square", startHz: 180, duration: 0.18, peak: 0.4, at: 0.12 },
  ],
};
