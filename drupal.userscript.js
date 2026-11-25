// ==UserScript==
// @name         Drupal JSON:API Browser
// @namespace    https://example.invalid/
// @version      1.0
// @description  Browse Drupal content and files through JSON:API
// @match        http://*/*
// @match        https://*/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const LIST_PAGE_SIZE = 50;

    /*
     * Thumbnail geometry.
     * The image API page size is calculated so that one page fits
     * into the visible browser without scrolling.
     */
    const THUMB_WIDTH  = 180;
    const THUMB_HEIGHT = 210;
    const GRID_GAP     = 12;
    const GRID_PADDING = 12;


    /*
     * ----------------------------------------------------------------
     * Drupal / JSON:API detection and discovery
     * ----------------------------------------------------------------
     */

    async function fetchJSON(url) {
        const r = await fetch(url, {
            credentials: 'same-origin',
            headers: {
                Accept: 'application/vnd.api+json'
            }
        });

        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);

        return await r.json();
    }


    /*
     * Drupal JSON:API normally lives at /jsonapi.
     *
     * Also check Drupal's generator meta tag before doing the API request,
     * but don't require it: some sites remove the generator tag.
     */
    async function discoverDrupal() {
        const candidates = [
            new URL('/jsonapi', location.origin).href
        ];

        /*
         * Drupal can itself be installed below the domain root.
         *
         * Walk upwards from the current pathname and try /jsonapi there.
         */
        const parts =
            location.pathname
                .split('/')
                .filter(Boolean);

        while (parts.length) {
            candidates.push(
                new URL(
                    '/' + parts.join('/') + '/jsonapi',
                    location.origin
                ).href
            );

            parts.pop();
        }


        const seen = new Set();

        for (const url of candidates) {
            if (seen.has(url))
                continue;

            seen.add(url);

            try {
                const root = await fetchJSON(url);

                /*
                 * A Drupal JSON:API entry point normally has a links object
                 * containing its available resource collections.
                 */
                if (
                    root &&
                    typeof root === 'object' &&
                    root.links &&
                    root.jsonapi
                ) {
                    return {
                        rootUrl: url,
                        document: root
                    };
                }

            } catch {
                /*
                 * Not a Drupal JSON:API root.
                 */
            }
        }

        return null;
    }


    /*
     * Convert a JSON:API link value into an href.
     *
     * JSON:API permits either:
     *
     *     "foo": "https://..."
     *
     * or:
     *
     *     "foo": { "href": "https://..." }
     */
    function linkHref(link) {
        if (typeof link === 'string')
            return link;

        return link?.href || null;
    }


    /*
     * Discover node bundles and file resource.
     *
     * Typical root entries:
     *
     *     node--article
     *     node--page
     *     node--news
     *     file--file
     *     media--image
     *     taxonomy_term--tags
     *     ...
     */
    function discoverResources(rootDocument) {
        const nodeTypes = [];
        let fileResource = null;

        for (const [name, link] of Object.entries(
            rootDocument.links || {}
        )) {
            const href = linkHref(link);

            if (!href)
                continue;

            if (name.startsWith('node--')) {
                nodeTypes.push({
                    type: name,
                    bundle: name.substring('node--'.length),
                    href
                });

            } else if (name === 'file--file') {
                fileResource = {
                    type: name,
                    href
                };
            }
        }


        nodeTypes.sort(
            (a, b) =>
                a.bundle.localeCompare(b.bundle)
        );


        return {
            nodeTypes,
            fileResource
        };
    }


    /*
     * ----------------------------------------------------------------
     * Styling
     * ----------------------------------------------------------------
     */

    const css = `
#vm-drupal-browser-button {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 2147483645;

    padding: 8px 14px;
    border: 1px solid #777;
    border-radius: 6px;

    background: #222;
    color: white;

    font: 14px sans-serif;
    cursor: pointer;
}

#vm-drupal-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;

    display: none;
    background: rgba(0,0,0,.70);
}

#vm-drupal-window {
    position: absolute;
    inset: 4%;

    display: flex;
    flex-direction: column;

    overflow: hidden;

    background: white;
    color: #222;
    border-radius: 8px;

    font: 14px sans-serif;
}

#vm-drupal-toolbar {
    flex: none;

    display: flex;
    align-items: center;
    flex-wrap: wrap;

    gap: 8px;
    padding: 10px;

    background: #eee;
}

#vm-drupal-modes {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
}

#vm-drupal-toolbar button {
    padding: 6px 12px;
    cursor: pointer;
}

#vm-drupal-toolbar button.vm-drupal-active {
    background: #333;
    color: white;
    font-weight: bold;
}

#vm-drupal-search {
    flex: 1;
    min-width: 160px;
    padding: 6px;
}

#vm-drupal-status {
    white-space: nowrap;
}

#vm-drupal-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
}


/*
 * Image grid
 */

#vm-drupal-image-grid {
    box-sizing: border-box;

    width: 100%;
    height: 100%;

    display: grid;

    grid-auto-rows: ${THUMB_HEIGHT}px;

    gap: ${GRID_GAP}px;
    padding: ${GRID_PADDING}px;

    overflow: hidden;
    align-content: start;
}

.vm-drupal-image-item {
    box-sizing: border-box;
    height: ${THUMB_HEIGHT}px;

    padding: 6px;

    border: 2px solid transparent;
    background: #fafafa;

    overflow: hidden;
}

.vm-drupal-image-item.vm-drupal-selected {
    border-color: #1677ff;
    background: #eaf3ff;
}

.vm-drupal-image-item img {
    display: block;

    width: 100%;
    height: 145px;

    object-fit: contain;
    background: #ddd;

    cursor: pointer;
}

.vm-drupal-image-title {
    margin-top: 5px;

    font-weight: bold;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.vm-drupal-image-info {
    margin-top: 3px;

    color: #666;
    font-size: 12px;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.vm-drupal-image-links {
    margin-top: 4px;
}

.vm-drupal-image-links a {
    margin-right: 8px;
}


/*
 * Text listings
 */

#vm-drupal-list {
    padding: 0;
    margin: 0;
    list-style: none;
}

.vm-drupal-list-item {
    padding: 9px 12px;
    border-bottom: 1px solid #ddd;
}

.vm-drupal-list-item.vm-drupal-selected {
    background: #eaf3ff;
}

.vm-drupal-list-item a {
    color: #0645ad;
    text-decoration: none;
}

.vm-drupal-list-item a:hover {
    text-decoration: underline;
}

.vm-drupal-meta {
    margin-left: 8px;

    color: #777;
    font-size: 12px;
}

.vm-drupal-mime {
    display: inline-block;

    min-width: 150px;
    margin-right: 8px;

    color: #555;
    font-family: monospace;
}


/*
 * Full-image viewer
 */

#vm-drupal-image-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;

    display: none;
    align-items: center;
    justify-content: center;

    background: rgba(0,0,0,.94);
}

#vm-drupal-full-image {
    max-width: calc(100% - 140px);
    max-height: calc(100% - 80px);

    object-fit: contain;
}

.vm-drupal-image-nav {
    position: absolute;
    top: 50%;

    transform: translateY(-50%);

    width: 55px;
    height: 80px;

    border: none;
    border-radius: 6px;

    background: rgba(255,255,255,.20);
    color: white;

    font: 40px sans-serif;
    cursor: pointer;
}

.vm-drupal-image-nav:hover {
    background: rgba(255,255,255,.35);
}

#vm-drupal-full-prev {
    left: 20px;
}

#vm-drupal-full-next {
    right: 20px;
}

#vm-drupal-full-close {
    position: absolute;

    right: 20px;
    top: 15px;

    border: none;
    background: none;
    color: white;

    font: 32px sans-serif;
    cursor: pointer;
}

#vm-drupal-full-caption {
    position: absolute;

    left: 70px;
    right: 70px;
    bottom: 12px;

    color: white;
    text-align: center;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
`;


    function addStyles() {
        const style = document.createElement('style');

        style.textContent = css;
        document.head.appendChild(style);
    }


    /*
     * ----------------------------------------------------------------
     * Helpers for Drupal entities
     * ----------------------------------------------------------------
     */

    function formatDate(value) {
        if (!value)
            return '';

        /*
         * Drupal timestamps may be UNIX numbers or ISO strings,
         * depending on entity/field.
         */
        if (typeof value === 'number') {
            return new Date(
                value * 1000
            ).toLocaleString();
        }

        return String(value).replace('T', ' ');
    }


    function filenameForFile(item) {
        return (
            item.attributes?.filename ||
            item.attributes?.name ||
            item.id
        );
    }


    function mimeForFile(item) {
        return (
            item.attributes?.filemime ||
            item.attributes?.mime ||
            ''
        );
    }


    function sizeForFile(item) {
        const n =
            item.attributes?.filesize;

        if (
            typeof n !== 'number' ||
            !Number.isFinite(n)
        )
            return '';


        if (n < 1024)
            return `${n} B`;

        if (n < 1024 ** 2)
            return `${(n / 1024).toFixed(1)} KiB`;

        if (n < 1024 ** 3)
            return `${(n / 1024 ** 2).toFixed(1)} MiB`;

        return `${(n / 1024 ** 3).toFixed(1)} GiB`;
    }


    /*
     * Drupal's file JSON varies slightly between versions/configurations.
     * Look in the common places where its public URL appears.
     */
    function fileURL(item) {
        const a = item.attributes || {};

        const candidates = [
            a.uri?.url,
            a.uri?.value?.url,
            a.url,
            a.file_url,
            a.content_url
        ];


        for (const value of candidates) {
            if (
                typeof value === 'string' &&
                /^https?:\/\//i.test(value)
            ) {
                return value;
            }

            if (
                typeof value === 'string' &&
                value.startsWith('/')
            ) {
                return new URL(
                    value,
                    location.origin
                ).href;
            }
        }


        /*
         * Some Drupal JSON:API versions expose a file URL under links.
         */
        for (const link of Object.values(
            item.links || {}
        )) {
            const href =
                linkHref(link);

            if (
                href &&
                !href.includes('/jsonapi/')
            ) {
                return href;
            }
        }


        return null;
    }


    function nodeTitle(item) {
        return (
            item.attributes?.title ||
            item.attributes?.name ||
            item.id
        );
    }


    function nodePublicURL(item) {
        const a =
            item.attributes || {};


        /*
         * Drupal nodes usually expose:
         *
         *     attributes.path.alias
         *
         * when an alias exists.
         */
        const alias =
            a.path?.alias;

        if (alias) {
            return new URL(
                alias,
                location.origin
            ).href;
        }


        /*
         * Otherwise /node/{nid} is normally usable.
         */
        const nid =
            a.drupal_internal__nid;

        if (nid != null) {
            return new URL(
                `/node/${nid}`,
                location.origin
            ).href;
        }


        /*
         * Last resort: JSON:API self URL.
         */
        return linkHref(
            item.links?.self
        );
    }


    /*
     * ----------------------------------------------------------------
     * Browser
     * ----------------------------------------------------------------
     */

    function createUI(discovery) {
        addStyles();

        const {
            nodeTypes,
            fileResource
        } =
            discoverResources(
                discovery.document
            );


        /*
         * Explicit visibility state. Don't infer visibility from
         * element.style.display because CSS-supplied display:none
         * doesn't appear there.
         */
        let browserVisible = false;
        let imageViewerVisible = false;


        /*
         * Modes:
         *
         *     images
         *     files
         *     node--article
         *     node--page
         *     node--whatever
         */
        let mode =
            fileResource
                ? 'images'
                : nodeTypes[0]?.type;


        if (!mode)
            return;


        let page = 1;

        let items = [];

        let selectedIndex = -1;

        let imageIndex = -1;

        let nextUrl = null;
        let prevUrl = null;


        let mediaColumns = 1;
        let mediaRows = 1;
        let mediaPageSize = 1;


        /*
         * Floating launcher.
         */

        const launcher =
            document.createElement('button');

        launcher.id =
            'vm-drupal-browser-button';

        launcher.textContent =
            'Drupal Browser';

        document.body.appendChild(
            launcher
        );


        /*
         * Browser overlay.
         */

        const overlay =
            document.createElement('div');

        overlay.id =
            'vm-drupal-overlay';


        overlay.innerHTML = `
            <div id="vm-drupal-window">

                <div id="vm-drupal-toolbar">

                    <div id="vm-drupal-modes"></div>

                    <input
                        id="vm-drupal-search"
                        type="search"
                        placeholder="Search"
                    >

                    <button id="vm-drupal-search-button">
                        Search
                    </button>

                    <button id="vm-drupal-prev">
                        ←
                    </button>

                    <span id="vm-drupal-status"></span>

                    <button id="vm-drupal-next">
                        →
                    </button>

                    <button id="vm-drupal-close">
                        Close
                    </button>

                </div>

                <div id="vm-drupal-content"></div>

            </div>
        `;


        document.body.appendChild(
            overlay
        );


        /*
         * Full image overlay.
         */

        const imageOverlay =
            document.createElement('div');

        imageOverlay.id =
            'vm-drupal-image-overlay';


        imageOverlay.innerHTML = `
            <button
                id="vm-drupal-full-prev"
                class="vm-drupal-image-nav"
            >‹</button>

            <img id="vm-drupal-full-image">

            <button
                id="vm-drupal-full-next"
                class="vm-drupal-image-nav"
            >›</button>

            <button id="vm-drupal-full-close">
                ×
            </button>

            <div id="vm-drupal-full-caption"></div>
        `;


        document.body.appendChild(
            imageOverlay
        );


        /*
         * Elements.
         */

        const modes =
            overlay.querySelector(
                '#vm-drupal-modes'
            );

        const content =
            overlay.querySelector(
                '#vm-drupal-content'
            );

        const status =
            overlay.querySelector(
                '#vm-drupal-status'
            );

        const search =
            overlay.querySelector(
                '#vm-drupal-search'
            );

        const fullImage =
            imageOverlay.querySelector(
                '#vm-drupal-full-image'
            );

        const fullCaption =
            imageOverlay.querySelector(
                '#vm-drupal-full-caption'
            );


        /*
         * ----------------------------------------------------------------
         * Mode buttons
         * ----------------------------------------------------------------
         */

        const modeButtons =
            new Map();


        function addModeButton(
            modeName,
            title
        ) {
            const b =
                document.createElement('button');

            b.textContent =
                title;

            b.addEventListener(
                'click',
                () =>
                    changeMode(modeName)
            );

            modeButtons.set(
                modeName,
                b
            );

            modes.appendChild(b);
        }


        if (fileResource) {
            addModeButton(
                'images',
                'Images'
            );

            addModeButton(
                'files',
                'Files'
            );
        }


        for (const node of nodeTypes) {
            /*
             * Make bundle names a little nicer:
             *
             *     news_article -> News article
             */
            const label =
                node.bundle
                    .replace(/_/g, ' ')
                    .replace(
                        /^./,
                        c => c.toUpperCase()
                    );

            addModeButton(
                node.type,
                label
            );
        }


        function updateModeButtons() {
            for (
                const [name, button]
                of modeButtons
            ) {
                button.classList.toggle(
                    'vm-drupal-active',
                    name === mode
                );
            }
        }


        /*
         * ----------------------------------------------------------------
         * Geometry
         * ----------------------------------------------------------------
         */

        function calculateImageGeometry() {
            const width =
                content.clientWidth -
                2 * GRID_PADDING;

            const height =
                content.clientHeight -
                2 * GRID_PADDING;


            mediaColumns =
                Math.max(
                    1,
                    Math.floor(
                        (width + GRID_GAP) /
                        (THUMB_WIDTH + GRID_GAP)
                    )
                );


            mediaRows =
                Math.max(
                    1,
                    Math.floor(
                        (height + GRID_GAP) /
                        (THUMB_HEIGHT + GRID_GAP)
                    )
                );


            mediaPageSize =
                Math.min(
                    mediaColumns *
                    mediaRows,

                    50
                );
        }


        /*
         * ----------------------------------------------------------------
         * Request construction
         * ----------------------------------------------------------------
         */

        function currentResource() {
            if (
                mode === 'images' ||
                mode === 'files'
            ) {
                return fileResource;
            }

            return nodeTypes.find(
                n => n.type === mode
            );
        }


        function buildURL(offset = 0) {
            const resource =
                currentResource();

            if (!resource)
                return null;


            const url =
                new URL(resource.href);


            const limit =
                mode === 'images'
                    ? mediaPageSize
                    : LIST_PAGE_SIZE;


            url.searchParams.set(
                'page[limit]',
                limit
            );

            url.searchParams.set(
                'page[offset]',
                offset
            );


            /*
             * Newest first.
             */
            url.searchParams.set(
                'sort',
                '-created'
            );


            /*
             * Images:
             *
             * Drupal JSON:API supports STARTS_WITH, so request only
             * files whose MIME type begins "image/".
             */
            if (mode === 'images') {
                url.searchParams.set(
                    'filter[mime][condition][path]',
                    'filemime'
                );

                url.searchParams.set(
                    'filter[mime][condition][operator]',
                    'STARTS_WITH'
                );

                url.searchParams.set(
                    'filter[mime][condition][value]',
                    'image/'
                );
            }


            /*
             * Search.
             */
            const q =
                search.value.trim();


            if (q) {
                if (
                    mode === 'images' ||
                    mode === 'files'
                ) {
                    url.searchParams.set(
                        'filter[search][condition][path]',
                        'filename'
                    );

                } else {
                    url.searchParams.set(
                        'filter[search][condition][path]',
                        'title'
                    );
                }


                url.searchParams.set(
                    'filter[search][condition][operator]',
                    'CONTAINS'
                );

                url.searchParams.set(
                    'filter[search][condition][value]',
                    q
                );
            }


            return url;
        }


        /*
         * ----------------------------------------------------------------
         * Loading
         * ----------------------------------------------------------------
         */

        async function loadURL(
            url,
            newPage
        ) {
            if (!url)
                return false;


            content.textContent =
                'Loading…';


            let doc;

            try {
                doc =
                    await fetchJSON(url);

            } catch (e) {
                content.textContent =
                    `Drupal JSON:API error: ${e}`;

                return false;
            }


            let result =
                Array.isArray(doc.data)
                    ? doc.data
                    : [];


            /*
             * Files mode means non-image files.
             *
             * Drupal filtering has STARTS_WITH but no NOT_STARTS_WITH
             * operator, so Files is filtered client-side.
             *
             * This means a Files page can have fewer than LIST_PAGE_SIZE
             * rows if that underlying API page contains images.
             */
            if (mode === 'files') {
                result =
                    result.filter(
                        item =>
                            !mimeForFile(item)
                                .toLowerCase()
                                .startsWith('image/')
                    );
            }


            items =
                result;

            page =
                newPage;

            selectedIndex =
                items.length
                    ? 0
                    : -1;


            nextUrl =
                linkHref(
                    doc.links?.next
                );

            prevUrl =
                linkHref(
                    doc.links?.prev
                );


            status.textContent =
                `page ${page} — ${items.length} shown`;


            render();

            return true;
        }


        async function loadFirstPage() {
            if (mode === 'images')
                calculateImageGeometry();

            return await loadURL(
                buildURL(0),
                1
            );
        }


        async function nextPage() {
            if (!nextUrl)
                return;

            await loadURL(
                nextUrl,
                page + 1
            );
        }


        async function prevPage() {
            if (!prevUrl)
                return;

            await loadURL(
                prevUrl,
                Math.max(
                    1,
                    page - 1
                )
            );
        }


        /*
         * ----------------------------------------------------------------
         * Rendering
         * ----------------------------------------------------------------
         */

        function render() {
            content.replaceChildren();


            if (!items.length) {
                content.textContent =
                    'No results.';

                return;
            }


            if (mode === 'images')
                renderImages();
            else if (mode === 'files')
                renderFiles();
            else
                renderNodes();
        }


        function renderImages() {
            const grid =
                document.createElement('div');

            grid.id =
                'vm-drupal-image-grid';


            grid.style.gridTemplateColumns =
                `repeat(${mediaColumns}, minmax(0, 1fr))`;


            items.forEach(
                (item, index) => {
                    const box =
                        document.createElement('div');

                    box.className =
                        'vm-drupal-image-item';


                    if (
                        index === selectedIndex
                    ) {
                        box.classList.add(
                            'vm-drupal-selected'
                        );
                    }


                    const url =
                        fileURL(item);


                    if (url) {
                        const img =
                            document.createElement(
                                'img'
                            );

                        img.src =
                            url;

                        img.loading =
                            'lazy';

                        img.alt =
                            filenameForFile(item);


                        img.addEventListener(
                            'click',
                            () => {
                                selectedIndex =
                                    index;

                                updateSelection();

                                openImage(index);
                            }
                        );


                        box.appendChild(img);
                    }


                    const title =
                        document.createElement(
                            'div'
                        );

                    title.className =
                        'vm-drupal-image-title';

                    title.textContent =
                        filenameForFile(item);

                    box.appendChild(title);


                    const info =
                        document.createElement(
                            'div'
                        );

                    info.className =
                        'vm-drupal-image-info';


                    info.textContent =
                        [
                            mimeForFile(item),

                            sizeForFile(item),

                            `#${item.attributes?.drupal_internal__fid ?? item.id}`
                        ]
                            .filter(Boolean)
                            .join(' — ');


                    box.appendChild(info);


                    if (url) {
                        const links =
                            document.createElement(
                                'div'
                            );

                        links.className =
                            'vm-drupal-image-links';


                        const a =
                            document.createElement(
                                'a'
                            );

                        a.href =
                            url;

                        a.target =
                            '_blank';

                        a.rel =
                            'noopener';

                        a.textContent =
                            'file';


                        links.appendChild(a);
                        box.appendChild(links);
                    }


                    box.addEventListener(
                        'click',
                        e => {
                            if (
                                e.target.closest('a') ||
                                e.target.tagName === 'IMG'
                            )
                                return;

                            selectedIndex =
                                index;

                            updateSelection();
                        }
                    );


                    grid.appendChild(box);
                }
            );


            content.appendChild(grid);
        }


        function renderFiles() {
            const list =
                document.createElement('ul');

            list.id =
                'vm-drupal-list';


            items.forEach(
                (item, index) => {
                    const row =
                        document.createElement(
                            'li'
                        );

                    row.className =
                        'vm-drupal-list-item';


                    if (
                        index === selectedIndex
                    ) {
                        row.classList.add(
                            'vm-drupal-selected'
                        );
                    }


                    const mime =
                        document.createElement(
                            'span'
                        );

                    mime.className =
                        'vm-drupal-mime';

                    mime.textContent =
                        mimeForFile(item) ||
                        'file';

                    row.appendChild(mime);


                    const url =
                        fileURL(item);


                    if (url) {
                        const a =
                            document.createElement(
                                'a'
                            );

                        a.href =
                            url;

                        a.target =
                            '_blank';

                        a.rel =
                            'noopener';

                        a.textContent =
                            filenameForFile(item);

                        row.appendChild(a);

                    } else {
                        const span =
                            document.createElement(
                                'span'
                            );

                        span.textContent =
                            filenameForFile(item);

                        row.appendChild(span);
                    }


                    const meta =
                        document.createElement(
                            'span'
                        );

                    meta.className =
                        'vm-drupal-meta';


                    meta.textContent =
                        [
                            sizeForFile(item),

                            formatDate(
                                item.attributes?.created
                            )
                        ]
                            .filter(Boolean)
                            .join(' — ');


                    row.appendChild(meta);


                    row.addEventListener(
                        'click',
                        e => {
                            if (e.target.closest('a'))
                                return;

                            selectedIndex =
                                index;

                            updateSelection();
                        }
                    );


                    list.appendChild(row);
                }
            );


            content.appendChild(list);
        }


        function renderNodes() {
            const list =
                document.createElement('ul');

            list.id =
                'vm-drupal-list';


            items.forEach(
                (item, index) => {
                    const row =
                        document.createElement(
                            'li'
                        );

                    row.className =
                        'vm-drupal-list-item';


                    if (
                        index === selectedIndex
                    ) {
                        row.classList.add(
                            'vm-drupal-selected'
                        );
                    }


                    const url =
                        nodePublicURL(item);


                    const a =
                        document.createElement(
                            'a'
                        );

                    a.href =
                        url;

                    a.target =
                        '_blank';

                    a.rel =
                        'noopener';

                    a.textContent =
                        nodeTitle(item);


                    row.appendChild(a);


                    const meta =
                        document.createElement(
                            'span'
                        );

                    meta.className =
                        'vm-drupal-meta';


                    const nid =
                        item.attributes
                            ?.drupal_internal__nid;


                    meta.textContent =
                        [
                            nid != null
                                ? `#${nid}`
                                : '',

                            formatDate(
                                item.attributes?.created
                            )
                        ]
                            .filter(Boolean)
                            .join(' — ');


                    row.appendChild(meta);


                    row.addEventListener(
                        'click',
                        e => {
                            if (e.target.closest('a'))
                                return;

                            selectedIndex =
                                index;

                            updateSelection();
                        }
                    );


                    list.appendChild(row);
                }
            );


            content.appendChild(list);
        }


        /*
         * ----------------------------------------------------------------
         * Selection
         * ----------------------------------------------------------------
         */

        function selectionNodes() {
            if (mode === 'images') {
                return content.querySelectorAll(
                    '.vm-drupal-image-item'
                );
            }

            return content.querySelectorAll(
                '.vm-drupal-list-item'
            );
        }


        function updateSelection() {
            const nodes =
                selectionNodes();


            nodes.forEach(
                (node, index) => {
                    node.classList.toggle(
                        'vm-drupal-selected',
                        index === selectedIndex
                    );
                }
            );


            if (mode !== 'images') {
                nodes[selectedIndex]
                    ?.scrollIntoView({
                        block: 'nearest'
                    });
            }
        }


        function moveImageHorizontal(delta) {
            const next =
                selectedIndex +
                delta;


            if (
                next >= 0 &&
                next < items.length
            ) {
                selectedIndex =
                    next;

                updateSelection();
            }
        }


        function moveImageVertical(delta) {
            const next =
                selectedIndex +
                delta * mediaColumns;


            if (
                next >= 0 &&
                next < items.length
            ) {
                selectedIndex =
                    next;

                updateSelection();
            }
        }


        function moveList(delta) {
            const next =
                selectedIndex +
                delta;


            if (
                next >= 0 &&
                next < items.length
            ) {
                selectedIndex =
                    next;

                updateSelection();
            }
        }


        function activateSelection() {
            const item =
                items[selectedIndex];

            if (!item)
                return;


            if (mode === 'images') {
                openImage(
                    selectedIndex
                );

                return;
            }


            const url =
                mode === 'files'
                    ? fileURL(item)
                    : nodePublicURL(item);


            if (url) {
                window.open(
                    url,
                    '_blank'
                );
            }
        }


        /*
         * ----------------------------------------------------------------
         * Full image viewer
         * ----------------------------------------------------------------
         */

        function showImage(index) {
            const item =
                items[index];

            const url =
                fileURL(item);


            if (!url)
                return;


            imageIndex =
                index;

            selectedIndex =
                index;


            updateSelection();


            fullImage.src =
                url;


            fullCaption.textContent =
                [
                    filenameForFile(item),

                    mimeForFile(item),

                    sizeForFile(item)
                ]
                    .filter(Boolean)
                    .join(' — ');
        }


        function openImage(index) {
            showImage(index);

            imageViewerVisible =
                true;

            imageOverlay.style.display =
                'flex';
        }


        function closeImage() {
            imageViewerVisible =
                false;

            imageOverlay.style.display =
                'none';

            fullImage.removeAttribute(
                'src'
            );

            imageIndex =
                -1;
        }


        async function nextImage(delta) {
            if (imageIndex < 0)
                return;


            const next =
                imageIndex +
                delta;


            if (
                next >= 0 &&
                next < items.length
            ) {
                showImage(next);
                return;
            }


            /*
             * Cross API-page boundary.
             */
            if (
                delta > 0 &&
                nextUrl
            ) {
                if (
                    await loadURL(
                        nextUrl,
                        page + 1
                    )
                ) {
                    if (items.length)
                        showImage(0);
                }

            } else if (
                delta < 0 &&
                prevUrl
            ) {
                if (
                    await loadURL(
                        prevUrl,
                        Math.max(1, page - 1)
                    )
                ) {
                    if (items.length) {
                        showImage(
                            items.length - 1
                        );
                    }
                }
            }
        }


        /*
         * ----------------------------------------------------------------
         * Modes
         * ----------------------------------------------------------------
         */

        async function changeMode(newMode) {
            if (mode === newMode)
                return;


            mode =
                newMode;

            page =
                1;

            selectedIndex =
                -1;

            nextUrl =
                null;

            prevUrl =
                null;


            updateModeButtons();

            await loadFirstPage();
        }


        /*
         * ----------------------------------------------------------------
         * UI
         * ----------------------------------------------------------------
         */

        launcher.addEventListener(
            'click',
            async () => {
                browserVisible =
                    true;

                overlay.style.display =
                    'block';


                updateModeButtons();


                if (!content.dataset.loaded) {
                    content.dataset.loaded =
                        '1';


                    /*
                     * Need a layout pass before calculating the thumbnail
                     * grid dimensions.
                     */
                    await new Promise(
                        resolve =>
                            requestAnimationFrame(
                                resolve
                            )
                    );


                    await loadFirstPage();
                }
            }
        );


        overlay.querySelector(
            '#vm-drupal-close'
        ).addEventListener(
            'click',
            () => {
                browserVisible =
                    false;

                overlay.style.display =
                    'none';
            }
        );


        overlay.querySelector(
            '#vm-drupal-prev'
        ).addEventListener(
            'click',
            prevPage
        );


        overlay.querySelector(
            '#vm-drupal-next'
        ).addEventListener(
            'click',
            nextPage
        );


        async function doSearch() {
            page = 1;

            await loadFirstPage();
        }


        overlay.querySelector(
            '#vm-drupal-search-button'
        ).addEventListener(
            'click',
            doSearch
        );


        search.addEventListener(
            'keydown',
            e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doSearch();
                }
            }
        );


        overlay.addEventListener(
            'click',
            e => {
                if (e.target === overlay) {
                    browserVisible =
                        false;

                    overlay.style.display =
                        'none';
                }
            }
        );


        imageOverlay.querySelector(
            '#vm-drupal-full-prev'
        ).addEventListener(
            'click',
            e => {
                e.stopPropagation();
                nextImage(-1);
            }
        );


        imageOverlay.querySelector(
            '#vm-drupal-full-next'
        ).addEventListener(
            'click',
            e => {
                e.stopPropagation();
                nextImage(+1);
            }
        );


        imageOverlay.querySelector(
            '#vm-drupal-full-close'
        ).addEventListener(
            'click',
            e => {
                e.stopPropagation();
                closeImage();
            }
        );


        imageOverlay.addEventListener(
            'click',
            e => {
                if (e.target === imageOverlay)
                    closeImage();
            }
        );


        /*
         * ----------------------------------------------------------------
         * Keyboard
         * ----------------------------------------------------------------
         *
         * Capture phase is deliberate, as with the WordPress script.
         */

        document.addEventListener(
            'keydown',
            async e => {
                const editable =
                    e.target instanceof HTMLInputElement ||
                    e.target instanceof HTMLTextAreaElement ||
                    e.target instanceof HTMLSelectElement ||
                    e.target?.isContentEditable;


                if (editable)
                    return;


                /*
                 * Full image viewer:
                 *
                 * Left / Up / PgUp       previous image
                 * Right / Down / PgDown  next image
                 */
                if (imageViewerVisible) {
                    switch (e.key) {
                        case 'ArrowLeft':
                        case 'ArrowUp':
                        case 'PageUp':

                            e.preventDefault();
                            e.stopPropagation();

                            await nextImage(-1);
                            return;


                        case 'ArrowRight':
                        case 'ArrowDown':
                        case 'PageDown':

                            e.preventDefault();
                            e.stopPropagation();

                            await nextImage(+1);
                            return;


                        case 'Escape':

                            e.preventDefault();
                            e.stopPropagation();

                            closeImage();
                            return;
                    }


                    return;
                }


                if (!browserVisible)
                    return;


                /*
                 * Image grid:
                 *
                 * Left/Right  one thumbnail
                 * Up/Down     one visual row
                 * PgUp/PgDn   previous/next API page
                 */
                if (mode === 'images') {
                    switch (e.key) {
                        case 'ArrowLeft':

                            e.preventDefault();
                            e.stopPropagation();

                            moveImageHorizontal(-1);
                            return;


                        case 'ArrowRight':

                            e.preventDefault();
                            e.stopPropagation();

                            moveImageHorizontal(+1);
                            return;


                        case 'ArrowUp':

                            e.preventDefault();
                            e.stopPropagation();

                            moveImageVertical(-1);
                            return;


                        case 'ArrowDown':

                            e.preventDefault();
                            e.stopPropagation();

                            moveImageVertical(+1);
                            return;


                        case 'PageUp':

                            e.preventDefault();
                            e.stopPropagation();

                            await prevPage();
                            return;


                        case 'PageDown':

                            e.preventDefault();
                            e.stopPropagation();

                            await nextPage();
                            return;


                        case 'Enter':

                            e.preventDefault();
                            e.stopPropagation();

                            activateSelection();
                            return;


                        case 'Escape':

                            e.preventDefault();
                            e.stopPropagation();

                            browserVisible =
                                false;

                            overlay.style.display =
                                'none';

                            return;
                    }


                    return;
                }


                /*
                 * Text modes: Files and node bundles.
                 */
                switch (e.key) {
                    case 'ArrowUp':

                        e.preventDefault();
                        e.stopPropagation();

                        moveList(-1);
                        return;


                    case 'ArrowDown':

                        e.preventDefault();
                        e.stopPropagation();

                        moveList(+1);
                        return;


                    case 'ArrowLeft':
                    case 'PageUp':

                        e.preventDefault();
                        e.stopPropagation();

                        await prevPage();
                        return;


                    case 'ArrowRight':
                    case 'PageDown':

                        e.preventDefault();
                        e.stopPropagation();

                        await nextPage();
                        return;


                    case 'Enter':

                        e.preventDefault();
                        e.stopPropagation();

                        activateSelection();
                        return;


                    case 'Escape':

                        e.preventDefault();
                        e.stopPropagation();

                        browserVisible =
                            false;

                        overlay.style.display =
                            'none';

                        return;
                }
            },

            true
        );
    }


    /*
     * ----------------------------------------------------------------
     * Startup
     * ----------------------------------------------------------------
     */

    async function main() {
        const discovery =
            await discoverDrupal();


        if (discovery)
            createUI(discovery);
    }


    main();

})();
