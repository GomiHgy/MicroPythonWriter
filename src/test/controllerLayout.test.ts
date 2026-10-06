import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const controllerCss = readFileSync(new URL('../components/BluetoothPanel.css', import.meta.url), 'utf8')

describe('コントローラの横幅', () => {
  it('独自の最大幅を設けず、共通レイアウトの横幅いっぱいに表示する', () => {
    const rule = controllerCss.match(/\.bluetooth-panel\s*\{([^}]+)\}/)?.[1]
    expect(rule).toBeDefined()
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/min-width:\s*0/)
    expect(rule).not.toMatch(/max-width|margin/)
  })

  it('PCの2列は内容によって親の幅を押し広げない', () => {
    const rule = controllerCss.match(/\.controller-grid\s*\{([^}]+)\}/)?.[1]
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
    expect(controllerCss).toMatch(/\.controller-grid \.panel\s*\{[^}]*min-width:\s*0/)
  })

  it('狭い画面では従来どおり1列で表示する', () => {
    expect(controllerCss).toMatch(/@media\s*\(max-width:\s*800px\)\s*\{\s*\.controller-grid\s*\{\s*grid-template-columns:\s*1fr;/)
  })
})
