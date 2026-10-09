#!/usr/bin/env node
/**
 * npm run shortcut: put a "Wonderland Studio" icon on your desktop that starts the Studio.
 *   Windows + WSL: a desktop shortcut that runs this folder inside your Linux distro.
 *   Linux: a .desktop launcher.   macOS: a double-clickable .command file.
 * Add --print to see what would be created without changing anything.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const NAME = 'Wonderland Studio';
const ICO = path.join(ROOT, 'assets', 'studio.ico');
const PNG = path.join(ROOT, 'assets', 'studio.png');
const psq = s => `'${String(s).replace(/'/g, "''")}'`; // PowerShell single-quoted string

/** The PowerShell that creates the shortcut. Pure, so it can be tested. */
function powershellScript({ distro, linuxPath }) {
  const args = `-d "${distro}" --cd "${linuxPath}" -e bash "${linuxPath}/scripts/launch.sh"`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$icon = Join-Path (Join-Path $env:LOCALAPPDATA 'WonderlandStudio') 'studio.ico'",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$lnk = Join-Path $desktop ${psq(NAME + '.lnk')}`,
    '$ws = New-Object -ComObject WScript.Shell',
    '$s = $ws.CreateShortcut($lnk)',
    "$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wsl.exe'",
    `$s.Arguments = ${psq(args)}`,
    '$s.WorkingDirectory = $env:USERPROFILE',
    '$s.IconLocation = "$icon,0"',
    '$s.WindowStyle = 1',
    `$s.Description = ${psq('Start the Wonderland Studio and open it in your browser')}`,
    '$s.Save()',
    'Write-Output $lnk'
  ].join('\n');
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const isWsl = () => !!process.env.WSL_DISTRO_NAME || (fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')));

function windowsViaWsl(print) {
  const distro = process.env.WSL_DISTRO_NAME;
  if (!distro) throw new Error('Could not tell which WSL distribution this is (WSL_DISTRO_NAME is empty).');
  const script = powershellScript({ distro, linuxPath: ROOT });
  if (print) { console.log(script); return; }
  const winLocal = run('cmd.exe', ['/c', 'echo %LOCALAPPDATA%'], { cwd: '/mnt/c' }).replace(/\r/g, '');
  const unixLocal = run('wslpath', ['-u', winLocal]);
  const dir = path.join(unixLocal, 'WonderlandStudio');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(ICO, path.join(dir, 'studio.ico')); // shortcut icons load reliably from a normal Windows folder
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const out = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { cwd: '/mnt/c' });
  console.log(`\n  ♠ Created the “${NAME}” shortcut on your desktop:\n    ${out.split(/\r?\n/).pop()}\n`);
  console.log('  Double-click it to start the Studio. It opens in your browser; keep the minimized window open while you work.');
  console.log('  Right-click it → “Pin to taskbar” (or Pin to Start) if you like.\n');
}

function linuxDesktop(print) {
  const exec = `bash -lc 'cd "${ROOT}" && npm run launch'`;
  const entry = `[Desktop Entry]\nType=Application\nName=${NAME}\nComment=Start the Wonderland Studio\nExec=${exec}\nIcon=${PNG}\nTerminal=true\nCategories=Development;\n`;
  if (print) { console.log(entry); return; }
  const targets = [path.join(os.homedir(), '.local', 'share', 'applications'), path.join(os.homedir(), 'Desktop')].filter(d => fs.existsSync(d) || d.includes('applications'));
  for (const d of targets) {
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 'wonderland-studio.desktop');
    fs.writeFileSync(f, entry, { mode: 0o755 });
    console.log(`  Created ${f}`);
  }
  console.log('  If the desktop copy shows a warning, right-click it and choose “Allow Launching”.');
}

function macCommand(print) {
  const body = `#!/bin/bash\ncd "${ROOT}" && npm run launch\n`;
  if (print) { console.log(body); return; }
  const f = path.join(os.homedir(), 'Desktop', `${NAME}.command`);
  fs.writeFileSync(f, body, { mode: 0o755 });
  console.log(`  Created ${f}. Double-click it to start the Studio.`);
}

if (require.main === module) {
  const print = process.argv.includes('--print');
  try {
    if (process.platform === 'win32') {
      console.log('  Run this from inside WSL (Ubuntu) so the Studio and its shortcut are in the same place. See the README.');
      process.exit(1);
    } else if (isWsl()) windowsViaWsl(print);
    else if (process.platform === 'darwin') macCommand(print);
    else linuxDesktop(print);
  } catch (e) { console.error(`  Could not create the shortcut: ${e.message}`); process.exit(1); }
}

module.exports = { powershellScript };
