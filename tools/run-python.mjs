/** Locate Python 3 consistently on Windows, macOS, and Linux, then run a tool. */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/run-python.mjs <script.py> [arguments...]');
  process.exit(2);
}

const configured = process.env.POKEREV_PYTHON;
const candidates = configured
  ? [{ command: configured, prefix: [] }]
  : process.platform === 'win32'
    ? [
        { command: 'py', prefix: ['-3'] },
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] },
      ]
    : [
        { command: 'python3', prefix: [] },
        { command: 'python', prefix: [] },
      ];

const python = candidates.find(({ command, prefix }) => {
  const probe = spawnSync(command, [...prefix, '--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return probe.status === 0 && /Python 3\./.test(`${probe.stdout || ''}${probe.stderr || ''}`);
});

if (!python) {
  console.error('Python 3 was not found. Install it, or set POKEREV_PYTHON to its executable path.');
  process.exit(1);
}

const result = spawnSync(python.command, [...python.prefix, ...args], {
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
