const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Fix snap deprecation by removing it
if (pkg.build && pkg.build.snap) {
  delete pkg.build.snap;
}

// Fix window association by setting desktopName and syncDesktopName
if (pkg.build && pkg.build.linux) {
  // Executable name is 'uclient'
  pkg.build.linux.desktopName = "uclient";
  pkg.build.linux.syncDesktopName = true;
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2), 'utf8');
console.log('Fixed electron-builder warnings');
