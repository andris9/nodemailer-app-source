'use strict';
/* global DOMPurify, window */

(() => {
    window.__purifyRef = new WeakMap();

    // Specify proxy URL
    let proxyLink = 'proxy.html#url=';
    let proxyImage = 'proxy.png#url=';
    let proxyCss = 'proxy.css#url=';

    // Specify attributes to proxy
    let attributes = ['action', 'background', 'href', 'poster', 'src', 'srcset'];

    // specify the regex to detect external content
    let regex = /(url\("?)(?!data:)/gim;

    /**
     *  Take CSS property-value pairs and proxy URLs in values,
     *  then add the styles to an array of property-value pairs
     */
    function addStyles(output, styles, config) {
        if (config.keepExternalResources) {
            return;
        }

        for (let prop = styles.length - 1; prop >= 0; prop--) {
            if (styles[styles[prop]]) {
                if (regex.test(styles[styles[prop]])) {
                    let url = styles[styles[prop]].replace(regex, '$1' + proxyImage);
                    styles[styles[prop]] = url;
                    window.__purifyRef.set(config.externalResourcesRef, true);
                }
            }
            if (styles[styles[prop]]) {
                output.push(styles[prop] + ':' + styles[styles[prop]] + ';');
            }
        }
    }

    /**
     * Take CSS rules and analyze them, proxy URLs via addStyles(),
     * then create matching CSS text for later application to the DOM
     */
    function addCSSRules(output, cssRules, config) {
        for (let index = cssRules.length - 1; index >= 0; index--) {
            let rule = cssRules[index];
            // check for rules with selector
            if (rule.type === 1 && rule.selectorText) {
                output.push(rule.selectorText + '{');
                if (rule.style) {
                    addStyles(output, rule.style, config);
                }
                output.push('}');
                // check for @media rules
            } else if (rule.type === rule.MEDIA_RULE) {
                output.push('@media ' + rule.media.mediaText + '{');
                addCSSRules(output, rule.cssRules, config);
                output.push('}');
                // check for @font-face rules
            } else if (rule.type === rule.FONT_FACE_RULE) {
                output.push('@font-face {');
                if (rule.style) {
                    addStyles(output, rule.style, config);
                }
                output.push('}');
                // check for @keyframes rules
            } else if (rule.type === rule.KEYFRAMES_RULE) {
                output.push('@keyframes ' + rule.name + '{');
                for (let i = rule.cssRules.length - 1; i >= 0; i--) {
                    let frame = rule.cssRules[i];
                    if (frame.type === 8 && frame.keyText) {
                        output.push(frame.keyText + '{');
                        if (frame.style) {
                            addStyles(output, frame.style, config);
                        }
                        output.push('}');
                    }
                }
                output.push('}');
            }
        }
    }

    /**
     * Proxy a URL in case it's not a Data URI
     */
    function proxyAttribute(node, attribute, url, config) {
        if (/^data:image\//.test(url)) {
            return url;
        } else {
            switch (node.tagName.toLowerCase()) {
                case 'a':
                    switch (attribute.toLowerCase()) {
                        case 'href':
                            // link
                            return proxyLink + encodeURIComponent(url);
                        default:
                            return proxyImage + encodeURIComponent(url);
                    }

                case 'link':
                    if (config.keepExternalResources) {
                        return url;
                    }
                    if (
                        attribute.toLowerCase() === 'href' &&
                        node.hasAttribute('rel') &&
                        node
                            .getAttribute('rel')
                            .toLowerCase()
                            .trim() === 'stylesheet'
                    ) {
                        window.__purifyRef.set(config.externalResourcesRef, true);
                        return proxyCss + encodeURIComponent(url);
                    } else {
                        return proxyImage + encodeURIComponent(url);
                    }

                case 'img':
                    if (config.keepExternalResources && !/^cid:/i.test(url)) {
                        return url;
                    }

                    switch (attribute.toLowerCase()) {
                        case 'src':
                            // link
                            if (/^cid:/i.test(url)) {
                                return `[[CID/${url}/CID]]`;
                            }
                            window.__purifyRef.set(config.externalResourcesRef, true);
                            return proxyImage + encodeURIComponent(url);
                        case 'srcset':
                            // link
                            return '';
                        default:
                            return proxyImage + encodeURIComponent(url);
                    }
            }

            return proxyImage + encodeURIComponent(url);
        }
    }

    // Add a hook to enforce proxy for leaky CSS rules
    DOMPurify.addHook('uponSanitizeElement', function(node, data, config) {
        if (data.tagName === 'style') {
            let output = [];
            addCSSRules(output, node.sheet.cssRules, config);
            node.textContent = output.join('\n');
        }
    });

    // Add a hook to enforce proxy for all HTTP leaks incl. inline CSS
    DOMPurify.addHook('afterSanitizeAttributes', function(node, data, config) {
        // set all elements owning target to target=_blank
        if ('target' in node) {
            node.setAttribute('target', '_blank');
        }

        // set non-HTML/MathML links to xlink:show=new
        if (!node.hasAttribute('target') && (node.hasAttribute('xlink:href') || node.hasAttribute('href'))) {
            node.setAttribute('xlink:show', 'new');
        }

        // Check all src attributes and proxy them
        for (let i = 0; i <= attributes.length - 1; i++) {
            if (node.hasAttribute(attributes[i])) {
                node.setAttribute(attributes[i], proxyAttribute(node, attributes[i], node.getAttribute(attributes[i]), config));
            }
        }

        // Check all style attribute values and proxy them
        if (node.hasAttribute('style') && !config.keepExternalResources) {
            let styles = node.style;
            let output = [];
            for (let prop = styles.length - 1; prop >= 0; prop--) {
                // we re-write each property-value pair to remove invalid CSS
                if (node.style[styles[prop]] && regex.test(node.style[styles[prop]])) {
                    let url = node.style[styles[prop]].replace(regex, '$1' + proxyImage);
                    node.style[styles[prop]] = url;
                    window.__purifyRef.set(config.externalResourcesRef, true);
                }
                output.push(styles[prop] + ':' + node.style[styles[prop]] + ';');
            }
            // re-add styles in case any are left
            if (output.length) {
                node.setAttribute('style', output.join(''));
            } else {
                node.removeAttribute('style');
            }
        }
    });
})();
