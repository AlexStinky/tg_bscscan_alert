require('dotenv').config();
//require('./scripts/logger').start();

const mongoose = require('mongoose');

const { Telegraf } = require('telegraf');
const { Stage, session } = Telegraf;
const TelegrafI18n = require('telegraf-i18n/lib/i18n');
const rateLimit = require('telegraf-ratelimit');

const middlewares = require('./scripts/middlewares');

const { sender } = require('./services/sender');
const { web3Service } = require('./services/web3');

const DB_CONN = process.env.DB_CONN;
const BOT_TOKEN = process.env.BOT_TOKEN;

const mongoClient = mongoose.connect(DB_CONN, {
	useUnifiedTopology: true,
	useNewUrlParser: true,
});

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 100 });

const { telegram: tg } = bot;

const limitConfig = {
	window: 1000,
	limit: 1,
	onLimitExceeded: (ctx, next) => ctx.telegram.sendChatAction(ctx.from.id, 'typing'),
};

const i18n = new TelegrafI18n({
	directory: './locales',
	defaultLanguage: 'en',
	sessionName: 'session',
	useSession: true,
	templateData: {
		pluralize: TelegrafI18n.pluralize, uppercase: (value) => value.toUpperCase(),
  	},
});

const stage = new Stage([]);

tg.callApi('getUpdates', { offset: -1 })
	.then(updates => updates.length && updates[0].update_id + 1)
	.then(offset => { if (offset) return tg.callApi('getUpdates', { offset }); })
	.then(() => bot.launch())
	.then(() => console.info('The bot is launched'))
	.catch(err => console.error(err));

bot.use(session());
bot.use(i18n.middleware());
bot.use(stage.middleware());
bot.use(rateLimit(limitConfig));

bot.use(middlewares.start);
bot.use(middlewares.commands);
bot.use(middlewares.cb);

bot.catch(err => console.error(err));

bot.telegram.getMe().then((botInfo) => {
    const now = new Date();
    const botUsername = botInfo.username;

    console.log(now);
    console.log(`Username: @${botUsername}`);
});

(async () => {
    /*const fs = require('fs');

    if (!fs.existsSync('./config.json')) {
		fs.writeFileSync('./config.json', fs.readFileSync('./config_example.json'));
    }*/

    await sender.create(bot);

	await web3Service.monitorWallets();
})()

process.once('SIGINT', async () => {
    await bot.stop();
    await mongoClient();
});
process.once('SIGTERM', async () => {
    await bot.stop();
    await mongoClient();
});