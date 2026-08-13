// Assistentfunktionen ar borttagen ur Hubben.
//
// Den har kunde skapa inloggningskonton, sa den lamnas inte kvar i sitt gamla
// skick bara for att ingen langre anropar den. Tills funktionen raderas i
// Supabase-panelen svarar den bara att den ar borta.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() =>
  new Response(JSON.stringify({ fel: "Assistentfunktionen finns inte langre" }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
);
