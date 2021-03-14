const Discord = require('discord.js');
const config = require('./config.json');
const Keyv = require('keyv');

const prefixes = new Keyv('sqlite://D:/Projects/DiscordBot/prefixes.sqlite');
const globalPrefix = '>>';

// namespace: "timedBonusRoleConfig", key: guildId, value: enabled(bool)
// namespace: "timedBonusRoles", key: guildId, value: [{ roleId, minDuration }] - minDuration is in number of days
const bonusRoleConfig = new Keyv(`sqlite://${process.cwd()}/timedBonusRoles.sqlite`, { namespace: 'timedBonusRolesConfig' });
const timedBonusRoles = new Keyv(`sqlite://${process.cwd()}/timedBonusRoles.sqlite`, { namespace: 'timedBonusRoles' });

const client = new Discord.Client();

client.on('ready', async () => {
    console.log('Ready!');
    
    setInterval(assignRole, 24 * 60 * 60 * 1000);
    assignRole(client);
});

client.on('message', async message => {
    if (message.author.bot) return;

    let args;
    if (message.guild) {
        let prefix;
        if (message.content.startsWith(globalPrefix)) {
            prefix = globalPrefix;
        } else {
            // check the guild-level prefix
            const guildPrefix = await prefixes.get(message.guild.id);
            if (message.content.startsWith(guildPrefix)) prefix = guildPrefix;
        }

        if (!prefix) return;
        args = message.content.slice(prefix.length).trim().split(/\s+/);
    } else {
        // handle DMs
        const slice = message.content.startsWith(globalPrefix) ? globalPrefix.length : 0;
        args = message.content.slice(slice).split(/\s+/);
    }

    const command = args.shift().toLowerCase();

    switch (command) {
    case 'ping':
    {
        message.channel.send('Pong!');
        break;
    }
    case 'prefix':
    {
        if (!message.member.hasPermission('KICK_MEMBERS')) return message.reply('Error: insufficient permission.');

        if (args.length) {
            await prefixes.set(message.guild.id, args[0]);
            return message.channel.send(`Successfully set prefix to \`${args[0]}\``);
        }

        message.channel.send(`Prefix is \`${await prefixes.get(message.guild.id) || globalPrefix}\``);
        break;
    }

    case 'setup':
    case 'add':
    case 'enable': 
    {
        if (!message.guild) {
            return message.reply('This command is only available in a server');
        }

        if (!message.member.hasPermission('KICK_MEMBERS')) return message.reply('Error: You have insufficient permission.');
        if (!message.guild.me.hasPermission('MANAGE_ROLES')) return message.reply('I do not have the permission to manage roles. Please check and try again.');

        let channelName = await message.channel.name.toLowerCase();
        if (!await channelName.includes('bot')) return;
        let guildRREnabled = await bonusRoleConfig.get(message.guild.id);
        let currentGuildRewardRoles = await timedBonusRoles.get(message.guild.id);

        if (currentGuildRewardRoles?.length >= 1 && guildRREnabled) {
            let hasExistingRR = true;
            message.reply(`Are you sure to add a new role reward? There are ${currentGuildRewardRoles.length} active role rewards.\nType \`yes\` or \`cancel\``);
            await message.channel.awaitMessages(m => m.author.id === message.author.id, { max: 1, time: 45000, errors: ['time'] })
                .then(m => {
                    if (m.first().content == 'yes' || m.first().content == 'y') {
                        message.reply('Mention the role, and the number of days that a user has to be in this server to become eligible to receive the awarded role (seperated by a space)\n' +
                                'Type `cancel` to abort.');
                        m.first().channel.awaitMessages((m) => m.author.id === message.author.id, { max: 1, time: 90000, errors: ['time'] })
                            .then(async (m) => {
                                if (message.content.trim().startsWith('canc')) return message.reply('Ok.');
                                let { rewardRole, minDuration } = await setUpRoleReward(m.first(), hasExistingRR, currentGuildRewardRoles);
                                m.first().channel.send(`The role is being added to members that have been in this server for more than ${minDuration} days.`);
                                assignRole(client, m.first(), rewardRole, minDuration);

                            }).catch((e) => {
                                console.log(e);
                            });
                    } else {
                        return message.reply('Cancelled.');
                    }
                });
        } else {
            message.reply('Mention the role, and the number of days that a user has to be in this server to become eligible to receive the awarded role (seperated by a space)\n' +
                    'Type `cancel` to abort.');
            message.channel.awaitMessages((m) => m.author.id === message.author.id, { max: 1, time: 90000, errors: ['time'] })
                .then(async (m) => {
                    if (m.first().content.trim().startsWith('canc')) return message.reply('Ok.');
                    let { rewardRole, minDuration } = await setUpRoleReward(m.first());
                    m.first().channel.send(`The role is being added to members that have been in this server for more than ${minDuration} days.`);
                    assignRole(client, m.first(), rewardRole, minDuration);

                }).catch((e) => {
                    console.log(e);
                    message.reply('Error encountered: ' + e);
                });
        }
        break;
    }

    case 'list':
    {
        let guildId = message.guild.id,
            guildConfigEnabled = await bonusRoleConfig.get(guildId);
    
        if (!guildConfigEnabled) {
            return message.reply('No role reward config found for this server. You may set one using the \'add\' command.');
        } 

        let guildRRConfig = await timedBonusRoles.get(guildId);
        if (!guildRRConfig || guildRRConfig?.length < 1){
            return message.reply('No role reward config found for this server. You may set one using the \'add\' command.');
        }

        let richEmbed = new Discord.MessageEmbed().setTitle('List of time-based role rewards for this server');
        for (let index = 0; index < guildRRConfig.length; index++) {
            const element = guildRRConfig[index];
            let rewardedRole = await message.guild.roles.resolve(element.roleId);
            richEmbed.addFields([
                {name: `Reward Role #${index+1}`, value: rewardedRole},
                {name: 'Reward activation delay', value: `${element.minDuration} days`}
            ]);
        }
        message.reply(richEmbed);
        break;
    }

    }

});

