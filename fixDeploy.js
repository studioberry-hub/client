const fs = require('fs');
let py = fs.readFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', 'utf8');

// Add "data" to SKIP_DIRS
py = py.replace('SKIP_DIRS = {"node_modules", ".git", "deploy"}', 'SKIP_DIRS = {"node_modules", ".git", "deploy", "data"}');

// Remove the upload of .env file if it's dangerous, but it might be required if they updated it.
// Actually, let's keep it but tell the user to check their .env

fs.writeFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', py, 'utf8');
