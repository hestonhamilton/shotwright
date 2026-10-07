// SPDX-License-Identifier: AGPL-3.0-or-later
import type { GalleryDiagnostic, GalleryModel, GalleryShot } from './model.js'

export type ComparePairState =
  | 'paired'
  | 'a-only'
  | 'b-only'
  | 'not-comparable'

export interface ComparePair {
  key: string
  state: ComparePairState
  a: GalleryShot | null
  b: GalleryShot | null
  spec: string
  order: number
  notComparableReason: string | null
}

export interface CompareCounts {
  total: number
  nameMatched: number
  comparable: number
  aOnly: number
  bOnly: number
  unmatchedByName: number
  notComparable: number
}

export interface CompareModel {
  a: GalleryModel
  b: GalleryModel
  pairs: ComparePair[]
  counts: CompareCounts
  diagnostics: GalleryDiagnostic[]
}

const stateOrder: Record<ComparePairState, number> = {
  'not-comparable': 0,
  'a-only': 1,
  'b-only': 2,
  paired: 3,
}

export function comparePairOrder(left: ComparePair, right: ComparePair): number {
  return stateOrder[left.state] - stateOrder[right.state] || left.order - right.order
}

function shots(model: GalleryModel): GalleryShot[] {
  return model.specs.flatMap((spec) => spec.shots)
}

function unavailableReason(side: 'A' | 'B', shot: GalleryShot): string {
  return `${side}: ${shot.imageError ?? 'Referenced PNG is unavailable'}`
}

export function buildCompareModel(a: GalleryModel, b: GalleryModel): CompareModel {
  const aShots = shots(a)
  const bShots = shots(b)
  const aByName = new Map(aShots.map((shot) => [shot.entry.name, shot]))
  const bByName = new Map(bShots.map((shot) => [shot.entry.name, shot]))
  const unionOrder = new Map<string, number>()

  for (const shot of [...aShots, ...bShots]) {
    if (!unionOrder.has(shot.entry.name)) {
      unionOrder.set(shot.entry.name, unionOrder.size)
    }
  }

  const pairs = [...unionOrder].map(([key, order]): ComparePair => {
    const aShot = aByName.get(key) ?? null
    const bShot = bByName.get(key) ?? null
    let state: ComparePairState
    let notComparableReason: string | null = null

    if (aShot === null) {
      state = 'b-only'
    } else if (bShot === null) {
      state = 'a-only'
    } else if (aShot.image === null || bShot.image === null) {
      state = 'not-comparable'
      notComparableReason = [
        ...(aShot.image === null ? [unavailableReason('A', aShot)] : []),
        ...(bShot.image === null ? [unavailableReason('B', bShot)] : []),
      ].join('; ')
    } else {
      state = 'paired'
    }

    return {
      key,
      state,
      a: aShot,
      b: bShot,
      spec: aShot?.entry.spec ?? bShot!.entry.spec,
      order,
      notComparableReason,
    }
  })

  pairs.sort(comparePairOrder)

  const comparable = pairs.filter((pair) => pair.state === 'paired').length
  const aOnly = pairs.filter((pair) => pair.state === 'a-only').length
  const bOnly = pairs.filter((pair) => pair.state === 'b-only').length
  const notComparable = pairs.filter((pair) => pair.state === 'not-comparable').length
  const nameMatched = comparable + notComparable

  return {
    a,
    b,
    pairs,
    counts: {
      total: pairs.length,
      nameMatched,
      comparable,
      aOnly,
      bOnly,
      unmatchedByName: aOnly + bOnly,
      notComparable,
    },
    diagnostics: [...a.diagnostics, ...b.diagnostics],
  }
}
