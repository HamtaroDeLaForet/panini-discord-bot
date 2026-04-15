import Database from 'better-sqlite3';
import { setTimeout as sleep } from 'timers/promises';

const DB_PATH = './panini.db';
const PLACEHOLDER = 'https://upload.wikimedia.org/wikipedia/commons/8/89/Portrait_Placeholder.png';
const RATE_LIMIT_MS = 500;

const db = new Database(DB_PATH);

const HEADERS = {
    'User-Agent': 'PaniniBot/1.0 (discord-panini-bot; mateo.fauquembergue@gmail.com.com) Node.js'
};

async function searchWikimediaCommons(playerName) {
    try {
        const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(playerName)}&srnamespace=6&srlimit=5&format=json&origin=*`;
        const res = await fetch(searchUrl, { headers: HEADERS });
        if (!res.ok) return null;
        const data = await res.json();
        const results = data?.query?.search;
        if (!results?.length) return null;

        for (const result of results) {
            const title = result.title;
            const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
            const infoRes = await fetch(infoUrl, { headers: HEADERS });
            if (!infoRes.ok) continue;
            const infoData = await infoRes.json();
            const pages = infoData?.query?.pages;
            if (!pages) continue;
            for (const page of Object.values(pages)) {
                const url = page?.imageinfo?.[0]?.url;
                if (url && /\.(jpg|jpeg|png)$/i.test(url)) return url;
            }
        }
    } catch { }
    return null;
}

async function searchWikipediaImage(playerName) {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(playerName)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
        const res = await fetch(searchUrl, { headers: HEADERS });
        if (!res.ok) return null;
        const data = await res.json();
        const pages = data?.query?.pages;
        if (!pages) return null;
        for (const page of Object.values(pages)) {
            const url = page?.thumbnail?.source;
            if (url && /\.(jpg|jpeg|png)/i.test(url)) return url;
        }
    } catch { }
    return null;
}

async function fetchPlayerImage(name, club) {
    const queries = [
        `${name} footballer`,
        `${name} ${club} footballer`,
        `${name} soccer player`,
        name,
    ];

    for (const query of queries) {
        const url = await searchWikipediaImage(query);
        if (url) return url;
        await sleep(RATE_LIMIT_MS);
        const commonsUrl = await searchWikimediaCommons(query);
        if (commonsUrl) return commonsUrl;
        await sleep(RATE_LIMIT_MS);
    }

    return null;
}

async function main() {
    const players = db.prepare(
        `SELECT id, name, club FROM players WHERE photo_url IS NULL OR photo_url = ?`
    ).all(PLACEHOLDER);

    console.log(`🔍 ${players.length} players to process...`);

    const updateStmt = db.prepare(`UPDATE players SET photo_url = ? WHERE id = ?`);
    let found = 0;
    let notFound = 0;

    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        process.stdout.write(`\r⏳ [${i + 1}/${players.length}] ${player.name.padEnd(30)}`);
        try {
            const imageUrl = await fetchPlayerImage(player.name, player.club);
            if (imageUrl) {
                updateStmt.run(imageUrl, player.id);
                found++;
            } else {
                notFound++;
            }
        } catch { }
        await sleep(RATE_LIMIT_MS);
    }

    console.log(`\n\n✅ Found: ${found}`);
    console.log(`❌ Not found: ${notFound}`);

    db.close();
    process.exit(0);
}

main();