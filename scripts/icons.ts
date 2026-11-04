/*
 * Draws the app's icons: the swatch fan from Today, fanned in Malin's own
 * deep autumn colours, on flannel. Run once after a change, and commit the
 * PNGs; the build never draws them, since it runs with the network off and
 * has no business doing image work.
 *
 *   node scripts/icons.ts
 *
 * Writes public/icons/ (the manifest's icons, the maskable one with the fan
 * inside Android's safe circle), src/app/apple-icon.png (Next links it as
 * the apple-touch-icon) and src/app/icon.svg (the browser tab). iOS fills a transparent corner with black, so every
 * icon here is opaque.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const GROUND = '#181c23'
/** Five of his best colours, chosen for how they read side by side at icon size. */
export const ICON_SWATCHES = ['#4f4a25', '#6b4a2b', '#8b4a1e', '#8a6a1f', '#a8842c']
const ANGLES = [-26, -13, 0, 13, 26]

/**
 * The fan in a 1024 square, centred on its real bounds. `width` is the share
 * of the square the fan spans: most of it for the home-screen icon, less for
 * the maskable one, whose edge Android may crop to a circle.
 */
export function fanSvg({ width = 0.78, ground = GROUND }: { width?: number; ground?: string } = {}): string {
  // The swatch on Today: 3.75 by 5.5 rem, turned about a point below its foot (50% 118%).
  const w = 375
  const h = 550
  const r = 45
  const pivot = { x: 0, y: h * 1.18 }
  const corners = ANGLES.flatMap((angle) => {
    const t = (angle * Math.PI) / 180
    return [
      [-w / 2, 0],
      [w / 2, 0],
      [-w / 2, h],
      [w / 2, h],
    ].map(([x, y]) => {
      const dx = x! - pivot.x
      const dy = y! - pivot.y
      return { x: pivot.x + dx * Math.cos(t) - dy * Math.sin(t), y: pivot.y + dx * Math.sin(t) + dy * Math.cos(t) }
    })
  })
  const minX = Math.min(...corners.map((c) => c.x))
  const maxX = Math.max(...corners.map((c) => c.x))
  const minY = Math.min(...corners.map((c) => c.y))
  const maxY = Math.max(...corners.map((c) => c.y))
  const scale = (1024 * width) / (maxX - minX)
  // Centre the bounds in the square.
  const tx = 512 - ((minX + maxX) / 2) * scale
  const ty = 512 - ((minY + maxY) / 2) * scale

  const swatches = ICON_SWATCHES.map(
    (colour, index) => `<g transform="rotate(${ANGLES[index]} ${pivot.x} ${pivot.y})">
      <rect x="${-w / 2}" y="0" width="${w}" height="${h}" rx="${r}" fill="${colour}" />
      <rect x="${-w / 2}" y="0" width="${w}" height="${h}" rx="${r}" fill="url(#weave)" />
      <rect x="${-w / 2 + 2}" y="2" width="${w - 4}" height="${h - 4}" rx="${r - 2}" fill="none" stroke="rgb(255 255 255 / 0.22)" stroke-width="4" />
    </g>`,
  ).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <pattern id="weave" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="3" height="18" fill="rgb(0 0 0 / 0.06)" />
    </pattern>
  </defs>
  <rect width="1024" height="1024" fill="${ground}" />
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    ${swatches}
  </g>
</svg>`
}

async function png(svg: string, size: number, file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const buffer = await sharp(Buffer.from(svg)).resize(size, size).flatten({ background: GROUND }).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(file, buffer)
  console.log(`${file} ${size}x${size}`)
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, '..')
  const full = fanSvg()
  // Android's maskable safe zone is the centre circle of 80% diameter; the fan's corners stay inside it.
  const maskable = fanSvg({ width: 0.6 })
  await png(full, 192, path.join(root, 'public/icons/icon-192.png'))
  await png(full, 512, path.join(root, 'public/icons/icon-512.png'))
  await png(maskable, 512, path.join(root, 'public/icons/maskable-512.png'))
  await png(full, 180, path.join(root, 'src/app/apple-icon.png'))
  // The browser tab: the same fan, larger in a rounded square, since a tab icon is 16 to 32 pixels.
  const tab = fanSvg({ width: 0.9 }).replace('<rect width="1024" height="1024"', '<rect width="1024" height="1024" rx="200"')
  await writeFile(path.join(root, 'src/app/icon.svg'), tab)
  console.log('src/app/icon.svg')
}
