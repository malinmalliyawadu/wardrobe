import sharp from 'sharp'

import type { Family } from './colour.ts'

/*
 * The garment's colour read from its photo, for listings that never name one
 * (END. puts the colour only in the picture). Deterministic and free: the
 * background is whatever the border of the photo is, the garment is every
 * pixel clearly different from it, and the dominant colour is the largest of
 * three clusters in CIELAB. Unsure reads (a white tee on a white sweep, a
 * busy print) return no family, and the product stays for Claude to judge.
 */

export type PhotoRead = {
  /** The dominant colour, and a second one when it covers a third of the garment. Empty when unsure. */
  colours: string[]
  families: Family[]
  /** The dominant colour, even when the read is too mixed to use. */
  hex: string | null
  /** Share of the photo that is garment rather than background. */
  foreground: number
  /** Share of the garment the dominant colour covers. */
  share: number
}

/** Reference colours per family, as a tailor would see them under studio light. */
const REFERENCES: [Family, string][] = [
  ['black', '#111111'], ['black', '#1e1e1e'],
  ['grey', '#2b2b2e'], ['grey', '#333333'], ['grey', '#4a4a4a'], ['grey', '#808080'], ['grey', '#a9a9a9'], ['grey', '#c9c9c9'],
  ['white', '#f6f6f4'], ['white', '#ffffff'],
  ['ecru', '#efe8d8'], ['ecru', '#e4dac3'],
  ['beige', '#d6c4a1'], ['beige', '#c4b08a'], ['beige', '#b39c76'], ['beige', '#cbbfa8'],
  ['brown', '#3e2a1f'], ['brown', '#5a3d2b'], ['brown', '#7b5236'], ['brown', '#94704f'],
  ['navy', '#1b2236'], ['navy', '#232c3d'], ['navy', '#2b3a5c'],
  ['blue', '#2f5d9a'], ['blue', '#4a6fa5'], ['blue', '#7fa1c9'], ['blue', '#a9c2df'],
  ['teal', '#1f5c5c'], ['teal', '#2e6f73'], ['teal', '#4f8f94'],
  ['green', '#24382c'], ['green', '#2f4a3a'], ['green', '#3d6b4a'], ['green', '#6f9a76'], ['green', '#a3b9a0'],
  ['olive', '#4f4d2c'], ['olive', '#6b6b3a'], ['olive', '#7c7650'],
  ['red', '#5c1a1f'], ['red', '#7a1f24'], ['red', '#a3262b'], ['red', '#c8323a'],
  ['rust', '#8f3f22'], ['rust', '#a4522c'], ['rust', '#c46a32'], ['rust', '#d9822b'],
  ['yellow', '#c99b38'], ['yellow', '#d4a82c'], ['yellow', '#e8d36a'],
  ['pink', '#e8a5b0'], ['pink', '#d9788c'], ['pink', '#f2c9cf'],
  ['purple', '#3b2440'], ['purple', '#4b2a4a'], ['purple', '#6a3d6b'], ['purple', '#8d6fa0'],
]

type Lab = [number, number, number]

const REFERENCE_LAB = REFERENCES.map(([family, hex]) => ({ family, lab: rgbToLab(hexToRgb(hex)) }))

const SIZE = { width: 48, height: 60 }
const BORDER = 2
/** A pixel this far (CIE76) from the background is garment. */
const FOREGROUND_DELTA = 18
const MIN_FOREGROUND = 0.08
/** Below this the garment has no one dominant colour: a print, a colour block. */
const MIN_SHARE = 0.4
/** A second colour this large is part of the garment too: a two-tone. */
const SECOND_SHARE = 0.3

export async function readPhoto(image: Buffer): Promise<PhotoRead> {
  const { data, info } = await sharp(image)
    .resize(SIZE.width, SIZE.height, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info

  const border: [number, number, number][] = []
  const all: Lab[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const rgb: [number, number, number] = [data[offset]!, data[offset + 1]!, data[offset + 2]!]
      all.push(rgbToLab(rgb))
      if (x < BORDER || y < BORDER || x >= width - BORDER || y >= height - BORDER) border.push(rgb)
    }
  }
  const background = rgbToLab([median(border, 0), median(border, 1), median(border, 2)])
  const foreground = all.filter((lab) => distance(lab, background) > FOREGROUND_DELTA)
  const foregroundShare = foreground.length / all.length
  if (foregroundShare < MIN_FOREGROUND) return { colours: [], families: [], hex: null, foreground: foregroundShare, share: 0 }

  const clusters = kMeans(foreground, 3).sort((a, b) => b.size - a.size)
  const [first, second] = clusters
  if (!first) return { colours: [], families: [], hex: null, foreground: foregroundShare, share: 0 }
  const share = first.size / foreground.length
  const hex = labToHex(first.centre)
  if (share < MIN_SHARE) return { colours: [], families: [], hex, foreground: foregroundShare, share }

  const colours = [hex]
  if (second && second.size / foreground.length >= SECOND_SHARE) colours.push(labToHex(second.centre))
  return { colours, families: familiesOfColours(colours), hex, foreground: foregroundShare, share }
}

