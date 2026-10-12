#!/usr/bin/env node
// Tiny plist reader/editor for native-config.sh, so the edition switch also
// runs on Linux (CI's Android job), where /usr/libexec/PlistBuddy doesn't exist.
//
//   node scripts/plist.cjs get FILE KEY              print a top-level string
//   node scripts/plist.cjs has FILE KEY              exit 0 if the key exists
//   node scripts/plist.cjs set FILE KEY VALUE        add or replace a top-level string
//   node scripts/plist.cjs delete FILE KEY           remove a top-level key (ok if absent)
//   node scripts/plist.cjs set-url-scheme FILE NAME VALUE
//                                                    set the one scheme of the
//                                                    CFBundleURLTypes entry named NAME
//
// Works on Xcode-formatted XML plists (tab-indented, keys sorted) by text
// edits, which keeps the file's formatting exactly as Xcode wrote it.
const fs = require('fs')

const [cmd, file, key, value] = process.argv.slice(2)
const die = (msg) => { console.error(`plist.cjs: ${msg}`); process.exit(1) }
if (!cmd || !file || !key) die('usage: plist.cjs get|has|set|delete|set-url-scheme FILE KEY [VALUE]')

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const src = fs.readFileSync(file, 'utf8')

// A top-level entry: one tab of indent, <key>…</key> then <string>…</string>.
const topLevel = (k) => new RegExp(`^\t<key>${esc(k)}</key>\n\t<string>(.*)</string>\n`, 'm')

switch (cmd) {
  case 'get': {
    const m = src.match(topLevel(key))
    if (!m) die(`${file}: no top-level string key ${key}`)
    process.stdout.write(unxml(m[1]) + '\n')
    break
  }
  case 'has':
    process.exit(topLevel(key).test(src) ? 0 : 1)
  case 'set': {
    if (value === undefined) die('set needs a VALUE')
    const entry = `\t<key>${key}</key>\n\t<string>${xml(value)}</string>\n`
    let out
    if (topLevel(key).test(src)) {
      out = src.replace(topLevel(key), entry)
    } else {
      // Insert in key order, the way Xcode keeps the file sorted.
      const keys = [...src.matchAll(/^\t<key>(.*)<\/key>\n/gm)]
      const next = keys.find((m) => m[1] > key)
      const at = next ? next.index : src.lastIndexOf('</dict>')
      if (at < 0) die(`${file}: no closing </dict>`)
      out = src.slice(0, at) + entry + src.slice(at)
    }
    fs.writeFileSync(file, out)
    break
  }
  case 'delete':
    fs.writeFileSync(file, src.replace(topLevel(key), ''))
    break
  case 'set-url-scheme': {
    if (value === undefined) die('set-url-scheme needs a VALUE')
    const re = new RegExp(
      `(<key>CFBundleURLName</key>\n\t*<string>${esc(key)}</string>\n\t*<key>CFBundleURLSchemes</key>\n\t*<array>\n\t*<string>)[^<]*(</string>)`)
    if (!re.test(src)) die(`${file}: no CFBundleURLTypes entry named ${key} with one scheme`)
    fs.writeFileSync(file, src.replace(re, `$1${xml(value)}$2`))
    break
  }
  default:
    die(`unknown command ${cmd}`)
}
