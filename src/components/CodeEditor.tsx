import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'

export function CodeEditor({ value, onChange, dark, wrap, errorLine, onSave, onRun }: { value: string; onChange(value: string): void; dark: boolean; wrap: boolean; errorLine?: number; onSave(): void; onRun(): void }) {
  const host = useRef<HTMLDivElement>(null); const viewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions: [lineNumbers(), python(), ...(dark ? [oneDark] : []), ...(wrap ? [EditorView.lineWrapping] : []), keymap.of([...defaultKeymap, indentWithTab, { key: 'Ctrl-s', run: () => { onSave(); return true } }, { key: 'Ctrl-Enter', run: () => { onRun(); return true } }]), EditorView.updateListener.of(update => { if (update.docChanged) onChange(update.state.doc.toString()) })] }), parent: host.current })
    viewRef.current = view; return () => view.destroy()
  // The editor owns its document; recreating only for presentation changes avoids cursor loss during typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, wrap])
  useEffect(() => { const view = viewRef.current; if (view && value !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }) }, [value])
  useEffect(() => { const view = viewRef.current; if (errorLine && view) { const line = view.state.doc.line(Math.min(errorLine, view.state.doc.lines)); view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }) } }, [errorLine])
  return <div className="editor" ref={host} aria-label="Pythonコードエディタ" />
}
