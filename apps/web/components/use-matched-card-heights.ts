import { type RefCallback, useEffect, useState } from "react";

export function useMatchedCardHeights(cardIds: readonly string[]) {
  const [containerElement, setContainerElement] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    if (!containerElement) {
      return;
    }

    const cards = Array.from(
      containerElement.querySelectorAll<HTMLElement>("[data-matched-card]"),
    );

    if (cards.length === 0) {
      return;
    }

    let frameId = 0;

    const syncHeights = () => {
      for (const card of cards) {
        card.style.removeProperty("height");
      }

      const tallestHeight = Math.max(...cards.map((card) => card.offsetHeight));

      if (!Number.isFinite(tallestHeight) || tallestHeight <= 0) {
        return;
      }

      const nextHeight = `${Math.ceil(tallestHeight)}px`;

      for (const card of cards) {
        card.style.height = nextHeight;
      }
    };

    const scheduleSyncHeights = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncHeights);
    };

    const resizeObserver = new ResizeObserver(scheduleSyncHeights);

    for (const card of cards) {
      resizeObserver.observe(card);
    }

    scheduleSyncHeights();
    window.addEventListener("resize", scheduleSyncHeights);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleSyncHeights);

      for (const card of cards) {
        card.style.removeProperty("height");
      }
    };
  }, [containerElement]);

  const containerRef: RefCallback<HTMLElement> = (node) => {
    setContainerElement(node);
  };

  return containerRef;
}
