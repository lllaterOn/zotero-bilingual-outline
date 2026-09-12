// Zotero loads this script before inserting the fragment, then dispatches load.
function bilingualOutlinePaneLoaded(event) {
  if (event.target.getAttribute?.('id') !== 'bo-pane') return;
  Zotero.BilingualOutline?.mountPreferences(window);
}
document.addEventListener('load', bilingualOutlinePaneLoaded, true);
window.addEventListener('unload', function removeBilingualOutlineListener() {
  document.removeEventListener('load', bilingualOutlinePaneLoaded, true);
}, { once: true });
