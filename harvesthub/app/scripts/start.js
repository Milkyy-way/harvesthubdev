// `npm start`: the Expo dev server for the development build ("HarvestHub
// Dev" — see app.config.ts). Sets APP_VARIANT=development, which `npx expo
// start` on its own wouldn't, then passes any extra arguments through.
const { spawn } = require('child_process');
const path = require('path');

const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin', 'cli');
const child = spawn(process.execPath, [cli, 'start', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, APP_VARIANT: process.env.APP_VARIANT || 'development' },
});
child.on('exit', (code) => process.exit(code ?? 0));
