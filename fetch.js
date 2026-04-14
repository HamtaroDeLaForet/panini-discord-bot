/**
 * SCRIPT 1 — Collecte des joueurs via API Football
 * -------------------------------------------------
 * Récupère tous les joueurs des ligues choisies et
 * les sauvegarde dans data/players_raw.json
 *
 * Prérequis :
 *   npm install node-fetch
 *
 * Usage :
 *   API_KEY=ta_clé node scripts/1_fetch_players.js
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// ─── CONFIG ────────────────────────────────────────────────────────────────

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    console.error('❌  Manque la clé API : API_KEY=xxxx node scripts/1_fetch_players.js');
    process.exit(1);
}

const BASE_URL = 'https://v3.football.api-sports.io';
const SEASON = 2024;
const ONLY_LEAGUE = process.env.LEAGUE_ID;

// IDs des ligues — dashboard.api-football.com pour en trouver d'autres
const LEAGUES = ONLY_LEAGUE
    ? [{ id: Number(ONLY_LEAGUE), name: 'Custom League' }]
    : [
        { id: 61, name: 'Ligue 1' },
        { id: 39, name: 'Premier League' },
        { id: 140, name: 'La Liga' },
        { id: 135, name: 'Serie A' },
        { id: 78, name: 'Bundesliga' },
        { id: 2, name: 'Champions League' },
    ];

// Délai entre chaque requête (ms) — plan gratuit : 10 req/min
const DELAY_MS = 6500;

// ─── HELPERS ───────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(endpoint, params = {}) {
    const url = new URL(`${BASE_URL}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const res = await fetch(url.toString(), {
        headers: { 'x-apisports-key': API_KEY },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);

    const json = await res.json();

    // Quota restant affiché pour suivre la conso
    const remaining = res.headers.get('x-ratelimit-requests-remaining');
    if (remaining !== null) process.stdout.write(` [quota restant: ${remaining}]`);

    return json;
}

// ─── COLLECTE D'UNE LIGUE (toutes les pages) ───────────────────────────────

async function fetchLeague(leagueId, leagueName) {
    const players = [];
    let page = 1;
    let totalPages = 1;

    console.log(`\n📋  ${leagueName} (league ${leagueId})`);

    do {
        process.stdout.write(`  → page ${page}/${totalPages}...`);

        const data = await apiFetch('players', {
            league: leagueId,
            season: SEASON,
            page,
        });

        if (data.errors && Object.keys(data.errors).length > 0) {
            console.error('\n❌  Erreur API :', data.errors);
            break;
        }

        totalPages = data.paging?.total ?? 1;

        for (const entry of data.response ?? []) {
            const { player, statistics } = entry;
            const stats = statistics?.[0];
            if (!stats) continue;

            players.push({
                // Identité
                api_id: player.id,
                name: player.name,
                firstname: player.firstname,
                lastname: player.lastname,
                nationality: player.nationality,
                age: player.age,
                photo_url: player.photo,

                // Club (saison en cours)
                club: stats.team?.name ?? null,
                club_id: stats.team?.id ?? null,
                league: leagueName,
                league_id: leagueId,

                // Poste
                position: stats.games?.position ?? null,

                // Stats brutes (pour enrichissement ou debug)
                appearances: stats.games?.appearences ?? 0,
                rating_api: stats.games?.rating
                    ? parseFloat(stats.games.rating)
                    : null,
            });
        }

        console.log(` ✓ (${players.length} joueurs cumulés)`);

        page++;
        if (page <= totalPages) await sleep(DELAY_MS);

    } while (page <= totalPages);

    return players;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
    const allPlayers = [];
    const seen = new Set(); // déduplique par api_id

    for (const league of LEAGUES) {
        try {
            const players = await fetchLeague(league.id, league.name);

            for (const p of players) {
                if (!seen.has(p.api_id)) {
                    seen.add(p.api_id);
                    allPlayers.push(p);
                }
            }

            // Pause entre chaque ligue
            if (league !== LEAGUES.at(-1)) {
                console.log(`  ⏳  Pause 10s avant la prochaine ligue...`);
                await sleep(10_000);
            }
        } catch (err) {
            console.error(`\n❌  Erreur sur ${league.name} :`, err.message);
        }
    }

    // Sauvegarde
    const outDir = path.resolve('data');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'players_raw.json');
    fs.writeFileSync(outPath, JSON.stringify(allPlayers, null, 2));

    console.log(`\n✅  ${allPlayers.length} joueurs uniques sauvegardés → ${outPath}`);
    console.log(`    Prochaine étape : télécharge le CSV FC25 sur Kaggle`);
    console.log(`    puis lance : node scripts/2_merge_ratings.js`);
}

main().catch((err) => {
    console.error('Erreur fatale :', err);
    process.exit(1);
});