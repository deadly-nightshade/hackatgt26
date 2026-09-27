"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Popup: bottom sheet on phones, centered card on desktop. Closes via ✕ or tapping outside
 * (Esc is handled by the page). Rendered into <body> so a transformed parent (e.g. the
 * "Find fish" bar) can't trap its fixed positioning.
 */
export function Sheet({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
