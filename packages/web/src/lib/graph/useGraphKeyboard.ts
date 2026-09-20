export interface GraphKeyboardOptions {
  toggleCanvasFocus: () => void | Promise<void>;
  undo: () => boolean;
  redo: () => boolean;
  rebuildCanvas: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  duplicateSelection: () => void;
  hasClipboard: () => boolean;
  getSelectedNodes: () => ReadonlyArray<{ id: string }>;
  toggleMute: (id: string) => void;
  toggleBypass: (id: string) => void;
}

export function useGraphKeyboard(opts: GraphKeyboardOptions): {
  isTyping: (t: EventTarget | null) => boolean;
  onEditorKeydown: (e: KeyboardEvent) => void;
} {
  function isTyping(t: EventTarget | null): boolean {
    return (
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
    );
  }

  function onEditorKeydown(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      void opts.toggleCanvasFocus();
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "z") {
      e.preventDefault();
      const ok = e.shiftKey ? opts.redo() : opts.undo();
      if (ok) opts.rebuildCanvas();
    } else if (k === "c") {
      if (opts.getSelectedNodes().length) {
        e.preventDefault();
        opts.copySelection();
      }
    } else if (k === "v") {
      if (opts.hasClipboard()) {
        e.preventDefault();
        opts.pasteClipboard();
      }
    } else if (k === "d") {
      if (opts.getSelectedNodes().length) {
        e.preventDefault();
        opts.duplicateSelection();
      }
    } else if (k === "m" || k === "b") {
      const sel = opts.getSelectedNodes();
      if (sel.length) {
        e.preventDefault();
        for (const n of sel) (k === "m" ? opts.toggleMute : opts.toggleBypass)(n.id);
      }
    }
  }

  return { isTyping, onEditorKeydown };
}
