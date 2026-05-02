/**
 * file-manager.js — File operations on MicroPython device via raw REPL.
 *
 * Provides list, read, write, and delete for files on the Pico W.
 * All operations enter raw REPL, execute Python, then exit + soft reset.
 */

import { escapePython } from './raw-repl.js';

const WRITE_CHUNK_SIZE = 1536; // bytes per f.write() call within a single exec

/**
 * Creates a file manager.
 *
 * @param {object} rawRepl — raw REPL controller from raw-repl.js
 */
export function createFileManager(rawRepl) {

  /**
   * List files in root directory.
   * @returns {Promise<string[]>} array of filenames
   */
  async function listFiles() {
    await rawRepl.enter();
    try {
      const { stdout, stderr } = await rawRepl.exec(
        'import os\nfor f in sorted(os.listdir("/")):\n print(f)'
      );
      if (stderr.trim()) {
        throw new Error('listFiles error: ' + stderr.trim());
      }
      await rawRepl.exit();
      await rawRepl.softReset();
      return stdout.trim().split(/\r?\n/).map(f => f.trim()).filter(f => f.length > 0);
    } catch (err) {
      try { await rawRepl.exit(); await rawRepl.softReset(); } catch {}
      throw err;
    }
  }

  /**
   * Read a file's contents.
   * @param {string} filename
   * @returns {Promise<string>} file contents
   */
  async function readFile(filename) {
    await rawRepl.enter();
    try {
      const { stdout, stderr } = await rawRepl.exec(
        `f=open('${filename}','r')\nprint(f.read(),end='')\nf.close()`
      );
      if (stderr.trim()) {
        throw new Error(`readFile(${filename}) error: ${stderr.trim()}`);
      }
      await rawRepl.exit();
      await rawRepl.softReset();
      return stdout;
    } catch (err) {
      try { await rawRepl.exit(); await rawRepl.softReset(); } catch {}
      throw err;
    }
  }

  /**
   * Write content to a file. For large files, splits into multiple f.write() calls.
   * @param {string} filename
   * @param {string} content
   */
  async function writeFile(filename, content) {
    await rawRepl.enter();
    try {
      if (content.length <= WRITE_CHUNK_SIZE) {
        // Single write
        const escaped = escapePython(content);
        const { stderr } = await rawRepl.exec(
          `f=open('${filename}','w')\nf.write('''${escaped}''')\nf.close()\nprint('ok')`,
          15000
        );
        if (stderr.trim()) {
          throw new Error(`writeFile(${filename}) error: ${stderr.trim()}`);
        }
      } else {
        // Multi-chunk write
        let code = `f=open('${filename}','w')\n`;
        for (let i = 0; i < content.length; i += WRITE_CHUNK_SIZE) {
          const chunk = content.slice(i, i + WRITE_CHUNK_SIZE);
          const escaped = escapePython(chunk);
          code += `f.write('''${escaped}''')\n`;
        }
        code += `f.close()\nprint('ok')`;
        const { stderr } = await rawRepl.exec(code, 30000);
        if (stderr.trim()) {
          throw new Error(`writeFile(${filename}) error: ${stderr.trim()}`);
        }
      }
      await rawRepl.exit();
      await rawRepl.softReset();
    } catch (err) {
      try { await rawRepl.exit(); await rawRepl.softReset(); } catch {}
      throw err;
    }
  }

  /**
   * Delete a file.
   * @param {string} filename
   */
  async function deleteFile(filename) {
    await rawRepl.enter();
    try {
      const { stderr } = await rawRepl.exec(
        `import os\nos.remove('${filename}')\nprint('ok')`
      );
      if (stderr.trim()) {
        throw new Error(`deleteFile(${filename}) error: ${stderr.trim()}`);
      }
      await rawRepl.exit();
      await rawRepl.softReset();
    } catch (err) {
      try { await rawRepl.exit(); await rawRepl.softReset(); } catch {}
      throw err;
    }
  }

  /**
   * Write multiple files in a single raw REPL session.
   * @param {Array<{name: string, content: string}>} entries
   * @param {function} [onProgress] — called with (filename, index, total) after each file
   */
  async function writeFiles(entries, onProgress) {
    await rawRepl.enter();
    try {
      for (let i = 0; i < entries.length; i++) {
        const { name, content } = entries[i];
        if (content.length <= WRITE_CHUNK_SIZE) {
          const escaped = escapePython(content);
          const { stderr } = await rawRepl.exec(
            `f=open('${name}','w')\nf.write('''${escaped}''')\nf.close()\nprint('ok')`,
            15000
          );
          if (stderr.trim()) {
            throw new Error(`writeFile(${name}) error: ${stderr.trim()}`);
          }
        } else {
          let code = `f=open('${name}','w')\n`;
          for (let j = 0; j < content.length; j += WRITE_CHUNK_SIZE) {
            const chunk = content.slice(j, j + WRITE_CHUNK_SIZE);
            const escaped = escapePython(chunk);
            code += `f.write('''${escaped}''')\n`;
          }
          code += `f.close()\nprint('ok')`;
          const { stderr } = await rawRepl.exec(code, 30000);
          if (stderr.trim()) {
            throw new Error(`writeFile(${name}) error: ${stderr.trim()}`);
          }
        }
        if (onProgress) onProgress(name, i, entries.length);
      }
      await rawRepl.exit();
      await rawRepl.softReset();
    } catch (err) {
      try { await rawRepl.exit(); await rawRepl.softReset(); } catch {}
      throw err;
    }
  }

  /**
   * Remove any .py files on the device that aren't in `keep`. Useful
   * during a v1→v2 cutover where stale modules (json_format.py, etc.)
   * would otherwise linger. Non-.py files (wifi.json, etc.) are
   * preserved unconditionally.
   *
   * @param {Array<string>} keep — filenames to leave alone
   */
  async function cleanStalePyFiles(keep) {
    const keepSet = new Set(keep);
    await rawRepl.enter();
    try {
      const { stdout } = await rawRepl.exec(
        'import os\nfor f in os.listdir("/"):\n if f.endswith(".py"):print(f)'
      );
      const present = stdout.split('\n').map(l => l.trim()).filter(Boolean);
      const stale = present.filter(name => !keepSet.has(name));
      for (const name of stale) {
        const { stderr } = await rawRepl.exec(
          `import os\ntry:\n os.remove('${name}')\n print('ok')\nexcept Exception as e:\n print(repr(e))`
        );
        if (stderr.trim()) {
          throw new Error(`cleanStale(${name}) error: ${stderr.trim()}`);
        }
      }
      await rawRepl.exit();
      return stale;
    } catch (err) {
      try { await rawRepl.exit(); } catch {}
      throw err;
    }
  }

  return { listFiles, readFile, writeFile, writeFiles, deleteFile, cleanStalePyFiles };
}
