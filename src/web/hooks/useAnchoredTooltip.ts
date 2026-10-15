import { useLayoutEffect, useState, type RefObject } from "react";

export function useAnchoredTooltip(ref: RefObject<HTMLElement | null>, active: boolean,
  x: number, y: number, height = 60) {
  const [position, setPosition] = useState<{ left: number; top: number }>();
  useLayoutEffect(() => {
    if (!active) { setPosition(undefined); return; }
    const update = () => {
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        left: Math.max(8, Math.min(window.innerWidth - 238, bounds.left + x)),
        top: Math.max(8, Math.min(window.innerHeight - height, bounds.top + y)),
      });
    };
    update();
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [ref, active, x, y, height]);
  return active ? position : undefined;
}
