const fs = require('fs');
let code = fs.readFileSync('D:/vbProj/cloudsrv/website/deploy/nginx-uclient.conf', 'utf8');
code = code.replace(/client_max_body_size 8m;/g, 'client_max_body_size 100m;');
fs.writeFileSync('D:/vbProj/cloudsrv/website/deploy/nginx-uclient.conf', code, 'utf8');
