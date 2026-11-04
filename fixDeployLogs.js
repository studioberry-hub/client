const fs = require('fs');
let py = fs.readFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', 'utf8');

// Replace the restart command to not check and instead print journalctl
py = py.replace(
  'run(client, f"systemctl restart {SERVICE_NAME}")',
  `code, out, err = run(client, f"systemctl restart {SERVICE_NAME}", check=False)\n        if code != 0:\n            run(client, f"journalctl -xeu {SERVICE_NAME} --no-pager | tail -n 50", check=False)\n            raise RuntimeError("Service failed to start!")`
);

fs.writeFileSync('D:/vbProj/cloudsrv/website/deploy/deploy.py', py, 'utf8');
console.log('Modified deploy.py to print logs on failure');
