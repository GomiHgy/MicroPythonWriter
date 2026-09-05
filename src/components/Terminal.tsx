import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function Terminal({ log, dark, autoScroll }: { log: string; dark: boolean; autoScroll: boolean }) {
  const host = useRef<HTMLDivElement>(null); const term = useRef<Xterm | null>(null)
  useEffect(() => {
    if (!host.current) return
    const terminal = new Xterm({ convertEol: true, fontFamily: 'ui-monospace, Consolas, monospace', theme: dark ? { background: '#10161f', foreground: '#dce6f2' } : { background: '#fff', foreground: '#17212b' } })
    const fit = new FitAddon()
    let frame = 0
    const scheduleFit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fit.fit())
    }
    terminal.loadAddon(fit)
    terminal.open(host.current)
    scheduleFit()
    term.current = terminal
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(host.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); terminal.dispose() }
  }, [dark])
  useEffect(() => { const terminal = term.current; if (!terminal) return; terminal.reset(); terminal.write([...log].filter(character => ![1, 4, 5].includes(character.charCodeAt(0))).join('')); if (autoScroll) terminal.scrollToBottom() }, [log, autoScroll])
  return <div className="terminal" ref={host} aria-label="シリアルターミナル" />
}
