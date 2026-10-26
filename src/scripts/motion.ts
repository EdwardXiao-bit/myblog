/**
 * 进场与反馈。
 * 原则（Emil 式）：只动 opacity / transform；内容默认可见，脚本可用时才隐藏；
 * 每次进场只播一次；减少动态偏好的用户直接看成品。
 */

const doc = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

// 同一个容器里的元素按顺序错开 60ms，形成「写下来」的节奏
const seen = new Map<Element, number>();
for (const el of targets) {
  const parent = el.parentElement ?? document.body;
  const index = seen.get(parent) ?? 0;
  el.style.setProperty('--i', String(index % 7));
  el.classList.add('reveal');
  seen.set(parent, index + 1);
}

if (!('IntersectionObserver' in window) || reduceMotion) {
  for (const el of targets) el.classList.add('is-in');
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.12 },
  );

  for (const el of targets) io.observe(el);

  // 首屏元素不等滚动，直接播（用户已经看到它们了）
  requestAnimationFrame(() => {
    for (const el of targets) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.9) el.classList.add('is-in');
    }
  });
}

// 页面从 bfcache 恢复时，进场状态可能停在半途：直接补齐
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  for (const el of targets) el.classList.add('is-in');
});

// 让外部链接有一致的按压反馈（CSS 负责视觉，这里只补键盘可达的按下态）
for (const el of document.querySelectorAll<HTMLElement>('a[href^="http"], button')) {
  el.addEventListener('pointerdown', () => el.setAttribute('data-pressed', ''));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
    el.addEventListener(type, () => el.removeAttribute('data-pressed'));
  }
}

// 滚动视差：图片相对页面轻轻移动一点，给出「纸面上的照片」的纵深。
// 每帧一次「先读后写」：先把所有 rect 读完，再统一写 transform。
// 旧版本在同一个循环里交替读写，每个元素都会触发一次强制同步布局（页面上最多 7 次）。
const drifts = Array.from(document.querySelectorAll<HTMLElement>("[data-drift]"));

if (drifts.length > 0 && !reduceMotion) {
  let queued = false;
  const rects = new Array<DOMRect>(drifts.length);

  const place = () => {
    queued = false;
    const vh = window.innerHeight;

    for (let i = 0; i < drifts.length; i++) rects[i] = drifts[i].getBoundingClientRect();

    for (let i = 0; i < drifts.length; i++) {
      const rect = rects[i];
      const el = drifts[i];
      if (rect.bottom < -80 || rect.top > vh + 80) {
        if (el.style.transform) el.style.transform = "";
        continue;
      }
      const mid = rect.top + rect.height / 2;
      const ratio = Math.max(-1, Math.min(1, (mid - vh / 2) / vh));
      el.style.transform = `translate3d(0, ${(-ratio * 18).toFixed(2)}px, 0)`;
    }
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(place);
  };

  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue, { passive: true });
  queue();
}

// 卡片立体倾斜：鼠标在卡片里的位置决定 rotateX / rotateY，附一点抬升和放大。
// 只在有真实指针的设备上跑；减少动态偏好直接跳过（悬停仍有底色、标题变色和图上缩放）。
if (!reduceMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  const TILT = 5.5; // 最大倾角，度
  const LIFT = 4; // 抬升，px
  const SCALE = 1.02;

  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-tilt]"));
  let active: HTMLElement | null = null;
  let activeRect: DOMRect | null = null;

  const clear = (el: HTMLElement) => {
    el.style.transition = "transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)";
    el.style.transform = "";
  };

  for (const el of cards) {
    let frame = 0;
    let px = 0;
    let py = 0;

    const write = () => {
      frame = 0;
      if (el !== active) return;
      el.style.transform =
        `perspective(900px) ` +
        `rotateX(${(-py * TILT * 2).toFixed(2)}deg) ` +
        `rotateY(${(px * TILT * 2).toFixed(2)}deg) ` +
        `translateY(${-LIFT}px) scale(${SCALE})`;
    };

    const track = (event: PointerEvent) => {
      if (!activeRect || activeRect.width === 0) return;
      px = (event.clientX - activeRect.left) / activeRect.width - 0.5;
      py = (event.clientY - activeRect.top) / activeRect.height - 0.5;
      if (!frame) frame = requestAnimationFrame(write);
    };

    el.addEventListener("pointerenter", (event) => {
      active = el;
      activeRect = el.getBoundingClientRect();
      el.style.transition = "transform 120ms linear";
      track(event);
    });

    el.addEventListener("pointermove", (event) => {
      if (active === el) track(event);
    });

    el.addEventListener("pointerleave", () => {
      active = null;
      activeRect = null;
      cancelAnimationFrame(frame);
      frame = 0;
      clear(el);
    });
  }

  // 滚动或缩放后卡片的矩形变了，追着鼠标那次记录就失效：重算一次
  const refresh = () => {
    if (active) activeRect = active.getBoundingClientRect();
  };
  window.addEventListener("scroll", refresh, { passive: true });
  window.addEventListener("resize", refresh, { passive: true });
}

// 锚点跳转：平滑只留给「点击页内锚点」这种真实意图。
// 全局 scroll-behavior: smooth 会让滚轮每一格都变成动画，跟手感全没了。
if (!reduceMotion) {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
    if (!(link instanceof HTMLAnchorElement)) return;
    const id = link.getAttribute("href")!.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  });
}

doc.dataset.motion = reduceMotion ? 'reduce' : 'on';
