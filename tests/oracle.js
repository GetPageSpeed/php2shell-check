#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const data = fs.readFileSync(path.join(__dirname, '../data/php2shell-data.json'), 'utf8');
const context = {window: {}, document: {
  readyState: 'loading',
  getElementById: id => id === 'gps-p2s-data' ? {textContent: data} : null,
  addEventListener: () => {}
}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.env.P2S_JS || path.join(__dirname, '..', 'vendor', 'php2shell.js'), 'utf8'), context);
console.log(JSON.stringify(context.window.gpsPhp2Shell.check(fs.readFileSync(process.argv[2], 'utf8'))));
