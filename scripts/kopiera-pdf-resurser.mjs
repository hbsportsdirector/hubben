// pdf.js hämtar teckensnitt och teckentabeller vid behov, från en URL som vi
// måste peka ut. Filerna ligger i paketet, inte i vår källkod, så de kopieras
// hit vid start och bygge i stället för att checkas in (185 filer).
//
// Utan standard_fonts renderas PDF:er som använder Helvetica, Times eller
// Courier utan inbäddat teckensnitt HELT UTAN TEXT — sidan blir vit. Utan
// cmaps gäller samma sak för japanska, kinesiska och koreanska dokument.
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rot = join(dirname(fileURLToPath(import.meta.url)), '..')
const kalla = join(rot, 'node_modules', 'pdfjs-dist')
const mal = join(rot, 'public', 'pdfjs')

if (!existsSync(kalla)) {
  console.error('pdfjs-dist saknas — kör npm install först.')
  process.exit(1)
}

await rm(mal, { recursive: true, force: true })
await mkdir(mal, { recursive: true })
for (const mapp of ['standard_fonts', 'cmaps']) {
  await cp(join(kalla, mapp), join(mal, mapp), { recursive: true })
}
console.log('pdf.js-resurser kopierade till public/pdfjs/')
