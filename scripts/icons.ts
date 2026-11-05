/*
 * Draws the app's icons: the palette strip from the top of every page, five
 * of Malin's own deep autumn colours as flat chips, on the pine ground. Run
 * once after a change, and commit the PNGs; the build never draws them,
 * since it runs with the network off and has no business doing image work.
 *
 *   node scripts/icons.ts
 *
 * Writes public/icons/ (the manifest's icons, the maskable one with the
 * chips inside Android's safe circle), src/app/apple-icon.png (Next links
 * it as the apple-touch-icon) and src/app/icon.svg (the browser tab). iOS
 * fills a transparent corner with black, so every icon here is opaque.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const GROUND = '#141b18'
/** Five of his best colours, chosen for how they read side by side at icon size. */
export const ICON_SWATCHES = ['#4a5a44', '#5a2a2e', '#2f4a4e', '#2a3d52', '#6e3a24']

/**
 * The strip in a 1024 square. `width` is the share of the square the strip
 * spans: most of it for the home-screen icon, less for the maskable one,
 * whose edge Android may crop to a circle.
 */
export function stripSvg({ width = 0.72, ground = GROUND }: { width?: number; ground?: string } = {}): string {
  const count = ICON_SWATCHES.length
  const gap = 12
  const span = 1024 * width
  const chip = (span - gap * (count - 1)) / count
  const height = chip * 2.2
  const left = (1024 - span) / 2
  const top = (1024 - height) / 2
  const chips = ICON_SWATCHES.map(
    (colour, index) =>
      `<rect x="${left + index * (chip + gap)}" y="${top}" width="${chip}" height="${height}" rx="${chip * 0.08}" fill="${colour}" />`,
  ).join('\n  ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${ground}" />
  ${chips}
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
  const full = stripSvg()
  // Android's maskable safe zone is the centre circle of 80% diameter; the strip's corners stay inside it.
  const maskable = stripSvg({ width: 0.5 })
  await png(full, 192, path.join(root, 'public/icons/icon-192.png'))
  await png(full, 512, path.join(root, 'public/icons/icon-512.png'))
  await png(maskable, 512, path.join(root, 'public/icons/maskable-512.png'))
  await png(full, 180, path.join(root, 'src/app/apple-icon.png'))
  // The browser tab: the same strip, larger in a rounded square, since a tab icon is 16 to 32 pixels.
  const tab = stripSvg({ width: 0.84 }).replace('<rect width="1024" height="1024"', '<rect width="1024" height="1024" rx="200"')
  await writeFile(path.join(root, 'src/app/icon.svg'), tab)
  console.log('src/app/icon.svg')
}
