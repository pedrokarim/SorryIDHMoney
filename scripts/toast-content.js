// Reçoit les demandes de toast (testeur, service worker) et les affiche sur
// la page. Injecté à la demande : il ne s'installe qu'une fois par page.
if (typeof window.__toastHandlerInitialized === 'undefined') {
    window.__toastHandlerInitialized = true;

    // L'écoute est posée tout de suite ; le module, lui, arrive de façon
    // asynchrone. Un message reçu entre-temps attend simplement le module.
    const toastModule = import(chrome.runtime.getURL('libs/toast-manager.js'));

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action !== 'showToast') return false;
        // showToast vérifie lui-même que les notifications sont activées.
        toastModule
            .then((module) => module.showToast(request.message, request.options))
            .then((toast) => sendResponse({ success: true, toastsEnabled: toast !== null }))
            .catch(() => sendResponse({ success: false }));
        return true;
    });
}
