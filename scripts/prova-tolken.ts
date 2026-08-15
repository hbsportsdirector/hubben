import { tolkaText, beskrivTolkning } from '../src/lib/tolkaText.ts'

// Fast "nu" så proven är reproducerbara: lördag 15 augusti 2026
const NU = new Date(2026, 7, 15, 9, 0, 0)

const fall: [string, string][] = [
  ['Ring tandläkaren', 'inget datum, ingen tid'],
  ['Möte med Daniel imorgon 10-11', 'sön 16 aug, 10:00–11:00'],
  ['Träning på tisdag kl 18', 'tis 18 aug, 18:00'],
  ['Läkarbesök 3 oktober 14:30', '3 okt, 14:30'],
  ['Boka hallen 15/9', '15 sep'],
  ['Handla 2026-12-24', '24 dec'],
  ['Ring 3 leverantörer', 'INGEN tid'],
  ['Köp 10 bollar', 'INGEN tid'],
  ['Möte idag kl. 9.15', 'idag, 09:15'],
  ['Spelarmöte nästa vecka', 'om sju dagar'],
  ['Matchen på lördag', 'lör 22 aug, inte idag'],
  ['Avstämning övermorgon', 'mån 17 aug'],
  ['Fika 25/12-27', 'jul 2027'],
  ['Möte 99-99', 'ogiltigt spann, titeln överlever'],
  ['Styrelsemöte på måndag 19:00–21:00', 'mån 17 aug, 19–21'],
  ['Handla mat', 'inget alls'],
]

let fel = 0
for (const [text, vantat] of fall) {
  const t = tolkaText(text, NU)
  console.log(`\n"${text}"`)
  console.log(`   titel:  "${t.titel}"`)
  console.log(`   datum=${t.datum ?? '-'}  start=${t.start ?? '-'}  slut=${t.slut ?? '-'}`)
  console.log(`   visas:  ${beskrivTolkning(t) ?? '(inget)'}`)
  console.log(`   väntat: ${vantat}`)
  if (!t.titel) { console.log('   !! TITELN BLEV TOM'); fel++ }
  if (/^(på|den|kl|i|om)$/i.test(t.titel.split(' ').pop() ?? '')) {
    console.log('   !! LÖS PREPOSITION KVAR I SLUTET'); fel++
  }
}
console.log(fel ? `\n${fel} problem` : '\nAlla fall rena')
