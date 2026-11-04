const fs = require('fs');
fs.writeFileSync('D:/vbProj/cloudsrv/website/data/download-stats.json', JSON.stringify({ count: 1814, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
