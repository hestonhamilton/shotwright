import { describe, expect, it } from 'vitest'

import { parseOnly, shouldCapture } from '../../src/filter.js'

describe('parseOnly', () => {
  it('splits on commas and trims', () => {
    expect(parseOnly('checkout, cart')).toEqual(['checkout', 'cart'])
  })
  it('drops empty segments and whitespace-only input', () => {
    expect(parseOnly(',, ,')).toEqual([])
    expect(parseOnly('')).toEqual([])
    expect(parseOnly(undefined)).toEqual([])
  })
})

describe('shouldCapture', () => {
  it('captures everything with an empty filter', () => {
    expect(shouldCapture('anything', [])).toBe(true)
  })
  it("matches on any substring (the original consumer's SHOTS_ONLY semantics)", () => {
    expect(shouldCapture('checkout-empty', ['checkout', 'cart'])).toBe(true)
    expect(shouldCapture('order-cart-3', ['checkout', 'cart'])).toBe(true)
    expect(shouldCapture('profile', ['checkout', 'cart'])).toBe(false)
  })
})
