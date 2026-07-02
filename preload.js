'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe surface exposed to the ops web app.
//
// Two globals:
//   window.__fwwDesktop — shell identity + capabilities (feature detection).
//       canEmbed:true tells the web app it may render embedded apps as <webview>
//       (this window enables webviewTag). In a plain browser it's undefined, so
//       the web app degrades embeds to "open in browser" launch cards.
//   window.fwwOps — the notification/badge bridge the shell-push module calls.

contextBridge.exposeInMainWorld('__fwwDesktop', {
  isDesktop: true,
  app: 'fww-ops',
  canEmbed: true, // this window sets webPreferences.webviewTag = true
  getVersion: () => ipcRenderer.invoke('app:version'),
  onUpdaterStatus: (cb) => ipcRenderer.on('updater:status', (_e, status) => cb(status)),
});

contextBridge.exposeInMainWorld('fwwOps', {
  /** Fire a native OS notification. @param {{title,body?,tag?,url?,silent?}} n */
  notify(n = {}) {
    ipcRenderer.send('fwwops:notify', {
      title: n.title != null ? String(n.title) : undefined,
      body:  n.body  != null ? String(n.body)  : undefined,
      tag:   n.tag   != null ? String(n.tag)   : undefined,
      url:   typeof n.url === 'string' ? n.url : undefined,
      silent: !!n.silent,
    });
  },
  /** Set the taskbar unread badge/overlay. */
  setBadge(count) {
    ipcRenderer.send('fwwops:set-badge', Math.max(0, Number(count) || 0));
  },
  /** Subscribe to native-notification clicks. Returns a disposer. */
  onActivateNotification(cb) {
    if (typeof cb !== 'function') return () => {};
    const listener = (_e, payload) => cb(payload || {});
    ipcRenderer.on('fwwops:activate-notification', listener);
    return () => ipcRenderer.removeListener('fwwops:activate-notification', listener);
  },
});
