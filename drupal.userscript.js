// ==UserScript==
// @name         Drupal JSON:API Browser
// @namespace    https://example.invalid/
// @version      1.1
// @description  Browse Drupal images, files and content through JSON:API
// @match        http://*/*
// @match        https://*/*
// @grant        none
// ==/UserScript==
// written by chatgpt GPT-6

(() => {
    'use strict';

    const JSON_API_TYPE = 'application/vnd.api+json';
    const PAGE_SIZE = 36;

    const css = `
        #vm-drupal-browser-button {
            position: fixed; bottom: 18px; left: 18px; z-index: 2147483645;
            padding: 8px 14px; border: 1px solid #777; border-radius: 6px;
            background: #222; color: #fff; cursor: pointer; font: 14px sans-serif;
        }
        #vm-drupal-browser, #vm-drupal-image {
            box-sizing: border-box; padding: 16px; background: #fff; color: #222;
            border: 1px solid #777; border-radius: 8px; font: 15px sans-serif;
        }
        #vm-drupal-browser { width: 92vw; height: 90vh; max-width: 92vw; }
        #vm-drupal-browser::backdrop, #vm-drupal-image::backdrop { background: #000b; }
        #vm-drupal-toolbar, #vm-drupal-image-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        #vm-drupal-toolbar { position: sticky; top: 0; background: #fff; padding-bottom: 12px; }
        #vm-drupal-toolbar button, #vm-drupal-toolbar input, #vm-drupal-toolbar select,
        #vm-drupal-image-controls button { font: inherit; }
        #vm-drupal-content { display: grid; gap: 8px; }
        #vm-drupal-content.vm-drupal-grid { grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); }
        #vm-drupal-content > * { box-sizing: border-box; min-width: 0; padding: 6px; overflow-wrap: anywhere; }
        #vm-drupal-content button { text-align: left; font: inherit; color: inherit; cursor: pointer; }
        #vm-drupal-content img { display: block; width: 100%; height: 128px; object-fit: contain; }
        #vm-drupal-image { background: #161616; color: #fff; }
        #vm-drupal-image img { display: block; max-width: 87vw; max-height: 77vh; margin: 10px auto; }
        #vm-drupal-image a { color: inherit; overflow-wrap: anywhere; }
    `;

    function httpUrl(value, base = document.baseURI) {
        if (typeof value !== 'string' || !value)
            return null;

        try {
            const url = new URL(value, base);
            if (url.protocol === 'http:' || url.protocol === 'https:')
                return url;
        } catch {
            // Ignore malformed URLs in the page or API response.
        }
        return null;
    }

    function localUrl(value, base) {
        const url = httpUrl(value, base);
        return url?.origin === location.origin ? url : null;
    }

    function drupalBase() {
        const settings = document.querySelector('script[type="application/json"][data-drupal-selector="drupal-settings-json"]');
        if (settings) {
            try {
                const base = localUrl(JSON.parse(settings.textContent).path?.baseUrl, location.origin);
                if (base)
                    return new URL(base.pathname.replace(/\/?$/, '/'), location.origin);
            } catch {
                // Other Drupal markers still work if the settings are malformed.
            }
        }

        for (const asset of document.querySelectorAll('script[src]')) {
            const url = localUrl(asset.getAttribute('src'));
            const match = url?.pathname.match(/\/(?:core\/)?misc\/drupal(?:\.init|SettingsLoader)?\.js$/);
            if (match)
                return new URL(url.pathname.slice(0, match.index) + '/', location.origin);
        }

        for (const generator of document.querySelectorAll('meta[name="generator" i]')) {
            if (/^Drupal(?:\s|\(|$)/i.test(generator.content.trim()))
                return new URL('/', location.origin);
        }

        return settings ? new URL('/', location.origin) : null;
    }

    function apiRoot(base) {
        for (const link of document.querySelectorAll('link[type="application/vnd.api+json"][href]')) {
            const url = localUrl(link.getAttribute('href'));
            const match = url?.pathname.match(/\/jsonapi(?:\/|$)/);
            if (match)
                return new URL(url.pathname.slice(0, match.index) + '/jsonapi', url);
        }
        return new URL('jsonapi', base);
    }

    function linkHref(link) {
        return typeof link === 'string' ? link : link?.href;
    }

    class Collection {
        constructor(label, url, kind) {
            this.label = label;
            this.url = url;
            this.kind = kind;
        }

        pageUrl(search) {
            const url = new URL(this.url);
            url.searchParams.set('page[limit]', PAGE_SIZE);
            if (this.kind === 'images')
                this.setFilter(url, 'mime', 'filemime', 'STARTS_WITH', 'image/');
            if (search)
                this.setFilter(url, 'search', this.kind === 'node' ? 'title' : 'filename', 'CONTAINS', search);
            return url;
        }

        setFilter(url, name, field, operator, value) {
            const filter = `filter[${name}][condition]`;
            url.searchParams.set(filter + '[path]', field);
            url.searchParams.set(filter + '[operator]', operator);
            url.searchParams.set(filter + '[value]', value);
        }
    }

    class DrupalApi {
        constructor(base, root) {
            this.base = base;
            this.root = root;
        }

        async read(url) {
            const response = await fetch(url, {
                headers: { Accept: JSON_API_TYPE },
                credentials: 'same-origin',
                mode: 'same-origin'
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            return response.json();
        }

        async collections() {
            const { links } = await this.read(this.root);
            const collections = [];
            for (const [type, link] of Object.entries(links || {})) {
                const url = localUrl(linkHref(link), this.root);
                if (!url)
                    continue;

                if (type === 'file--file') {
                    collections.unshift(new Collection('Images', url, 'images'), new Collection('Files', url, 'files'));
                } else if (type.startsWith('node--')) {
                    const label = type.slice('node--'.length).replace(/_/g, ' ');
                    collections.push(new Collection(label, url, 'node'));
                }
            }
            if (!collections.length)
                throw new Error('No image, file or node collections were advertised');
            return collections;
        }

        itemUrl(attributes, collection) {
            if (collection.kind !== 'node')
                return httpUrl(attributes.uri?.url, location.origin);

            if (attributes.path?.alias)
                return localUrl(attributes.path.alias.replace(/^\//, ''), this.base);

            if (attributes.drupal_internal__nid)
                return new URL(`node/${encodeURIComponent(attributes.drupal_internal__nid)}`, this.base);

            return null;
        }
    }

    class DrupalBrowser {
        constructor(api, collections) {
            this.api = api;
            this.collections = collections;
            this.items = [];
            this.busy = false;
            this.dialog = document.createElement('dialog');
            this.dialog.id = 'vm-drupal-browser';
            this.dialog.setAttribute('aria-label', 'Drupal Browser');
            this.dialog.innerHTML = `
                <form id="vm-drupal-toolbar">
                    <select name="collection" aria-label="Collection"></select>
                    <input name="search" type="search" placeholder="Search" aria-label="Search">
                    <button type="submit" name="submitSearch">Search</button>
                    <button type="button" name="previous" aria-label="Previous page">←</button>
                    <button type="button" name="next" aria-label="Next page">→</button>
                    <span role="status"></span>
                    <button type="button" name="close">Close</button>
                </form>
                <div id="vm-drupal-content"></div>
            `;
            document.body.appendChild(this.dialog);
            this.toolbar = this.dialog.querySelector('form');
            this.status = this.toolbar.querySelector('[role="status"]');
            this.content = this.dialog.querySelector('#vm-drupal-content');
            this.viewer = new ImageViewer();
            this.connectControls();
        }

        connectControls() {
            const { collection, previous, next, close } = this.toolbar.elements;
            this.collections.forEach((item, index) => collection.add(new Option(item.label, index)));

            this.toolbar.addEventListener('submit', event => {
                event.preventDefault();
                this.loadFirstPage();
            });
            collection.addEventListener('change', () => this.loadFirstPage());
            previous.addEventListener('click', () => this.loadPage(this.previous));
            next.addEventListener('click', () => this.loadPage(this.next));
            close.addEventListener('click', () => this.dialog.close());
            this.dialog.addEventListener('keydown', event => this.handleKey(event));
        }

        handleKey(event) {
            if (event.target.matches('input, select, button') || event.defaultPrevented)
                return;

            if (event.key === 'PageUp' || event.key === 'PageDown') {
                event.preventDefault();
                this.loadPage(event.key === 'PageUp' ? this.previous : this.next);
            }
        }

        show() {
            this.dialog.showModal();
            if (!this.loaded)
                this.loadFirstPage();
        }

        loadFirstPage() {
            const { collection, search } = this.toolbar.elements;
            const current = this.collections[collection.selectedIndex];
            this.loadPage(current.pageUrl(search.value.trim()), current);
        }

        async loadPage(url, collection = this.collection) {
            if (!url || this.busy)
                return;

            this.busy = true;
            const controls = this.toolbar.elements;
            controls.collection.disabled = true;
            controls.search.disabled = true;
            controls.submitSearch.disabled = true;
            controls.previous.disabled = true;
            controls.next.disabled = true;
            this.status.textContent = 'Loading…';
            try {
                const result = await this.api.read(url);
                if (!Array.isArray(result.data))
                    throw new Error('Expected a collection of resources');

                this.collection = collection;
                this.previous = localUrl(linkHref(result.links?.prev), url);
                this.next = localUrl(linkHref(result.links?.next), url);
                this.items = result.data.map(resource => this.displayItem(resource));
                this.render();
                this.loaded = true;
            } catch (error) {
                controls.collection.selectedIndex = Math.max(0, this.collections.indexOf(this.collection));
                this.status.textContent = `Drupal API error: ${error.message}`;
            } finally {
                controls.collection.disabled = false;
                controls.search.disabled = false;
                controls.submitSearch.disabled = false;
                controls.previous.disabled = !this.previous;
                controls.next.disabled = !this.next;
                this.busy = false;
            }
        }

        displayItem(resource) {
            const attributes = resource.attributes || {};
            const label = attributes.title || attributes.filename || resource.id;
            return { label, url: this.api.itemUrl(attributes, this.collection) };
        }

        render() {
            const showImages = this.collection.kind === 'images';
            this.content.classList.toggle('vm-drupal-grid', showImages);
            this.content.replaceChildren();
            const images = showImages ? this.items.filter(item => item.url) : [];

            for (const item of this.items) {
                if (showImages && item.url)
                    this.content.append(this.thumbnail(item, images));
                else
                    this.content.append(itemLink(item));
            }
            this.status.textContent = this.items.length ? `${this.items.length} on this page` : 'No results';
        }

        thumbnail(item, images) {
            const button = document.createElement('button');
            button.type = 'button';
            const image = document.createElement('img');
            image.loading = 'lazy';
            image.alt = '';
            image.src = item.url;
            button.append(image, item.label);
            button.addEventListener('click', () => this.viewer.show(images, images.indexOf(item)));
            return button;
        }
    }

    function itemLink(item) {
        const element = document.createElement(item.url ? 'a' : 'span');
        element.textContent = item.label;
        if (item.url) {
            element.href = item.url;
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
        }
        return element;
    }

    class ImageViewer {
        constructor() {
            this.dialog = document.createElement('dialog');
            this.dialog.id = 'vm-drupal-image';
            this.dialog.setAttribute('aria-label', 'Drupal image');
            this.dialog.innerHTML = `
                <div id="vm-drupal-image-controls">
                    <button type="button" aria-label="Previous image">←</button>
                    <button type="button" aria-label="Next image">→</button>
                    <button type="button">Close</button>
                </div>
                <img>
                <div></div>
            `;
            document.body.appendChild(this.dialog);
            this.image = this.dialog.querySelector('img');
            this.caption = this.dialog.lastElementChild;
            [this.previous, this.next, this.close] = this.dialog.querySelectorAll('button');
            this.previous.addEventListener('click', () => this.move(-1));
            this.next.addEventListener('click', () => this.move(1));
            this.close.addEventListener('click', () => this.dialog.close());
            this.dialog.addEventListener('keydown', event => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    this.move(event.key === 'ArrowLeft' ? -1 : 1);
                }
            });
        }

        show(images, index) {
            this.images = images;
            this.index = index;
            this.move(0);
            this.dialog.showModal();
        }

        move(step) {
            const index = this.index + step;
            if (index < 0 || index >= this.images.length)
                return;

            this.index = index;
            const item = this.images[index];
            this.image.src = item.url;
            this.image.alt = item.label;
            this.caption.replaceChildren(itemLink(item));
            this.previous.disabled = index === 0;
            this.next.disabled = index === this.images.length - 1;
        }
    }

    function addLauncher(base) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'vm-drupal-browser-button';
        button.textContent = 'Drupal Browser';
        document.body.appendChild(button);

        let browser;
        button.addEventListener('click', async event => {
            if (!event.isTrusted)
                return;

            if (browser) {
                browser.show();
                return;
            }

            button.disabled = true;
            button.textContent = 'Checking Drupal API…';
            try {
                const api = new DrupalApi(base, apiRoot(base));
                browser = new DrupalBrowser(api, await api.collections());
                browser.show();
                button.textContent = 'Drupal Browser';
                button.removeAttribute('title');
            } catch (error) {
                button.textContent = 'Drupal API unavailable · Retry';
                button.title = error.message;
            } finally {
                button.disabled = false;
            }
        });
    }

    function main() {
        const base = drupalBase();
        if (base)
            addLauncher(base);
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', main, { once: true });
    else
        main();
})();

