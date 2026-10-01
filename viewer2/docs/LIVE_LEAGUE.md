# Live league

The hangar is the home screen. One shared live broadcast cycles through 60 seconds of betting, a fight at real speed, a four-second hold on the final combat view, and 15 seconds of results. Completed fights expose statistics and crew snapshots, without replay recordings or betting.

## Economy

- New browser accounts receive 500 credits. Existing accounts retain their balances.
- The per-fight bet limit follows the available balance for every player: below 1,000 credits, 100; from 1,000 to 1,999, 250; at 2,000 or more, 500. Bets also cannot exceed the available balance.
- Zero balances receive a 50-credit refill, at most once per hour. Unsettled bets prevent a refill. Settlement and reconnect check eligibility; the minute watchdog handles hourly eligibility while a session stays open.
- Sponsorship costs 2,000 credits and includes a default name and four crew. Renaming costs 50 credits; scouting one candidate costs 100 credits. A paid candidate persists until hired or rejected.
- Betting profit has a 5% margin. Winning owners receive 1% of winning bettor profit, excluding returned stakes. The prototype includes simulated spectator betting in that income calculation.
- Stakes and awards use whole credits. Legacy storage uses 100 units per credit, but monetary values must be multiples of 100. Winnings and owner payments round at source.

## Scheduling

Future pairings are saved in the channel queue. Rotations prioritize longer-waiting ships and randomize opponents when booking. Sponsored matches sort ahead of background-only matches, preserving their relative order. Unannounced background slots can be replaced to book new or returning sponsored ships. The owner panel shows the next opponent and the ordinal upcoming match: “Up next,” or “In N fights.”

Only the current matchup is bettable. Ship and crew changes remain available until its betting window opens. Changes regenerate a prepared simulation without changing the booked pairing. Betting-open matchups stay locked. Ship and crew state is restored for each appearance; identities, stats, career and owner income persist.

## Runtime and deployment

The Convex backend runs the Rust duel simulation through the embedded WebAssembly binary in `convex/simBinary.ts`. Baseline matchups use the original 400-fight odds matrix; new crew matchups use 128 simulations and a cache. Future outcomes, seeds and recording URLs are private. The live recording is accessible only during the current fight/results window.

Production Convex: `https://glad-dogfish-932.convex.cloud`.
Development Convex: `https://resolute-crocodile-221.convex.cloud`.
Frontend: `https://hardburn.vercel.app`.

Vercel builds from the repository root with `npm ci` and `npm run build`, serving `dist`. Set `VITE_CONVEX_URL` for each environment. Production has the production URL configured; the build also has a production-only fallback. Legacy local recordings are excluded from the deployed build.

Deploy the backend with `npx convex deploy`. For an existing prototype deployment, run `game:roundCredits` to normalize money and `game:initializeQueue` to book/migrate its queue. Run `game:initialize` for an empty deployment. These internal mutations are idempotent for those operations. Production commands use `npx convex run ... --prod`.

Build a replacement simulator with `npm run build:sim` after installing the Rust `wasm32-unknown-unknown` target. The embedded binary is committed so web builds do not need Rust.

## Development tools

`?lab=1` reveals development preview-credit tooling. Every lab mutation/query checks the development deployment URL and rejects production use. Verification ships are excluded from matchmaking. `lab:verifyEconomy` checks the spectator cap, ownership cap removal, and refill eligibility/interval on the development cloud. `lab:queueStatus` and `lab:creditAudit` provide development diagnostics without exposing recording outcomes.

Accounts currently use an anonymous browser capability saved in local storage. They are not transferable authenticated accounts. Chat supports remembered visibility, mute/report and rate limits; reports are stored for review. Economy tuning, durable account authentication and moderation operations remain prototype work.

## Crew names

New sponsored crews and scouting candidates use Terran given names and surnames sampled from Donjon's SciFi Name Generator. The pool comes from 20 ten-name batches each of Terran Male and Terran Female, sampled on September 30, 2026; the original outputs and source URL are saved in `terran-name-samples.json`. `shared/terran-name-pool.js` contains the deduplicated given-name lists and shared surnames.

`shared/crew-names.js` selects either given-name list equally and recombines names deterministically from a seed. Current crew names are excluded during scouting and assignment. Existing identities persist. Names do not affect skill or g tolerance; generated names receive stable, varied portraits. The game does not call Donjon at runtime.
