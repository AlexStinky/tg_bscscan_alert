const fs = require('fs');

const TelegrafI18n = require('telegraf-i18n/lib/i18n');

const i18n = new TelegrafI18n({
    directory: './locales',
    defaultLanguage: 'en',
    sessionName: 'session',
    useSession: true,
    templateData: {
        pluralize: TelegrafI18n.pluralize,
        uppercase: (value) => value.toUpperCase()
    }
});

const PAGINATIONS_SIZE = 5;

const DATE_OPTIONS = {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
};

const paginations = (lang, inline_keyboard, data, page, key, size = PAGINATIONS_SIZE) => {
    const length = data.length;

    if (length > 0) {
        if (page > 1 && (page * size) < length) {
            inline_keyboard[inline_keyboard.length] = [
                { text: i18n.t(lang, 'back_button'), callback_data: `next-${key}-${page - 1}` },
                { text: i18n.t(lang, 'next_button'), callback_data: `next-${key}-${page + 1}` }
            ];
        } else if (page === 1 && length > size) {
            inline_keyboard[inline_keyboard.length] = [
                { text: i18n.t(lang, 'next_button'), callback_data: `next-${key}-${page + 1}` }
            ];
        } else if (page > 1) {
            inline_keyboard[inline_keyboard.length] = [
                { text: i18n.t(lang, 'back_button'), callback_data: `next-${key}-${page - 1}` }
            ];
        }
    }

    return inline_keyboard;
};

const text = (lang, key, data) => i18n.t(lang, key, data);

const start = (lang, user, message_id = null) => {
    const message = {
        type: (message_id) ? 'edit_text' : 'text',
        message_id,
        text: i18n.t(lang, 'start_message'),
        extra: {}
    };
    let inline_keyboard = [
        [{
            text: (user.isMonitor) ?
                i18n.t(lang, 'stopMonitor_button') : i18n.t(lang, 'startMonitor_button'),
            callback_data: 'monitor'
        }]
    ];

    message.extra = {
        reply_markup: {
            inline_keyboard
        }
    };

    return message;
};

const monitor = (lang, data) => {
    const message = {
        type: 'text',
        text: i18n.t(lang, 'monitor_message', data),
        extra: {}
    };

    return message;
};

const userInfo = (lang, user, message_id = null) => {
    const message = {
        type: (message_id) ? 'edit_text' : 'text',
        message_id,
        text: i18n.t(lang, 'userInfo_message', {
            user: i18n.t(lang, 'user_url', {
                id: user.chat_id,
                username: user.username
            }),
            isAdmin: (user.isAdmin) ? '✅' : '❌'
        }),
        extra: {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: i18n.t(lang, 'back_button'),
                        callback_data: 'cancel'
                    }]
                ]
            }
        }
    };

    return message;
};

module.exports = {
    text,
    start,
    monitor,
    userInfo
}