import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const nodeRef = useRef<T | null>(null);
  const setNode = useCallback((node: T | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    if (!open || !nodeRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = nodeRef.current.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? nodeRef.current).focus();
    return () => previous?.focus?.();
  }, [open]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !nodeRef.current) return;
    const focusable = Array.from(nodeRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      nodeRef.current.focus();
      return;
    }
    const current = document.activeElement;
    const index = focusable.indexOf(current as HTMLElement);
    const next = event.shiftKey
      ? focusable[(index <= 0 ? focusable.length : index) - 1]
      : focusable[(index + 1) % focusable.length];
    if (!event.shiftKey && index === -1) {
      event.preventDefault();
      focusable[0].focus();
    } else if (event.shiftKey && index === -1) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else {
      event.preventDefault();
      next.focus();
    }
  }, [onClose]);

  return { setNode, onKeyDown };
}
