import { describe, it, expect } from 'vitest'
import { tolkaText, beskrivTolkning } from './tolkaText'

/** Fast "nu" så proven är reproducerbara: lördag 15 augusti 2026, kl 09.
 *  Utan den skulle "imorgon" betyda olika saker beroende på när testet kördes,
 *  och ett test som går sönder av sig självt en gång i månaden slutar man
 *  snart att lita på. */
const NU = new Date(2026, 7, 15, 9, 0, 0)
const tolka = (s: string) => tolkaText(s, NU)

describe('titel och datum', () => {
  it('lämnar ren text i fred', () => {
    const t = tolka('Ring tandläkaren')
    expect(t.titel).toBe('Ring tandläkaren')
    expect(t.datum).toBeNull()
    expect(t.start).toBeNull()
  })

  it('tar idag, imorgon och övermorgon', () => {
    expect(tolka('Möte idag').datum).toBe('2026-08-15')
    expect(tolka('Möte imorgon').datum).toBe('2026-08-16')
    expect(tolka('Möte övermorgon').datum).toBe('2026-08-17')
    expect(tolka('Möte i morgon').datum).toBe('2026-08-16')
  })

  it('tar nästa vecka', () => {
    expect(tolka('Spelarmöte nästa vecka').datum).toBe('2026-08-22')
  })

  it('tolkar veckodag som NÄSTA förekomst, aldrig idag', () => {
    // NU är en lördag. "på lördag" ska bli nästa lördag, inte idag —
    // säger man dagens eget namn menar man nästan alltid nästa vecka.
    expect(tolka('Matchen på lördag').datum).toBe('2026-08-22')
    expect(tolka('Träning på tisdag').datum).toBe('2026-08-18')
  })

  it('tar bort prepositionen med veckodagen', () => {
    expect(tolka('Träning på tisdag kl 18').titel).toBe('Träning')
    expect(tolka('Matchen på lördag').titel).toBe('Matchen')
  })

  it('förstår skrivna datumformat', () => {
    expect(tolka('Handla 2026-12-24').datum).toBe('2026-12-24')
    expect(tolka('Boka hallen 15/9').datum).toBe('2026-09-15')
    expect(tolka('Läkarbesök 3 oktober').datum).toBe('2026-10-03')
    expect(tolka('Fika 25/12-27').datum).toBe('2027-12-25')
  })

  it('flyttar datum utan år till nästa år om de redan passerat', () => {
    // 3 mars 2026 är passerat den 15 augusti 2026
    expect(tolka('Deklaration 3 mars').datum).toBe('2027-03-03')
    expect(tolka('Möte 1/2').datum).toBe('2027-02-01')
  })
})

describe('klockslag', () => {
  it('tar spann', () => {
    const t = tolka('Möte med Daniel imorgon 10-11')
    expect(t.titel).toBe('Möte med Daniel')
    expect(t.start).toBe('10:00')
    expect(t.slut).toBe('11:00')
  })

  it('tar spann med minuter och tankstreck', () => {
    const t = tolka('Styrelsemöte på måndag 19:00–21:00')
    expect(t.start).toBe('19:00')
    expect(t.slut).toBe('21:00')
  })

  it('tar kl-former', () => {
    expect(tolka('Möte idag kl. 9.15').start).toBe('09:15')
    expect(tolka('Möte klockan 14').start).toBe('14:00')
    expect(tolka('Möte kl 7').start).toBe('07:00')
  })

  it('tar tid med kolon utan kl', () => {
    expect(tolka('Avstämning 14:30').start).toBe('14:30')
  })

  /* Den viktigaste gruppen: tolken ska hellre missa en tid än hitta på en.
     En felaktig tid är värre än ingen, för den upptäcks först när man missat
     mötet. */
  describe('hittar ALDRIG på ett klockslag', () => {
    it('låter ensamma tal vara i fred utan datum', () => {
      expect(tolka('Ring 3 leverantörer').start).toBeNull()
      expect(tolka('Köp 10 bollar').start).toBeNull()
      expect(tolka('Beställ 24 tröjor').start).toBeNull()
    })

    it('behåller talet i titeln', () => {
      expect(tolka('Ring 3 leverantörer').titel).toBe('Ring 3 leverantörer')
      expect(tolka('Köp 10 bollar').titel).toBe('Köp 10 bollar')
    })

    it('avvisar omöjliga klockslag och behåller texten', () => {
      const t = tolka('Möte 99-99')
      expect(t.start).toBeNull()
      expect(t.titel).toBe('Möte 99-99')
    })

    it('avvisar minuter över 59', () => {
      expect(tolka('Möte 10:75').start).toBeNull()
    })
  })

  it('accepterar ensamt tal NÄR ett datum redan hittats', () => {
    // "imorgon 10" är entydigt nog: datumet gör att talet är ett klockslag
    const t = tolka('Träning imorgon 10')
    expect(t.datum).toBe('2026-08-16')
    expect(t.start).toBe('10:00')
    expect(t.titel).toBe('Träning')
  })
})

describe('titeln överlever alltid', () => {
  const fall = [
    'Ring tandläkaren',
    'Möte med Daniel imorgon 10-11',
    'Träning på tisdag kl 18',
    'Läkarbesök 3 oktober 14:30',
    'Boka hallen 15/9',
    'Handla 2026-12-24',
    'Ring 3 leverantörer',
    'Möte idag kl. 9.15',
    'Spelarmöte nästa vecka',
    'Matchen på lördag',
    'Avstämning övermorgon',
    'Möte 99-99',
    'Styrelsemöte på måndag 19:00–21:00',
    'Handla mat',
  ]

  it.each(fall)('%s', (text) => {
    const t = tolka(text)
    expect(t.titel.length).toBeGreaterThan(0)
    // Ingen lös preposition kvar i slutet
    expect(t.titel.split(' ').pop()).not.toMatch(/^(på|den|kl|klockan)$/i)
  })
})

describe('beskrivTolkning', () => {
  it('säger inget när det inte finns något att säga', () => {
    expect(beskrivTolkning(tolka('Ring tandläkaren'))).toBeNull()
  })

  it('visar datum och spann', () => {
    const text = beskrivTolkning(tolka('Möte imorgon 10-11'))
    expect(text).toContain('10:00–11:00')
    expect(text).toContain('16')
  })
})
