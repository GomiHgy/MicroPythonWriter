import { describe, expect, it } from 'vitest'
import { SimulationButtonInput } from '../services/simulation/SimulationButtonInput'
import { SimulationClock } from '../services/simulation/SimulationClock'
import type { ButtonGesture } from '../services/simulation/types'

function setup() {
  let time = 0
  const changes: (ButtonGesture | null)[] = []
  const clock = new SimulationClock(() => time)
  const input = new SimulationButtonInput(() => clock.now(), gesture => changes.push(gesture))
  return { input, changes, clock, at: (ms: number) => { time = ms; return input.read() } }
}

describe('simulated physical button gestures', () => {
  it('emits one short GPIO press and keeps the click-confirmation window exclusive', () => {
    const { input, changes, at } = setup()
    expect(input.start('single', true)).toBe(true)
    expect(at(0)).toBe(true)
    expect(at(99)).toBe(true)
    expect(at(100)).toBe(false)
    expect(input.start('double', true)).toBe(false)
    expect(at(499)).toBe(false)
    expect(changes).toEqual(['single'])
    expect(at(500)).toBe(false)
    expect(changes).toEqual(['single', null])
    expect(input.start('double', true)).toBe(true)
  })

  it('emits two short presses separated by a real release, not a synthetic action callback', () => {
    const { input, changes, at } = setup()
    input.start('double', true)
    expect(at(0)).toBe(true)
    expect(at(100)).toBe(false)
    expect(at(239)).toBe(false)
    expect(at(240)).toBe(true)
    expect(at(339)).toBe(true)
    expect(at(340)).toBe(false)
    expect(at(739)).toBe(false)
    expect(input.start('single', true)).toBe(false)
    expect(at(740)).toBe(false)
    expect(changes).toEqual(['double', null])
  })

  it('holds long enough to exceed the 1000ms threshold after 40ms debounce', () => {
    const { input, changes, at } = setup()
    input.start('long', true)
    expect(at(40)).toBe(true)
    expect(at(1040)).toBe(true)
    expect(at(1099)).toBe(true)
    expect(at(1100)).toBe(false)
    expect(input.start('single', true)).toBe(false)
    expect(at(1500)).toBe(false)
    expect(changes).toEqual(['long', null])
  })

  it.each<ButtonGesture>(['single', 'double', 'long'])('cancels %s without a later press after pause/resume', gesture => {
    const { input, changes, clock, at } = setup()
    input.start(gesture, true)
    at(50)
    clock.pause()
    input.cancel()
    expect(at(100_000)).toBe(false)
    expect(input.start('single', false)).toBe(false)
    clock.resume()
    expect(at(100_300)).toBe(false)
    expect(changes).toEqual([gesture, null])
  })

  it('uses simulation time and never advances a gesture with a paused wall clock', () => {
    const { input, clock, at } = setup()
    input.start('single', true)
    at(50)
    clock.pause()
    expect(at(100_000)).toBe(true)
    clock.resume()
    expect(at(100_049)).toBe(true)
    expect(at(100_050)).toBe(false)
  })

  it('rejects paused, invalid, repeated and manual/automatic overlapping input', () => {
    const { input, changes, at } = setup()
    expect(input.start('single', false)).toBe(false)
    expect(input.start('invalid' as ButtonGesture, true)).toBe(false)
    input.manual(true, false)
    expect(at(0)).toBe(false)
    input.manual(true, true)
    expect(at(10)).toBe(true)
    expect(input.start('single', true)).toBe(false)
    input.manual(false, false)
    input.start('double', true)
    input.manual(true, true)
    expect(at(110)).toBe(false)
    expect(input.start('double', true)).toBe(false)
    input.manual(false, false)
    expect(at(1000)).toBe(false)
    expect(changes).toEqual(['double', null])
  })

  it('finishes after a delayed poll without replaying missed presses', () => {
    const { input, changes, at } = setup()
    input.start('double', true)
    expect(at(5000)).toBe(false)
    expect(changes).toEqual(['double', null])
    expect(at(6000)).toBe(false)
    expect(changes).toEqual(['double', null])
  })
})