/** The families a photo's stored colours stand for, under today's rules. */
export function familiesOfColours(colours: string[]): Family[] {
  return [...new Set(colours.flatMap((hex) => readFamilies(rgbToLab(hexToRgb(hex)))))]
}

/**
 * The family a photographed colour is nearest, plus the ones a camera
 * confuses it with: studio shading turns white into pale grey, and navy,
 * charcoal and black all photograph near black. Shading does not take the
 * warmth out of cream, so a pale read with no colour in it at all (chroma
 * under 4) is white or grey, and only a faintly warm one may be ecru.
 */
export function readFamilies(lab: Lab): Family[] {
  const [lightness, a, b] = lab
  const chroma = Math.hypot(a, b)
  const families = new Set<Family>([nearestFamily(lab)])
  if (chroma < 4 && lightness > 68) for (const family of ['white', 'grey'] as const) families.add(family)
  if (chroma >= 4 && chroma < 10 && lightness > 68) for (const family of ['white', 'ecru', 'grey'] as const) families.add(family)
  if (lightness < 24) for (const family of ['black', 'navy', 'grey'] as const) families.add(family)
  if (chroma < 8 && lightness >= 24 && lightness <= 68) families.add('grey')
  return [...families]
}

export function nearestFamily(lab: Lab): Family {
  let best = REFERENCE_LAB[0]!
  let bestDistance = Infinity
  for (const reference of REFERENCE_LAB) {
    const d = distance(lab, reference.lab)
    if (d < bestDistance) {
      best = reference
      bestDistance = d
    }
  }
  return best.family
}

export function familyOfHex(hex: string): Family {
  return nearestFamily(rgbToLab(hexToRgb(hex)))
}

/** How far apart two colours look: CIE76 in CIELAB, about 2.3 for a just-noticeable difference. */
export function hexDistance(a: string, b: string): number {
  return distance(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)))
}

/** Lloyd's algorithm with a deterministic start: centres at the 1/6, 1/2 and 5/6 lightness quantiles. */
function kMeans(points: Lab[], k: number): { centre: Lab; size: number }[] {
  const byLightness = [...points].sort((a, b) => a[0] - b[0])
  let centres: Lab[] = Array.from({ length: k }, (_, index) => {
    const at = Math.min(byLightness.length - 1, Math.floor(((2 * index + 1) / (2 * k)) * byLightness.length))
    return [...byLightness[at]!] as Lab
  })
  let assignment = new Array<number>(points.length).fill(0)
  for (let iteration = 0; iteration < 12; iteration += 1) {
    assignment = points.map((point) => {
      let best = 0
      for (let c = 1; c < centres.length; c += 1) {
        if (distance(point, centres[c]!) < distance(point, centres[best]!)) best = c
      }
      return best
    })
    centres = centres.map((centre, c) => {
      const members = points.filter((_, index) => assignment[index] === c)
      if (members.length === 0) return centre
      return [0, 1, 2].map((axis) => members.reduce((sum, point) => sum + point[axis]!, 0) / members.length) as Lab
    })
  }
  return centres.map((centre, c) => ({ centre, size: assignment.filter((value) => value === c).length }))
}

function median(values: [number, number, number][], channel: 0 | 1 | 2): number {
  const sorted = values.map((value) => value[channel]).sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function distance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** sRGB to CIELAB under D65. */
export function rgbToLab([r, g, b]: [number, number, number]): Lab {
  const linear = [r, g, b].map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function labToHex([l, a, b]: Lab): string {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inverse = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
  const x = inverse(fx) * 0.95047
  const y = inverse(fy)
  const z = inverse(fz) * 1.08883
  const linear = [
    x * 3.2406 + y * -1.5372 + z * -0.4986,
    x * -0.9689 + y * 1.8758 + z * 0.0415,
    x * 0.0557 + y * -0.204 + z * 1.057,
  ]
  return `#${linear
    .map((c) => {
      const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
      return Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
    })
    .join('')}`
}
