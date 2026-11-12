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
  docs: call('docs:list'),
  importDocs: call('docs:import'),
  removeDoc: call('docs:remove'),
  setDefaultDoc: call('docs:default'),
  setDocLang: call('docs:lang'),
  openDoc: call('docs:open'),
  studios: call('studios:list'),
  addStudio: call('studios:add'),
  updateStudio: call('studios:update'),
  removeStudio: call('studios:remove'),
  prepareStudio: call('studios:prepare'),
  saveStudioDocs: call('studios:docs'),
  prepare: call('app:prepare'),
  saveJobDocs: call('jobs:docs'),
  gmailConnect: call('gmail:connect'),
  gmailDisconnect: call('gmail:disconnect'),
  createDraft: call('gmail:draft'),
  open: call('shell:open'),
});
