const fs = require('fs');
let py = fs.readFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', 'utf8');

py = py.replace('setup_20.x', 'setup_22.x');
py = py.replace('major < 18', 'major < 22');

fs.writeFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', py, 'utf8');
console.log('Fixed deploy.py to install Node 22');
