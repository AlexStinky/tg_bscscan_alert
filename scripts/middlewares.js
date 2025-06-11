const messages = require('./messages');

const { sender } = require('../services/sender');
const { web3Service } = require('../services/web3');
const {
    userDBService,
    walletDBService
} = require('../services/db');

const ADMINS = process.env.ADMINS.split(',');

const LANGUAGES = /uk/;

const start = async (ctx, next) => {
    const { message } = ctx.update.callback_query || ctx.update;

    if (message) {
        try {
            ctx.state.user = await userDBService.get({ chat_id: ctx.from.id });

            if (message.chat.type === 'private') {
                const lang = (LANGUAGES.test(ctx.from.language_code)) ?
                    ctx.from.language_code : 'uk';
                const username = ctx.chat.username || ctx.from.username || ctx.from.first_name;

                if (!ctx.state.user) {
                    const user = {
                        chat_id: ctx.from.id,
                        username,
                        lang
                    };

                    ctx.state.user = await userDBService.create(user);
                }

                await ctx.i18n.locale(lang);

                if (ctx.state.user.username !== username || ctx.state.user.lang !== lang) {
                    ctx.state.user = await userDBService.update({ chat_id: ctx.from.id }, {
                        isActive: true,
                        lang,
                        username
                    }, 'after');
                }
            }
        } catch (error) {
            console.log(error)
        }
    }

    return next();
};

const commands = async (ctx, next) => {
    const { message } = ctx.update;

    const { user } = ctx.state;

    if (message && message.text) {
        const { text } = message;

        const match = text.split(' ');

        let chat_id = message.chat.id,
            response_message = null,
            update = null;

        if (message.chat.type === 'private') {
            if (match[0] === '/start') {
                response_message = messages.start(user.lang, user);

                await ctx.scene.leave();
            }

            if (text === ctx.i18n.t('cancel_button')) {
                response_message = messages.start(user.lang, user);

                await ctx.replyWithHTML('👍', {
                    reply_markup: {
                        remove_keyboard: true
                    }
                });

                await ctx.scene.leave();
            }

            if (web3Service.NEW_WALLET_REG.test(text)) {
                const [name, address, token_ticker, wanted_volume_per_day] = text.split(':');

                console.log(name, address, token_ticker, wanted_volume_per_day)

                let wallet = await walletDBService.get({
                    address,
                    token_ticker,
                    wanted_volume_per_day
                });

                if (!wallet) {
                    wallet = await walletDBService.create({
                        chats: [user.chat_id],
                        name,
                        address,
                        token_ticker,
                        wanted_volume_per_day
                    });
                } else {
                    wallet = await walletDBService.update({ _id: wallet._id }, {
                        $addToSet: {
                            chats: user.chat_id
                        }
                    }, 'after');
                }

                if (wallet) {
                    update = {
                        $addToSet: {
                            wallets: wallet._id
                        }
                    };
                }

                response_message = messages.start(user.lang, user);
                response_message.text = ctx.i18n.t('walletAdded_message');
            }

            if (user.isAdmin || ADMINS.includes(user.chat_id)) {
                if (match[0] === '/admin') {
                    const check = await userDBService.get({
                        $or: [
                            { chat_id: match[1] },
                            { username: match[1] }
                        ]
                    });
                
                    if (check) {
                        check.isAdmin = (user.chat_id == check.chat_id) ?
                            true : !check.isAdmin;

                        await userDBService.update({ chat_id: check.chat_id }, check);
                
                        response_message = messages.userInfo(user.lang, check);
                    }
                }
            }
        }

        if (update) {
            await userDBService.update({ chat_id }, update);
        }

        if (response_message) {
            sender.enqueue({
                chat_id,
                message: response_message
            });
        }
    }

    return next();
};

const cb = async (ctx, next) => {
    const { callback_query } = ctx.update;

    const { user } = ctx.state;

    if (callback_query) {
        const now = new Date();

        const { message } = callback_query;
        const { message_id } = message;

        const chat_id = message.chat.id;

        const match = callback_query.data.split('-');

        let deleteMessage = false,
            response_message = null,
            update = null,
            answer = null;

        if (callback_query.message.chat.type === 'private') {
            if (match[0] === 'cancel') {
                deleteMessage = true;
                response_message = messages.start(user.lang, user);

                await ctx.scene.leave();
            }

            if (match[0] === 'monitor') {
                if (user.wallets.length > 0) {}
            }
        }

        if (update) {
            await userDBService.update({ chat_id }, update);
        }

        if (deleteMessage) {
            await sender.deleteMessage(chat_id, message_id);
        }

        if (answer) {
            await ctx.answerCbQuery(answer, true);
        }

        if (response_message) {
            sender.enqueue({
                chat_id,
                message: response_message
            });
        }
    }

    return next();
};

module.exports = {
    start,
    commands,
    cb
}