import { describe, expect, it } from 'vitest'
import { parse } from 'postcss'
import indexHtml from '../index.html?raw'
import styleCss from './style.css?raw'

describe('title dialog and action focus', () => {
  it('names the title dialog with its visible heading and contains Start', () => {
    const titlePanel = indexHtml.match(/<div\b[^>]*id="title-panel"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ''
    const openingTag = titlePanel.match(/^<div\b[^>]*>/)?.[0] ?? ''
    expect(openingTag).toMatch(/role="dialog"/)
    const headingId = openingTag.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(headingId).toBeTruthy()
    const heading = titlePanel.match(/<h1\b[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h1>/)
    expect(heading?.[1]).toBe(headingId)
    expect(heading?.[2].trim()).not.toBe('')
    expect(titlePanel).toContain('id="btn-start"')
    expect(indexHtml.match(new RegExp(`id="${headingId}"`, 'g'))).toHaveLength(1)
  })

  // Check the shipped CSS contract; browser checks additionally exercise the cascade
  // after pointer input, when programmatic focus need not match :focus-visible.
  it.each(['#btn-start', '#btn-resume', '#btn-restart', '.hud-btn'])(
    '%s has the yellow ring for ordinary focus, independent of input modality',
    (selector) => {
      let outline: string | undefined
      let offset: string | undefined
      parse(styleCss).walkRules((rule) => {
        if (!rule.selectors.includes(`${selector}:focus`)) return
        rule.walkDecls('outline', (decl) => { outline = decl.value })
        rule.walkDecls('outline-offset', (decl) => { offset = decl.value })
      })
      expect(outline).toBe('3px solid #ffe066')
      expect(offset).toBe('3px')
    },
  )

  it('applies HUD focus styling to both Pause and Mute', () => {
    for (const id of ['btn-pause', 'btn-mute']) {
      const button = indexHtml.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`))?.[0] ?? ''
      expect(button).toMatch(/class="[^"]*\bhud-btn\b[^"]*"/)
    }
  })

  it('retains the yellow keyboard focus ring for other focusable controls', () => {
    let outline: string | undefined
    parse(styleCss).walkRules((rule) => {
      if (rule.selectors.includes(':focus-visible')) {
        rule.walkDecls('outline', (decl) => { outline = decl.value })
      }
    })
    expect(outline).toBe('3px solid #ffe066')
  })
})
