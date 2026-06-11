import type { Judgment } from "./types";
import type { InputJudge } from "./input";

const LANE_COLORS: [string, string, string, string] = [
  "#5fc3b5", // teal - low
  "#a48cd1", // lavender
  "#d4b46a", // gold
  "#d77a8c", // rose - high
];

const JUDGMENT_COLORS: Record<Judgment, string> = {
  perfect: "#fff7d4",
  great: "#b8f0c8",
  good: "#aed4ff",
  miss: "#ff8a8a",
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingJudge {
  text: string;
  color: string;
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

export interface RenderOptions {
  approachTimeSec: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private floats: FloatingJudge[] = [];
  private dpr = window.devicePixelRatio || 1;
  private w = 0;
  private h = 0;
  private playW = 0;
  private playX = 0;
  private laneW = 0;
  private hitY = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: RenderOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** Live-tweak the visual approach time (note fall speed) without
   * affecting judgment timing. */
  setApproachTime(seconds: number): void {
    this.opts.approachTimeSec = Math.max(0.3, Math.min(5.0, seconds));
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.playW = Math.min(560, Math.max(360, this.w * 0.46));
    this.playX = (this.w - this.playW) / 2;
    this.laneW = this.playW / 4;
    this.hitY = this.h - Math.max(120, this.h * 0.16);
  }

  clearEffects(): void {
    this.particles = [];
    this.floats = [];
  }

  spawnHit(lane: 0 | 1 | 2 | 3, judgment: Judgment, deltaMs: number): void {
    const cx = this.playX + (lane + 0.5) * this.laneW;
    const color = LANE_COLORS[lane];
    const burst = judgment === "perfect" ? 22 : judgment === "great" ? 16 : 10;
    for (let i = 0; i < burst; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 180;
      this.particles.push({
        x: cx,
        y: this.hitY,
        vx: Math.cos(a) * s * 0.5,
        vy: Math.sin(a) * s * 0.5 - 120,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.3,
        color,
        size: 2 + Math.random() * 3,
      });
    }
    const txt = judgment.toUpperCase();
    this.floats.push({
      text: txt,
      color: JUDGMENT_COLORS[judgment],
      x: cx,
      y: this.hitY - 30,
      life: 0,
      maxLife: 0.7,
    });
    if (judgment !== "perfect") {
      // small timing-debug tick on screen
      const sign = deltaMs < 0 ? "early" : "late";
      this.floats.push({
        text: `${Math.abs(deltaMs).toFixed(0)}ms ${sign}`,
        color: "#8c9bb3",
        x: cx,
        y: this.hitY - 8,
        life: 0,
        maxLife: 0.6,
      });
    }
  }

  spawnMiss(lane: 0 | 1 | 2 | 3): void {
    const cx = this.playX + (lane + 0.5) * this.laneW;
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 30,
        y: this.hitY,
        vx: (Math.random() - 0.5) * 40,
        vy: 30 + Math.random() * 40,
        life: 0,
        maxLife: 0.5,
        color: "#ff8a8a",
        size: 2,
      });
    }
    this.floats.push({
      text: "MISS",
      color: JUDGMENT_COLORS.miss,
      x: cx,
      y: this.hitY - 30,
      life: 0,
      maxLife: 0.6,
    });
  }

  draw(songTime: number, input: InputJudge, dt: number, elapsed: number): void {
    const ctx = this.ctx;

    this.drawBackground(elapsed);

    ctx.save();
    const playH = this.h;
    const r = 14;
    ctx.beginPath();
    roundRect(ctx, this.playX, 0, this.playW, playH, r);
    ctx.clip();

    ctx.fillStyle = "rgba(10, 14, 30, 0.55)";
    ctx.fillRect(this.playX, 0, this.playW, playH);

    for (let lane = 0; lane < 4; lane++) {
      const x = this.playX + lane * this.laneW;
      const held = input.held[lane];
      const grad = ctx.createLinearGradient(x, 0, x, playH);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(1, held ? hexToRgba(LANE_COLORS[lane], 0.22) : "rgba(255,255,255,0.03)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, this.laneW, playH);
      if (lane > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x - 0.5, 0, 1, playH);
      }
    }

    const hitGrad = ctx.createLinearGradient(0, this.hitY - 30, 0, this.hitY + 30);
    hitGrad.addColorStop(0, "rgba(255,255,255,0)");
    hitGrad.addColorStop(0.5, "rgba(255,255,255,0.18)");
    hitGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hitGrad;
    ctx.fillRect(this.playX, this.hitY - 30, this.playW, 60);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.playX, this.hitY);
    ctx.lineTo(this.playX + this.playW, this.hitY);
    ctx.stroke();

    const approach = this.opts.approachTimeSec;
    const noteH = 18;
    for (let lane = 0; lane < 4; lane++) {
      const x = this.playX + lane * this.laneW + 6;
      const w = this.laneW - 12;
      const color = LANE_COLORS[lane];
      const pending = input.pendingByLane(lane as 0 | 1 | 2 | 3);
      for (const n of pending) {
        const dt2 = n.time - songTime;
        if (dt2 > approach) break;
        if (dt2 < -0.2) continue;
        const progress = 1 - dt2 / approach;
        const y = progress * this.hitY - noteH / 2;
        if (y < -noteH) continue;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = color;
        roundRect(ctx, x, y, w, noteH, 6);
        ctx.fill();
        ctx.restore();
      }
    }

    for (let lane = 0; lane < 4; lane++) {
      if (!input.held[lane]) continue;
      const cx = this.playX + (lane + 0.5) * this.laneW;
      const r2 = this.laneW * 0.45;
      const g = ctx.createRadialGradient(cx, this.hitY, 0, cx, this.hitY, r2);
      g.addColorStop(0, hexToRgba(LANE_COLORS[lane], 0.55));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, this.hitY, r2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    this.updateAndDrawParticles(dt);
    this.updateAndDrawFloats(dt);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const keys = ["D", "F", "J", "K"];
    for (let lane = 0; lane < 4; lane++) {
      const cx = this.playX + (lane + 0.5) * this.laneW;
      ctx.fillText(keys[lane], cx, this.hitY + 50);
    }
  }

  private drawBackground(elapsed: number): void {
    const ctx = this.ctx;
    const phase = elapsed * 0.04;
    const c1 = `hsl(${(220 + Math.sin(phase) * 15) | 0}, 35%, 8%)`;
    const c2 = `hsl(${(260 + Math.cos(phase * 0.7) * 25) | 0}, 30%, 12%)`;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 3; i++) {
      const t = elapsed * 0.05 + i * 2.1;
      const cx = this.w * (0.5 + 0.35 * Math.sin(t));
      const cy = this.h * (0.45 + 0.3 * Math.cos(t * 0.9));
      const r = Math.max(this.w, this.h) * 0.45;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, ["#5fc3b5", "#a48cd1", "#d4b46a"][i]);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  private updateAndDrawParticles(dt: number): void {
    const ctx = this.ctx;
    const survivors: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.vy += 220 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.life / p.maxLife;
      ctx.fillStyle = hexToRgba(p.color, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      survivors.push(p);
    }
    this.particles = survivors;
  }

  private updateAndDrawFloats(dt: number): void {
    const ctx = this.ctx;
    const survivors: FloatingJudge[] = [];
    for (const f of this.floats) {
      f.life += dt;
      if (f.life >= f.maxLife) continue;
      const a = 1 - f.life / f.maxLife;
      const dy = -40 * (f.life / f.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = f.color;
      ctx.font = "700 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y + dy);
      ctx.restore();
      survivors.push(f);
    }
    this.floats = survivors;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexToRgba(hex: string, a: number): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
