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
// 只动 transform，一帧最多算一次；减少动态偏好下完全不动。
const drifts = Array.from(document.querySelectorAll<HTMLElement>('[data-drift]'));

if (drifts.length > 0 && !reduceMotion) {
  let queued = false;

  const place = () => {
    queued = false;
    const vh = window.innerHeight;
    for (const el of drifts) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -80 || rect.top > vh + 80) continue;
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

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue, { passive: true });
  place();
}

doc.dataset.motion = reduceMotion ? 'reduce' : 'on';
