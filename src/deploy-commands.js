require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');

const commands = [];
const commandFiles = fs.readdirSync('./src/commands');

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    commands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🔄 Refreshing commands...');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, '922159546447847434'),
            { body: commands }
        );

        console.log('✅ Commands registered');
    } catch (error) {
        console.error(error);
    }
})();