client.on('roleDelete', async role => {
    console.log('roleDelete event fired');
    let roleId = role.id,
        guildId = role.guild.id;

    let guildRRConfig = await timedBonusRoles.get(guildId);
    if (guildRRConfig.length > 1) {let roleIndex = guildRRConfig.findIndex(element => element.roleId == roleId);
        await guildRRConfig.splice(roleIndex, 1);

        return await timedBonusRoles.set(guildId, guildRRConfig);
    } else {
        bonusRoleConfig.set(guildId, false);
        return await timedBonusRoles.delete(guildId);
    }
});

Date.prototype.addDays = function (d) {
    this.setTime(this.getTime() + (d * 24 * 60 * 60 * 1000));
    return this;
};

let setUpRoleReward = async (message, guildRREnabled, currentGuildRewardRoles) => {
    let guildId = message.guild.id;
    let newRewardRole = message.mentions.roles.first(),
        newRewardRoleId = newRewardRole.id;
    let _msgArgs = message.content.trim().split(/\s+/);
    let minDuration = parseInt(_msgArgs.pop());

    if (isNaN(minDuration)) throw message.reply('Cancelled.');

    if (!newRewardRoleId) { //if no roles were mentioned
        let roleId = (_msgArgs.length == 1) ? _msgArgs[0] : _msgArgs.join(' ');
        try {
            // @ts-ignore
            newRewardRoleId = await message.guild.roles.fetch(roleId).id;
        } catch (err) {
            throw message.reply('Encountered an error: ' + err);
        }
    }

    for (let index = 0; index < currentGuildRewardRoles.length; index++) {
        const element = currentGuildRewardRoles[index];
        if (element.roleId == newRewardRoleId) {
            message.reply(`Role ${newRewardRole} already registered for this server`);
            throw `Role ${newRewardRole} already registered for this server`;
        }
    }

    try {
        bonusRoleConfig.set(guildId, true);

        if (currentGuildRewardRoles?.length >= 1 && guildRREnabled) {
            currentGuildRewardRoles.push({ roleId: newRewardRoleId, minDuration: minDuration });
            timedBonusRoles.set(guildId, currentGuildRewardRoles);
        } else {
            let newBonusRolesConfig = [{ roleId: newRewardRoleId, minDuration: minDuration }];
            timedBonusRoles.set(guildId, newBonusRolesConfig);
        }

        message.reply(`All set!\nI'm adding the role to users that have been a member of this server for ${minDuration} days`);

    } catch (err) {
        throw message.reply('Encountered an error: ' + err);
    }

    return { rewardRole: newRewardRoleId, minDuration };
};


async function assignRole(/** @type {Discord.Client} */ client, /** @type {Discord.Message} */ message, /** @type {String} */ role, minDuration) {
    if (!message) {
        client.guilds.cache.each(async (guild) => {
            let guildId = guild.id;
            let guildConfigEnabled = await bonusRoleConfig.get(guild.id);
            let guildConfig = await timedBonusRoles.get(guildId);
            if (!guildConfigEnabled || guildConfig?.length < 1 || !guildConfig) {
                console.log(`Config not found for guild ${guildId}`);
                return;
            }

            guildConfig.forEach(async (/** @type {{ roleId: any; minDuration: Number; }} */ element) => {
                let { roleId: bonusRoleId, minDuration } = element;
                let allGuildMembers = await guild.members.fetch();
                allGuildMembers.each(async (/** @type {Discord.GuildMember} */ gmember) => {
                    if (gmember.user.bot)
                        return;
                    let hasRole = gmember.roles.cache.has(bonusRoleId);
                    let joinDate = gmember.joinedAt;

                    if (!hasRole) {
                        let now = Date.now(); //@ts-expect-error
                        if (now < joinDate.addDays(minDuration)) {
                            hasRole = false;
                        } else {
                            try {
                                gmember.roles.add(bonusRoleId);
                            } catch (err) {console.log(err);}
                            hasRole = true;
                        }
                    }
                });
            });

        });
    } else if (message && role) {
        let bonusRole = role;
        let allGuildMembers = await message.guild.members.fetch();
        try {
            allGuildMembers.each(async (/** @type {Discord.GuildMember} */ gmember) => {
                if (gmember.user.bot)
                    return;
                // @ts-ignore
                let hasRole = gmember.roles.cache.has(bonusRole);
                let joinDate = gmember.joinedAt;

                if (!hasRole) {
                    let now = Date.now(); //@ts-expect-error
                    if (now < joinDate.addDays(minDuration)) {
                        hasRole = false;
                    } else {
                        gmember.roles.add(bonusRole);
                        hasRole = true;
                    }
                }

            });
        } catch (err) {
            message.reply('Encountered an error: ' + err);
        }
    }
}

client.on('error', console.error);

client.login(config.token);