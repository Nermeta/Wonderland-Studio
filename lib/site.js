/** Runs `bundle exec jekyll serve` for the site clone so you can check it locally. */
const { spawn } = require('child_process');

let PORT = 4000;
let child = null;
let state = { status: 'stopped', url: `http://127.0.0.1:${PORT}/`, log: [], hint: '' };

const push = line => { state.log.push(line); if (state.log.length > 60) state.log.shift(); };

function hintFor(text) {
  if (/ENOENT|not found|is not recognized/i.test(text)) return 'Ruby and Bundler are not installed. Install them (sudo apt install ruby-full build-essential), then run “bundle install” in the site folder.';
  if (/Could not find gem|bundle install|Bundler::GemNotFound|Could not locate Gemfile/i.test(text)) return 'The site’s gems are missing. Run “bundle install” in the site folder once, then start the preview again.';
  if (/Address already in use|EADDRINUSE/i.test(text)) return `Port ${PORT} is already in use. Stop whatever is serving it, then try again.`;
  return '';
}

function start(repo, { cmd = 'bundle', port = PORT, args } = {}) {
  if (child) return status();
  PORT = port;
  args = args || ['exec', 'jekyll', 'serve', '--host', '127.0.0.1', '--port', String(PORT), '--livereload'];
  state = { status: 'starting', url: `http://127.0.0.1:${PORT}/`, log: [], hint: '' };
  let p;
  try { p = spawn(cmd, args, { cwd: repo, windowsHide: true, env: process.env }); }
  catch (e) { state.status = 'error'; push(e.message); state.hint = hintFor(e.message); return status(); }
  child = p;
  const take = buf => {
    for (const line of String(buf).split(/\r?\n/).filter(Boolean)) {
      push(line);
      if (/Server running|Server address/i.test(line) && state.status === 'starting') state.status = 'ready';
    }
  };
  p.stdout.on('data', take); p.stderr.on('data', take);
  p.on('error', e => { push(e.message); state.status = 'error'; state.hint = hintFor(e.code + ' ' + e.message); child = null; });
  p.on('exit', code => {
    if (child === p) child = null;
    if (state.status !== 'stopped') {
      state.status = state.status === 'ready' ? 'stopped' : 'error';
      if (state.status === 'error') { push(`Exited with code ${code}.`); state.hint = state.hint || hintFor(state.log.join('\n')); }
    }
  });
  return status();
}

function stop() {
  if (child) { state.status = 'stopped'; child.kill('SIGTERM'); child = null; }
  else if (state.status !== 'error') state.status = 'stopped';
  return status();
}

const status = () => ({ ...state, log: state.log.slice(-25) });
process.on('exit', () => { if (child) child.kill('SIGTERM'); });

module.exports = { start, stop, status };
