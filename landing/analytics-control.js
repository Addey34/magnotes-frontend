(function () {
    'use strict';

    window.magNotesAnalyticsBeforeSend = function (_type, payload) {
        const disabled =
            new URLSearchParams(window.location.search).get('analytics') ===
            'off';
        return disabled ? false : payload;
    };
})();
