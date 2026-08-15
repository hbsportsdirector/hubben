/** Engångskodmod: lägg .throwOnError() på skrivningar vars resultat kastas bort.
 *
 * Mönstret `await supabase.from(...).update(...)` som fristående sats slukar
 * felet — misslyckas skrivningen fortsätter appen som om allt gick bra. Det är
 * buggfamiljen bakom uppgiften som försvann och mejlet som såg flyttat ut men
 * låg kvar.
 *
 * Kör med:  node scripts/satt-throwonerror.mjs [--skriv]
 * Utan --skriv listas bara träffarna.
 *
 * Parsar med TypeScripts egen parser i stället för att gissa på radnivå —
 * en sats kan sträcka sig över flera rader och radbaserad textmanipulation
 * hade förr eller senare klippt mitt i en kedja.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const SKRIV = process.argv.includes('--skriv')
const ROT = 'src'

function allaFiler(dir) {
  return readdirSync(dir).flatMap((namn) => {
    const p = join(dir, namn)
    if (statSync(p).isDirectory()) return allaFiler(p)
    return /\.tsx?$/.test(namn) ? [p] : []
  })
}

/** Är uttrycket en kedja som börjar i identifieraren `supabase`? */
function rotarISupabase(nod) {
  let n = nod
  for (;;) {
    if (ts.isCallExpression(n)) { n = n.expression; continue }
    if (ts.isPropertyAccessExpression(n)) { n = n.expression; continue }
    if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) { n = n.expression; continue }
    break
  }
  return ts.isIdentifier(n) && n.text === 'supabase'
}

let totalt = 0
for (const fil of allaFiler(ROT)) {
  const kalla = readFileSync(fil, 'utf8')
  const kod = ts.createSourceFile(fil, kalla, ts.ScriptTarget.Latest, true,
    fil.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

  const punkter = []
  const ga = (nod) => {
    if (ts.isExpressionStatement(nod) && ts.isAwaitExpression(nod.expression)) {
      const inre = nod.expression.expression
      if (ts.isCallExpression(inre) && rotarISupabase(inre)) {
        const text = inre.getText(kod)
        if (!text.includes('.throwOnError(')) {
          punkter.push({ slut: inre.getEnd(), rad: kod.getLineAndCharacterOfPosition(inre.getStart(kod)).line + 1 })
        }
      }
    }
    ts.forEachChild(nod, ga)
  }
  ga(kod)

  if (!punkter.length) continue
  totalt += punkter.length
  console.log(`${fil}: ${punkter.length} (rad ${punkter.map((p) => p.rad).join(', ')})`)

  if (SKRIV) {
    let ut = kalla
    // Bakifrån, annars flyttar varje insättning positionerna efter sig
    for (const p of punkter.sort((a, b) => b.slut - a.slut)) {
      ut = ut.slice(0, p.slut) + '.throwOnError()' + ut.slice(p.slut)
    }
    writeFileSync(fil, ut)
  }
}

console.log(`\n${totalt} skrivningar${SKRIV ? ' ändrade' : ' hittade (kör med --skriv för att ändra)'}`)
