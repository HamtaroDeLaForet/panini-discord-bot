import Database from 'better-sqlite3';

const db = new Database('./panini.db');
const players = db.prepare(`
  SELECT id, name, photo_url 
  FROM players 
  WHERE photo_url IS NOT NULL
`).all();

let valid = 0;
let broken = [];
const BATCH_SIZE = 20;

async function checkPlayer(player) {
  try {
    const res = await fetch(player.photo_url, { method: 'HEAD' });
    if (res.ok) {
      valid++;
    } else {
      broken.push({ ...player, status: res.status });
    }
  } catch {
    broken.push({ ...player, status: 'NETWORK_ERROR' });
  }
}

for (let i = 0; i < players.length; i += BATCH_SIZE) {
  const batch = players.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(checkPlayer));
  process.stdout.write(
    `\r🔍 ${Math.min(i + BATCH_SIZE, players.length)}/${players.length} checked...`
  );
}

console.log(`\n\n✅ Valid: ${valid}`);
console.log(`❌ Broken: ${broken.length}`);

if (broken.length > 0) {
  console.log(`\nBroken URLs:`);
  broken.forEach(p =>
    console.log(`  [${p.id}] ${p.name} — ${p.status} — ${p.photo_url}`)
  );
}

db.close();
process.exit(0);