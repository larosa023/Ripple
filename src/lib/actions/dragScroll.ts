// Click-and-drag horizontal panning for rows, with momentum on release.
// A press that moves less than a few pixels is still a normal click.

const THRESHOLD = 6; // px before a press counts as a drag
const FRICTION = 0.93; // momentum decay per frame

function reducedMotion() {
  return document.documentElement.dataset.motion === 'reduce';
}

export function dragScroll(node: HTMLElement) {
  let pointerId = -1;
  let startX = 0;
  let startScroll = 0;
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0; // px per ms
  let raf = 0;

  function stopMomentum() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function onDown(e: PointerEvent) {
    // Mouse/pen left button only; touch already scrolls natively.
    if (e.pointerType === 'touch' || e.button !== 0) return;
    stopMomentum();
    pointerId = e.pointerId;
    startX = lastX = e.clientX;
    lastT = performance.now();
    startScroll = node.scrollLeft;
    dragging = false;
    velocity = 0;
  }

  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    if (!dragging) {
      if (Math.abs(dx) < THRESHOLD) return;
      dragging = true;
      node.setPointerCapture(pointerId);
      node.classList.add('dragging');
    }
    node.scrollLeft = startScroll - dx;
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) velocity = 0.8 * ((lastX - e.clientX) / dt) + 0.2 * velocity;
    lastX = e.clientX;
    lastT = now;
  }

  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    if (!dragging) return;
    node.classList.remove('dragging');
    if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    // Swallow the click that follows a drag so the grabbed card doesn't open.
    const swallow = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    node.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 0);
    dragging = false;

    if (reducedMotion() || performance.now() - lastT > 80) return; // paused before release: no fling
    let v = velocity * 16; // px per frame
    const step = () => {
      if (Math.abs(v) < 0.5) return stopMomentum();
      const before = node.scrollLeft;
      node.scrollLeft += v;
      if (node.scrollLeft === before) return stopMomentum(); // hit an edge
      v *= FRICTION;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // Stop the browser's own image/link drag ghost from hijacking the gesture.
  function onDragStart(e: DragEvent) {
    e.preventDefault();
  }

  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  node.addEventListener('dragstart', onDragStart);
  node.addEventListener('wheel', stopMomentum, { passive: true });

  return {
    destroy() {
      stopMomentum();
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('wheel', stopMomentum);
    },
  };
}
