import indexHtml from '../index.html?raw'
import mainTsSource from './main.ts?raw'
import { describe, expect, it } from 'vitest'

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function howtoItems(className: string): string[] {
  const blocks = [
    ...indexHtml.matchAll(new RegExp(`<ul class="howto ${className}">([\\s\\S]*?)</ul>`, 'g')),
  ]
  return blocks.flatMap((block) =>
    [...block[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => stripTags(m[1])),
  )
}

describe('help copy: miss, manual car reset, and boost (T09)', () => {
  const desktop = howtoItems('howto-desktop')
  const mobile = howtoItems('howto-mobile')
  const allHelp = [...desktop, ...mobile].join('\n')

  it('does not promise that a miss is an automatic retry', () => {
    expect(desktop.length + mobile.length).toBeGreaterThan(0)
    expect(allHelp).not.toMatch(/miss\s*=\s*retry/i)
    expect(allHelp).not.toMatch(/fall off\s*\/\s*miss\s*=\s*retry/i)
    expect(allHelp).not.toMatch(/automatic retry/i)
    expect(allHelp).not.toMatch(/auto[- ]?retry/i)
  })

  it('states that a miss breaks combo on desktop and mobile help', () => {
    expect(desktop.some((li) => /miss/i.test(li) && /breaks combo/i.test(li))).toBe(true)
    expect(mobile.some((li) => /miss/i.test(li) && /breaks combo/i.test(li))).toBe(true)
  })

  it('documents R as the car-reset control', () => {
    const resetLine = desktop.find((li) => /\bR\b/.test(li) && /reset/i.test(li))
    expect(resetLine).toBeTruthy()
    expect(resetLine).toMatch(/reset car/i)
  })

  it('tells mobile players that pause can mute and reset the car', () => {
    const pauseLine = mobile.find((li) => /pause/i.test(li) && /mute/i.test(li) && /reset car/i.test(li))
    expect(pauseLine).toBeTruthy()
    expect(mainTsSource).toMatch(/btnPauseMute\?\.addEventListener\('click',\s*toggleMute\)/)
    expect(mainTsSource).toMatch(/btnResetCar\?\.addEventListener\('click',\s*resetCarFromPause\)/)
    const resetFromPause = mainTsSource.match(/function resetCarFromPause\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(resetFromPause).toMatch(/phase !== 'paused'/)
    expect(resetFromPause).toMatch(/resetPlayerNearStart\(\)/)
    expect(resetFromPause).toMatch(/resumeGame\(\)/)
    expect(resetFromPause).not.toMatch(/startGame\(/)
    expect(resetFromPause).not.toMatch(/restartToTitle\(/)
  })

  it('describes boost pickups in a separate line from the miss/combo rule', () => {
    const missLine = desktop.find((li) => /breaks combo/i.test(li))
    const boostLine = desktop.find((li) => /\bboost\b/i.test(li))
    expect(missLine).toBeTruthy()
    expect(boostLine).toBeTruthy()
    expect(missLine).not.toBe(boostLine)
    expect(missLine).not.toMatch(/\bboost\b/i)
    expect(boostLine).toMatch(/\bboost\b/i)

    const mobileMiss = mobile.find((li) => /breaks combo/i.test(li))
    const mobileBoost = mobile.find((li) => /\bboost\b/i.test(li))
    expect(mobileMiss).toBeTruthy()
    expect(mobileBoost).toBeTruthy()
    expect(mobileMiss).not.toBe(mobileBoost)
    expect(mobileMiss).not.toMatch(/\bboost\b/i)
  })

  it('still wires R during play to reset the car, not restart the race', () => {
    const rHandler = mainTsSource.match(/if \(e\.code === 'KeyR'[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(rHandler).toMatch(/phase === 'playing'/)
    expect(rHandler).toMatch(/resetPlayerNearStart\(\)/)
    expect(rHandler).not.toMatch(/startGame\(/)
    expect(rHandler).not.toMatch(/restartToTitle\(/)
  })
})
