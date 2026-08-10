// Ritar Hubbens appikon till public/ikoner/.
//
// iOS vill ha PNG för hemskärmen — SVG duger inte där — och att checka in
// binärer som ingen kan diffa är sämre än att rita dem. Formen är samma
// planet som i sidomenyn, fast geometrisk: en klot med en ring runt.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ikoner')

const BAKGRUND = [11, 15, 26]     // #0b0f1a, samma som theme-color
const KLOT = [56, 189, 248]       // accentens ljusblå
const RING = [167, 139, 250]      // lila, som kalenderprickarna

/** Mjuk övergång så kanterna inte blir trappsteg. */
function blanda(under, over, andel) {
  return under.map((v, i) => Math.round(v + (over[i] - v) * andel))
}
function kant(avstand, gräns, mjukhet = 1.5) {
  return Math.min(1, Math.max(0, (gräns - avstand) / mjukhet))
}

function rita(storlek) {
  const px = Buffer.alloc(storlek * storlek * 4)
  const mitt = storlek / 2
  const r = storlek * 0.26          // klotets radie
  const ringR = storlek * 0.44      // ringens ytterradie
  const ringTjocklek = storlek * 0.055
  const lutning = -0.38             // radianer, ringen lutar som Saturnus
  const hörn = storlek * 0.22       // rundade hörn på plattan

  for (let y = 0; y < storlek; y++) {
    for (let x = 0; x < storlek; x++) {
      const dx = x - mitt, dy = y - mitt
      let f = [...BAKGRUND]

      // Ringen: en ellips som roterats, tillplattad i höjdled
      const rx = dx * Math.cos(lutning) - dy * Math.sin(lutning)
      const ry = dx * Math.sin(lutning) + dy * Math.cos(lutning)
      const ellips = Math.hypot(rx, ry / 0.34)
      const iRingen = kant(Math.abs(ellips - ringR), ringTjocklek / 2, 2)
      const iKlotet = kant(Math.hypot(dx, dy), r, 2)

      // Ringen målas i två omgångar med klotet emellan, annars ser den ut
      // att ligga platt bakom i stället för att gå runt.
      if (iRingen > 0 && ry <= 0) f = blanda(f, RING, iRingen * 0.95)

      if (iKlotet > 0) {
        // Lite ljus uppifrån vänster så klotet inte ser platt ut
        const ljus = 0.82 + 0.18 * Math.max(0, (-dx - dy) / (r * 1.4))
        f = blanda(f, KLOT.map((v) => Math.min(255, Math.round(v * ljus))), iKlotet)
      }

      if (iRingen > 0 && ry > 0) f = blanda(f, RING, iRingen * 0.95)

      // Rundade hörn: genomskinligt utanför plattan
      const hx = Math.max(0, Math.abs(dx) - (mitt - hörn))
      const hy = Math.max(0, Math.abs(dy) - (mitt - hörn))
      const utanför = Math.hypot(hx, hy) - hörn
      const alfa = Math.round(255 * Math.min(1, Math.max(0, 0.5 - utanför)))

      const i = (y * storlek + x) * 4
      px[i] = f[0]; px[i + 1] = f[1]; px[i + 2] = f[2]; px[i + 3] = alfa
    }
  }
  return px
}

// ---- PNG-hopsättning ----
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return (buf) => {
    let c = -1
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
})()

function bit(typ, data) {
  const längd = Buffer.alloc(4); längd.writeUInt32BE(data.length)
  const kropp = Buffer.concat([Buffer.from(typ, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(kropp))
  return Buffer.concat([längd, kropp, crc])
}

function tillPng(px, storlek) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(storlek, 0); ihdr.writeUInt32BE(storlek, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  // Varje rad föregås av en filterbyte — 0 betyder "ingen filtrering"
  const rader = Buffer.alloc((storlek * 4 + 1) * storlek)
  for (let y = 0; y < storlek; y++) {
    rader[y * (storlek * 4 + 1)] = 0
    px.copy(rader, y * (storlek * 4 + 1) + 1, y * storlek * 4, (y + 1) * storlek * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bit('IHDR', ihdr),
    bit('IDAT', deflateSync(rader, { level: 9 })),
    bit('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(UT, { recursive: true })
for (const storlek of [192, 512, 180]) {
  const namn = storlek === 180 ? 'apple-touch-icon.png' : `ikon-${storlek}.png`
  writeFileSync(join(UT, namn), tillPng(rita(storlek), storlek))
}
console.log('Appikoner ritade till public/ikoner/')
