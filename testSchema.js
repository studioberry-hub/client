const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Remove from linux
if (pkg.build.linux) {
  delete pkg.build.linux.desktopName;
  delete pkg.build.linux.syncDesktopName;
}

// Add desktopName to build
// The warning said: "Set desktopName in package.json and linux.syncDesktopName: true"
// Oh, actually maybe linux DOES have syncDesktopName?
// Let's test by running electron-builder config validation.

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
