const CDP = require('chrome-remote-interface');

async function getTabs() {
    const tabs = await CDP.List({ host: 'localhost', port: 9222 });
    return tabs.filter(t => t.type === 'page');
}

module.exports = { getTabs };

// usage: 
// const{getTabs} = require{'./chrome'};
// const tabs = await getTabs();