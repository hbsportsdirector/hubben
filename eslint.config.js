import js from '@eslint/js'
import ts from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default ts.config(
  {
    // Byggresultat, beroenden och edge-funktionerna. De sista kör Deno med
    // helt andra globaler och egna importvägar — att linta dem här ger bara
    // brus om saker som inte är fel.
    ignores: ['dist/**', 'node_modules/**', 'supabase/functions/**', 'scripts/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /* Nya, mycket opinionsstarka regler ur compiler-eran. De slår på det
       * fullt normala `useEffect(() => { load() }, [load])` och skulle kräva
       * att halva appen skrivs om för att bli tysta. Det är inte den bugg vi
       * jagar här — varning räcker, avstängt där mönstret är genomgående. */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/exhaustive-deps': 'warn',

      /* ── Tysta skrivfel mot databasen ──────────────────────────────────
       *
       * Den här buggfamiljen har bitit flera gånger: en skrivning misslyckas,
       * `error` läses aldrig, och appen fortsätter som om allt gick bra.
       * Uppgiften som försvann, mejlet som såg flyttat ut men låg kvar — båda
       * var samma sak.
       *
       * Två regler fångar de två formerna. Bägge går att slå av med en
       * kommentar när man verkligen menar det, men då står det i koden att
       * man menade det.
       */

      // Form 1: `const { data, error } = await ...` där error aldrig läses.
      // ignoreRestSiblings: false är det som gör att den ser oanvänd `error`.
      '@typescript-eslint/no-unused-vars': ['error', {
        ignoreRestSiblings: false,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Form 2: `await supabase.from(...).update(...)` helt utan att ta emot
      // resultatet. Den värsta varianten — där finns inte ens ett `error` att
      // glömma bort.
      // `.throwOnError()` sist i kedjan är den godkända fixen: då kastar
      // anropet i stället för att tyst returnera ett fel ingen läser, och
      // felet fångas globalt av Felvakten. Därför undantas den här.
      'no-restricted-syntax': ['error', {
        selector: "ExpressionStatement > AwaitExpression > CallExpression:not([callee.property.name='throwOnError']) MemberExpression[object.name='supabase']",
        message:
          'Ta emot resultatet och läs error. En misslyckad skrivning som ingen ' +
          'kontrollerar blir en tyst lögn i databasen. Menar du verkligen ' +
          '"strunt samma"? Skriv då void supabase... med en kommentar om varför.',
      }],
    },
  },
)
