/* eslint global-require:0 */
/* global exec, alert, document */
'use strict';

(() => {
    const main = async () => {
        let id = Number(document.location.hash.replace('#', ''));
        if (!id) {
            return await exec({
                command: 'closeWindow'
            });
        }

        document.title = `View source (${id})`;

        let emailSource = await exec({
            command: 'emailSource',
            params: {
                id
            }
        });

        document.getElementById('source-text').textContent = emailSource;
    };

    main().catch(err => alert(err.stack));
})();
