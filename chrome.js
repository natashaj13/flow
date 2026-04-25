const CDP = require('chrome-remote-interface');
tabs = CDP.List({ host: 'localhost', port: 9222 }).then(tabs => {
    console.log(tabs);
});
