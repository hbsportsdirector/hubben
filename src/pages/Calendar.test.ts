import { describe, it, expect } from 'vitest'
import { tolkaTid, tidsstampel, dygnsSpann, heldagLokal, heldagLagrad } from './Calendar'

describe('tolkaTid', () => {
  it('tar emot det man faktiskt skriver', () => {
    expect(tolkaTid('17:00')).toBe('17:00')
    expect(tolkaTid('1700')).toBe('17:00')
    expect(tolkaTid('17')).toBe('17:00')
    expect(tolkaTid('9')).toBe('09:00')
    expect(tolkaTid('17.30')).toBe('17:30')
    expect(tolkaTid('17,30')).toBe('17:30')
  })

  it('säger nej till sådant som inte är en tid', () => {
    expect(tolkaTid('')).toBeNull()
    expect(tolkaTid('25:00')).toBeNull()
    expect(tolkaTid('17:75')).toBeNull()
    expect(tolkaTid('kvart i fem')).toBeNull()
  })
})

describe('tidsstampel', () => {
  it('bygger en tidpunkt av datum och klockslag', () => {
    const d = tidsstampel('2026-09-04', '17:00')
    expect(d).not.toBeNull()
    expect(d!.getHours()).toBe(17)
    expect(d!.getFullYear()).toBe(2026)
  })

  // Kärnan i felet "Invalid time value": krockvarningen kör vid varje
  // tangenttryckning, och mitt i att man skriver 1700 är strängen "1" och
  // sedan "170". Blev det ett Invalid Date kastade toISOString() långt senare,
  // inuti ett löfte, och slog upp "Något gick fel" över hela sidan.
  it('ger null för en halvskriven tid i stället för ett ogiltigt datum', () => {
    for (const halvt of ['', '1', '17:', ':30', '99', '17:99']) {
      const d = tidsstampel('2026-09-04', halvt)
      if (d !== null) expect(Number.isNaN(d.getTime())).toBe(false)
    }
    expect(tidsstampel('2026-09-04', '')).toBeNull()
    expect(tidsstampel('2026-09-04', '17:')).toBeNull()
    expect(tidsstampel('2026-09-04', '17:99')).toBeNull()
  })

  it('ger null för ett datum som inte är färdigskrivet', () => {
    expect(tidsstampel('', '17:00')).toBeNull()
    expect(tidsstampel('2026-09', '17:00')).toBeNull()
    expect(tidsstampel('2026-9-4', '17:00')).toBeNull()
  })

  // "1" tolkas som klockan ett — det är rätt, men just därför måste
  // krockvarningen stå över tills tiden är rimlig, inte lita på null ensamt.
  it('tolkar en ensam siffra som hel timme', () => {
    expect(tidsstampel('2026-09-04', '1')!.getHours()).toBe(1)
  })
})

describe('dygnsSpann', () => {
  // En cup fredag–söndag är tre dagar. Räknar man bara mellanrummet blir det
  // två, och sista dagen ser ut att saknas.
  it('räknar båda ändarna', () => {
    expect(dygnsSpann('2026-09-04', '2026-09-06')).toBe(3)
    expect(dygnsSpann('2026-09-04', '2026-09-04')).toBe(1)
    expect(dygnsSpann('2026-09-04', '2026-09-05')).toBe(2)
  })

  it('klarar månadsskifte och sommartidsskifte', () => {
    expect(dygnsSpann('2026-08-30', '2026-09-02')).toBe(4)
    // Sista helgen i oktober: klockan ställs om mitt i spannet
    expect(dygnsSpann('2026-10-24', '2026-10-26')).toBe(3)
  })
})

// Heldagar lagras som midnatt UTC. Läst rakt av blev det kl. 02 svensk
// sommartid, och slutet drog ut händelsen över nästa dag. Körs testerna med
// TZ=Europe/Stockholm syns felet; i UTC hade det gått igenom ändå.
describe('heldagLokal / heldagLagrad', () => {
  it('ger lokal midnatt samma datum', () => {
    const d = heldagLokal('2026-10-04T00:00:00+00:00')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(4)
    expect(d.getHours()).toBe(0)
  })

  it('går fram och tillbaka utan att datumet glider', () => {
    for (const iso of ['2026-03-29T00:00:00.000Z', '2026-07-15T00:00:00.000Z', '2026-10-25T00:00:00.000Z']) {
      expect(heldagLagrad(heldagLokal(iso))).toBe(iso)
    }
  })

  it('lagrar en lokal dag som midnatt UTC samma datum', () => {
    expect(heldagLagrad(new Date(2026, 9, 4))).toBe('2026-10-04T00:00:00.000Z')
  })
})
