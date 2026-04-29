'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, exec } = require('child_process');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function getProjectName(projectDir) {
  if (!projectDir) return '';
  const homeDir = os.homedir();
  const normalized = projectDir.replace(/\/+$/, '');
  if (normalized === homeDir) return '';
  const cleaned = projectDir.replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const name = parts[parts.length - 1] || cleaned;
  const generic = new Set([
    pathBasename(homeDir),
    'home',
    'root',
    'workspace',
    'projects',
    'src',
    'code',
    'repo',
  ]);
  if (!name || name.length < 4 || generic.has(name.toLowerCase())) return '';
  return name;
}

function pathBasename(targetPath) {
  const cleaned = String(targetPath || '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}

function tokenizeHintText(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(token => token.length >= 4)
    .slice(0, 8);
}

function makeSessionTitle(sessionId, tool, projectDir, firstMessage) {
  const project = getProjectName(projectDir) || tool;
  const shortId = String(sessionId || '').slice(0, 8);
  const topic = tokenizeHintText(firstMessage).slice(0, 3).join(' ');
  const suffix = topic ? ` ${topic}` : '';
  return `codedash ${tool} ${project} ${shortId}${suffix}`.trim();
}

function buildLinuxBashCommand(fullCmd, title) {
  if (!title) return `${fullCmd}; exec bash`;
  const safeTitle = String(title).replace(/"/g, '\\"');
  return `printf "\\033]0;${safeTitle}\\007"; export PROMPT_COMMAND='printf "\\033]0;${safeTitle}\\007"'; ${fullCmd}; exec bash`;
}

function parseLinuxWindows() {
  try {
    const output = execSync('wmctrl -lp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return output
      .split('\n')
      .map(line => {
        const match = line.match(/^(\S+)\s+(-?\d+)\s+(\d+)\s+\S+\s+(.*)$/);
        if (!match) return null;
        return {
          id: match[1],
          desktop: parseInt(match[2], 10),
          pid: parseInt(match[3], 10),
          title: match[4] || '',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function scoreLinuxWindow(windowTitle, hints) {
  const title = String(windowTitle || '').toLowerCase();
  if (!title) return 0;

  if (!title.includes('codedash')) return 0;
  if (hints.sessionId && title.includes(hints.sessionId)) return 200;
  if (hints.shortId && title.includes(hints.shortId)) return 120;
  return 0;
}

function focusExistingLinuxWindow(sessionId, tool, projectDir, firstMessage) {
  const hints = {
    sessionId: String(sessionId || '').toLowerCase(),
    shortId: String(sessionId || '').slice(0, 8).toLowerCase(),
    projectName: getProjectName(projectDir).toLowerCase(),
    tool,
    messageTokens: tokenizeHintText(firstMessage),
  };

  const windows = parseLinuxWindows();
  const ranked = windows
    .map(win => ({ ...win, score: scoreLinuxWindow(win.title, hints) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 120) return null;

  try {
    const helperPath = path.join(__dirname, 'focus_window.py');
    const envPrefix = [
      process.env.DISPLAY ? `DISPLAY=${shellQuote(process.env.DISPLAY)}` : '',
      process.env.XAUTHORITY ? `XAUTHORITY=${shellQuote(process.env.XAUTHORITY)}` : '',
      process.env.DBUS_SESSION_BUS_ADDRESS ? `DBUS_SESSION_BUS_ADDRESS=${shellQuote(process.env.DBUS_SESSION_BUS_ADDRESS)}` : '',
    ].filter(Boolean).join(' ');
    const focusCmd = `${envPrefix ? `${envPrefix} ` : ''}python3 ${shellQuote(helperPath)} ${best.id}`;
    exec(`bash -lc ${shellQuote(`sleep 0.2; ${focusCmd}`)}`);
    return { action: 'focused', windowId: best.id, windowTitle: best.title, score: best.score };
  } catch {
    return null;
  }
}

// ── Detect available terminals ──────────────────────────────

function detectTerminals() {
  const terminals = [];
  const platform = process.platform;

  if (platform === 'darwin') {
    // Check iTerm2
    try {
      execSync('osascript -e \'application id "com.googlecode.iterm2"\'', { stdio: 'pipe' });
      terminals.push({ id: 'iterm2', name: 'iTerm2', available: true });
    } catch {
      terminals.push({ id: 'iterm2', name: 'iTerm2', available: false });
    }
    // Terminal.app always available on macOS
    terminals.push({ id: 'terminal', name: 'Terminal.app', available: true });
    // Check Warp
    try {
      if (fs.existsSync('/Applications/Warp.app')) {
        terminals.push({ id: 'warp', name: 'Warp', available: true });
      }
    } catch {}
    // Check Kitty
    try {
      execSync('which kitty', { stdio: 'pipe' });
      terminals.push({ id: 'kitty', name: 'Kitty', available: true });
    } catch {}
    // Check Alacritty
    try {
      execSync('which alacritty', { stdio: 'pipe' });
      terminals.push({ id: 'alacritty', name: 'Alacritty', available: true });
    } catch {}
  } else if (platform === 'linux') {
    const linuxTerms = [
      { id: 'xfce4-terminal', name: 'XFCE Terminal', cmd: 'xfce4-terminal' },
      { id: 'gnome-terminal', name: 'GNOME Terminal', cmd: 'gnome-terminal' },
      { id: 'konsole', name: 'Konsole', cmd: 'konsole' },
      { id: 'kitty', name: 'Kitty', cmd: 'kitty' },
      { id: 'alacritty', name: 'Alacritty', cmd: 'alacritty' },
      { id: 'xterm', name: 'xterm', cmd: 'xterm' },
    ];
    for (const t of linuxTerms) {
      try {
        execSync(`which ${t.cmd}`, { stdio: 'pipe' });
        terminals.push({ ...t, available: true });
      } catch {
        terminals.push({ ...t, available: false });
      }
    }
  } else {
    terminals.push({ id: 'cmd', name: 'Command Prompt', available: true });
    terminals.push({ id: 'powershell', name: 'PowerShell', available: true });
    try {
      execSync('where wt', { stdio: 'pipe' });
      terminals.push({ id: 'windows-terminal', name: 'Windows Terminal', available: true });
    } catch {}
  }

  return terminals;
}

// ── Terminal launch ─────────────────────────────────────────

function openInTerminal(sessionId, tool, flags, projectDir, terminalId, firstMessage = '') {
  const skipPerms = flags.includes('skip-permissions');
  let cmd;

  if (tool === 'codex') {
    cmd = `codex resume ${sessionId}`;
  } else {
    cmd = `claude --resume ${sessionId}`;
    if (skipPerms) cmd += ' --dangerously-skip-permissions';
  }

  const cdPart = projectDir ? `cd ${JSON.stringify(projectDir)} && ` : '';
  const fullCmd = cdPart + cmd;
  const escapedCmd = fullCmd.replace(/"/g, '\\"');
  const title = makeSessionTitle(sessionId, tool, projectDir, firstMessage);

  const platform = process.platform;

  if (platform === 'darwin') {
    switch (terminalId) {
      case 'terminal':
        execSync(`osascript -e 'tell application "Terminal"
          activate
          do script "${escapedCmd}"
        end tell'`);
        break;
      case 'warp':
        execSync(`osascript -e 'tell application "Warp"
          activate
        end tell'`);
        // Warp doesn't have great AppleScript support, use open
        setTimeout(() => exec(`osascript -e 'tell application "System Events" to keystroke "${fullCmd}" & return'`), 500);
        break;
      case 'kitty':
        exec(`kitty --single-instance bash -c '${fullCmd}; exec bash'`);
        break;
      case 'alacritty':
        exec(`alacritty -e bash -c '${fullCmd}; exec bash'`);
        break;
      case 'iterm2':
      default: {
        const script = `
          tell application "iTerm"
            activate
            set newWindow to (create window with default profile)
            tell current session of newWindow
              write text "${escapedCmd}"
            end tell
          end tell
        `;
        try {
          execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { stdio: 'pipe' });
        } catch {
          // Fallback to Terminal.app
          execSync(`osascript -e 'tell application "Terminal" to do script "${escapedCmd}"'`);
        }
        break;
      }
    }
    return { action: 'launched', mode: 'new_terminal' };
  } else if (platform === 'linux') {
    const focused = focusExistingLinuxWindow(sessionId, tool, projectDir, firstMessage);
    if (focused) return focused;

    const quotedCmd = shellQuote(buildLinuxBashCommand(fullCmd, title));
    const quotedTitle = shellQuote(title);
    const quotedProject = projectDir ? shellQuote(projectDir) : '';

    switch (terminalId) {
      case 'xfce4-terminal':
        exec(`xfce4-terminal --disable-server --title=${quotedTitle}${projectDir ? ` --working-directory=${quotedProject}` : ''} --command=${shellQuote(`bash -lc ${quotedCmd}`)}`);
        break;
      case 'kitty':
        exec(`kitty --title ${quotedTitle} bash -lc ${quotedCmd}`);
        break;
      case 'alacritty':
        exec(`alacritty --title ${quotedTitle} -e bash -lc ${quotedCmd}`);
        break;
      case 'konsole':
        exec(`konsole${projectDir ? ` --workdir ${quotedProject}` : ''} -p tabtitle=${quotedTitle} -e bash -lc ${quotedCmd}`);
        break;
      case 'xterm':
        exec(`xterm -T ${quotedTitle} -e bash -lc ${quotedCmd}`);
        break;
      case 'gnome-terminal':
      default:
        exec(`gnome-terminal --title=${quotedTitle}${projectDir ? ` --working-directory=${quotedProject}` : ''} -- bash -lc ${quotedCmd}`);
        break;
    }
    return { action: 'launched', mode: 'new_terminal', title };
  } else {
    switch (terminalId) {
      case 'powershell':
        exec(`start powershell -NoExit -Command "${fullCmd}"`);
        break;
      case 'windows-terminal':
        exec(`wt new-tab cmd /k "${fullCmd}"`);
        break;
      default:
        exec(`start cmd /k "${fullCmd}"`);
        break;
    }
    return { action: 'launched', mode: 'new_terminal' };
  }
}

module.exports = { detectTerminals, openInTerminal };
