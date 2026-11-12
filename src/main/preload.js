'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('jh', {
  list: call('jobs:list'),
  setStatus: call('jobs:status'),
  setNote: call('jobs:note'),
  setEmail: call('jobs:email'),
  scan: call('scan:run'),
  importAlerts: call('alerts:import'),
  getConfig: call('config:get'),
  setConfig: call('config:set'),
  pickFile: call('files:pick'),
  prepare: call('app:prepare'),
  gmailConnect: call('gmail:connect'),
  gmailDisconnect: call('gmail:disconnect'),
  createDraft: call('gmail:draft'),
  open: call('shell:open'),
});
