const fs = require('fs');
let py = fs.readFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', 'utf8');

py = py.replace('SKIP_DIRS = {"node_modules", ".git", "deploy", "data"}', 'SKIP_DIRS = {"node_modules", ".git", "deploy", "data", "uploads"}');
if (!py.includes('"uploads"')) {
    py = py.replace('SKIP_DIRS = {"node_modules", ".git", "deploy"}', 'SKIP_DIRS = {"node_modules", ".git", "deploy", "data", "uploads"}');
}

fs.writeFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', py, 'utf8');
