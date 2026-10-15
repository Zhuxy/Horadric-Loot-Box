import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Minimal right-click menu. Renders at the cursor position, closes on outside click. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-[160px] rounded-md border border-ink-600 bg-ink-900 py-1 shadow-tip"
      style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - items.length * 36 - 16) }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((mi, i) => (
        <button
          key={i}
          className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-ink-700 ${
            mi.danger ? 'text-red-300' : 'text-ink-200'
          }`}
          onClick={() => {
            onClose();
            mi.onClick();
          }}
        >
          {mi.label}
        </button>
      ))}
    </div>
  );
}
