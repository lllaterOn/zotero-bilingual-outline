/* Zotero 10 supplies the privileged globals used here in its plugin sandbox. */
var bilingualOutlineStartup = null;

function install() {}

async function startup({ rootURI }) {
  if (bilingualOutlineStartup) return bilingualOutlineStartup;
  bilingualOutlineStartup = (async () => {
    Services.scriptloader.loadSubScriptWithOptions(rootURI + "runtime.js", {
      target: globalThis,
      ignoreCache: true,
    });
    await BilingualOutlineRuntime.startup(Zotero, IOUtils, PathUtils, Services, rootURI);
  })();
  try {
    await bilingualOutlineStartup;
  } catch (error) {
    try {
      await globalThis.BilingualOutlineRuntime?.shutdown();
    } finally {
      bilingualOutlineStartup = null;
      globalThis.BilingualOutlineRuntime = undefined;
      delete globalThis.BilingualOutlineRuntime;
    }
    throw error;
  }
}

async function shutdown() {
  try {
    if (bilingualOutlineStartup) await bilingualOutlineStartup;
    await globalThis.BilingualOutlineRuntime?.shutdown();
  } finally {
    bilingualOutlineStartup = null;
    globalThis.BilingualOutlineRuntime = undefined;
    delete globalThis.BilingualOutlineRuntime;
  }
}

// Removing the add-on must not delete user translations, backups, or shared notes.
function uninstall() {}

function onMainWindowLoad() {}
function onMainWindowUnload() {}
