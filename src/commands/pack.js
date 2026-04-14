const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pack')
        .setDescription('Open a pack of 5 football cards'),

    async execute(interaction) {
        await interaction.reply('🎁 Opening your pack...');
    }
};