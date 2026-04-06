document.addEventListener('DOMContentLoaded', function() {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('extension-name').textContent = manifest.name;
    document.getElementById('extension-version').textContent = 'v' + manifest.version;

    // Mode édition
    document.getElementById('toggle-edit-mode').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "toggleEditMode",
                    enabled: true
                });
            }
        });
        window.close();
    });
});
