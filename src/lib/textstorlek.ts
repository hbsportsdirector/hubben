/** Hubbens egen textstorlek.
 *
 *  Webbläsarens zoom gör texten större men tar samtidigt bort bredd, så
 *  läsrutan kläms ihop precis när man ville läsa bättre. Den här skalar
 *  gränssnittet utan att man behöver zooma — och eftersom kolumnerna går att
 *  dra kan man ta tillbaka bredden där den behövs.
 *
 *  `zoom` och inte rem: appen har gott om storlekar i pixlar, och de följer
 *  inte med när rotens teckenstorlek ändras. Zoom skalar allt. */
const NYCKEL = 'hubben.textstorlek'

export const STORLEKAR = [
  { varde: 100, namn: 'Liten' },
  { varde: 115, namn: 'Normal' },
  { varde: 130, namn: 'Stor' },
  { varde: 150, namn: 'Största' },
] as const

export function hamtaTextstorlek(): number {
  const sparat = Number(localStorage.getItem(NYCKEL))
  return STORLEKAR.some((s) => s.varde === sparat) ? sparat : 100
}

export function sattTextstorlek(varde: number) {
  localStorage.setItem(NYCKEL, String(varde))
  anvand(varde)
}

function anvand(varde: number) {
  // 100 % lämnas orört — en tom sträng är inte samma sak som "zoom: 1" för
  // webbläsare som inte kan zoom alls.
  document.body.style.zoom = varde === 100 ? '' : String(varde / 100)
}

/** Körs vid start, innan React ritar något, så sidan inte hoppar. */
export function anvandSparadTextstorlek() {
  anvand(hamtaTextstorlek())
}
