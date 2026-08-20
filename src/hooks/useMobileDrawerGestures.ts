import { useEffect, useRef } from "react";

interface MobileDrawerGestureOptions {
  onOpenHistory: () => void;
  onOpenGitHub: () => void;
  onCloseHistory: () => void;
  onCloseGitHub: () => void;
  historyOpen: boolean;
  githubOpen: boolean;
}

/**
 * Adds conservative edge-swipe gestures for mobile drawer navigation.
 * Vertical scrolling wins unless the gesture is clearly horizontal.
 */
export function useMobileDrawerGestures({
  onOpenHistory,
  onOpenGitHub,
  onCloseHistory,
  onCloseGitHub,
  historyOpen,
  githubOpen,
}: MobileDrawerGestureOptions) {
  const optionsRef = useRef({ onOpenHistory, onOpenGitHub, onCloseHistory, onCloseGitHub, historyOpen, githubOpen });
  useEffect(() => {
    optionsRef.current = { onOpenHistory, onOpenGitHub, onCloseHistory, onCloseGitHub, historyOpen, githubOpen };
  }, [onOpenHistory, onOpenGitHub, onCloseHistory, onCloseGitHub, historyOpen, githubOpen]);

  useEffect(() => {
    const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onTouchStart = (event: TouchEvent) => {
      if (!isMobile() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const { historyOpen: history, githubOpen: github } = optionsRef.current;
      const edgeStart = touch.clientX <= 28 || touch.clientX >= window.innerWidth - 28;
      const drawerOpen = history || github;
      if (!edgeStart && !drawerOpen) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking || event.changedTouches.length !== 1) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;

      const { historyOpen: history, githubOpen: github, onOpenHistory: openHistory, onOpenGitHub: openGitHub, onCloseHistory: closeHistory, onCloseGitHub: closeGitHub } = optionsRef.current;
      if (history && dx < -56) closeHistory();
      else if (github && dx > 56) closeGitHub();
      else if (!history && !github && startX <= 28 && dx > 56) openHistory();
      else if (!history && !github && startX >= window.innerWidth - 28 && dx < -56) openGitHub();
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
}
