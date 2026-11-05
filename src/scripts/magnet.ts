/**
 * 磁吸悬浮 + 按压缩放：指针在元素内移动时，元素整体朝指针轻微偏移；
 * 按下时缩一点点，松开回弹。位移与缩放都放在同一个 rAF 里，
 * 不和其他动画抢 transform；reduced-motion 或非精细指针时完全不动。
 *
 * 用法：
 *   <div data-magnet>…</div>
 *   initMagnets();                       // 页面里所有 [data-magnet]
 *   attachMagnet(el, { lift: 0 });       // 或者单个元素自己调参
 *
 * 可选的 data 属性：data-magnet-pull / data-magnet-lift / data-magnet-press
 */

type MagnetOptions = {
  /** 横向位移幅度（px）：指针在边缘时最多偏移 pull / 2 */
  pullX?: number;
  pullY?: number;
  /** hover 时整体抬起多少 px */
  lift?: number;
  /** 按下时的缩放比例 */
  pressScale?: number;
};

const DEFAULTS: Required<MagnetOptions> = {
  pullX: 10,
  pullY: 8,
  lift: 3,
  pressScale: 0.985,
};

const LERP = 0.18;
const SCALE_LERP = 0.3;

export function attachMagnet(el: HTMLElement, options: MagnetOptions = {}) {
  const config = { ...DEFAULTS, ...options };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  type Box = { left: number; top: number; width: number; height: number };
  let box: Box | null = null;

  let x = 0;
  let y = 0;
  let scale = 1;
  let targetX = 0;
  let targetY = 0;
  let targetScale = 1;
  let frame = 0;
  let hovering = false;

  // getBoundingClientRect 会把当前 transform 算进去，直接拿它算偏移会自己推自己。
  // 所以留一份「没变形时」的盒子：测量时临时摘掉 transform，同一帧内还原，不会闪。
  const measure = () => {
    const prev = el.style.transform;
    el.style.transform = '';
    const rect = el.getBoundingClientRect();
    el.style.transform = prev;
    box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const render = () => {
    frame = 0;
    x += (targetX - x) * LERP;
    y += (targetY - y) * LERP;
    scale += (targetScale - scale) * SCALE_LERP;

    const settled =
      Math.abs(targetX - x) < 0.05 &&
      Math.abs(targetY - y) < 0.05 &&
      Math.abs(targetScale - scale) < 0.001;

    // 停稳又不在 hover 里：把 inline transform 摘掉，回到浏览器本来的布局（避免残留层）
    if (!hovering && Math.abs(targetScale - 1) < 0.001 && settled) {
      el.style.transform = '';
      return;
    }

    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    if (!settled) frame = requestAnimationFrame(render);
  };

  const kick = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  el.addEventListener('pointerenter', () => {
    if (!box) measure();
  });

  el.addEventListener('pointermove', (event) => {
    if (reduceMotion.matches || !finePointer.matches) return;
    if (!box) measure();
    const nx = (event.clientX - box!.left) / box!.width - 0.5;
    const ny = (event.clientY - box!.top) / box!.height - 0.5;
    targetX = nx * config.pullX;
    targetY = ny * config.pullY - config.lift;
    hovering = true;
    kick();
  });

  el.addEventListener('pointerdown', () => {
    if (reduceMotion.matches) return;
    targetScale = config.pressScale;
    kick();
  });

  const release = () => {
    targetScale = 1;
    kick();
  };

  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  el.addEventListener('pointerleave', () => {
    targetX = 0;
    targetY = 0;
    targetScale = 1;
    hovering = false;
    box = null; // 下次进入重新量，页面可能已经滚过
    kick();
  });

  window.addEventListener(
    'scroll',
    () => {
      if (hovering) box = null;
    },
    { passive: true },
  );
}

const num = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 给页面上所有 [data-magnet] 挂上磁吸；data-magnet-* 可以逐个调参 */
export function initMagnets(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-magnet]')) {
    attachMagnet(el, {
      pullX: num(el.dataset.magnetPull, DEFAULTS.pullX),
      pullY: num(el.dataset.magnetPull, DEFAULTS.pullY),
      lift: num(el.dataset.magnetLift, DEFAULTS.lift),
      pressScale: num(el.dataset.magnetPress, DEFAULTS.pressScale),
    });
  }
}
