'use strict';
/* global DOMPurify, window */

(() => {
    window.__purifyRef = new WeakMap();

    // Specify proxy URL
    let proxyLink = 'proxy.html#url=';
    let proxyImage =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAAAyCAYAAADLLVz8AAAKxmlDQ1BJQ0MgUHJvZmlsZQAASImVlwdQU+kWgP9700NCgAQEpITeBOkEkBJ6KIJ0EJWQBBJKiAkBwa6IK7giiEizUFZFFFwLIGtFFCuKBewLsqgoq1iwofIu8Ai77817b96Z+ef/5tzzn/LPPXfOBYCMZotEqbACAGnCDHGorwc9OiaWjhsARKAFKMAW6LM5EhEzJCQQIDK9/10+9gBoYr9tPuHr35//V1Hk8iQcAKAQhBO4Ek4awseQ9ZIjEmcAgNqD6PWyMkQT3IEwTYwkiPC9CU6a4uEJTphkNJi0CQ/1RJgGAJ7EZouTACDRET09k5OE+CG5I2wp5AqECIsQduXw2VyEDyM8Jy0tfYIfIWyc8Bc/SX/zmSDzyWYnyXiqlknBewkkolR29v95Hf9b0lKl0zEMkUXii/1CkV0JubN7KekBMhYmzA+eZgF30n6S+VK/iGnmSDxjp5nL9gqQnU2dHzjNiQIflsxPBit8mnkS77BpFqeHymIlij2Z08wWz8SVpkTI9HweS+Y/hx8eNc2Zgsj50yxJCQuYsfGU6cXSUFn+PKGvx0xcH1ntaZK/1Ctgyc5m8MP9ZLWzZ/LnCZkzPiXRsty4PC/vGZsImb0ow0MWS5QaIrPnpfrK9JLMMNnZDOSFnDkbIrvDZLZ/yDSDQOAL6MAPeIFQZLcFSPUZvGUZE4V4pouyxYIkfgadiXQYj84Scizm0K0trRwBmOjXqdfhfehkH0Iqp2d06XUAMD4iPVI0o0soAaAlDwDVBzM6/V0AUHIBaG7nSMWZU7rJXsIgXwIKoAE15HugB4yBObAG9sAZuANv4A+CQTiIAYsBB/BBGhCDLLACrAV5oABsBdtBBdgNasF+cAgcAS3gJDgHLoKr4Ca4Cx6CPjAIXoER8BGMQRCEg8gQFVKDtCEDyAyyhhiQK+QNBUKhUAwUDyVBQkgKrYDWQwVQMVQBVUP10K/QCegcdBnqhu5D/dAQ9A76CqNgEkyDNWFDeC7MgJlwABwOL4KT4KVwDpwLb4HL4Br4INwMn4OvwnfhPvgVPIoCKDmUCkoHZY5ioDxRwahYVCJKjFqFykeVompQjag2VCfqNqoPNYz6gsaiqWg62hztjPZDR6A56KXoVejN6Ar0fnQzugN9G92PHkH/wJAxGhgzjBOGhYnGJGGyMHmYUsxezHHMBcxdzCDmIxaLVcEaYR2wftgYbDJ2OXYzdie2CXsW240dwI7icDg1nBnOBReMY+MycHm4ctxB3BncLdwg7jNeDq+Nt8b74GPxQvw6fCn+AP40/hb+OX6MoEAwIDgRgglcQjahkFBHaCPcIAwSxoiKRCOiCzGcmExcSywjNhIvEB8R38vJyenKOcotkBPIrZErkzssd0muX+4LSYlkSvIkxZGkpC2kfaSzpPuk92Qy2ZDsTo4lZ5C3kOvJ58lPyJ/lqfIW8ix5rvxq+Ur5Zvlb8q8pBIoBhUlZTMmhlFKOUm5QhhUICoYKngpshVUKlQonFHoVRhWpilaKwYppipsVDyheVnyhhFMyVPJW4irlKtUqnVcaoKKoelRPKoe6nlpHvUAdpGFpRjQWLZlWQDtE66KNKCsp2ypHKi9TrlQ+pdynglIxVGGppKoUqhxR6VH5OktzFnMWb9amWY2zbs36pDpb1V2Vp5qv2qR6V/WrGl3NWy1FrUitRe2xOlrdVH2Bepb6LvUL6sOzabOdZ3Nm588+MvuBBqxhqhGqsVyjVuOaxqimlqavpkizXPO85rCWipa7VrJWidZprSFtqrartkC7RPuM9ku6Mp1JT6WX0TvoIzoaOn46Up1qnS6dMV0j3QjddbpNuo/1iHoMvUS9Er12vRF9bf0g/RX6DfoPDAgGDAO+wQ6DToNPhkaGUYYbDVsMXxipGrGMcowajB4Zk43djJca1xjfMcGaMExSTHaa3DSFTe1M+aaVpjfMYDN7M4HZTrPuOZg5jnOEc2rm9JqTzJnmmeYN5v0WKhaBFussWixez9WfGzu3aG7n3B+WdpaplnWWD62UrPyt1lm1Wb2zNrXmWFda37Eh2/jYrLZptXlra2bLs91le8+Oahdkt9Gu3e67vYO92L7RfshB3yHeocqhl0FjhDA2My45Yhw9HFc7nnT84mTvlOF0xOmNs7lzivMB5xfzjObx5tXNG3DRdWG7VLv0udJd4133uPa56bix3WrcnrrruXPd97o/Z5owk5kHma89LD3EHsc9Pnk6ea70POuF8vL1yvfq8lbyjvCu8H7io+uT5NPgM+Jr57vc96wfxi/Ar8ivl6XJ4rDqWSP+Dv4r/TsCSAFhARUBTwNNA8WBbUFwkH/QtqBH8w3mC+e3BINgVvC24MchRiFLQ35bgF0QsqBywbNQq9AVoZ1h1LAlYQfCPoZ7hBeGP4wwjpBGtEdSIuMi6yM/RXlFFUf1Rc+NXhl9NUY9RhDTGouLjYzdGzu60Hvh9oWDcXZxeXE9i4wWLVt0ebH64tTFp5ZQlrCXHI3HxEfFH4j/xg5m17BHE1gJVQkjHE/ODs4rrju3hDvEc+EV854nuiQWJ75IcknaljTEd+OX8ocFnoIKwdtkv+TdyZ9SglP2pYynRqU2peHT4tNOCJWEKcKOdK30ZendIjNRnqhvqdPS7UtHxAHivRJIskjSmkFDBqNrUmPpBml/pmtmZebnrMiso8sUlwmXXcs2zd6U/TzHJ+eX5ejlnOXtK3RWrF3Rv5K5snoVtCphVftqvdW5qwfX+K7Zv5a4NmXt9XWW64rXfVgftb4tVzN3Te7ABt8NDXnyeeK83o3OG3f/hP5J8FPXJptN5Zt+5HPzrxRYFpQWfNvM2XzlZ6ufy34e35K4pavQvnDXVuxW4daeIrei/cWKxTnFA9uCtjWX0EvySz5sX7L9cqlt6e4dxB3SHX1lgWWt5frlW8u/VfAr7lZ6VDZVaVRtqvq0k7vz1i73XY27NXcX7P66R7DnXrVvdXONYU1pLbY2s/ZZXWRd5y+MX+r3qu8t2Pt9n3Bf3/7Q/R31DvX1BzQOFDbADdKGoYNxB28e8jrU2mjeWN2k0lRwGByWHn75a/yvPUcCjrQfZRxtPGZwrOo49Xh+M9Sc3TzSwm/pa41p7T7hf6K9zbnt+G8Wv+07qXOy8pTyqcLTxNO5p8fP5JwZPSs6O3wu6dxA+5L2h+ejz9/pWNDRdSHgwqWLPhfPdzI7z1xyuXTystPlE1cYV1qu2l9tvmZ37fh1u+vHu+y7mm843Gi96XizrXte9+lbbrfO3fa6ffEO687Vu/PvdvdE9Nzrjevtu8e99+J+6v23DzIfjD1c8wjzKP+xwuPSJxpPan43+b2pz77vVL9X/7WnYU8fDnAGXv0h+ePbYO4z8rPS59rP619Yvzg55DN08+XCl4OvRK/GhvP+VPyz6rXx62Nv3N9cG4keGXwrfjv+bvN7tff7Pth+aB8NGX3yMe3j2Kf8z2qf939hfOn8GvX1+VjWN9y3su8m39t+BPx4NJ42Pi5ii9mTowAKWXBiIgDv9gFAjgGAehMA4sKpeXpSoKl/gEkC/4mnZu5JsQegtheA8OUABF4HoLwCGWcR/5Q4AEIoiN4ZwDY2svVPkSTaWE/5Irkho8nj8fH3xgDgigD4XjQ+PlY7Pv69Fkn2IQBns6fm+AnRQv4psnAA/eZ7T7stDfyL/AM+XBIZkSyi/AAAAIplWElmTU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACQAAAAAQAAAJAAAAABAAOShgAHAAAAEgAAAHigAgAEAAAAAQAAAFCgAwAEAAAAAQAAADIAAAAAQVNDSUkAAABTY3JlZW5zaG90mA3SqQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAdRpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8ZXhpZjpQaXhlbFhEaW1lbnNpb24+ODA8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpVc2VyQ29tbWVudD5TY3JlZW5zaG90PC9leGlmOlVzZXJDb21tZW50PgogICAgICAgICA8ZXhpZjpQaXhlbFlEaW1lbnNpb24+NTA8L2V4aWY6UGl4ZWxZRGltZW5zaW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KgJkXzgAAABxpRE9UAAAAAgAAAAAAAAAZAAAAKAAAABkAAAAZAAAAna7HRJUAAABpSURBVGgF7NKxDQAgEAMx2H/CnwYkRuBap7/Gyp6Zs+xbYAP8tnshwOa3AAKMAjH3QIBRIOYeCDAKxNwDAUaBmHsgwCgQcw8EGAVi7oEAo0DMPRBgFIi5BwKMAjH3QIBRIOYeCDAKxPwCAAD//w5ip6IAAABnSURBVO3SsQ0AIBADMdh/wp8GJEbgWqe/xsqembPsW2AD/LZ7IcDmtwACjAIx90CAUSDmHggwCsTcAwFGgZh7IMAoEHMPBBgFYu6BAKNAzD0QYBSIuQcCjAIx90CAUSDmHggwCsT8AgWXsSe/cMxWAAAAAElFTkSuQmCC';
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
                            return proxyImage;
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
                        return proxyImage;
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
                            return proxyImage;
                        case 'srcset':
                            // link
                            return '';
                        default:
                            return proxyImage;
                    }
            }

            return proxyImage;
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
