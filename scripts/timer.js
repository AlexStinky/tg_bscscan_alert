const fs = require('fs');

const cron = require('node-cron');

cron.schedule('8 2 * * *', () => {
    const folder = './files';

    fs.readdir(folder, (err, files) => {
        if (err) return console.error('[timer]', err);

        files.forEach(file => {
            const fullPath = folder + '/' + file;

            fs.stat(fullPath, (err, stats) => {
                if (err) return console.error('[timer]', err);

                if (stats.isFile()) {
                    fs.unlink(fullPath, (err) => {
                        if (err) return console.error('[timer]', err);
                    });
                }
            });
        });
    });
});