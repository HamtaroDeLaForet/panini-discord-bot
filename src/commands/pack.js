import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import db from '../db/database.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PACK_SIZE = 5;

const RARITY_CONFIG = {
    Legendary: { emoji: '🟡', color: 0xFFD700, threshold: 97,  showImage: true  },
    Epic:      { emoji: '🟣', color: 0x9B59B6, threshold: 85,  showImage: true  },
    Rare:      { emoji: '🔵', color: 0x3498DB, threshold: 60,  showImage: true  },
    Common:    { emoji: '⚪', color: 0x95A5A6, threshold: 0,   showImage: false },
};

const PACK_COLOR_DEFAULT = 0x2C2F33;

const REVEAL_DELAY_MS    = 1400;
const OPENING_DELAY_MS   = 1800;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns the rarity key based on a 0-100 roll.
 */
function getRarityFromRoll(roll) {
    if (roll >= RARITY_CONFIG.Legendary.threshold) return 'Legendary';
    if (roll >= RARITY_CONFIG.Epic.threshold)      return 'Epic';
    if (roll >= RARITY_CONFIG.Rare.threshold)      return 'Rare';
    return 'Common';
}

/**
 * Draws a single random player of the given rarity from the DB.
 * Returns null if the table is empty for that rarity.
 */
function drawPlayer(rarity) {
    return db.prepare(`
        SELECT * FROM players
        WHERE rarity = ?
        ORDER BY RANDOM()
        LIMIT 1
    `).get(rarity) ?? null;
}

/**
 * Gets or creates a user row, returns the row (with at least { id }).
 */
function getOrCreateUser(discordId, serverId) {
    const existing = db.prepare(`
        SELECT * FROM users
        WHERE discord_id = ? AND server_id = ?
    `).get(discordId, serverId);

    if (existing) return existing;

    const result = db.prepare(`
        INSERT INTO users (discord_id, server_id, coins, created_at)
        VALUES (?, ?, 0, ?)
    `).run(discordId, serverId, Date.now());

    return { id: result.lastInsertRowid };
}

/**
 * Saves a card to the DB.
 */
function saveCard(userId, playerId, serverId) {
    db.prepare(`
        INSERT INTO cards (user_id, player_id, server_id, obtained_at)
        VALUES (?, ?, ?, ?)
    `).run(userId, playerId, serverId, Date.now());
}

// ─── Embed Builders ───────────────────────────────────────────────────────────

/**
 * "Pack is opening..." intro embed — animated suspense effect.
 */
function buildOpeningEmbed() {
    return new EmbedBuilder()
        .setTitle('📦  Pack Opening')
        .setDescription(
            '✨ *The pack is being opened...*\n\n' +
            '> Getting ready to reveal your players'
        )
        .setColor(PACK_COLOR_DEFAULT)
        .setFooter({ text: 'Panini Bot • Pack System' });
}

/**
 * Reveal embed — rebuilt from scratch each time to prevent Discord image cache bugs.
 *
 * @param {object[]} revealedSoFar  - Players revealed so far (including current).
 * @param {number}   total          - Total pack size.
 * @param {boolean}  isFinal        - Whether this is the final state.
 */
function buildRevealEmbed(revealedSoFar, total, isFinal = false) {
    const latest = revealedSoFar.at(-1);
    const cfg    = RARITY_CONFIG[latest.rarity] ?? RARITY_CONFIG.Common;

    // Color: always the rarity color of the *latest* revealed card
    const embed = new EmbedBuilder()
        .setColor(cfg.color)
        .setFooter({
            text: isFinal
                ? `Panini Bot • Pack System`
                : `Revealing ${revealedSoFar.length}/${total}`,
        });

    if (isFinal) {
        embed.setTitle('🎉  Pack Completed!');
        embed.setDescription(
            `You received **${total} players**!\n\n` +
            `📚 Use \`/collection\` to view your cards.`
        );
    } else {
        embed.setTitle(`📦  Pack Opening  —  Card ${revealedSoFar.length}/${total}`);
        embed.setDescription(null);
    }

    // Add one field per revealed player
    for (const p of revealedSoFar) {
        const pcfg = RARITY_CONFIG[p.rarity] ?? RARITY_CONFIG.Common;
        embed.addFields({
            name:   `${pcfg.emoji}  ${p.name}`,
            value:  `🏟  ${p.club ?? 'Unknown'}  •  ⭐ ${p.overall ?? '?'}  •  *${p.rarity}*`,
            inline: false,
        });
    }

    // Show image only for the latest card if rarity warrants it
    if (cfg.showImage && latest.photo_url) {
        embed.setImage(latest.photo_url);
    }
    // Legendary gets a special thumbnail badge too
    if (latest.rarity === 'Legendary' && latest.photo_url) {
        embed.setThumbnail(latest.photo_url);
    }

    return embed;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export default {
    data: new SlashCommandBuilder()
        .setName('pack')
        .setDescription('Open a pack of 5 football cards'),

    async execute(interaction) {
        const discordId = interaction.user.id;
        const serverId  = interaction.guild.id;

        try {
            // 1. ACK immediately (Discord requires a reply within 3 s)
            await interaction.reply({
                embeds: [buildOpeningEmbed()],
            });

            // 2. Get or create user
            const user = getOrCreateUser(discordId, serverId);

            // 3. Draw pack — wrapped in a transaction for atomicity
            const packResults = db.transaction(() => {
                const drawn = [];

                for (let i = 0; i < PACK_SIZE; i++) {
                    const roll   = Math.random() * 100;
                    const rarity = getRarityFromRoll(roll);
                    const player = drawPlayer(rarity);

                    if (!player) continue; // skip if DB has no players of this rarity

                    saveCard(user.id, player.id, serverId);
                    drawn.push(player);
                }

                return drawn;
            })();

            if (packResults.length === 0) {
                await interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xE74C3C)
                            .setTitle('❌  No players found')
                            .setDescription('The player database appears to be empty.')
                            .setFooter({ text: 'Panini Bot • Pack System' }),
                    ],
                });
                return;
            }

            // 4. Suspense pause — let the "opening" embed breathe
            await sleep(OPENING_DELAY_MS);

            // 5. Progressive reveal loop
            //    Key fix: rebuild EmbedBuilder every iteration → no Discord image cache bug
            const revealed = [];

            for (let i = 0; i < packResults.length; i++) {
                revealed.push(packResults[i]);

                const isFinal = i === packResults.length - 1;
                const embed   = buildRevealEmbed(revealed, packResults.length, isFinal);

                await interaction.editReply({ embeds: [embed] });

                if (!isFinal) {
                    await sleep(REVEAL_DELAY_MS);
                }
            }

        } catch (error) {
            console.error('[/pack]', error);

            // Safe error fallback — use followUp if the reply was already sent
            const errorEmbed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle('❌  Error')
                .setDescription('Something went wrong while opening your pack. Please try again.')
                .setFooter({ text: 'Panini Bot • Pack System' });

            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch {
                await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    },
};