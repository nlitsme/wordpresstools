// ==UserScript==
// @name         WordPress REST Browser
// @namespace    https://example.invalid/
// @version      1.6
// @description  Browse WordPress media, files, posts and pages through the REST API
// @match        http://*/*
// @match        https://*/*
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const LIST_PER_PAGE = 50;

    const THUMB_WIDTH  = 180;
    const THUMB_HEIGHT = 210;
    const GRID_GAP     = 12;
    const GRID_PADDING = 12;

    /*
     * WordPress REST media types other than "image".
     */
    const NON_IMAGE_MEDIA_TYPES = [
        'audio',
        'video',
        'application',
        'text'
    ];


    function getApiRoot() {
        const link = document.querySelector(
            'link[rel="https://api.w.org/"]'
        );

        if (link?.href)
            return link.href;

        return new URL('/wp-json/', location.origin).href;
    }


    async function isWordPress(apiRoot) {
        try {
            const r = await fetch(apiRoot, {
                credentials: 'same-origin'
            });

            if (!r.ok)
                return false;

            const j = await r.json();

            return !!j.namespaces;

        } catch {
            return false;
        }
    }


    const css = `
#vm-wp-browser-button {
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

#vm-wp-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483646;

    background: rgba(0,0,0,.70);
    display: none;
}

#vm-wp-window {
    position: absolute;
    inset: 4%;

    background: #fff;
    color: #222;
    border-radius: 8px;

    display: flex;
    flex-direction: column;

    font: 14px sans-serif;
    overflow: hidden;
}

#vm-wp-toolbar {
    flex: none;

    padding: 10px;
    background: #eee;

    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}

#vm-wp-toolbar input {
    flex: 1;
    min-width: 180px;
    padding: 6px;
}

#vm-wp-toolbar button {
    padding: 6px 12px;
    cursor: pointer;
}

#vm-wp-toolbar button.vm-wp-active {
    font-weight: bold;
    background: #333;
    color: white;
}

#vm-wp-status {
    white-space: nowrap;
}

#vm-wp-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
}


/*
 * Media thumbnails
 */

#vm-wp-media-grid {
    box-sizing: border-box;

    width: 100%;
    height: 100%;

    display: grid;

    grid-template-columns:
        repeat(auto-fill, minmax(${THUMB_WIDTH}px, 1fr));

    grid-auto-rows: ${THUMB_HEIGHT}px;

    gap: ${GRID_GAP}px;
    padding: ${GRID_PADDING}px;

    overflow: hidden;
    align-content: start;
}

.vm-wp-media-item {
    box-sizing: border-box;

    height: ${THUMB_HEIGHT}px;

    border: 2px solid transparent;
    background: #fafafa;
    padding: 6px;

    overflow: hidden;
}

.vm-wp-media-item.vm-wp-selected {
    border-color: #1677ff;
    background: #eaf3ff;
}

.vm-wp-media-item img {
    display: block;

    width: 100%;
    height: 140px;

    object-fit: contain;
    background: #ddd;

    cursor: pointer;
}

.vm-wp-media-title {
    margin-top: 5px;

    font-weight: bold;

    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vm-wp-media-info {
    margin-top: 3px;

    font-size: 12px;
    color: #555;

    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vm-wp-media-links {
    margin-top: 5px;

    overflow: hidden;
    white-space: nowrap;
}

.vm-wp-media-links a {
    margin-right: 8px;
}


/*
 * Posts / Pages / Files lists
 */

#vm-wp-list {
    padding: 0;
    margin: 0;

    list-style: none;
}

.vm-wp-list-item {
    padding: 9px 12px;
    border-bottom: 1px solid #ddd;
}

.vm-wp-list-item.vm-wp-selected {
    background: #eaf3ff;
}

.vm-wp-list-item a {
    color: #0645ad;
    text-decoration: none;
}

.vm-wp-list-item a:hover {
    text-decoration: underline;
}

.vm-wp-list-meta {
    margin-left: 8px;

    color: #777;
    font-size: 12px;
}

.vm-wp-file-type {
    display: inline-block;

    min-width: 110px;
    margin-right: 8px;

    color: #555;
    font-family: monospace;
}

.vm-wp-file-size {
    margin-left: 8px;

    color: #777;
    font-size: 12px;
}


/*
 * Full image viewer
 */

#vm-wp-image-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;

    display: none;
    align-items: center;
    justify-content: center;

    background: rgba(0,0,0,.94);
}

#vm-wp-image {
    max-width: calc(100% - 140px);
    max-height: calc(100% - 80px);

    object-fit: contain;
}

.vm-wp-image-nav {
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

.vm-wp-image-nav:hover {
    background: rgba(255,255,255,.35);
}

#vm-wp-image-prev {
    left: 20px;
}

#vm-wp-image-next {
    right: 20px;
}

#vm-wp-image-close {
    position: absolute;
    right: 20px;
    top: 15px;

    border: none;
    background: none;
    color: white;

    font: 32px sans-serif;
    cursor: pointer;
}

#vm-wp-image-caption {
    position: absolute;

    left: 70px;
    right: 70px;
    bottom: 12px;

    color: white;
    text-align: center;

    font: 14px sans-serif;

    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
`;


    function addStyles() {
        const style = document.createElement('style');

        style.textContent = css;
        document.head.appendChild(style);
    }


    function createUI(apiRoot) {
        addStyles();


        /*
         * Explicit UI state.
         *
         * This avoids relying on element.style.display, which only sees
         * inline styles and not CSS rules.
         */
        let browserVisible = false;
        let imageViewerVisible = false;


        const button = document.createElement('button');

        button.id = 'vm-wp-browser-button';
        button.textContent = 'WP Browser';

        document.body.appendChild(button);


        /*
         * Main browser
         */

        const overlay = document.createElement('div');

        overlay.id = 'vm-wp-overlay';

        overlay.innerHTML = `
            <div id="vm-wp-window">

                <div id="vm-wp-toolbar">

                    <button id="vm-wp-mode-media">Media</button>
                    <button id="vm-wp-mode-files">Files</button>
                    <button id="vm-wp-mode-posts">Posts</button>
                    <button id="vm-wp-mode-pages">Pages</button>

                    <input
                        id="vm-wp-search"
                        type="search"
                        placeholder="Search"
                    >

                    <button id="vm-wp-search-button">Search</button>

                    <button id="vm-wp-prev">←</button>

                    <span id="vm-wp-status"></span>

                    <button id="vm-wp-next">→</button>

                    <button id="vm-wp-close">Close</button>

                </div>

                <div id="vm-wp-content"></div>

            </div>
        `;

        document.body.appendChild(overlay);


        /*
         * Full image viewer
         */

        const imageOverlay = document.createElement('div');

        imageOverlay.id = 'vm-wp-image-overlay';

        imageOverlay.innerHTML = `
            <button
                id="vm-wp-image-prev"
                class="vm-wp-image-nav"
                title="Previous image"
            >‹</button>

            <img id="vm-wp-image">

            <button
                id="vm-wp-image-next"
                class="vm-wp-image-nav"
                title="Next image"
            >›</button>

            <button
                id="vm-wp-image-close"
                title="Close"
            >×</button>

            <div id="vm-wp-image-caption"></div>
        `;

        document.body.appendChild(imageOverlay);


        /*
         * Elements
         */

        const content =
            overlay.querySelector('#vm-wp-content');

        const search =
            overlay.querySelector('#vm-wp-search');

        const status =
            overlay.querySelector('#vm-wp-status');

        const mediaButton =
            overlay.querySelector('#vm-wp-mode-media');

        const filesButton =
            overlay.querySelector('#vm-wp-mode-files');

        const postsButton =
            overlay.querySelector('#vm-wp-mode-posts');

        const pagesButton =
            overlay.querySelector('#vm-wp-mode-pages');

        const fullImage =
            imageOverlay.querySelector('#vm-wp-image');

        const imageCaption =
            imageOverlay.querySelector(
                '#vm-wp-image-caption'
            );


        /*
         * State
         */

        let mode = 'media';

        let page = 1;
        let totalPages = 1;

        let items = [];

        let selectedIndex = -1;
        let imageIndex = -1;

        let mediaColumns = 1;
        let mediaRows = 1;
        let mediaPageSize = 1;


        /*
         * UI visibility helpers.
         */

        function showBrowser() {
            browserVisible = true;
            overlay.style.display = 'block';
        }


        function hideBrowser() {
            browserVisible = false;
            overlay.style.display = 'none';
        }


        function showImageViewer() {
            imageViewerVisible = true;
            imageOverlay.style.display = 'flex';
        }


        function hideImageViewer() {
            imageViewerVisible = false;
            imageOverlay.style.display = 'none';
        }


        function endpointForMode() {
            switch (mode) {
                case 'posts':
                    return 'wp/v2/posts';

                case 'pages':
                    return 'wp/v2/pages';

                case 'files':
                case 'media':
                default:
                    return 'wp/v2/media';
            }
        }


        function updateModeButtons() {
            mediaButton.classList.toggle(
                'vm-wp-active',
                mode === 'media'
            );

            filesButton.classList.toggle(
                'vm-wp-active',
                mode === 'files'
            );

            postsButton.classList.toggle(
                'vm-wp-active',
                mode === 'posts'
            );

            pagesButton.classList.toggle(
                'vm-wp-active',
                mode === 'pages'
            );
        }


        /*
         * Calculate how many image thumbnails fit on screen.
         */

        function calculateMediaGeometry() {
            const width =
                content.clientWidth -
                2 * GRID_PADDING;

            const height =
                content.clientHeight -
                2 * GRID_PADDING;

            mediaColumns = Math.max(
                1,
                Math.floor(
                    (width + GRID_GAP) /
                    (THUMB_WIDTH + GRID_GAP)
                )
            );

            mediaRows = Math.max(
                1,
                Math.floor(
                    (height + GRID_GAP) /
                    (THUMB_HEIGHT + GRID_GAP)
                )
            );

            mediaPageSize =
                Math.min(
                    mediaColumns * mediaRows,
                    100
                );
        }


        /*
         * Fetch one normal WordPress REST collection page.
         */

        async function fetchCollection(url) {
            const response = await fetch(
                url,
                {
                    credentials: 'same-origin'
                }
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            return {
                items: await response.json(),

                total:
                    Number(
                        response.headers.get(
                            'X-WP-Total'
                        )
                    ) || 0,

                totalPages:
                    Number(
                        response.headers.get(
                            'X-WP-TotalPages'
                        )
                    ) || 1
            };
        }


        /*
         * Fetch Files mode.
         *
         * WordPress doesn't provide "media_type != image", so query
         * each non-image media type separately and combine the page.
         *
         * We retrieve enough candidates for this requested combined
         * page and then sort/slice them globally.
         */
        async function loadFilesPage(newPage) {
            const wantedStart =
                (newPage - 1) * LIST_PER_PAGE;

            const wantedEnd =
                wantedStart + LIST_PER_PAGE;

            /*
             * To produce combined chronological pages correctly,
             * request the first N entries from each type.
             *
             * WordPress caps per_page at 100, so fetch as many pages
             * as required from each media type.
             */
            const needPerType =
                wantedEnd;

            const all = [];

            let total = 0;


            for (const mediaType of NON_IMAGE_MEDIA_TYPES) {
                let remaining =
                    needPerType;

                let typePage = 1;


                while (remaining > 0) {
                    const count =
                        Math.min(
                            remaining,
                            100
                        );

                    const url =
                        new URL(
                            'wp/v2/media',
                            apiRoot
                        );

                    url.searchParams.set(
                        'page',
                        typePage
                    );

                    url.searchParams.set(
                        'per_page',
                        count
                    );

                    url.searchParams.set(
                        'orderby',
                        'date'
                    );

                    url.searchParams.set(
                        'order',
                        'desc'
                    );

                    url.searchParams.set(
                        'media_type',
                        mediaType
                    );

                    url.searchParams.set(
                        '_fields',
                        [
                            'id',
                            'date',
                            'slug',
                            'link',
                            'title',
                            'media_type',
                            'mime_type',
                            'source_url',
                            'media_details'
                        ].join(',')
                    );


                    if (search.value.trim()) {
                        url.searchParams.set(
                            'search',
                            search.value.trim()
                        );
                    }


                    let result;

                    try {
                        result =
                            await fetchCollection(url);

                    } catch (e) {
                        /*
                         * A site/plugin may reject a particular media
                         * type. Just skip that type.
                         */
                        break;
                    }


                    if (typePage === 1)
                        total += result.total;


                    all.push(
                        ...result.items
                    );


                    if (
                        result.items.length < count ||
                        typePage >= result.totalPages
                    )
                        break;


                    remaining -=
                        result.items.length;

                    ++typePage;
                }
            }


            /*
             * Merge the separate media-type streams chronologically.
             */
            all.sort(
                (a, b) =>
                    String(b.date).localeCompare(
                        String(a.date)
                    )
            );


            items =
                all.slice(
                    wantedStart,
                    wantedEnd
                );


            page = newPage;

            totalPages =
                Math.max(
                    1,
                    Math.ceil(
                        total / LIST_PER_PAGE
                    )
                );


            selectedIndex =
                items.length ? 0 : -1;


            status.textContent =
                `page ${page}/${totalPages} — ` +
                `${total} files`;


            render();

            return true;
        }


        /*
         * Load one browser page.
         */

        async function load(newPage = page) {
            content.textContent = 'Loading…';


            if (mode === 'files') {
                try {
                    return await loadFilesPage(
                        newPage
                    );

                } catch (e) {
                    content.textContent =
                        `WordPress API error: ${e}`;

                    return false;
                }
            }


            if (mode === 'media')
                calculateMediaGeometry();


            const url =
                new URL(
                    endpointForMode(),
                    apiRoot
                );


            url.searchParams.set(
                'page',
                newPage
            );


            url.searchParams.set(
                'per_page',
                mode === 'media'
                    ? mediaPageSize
                    : LIST_PER_PAGE
            );


            url.searchParams.set(
                'orderby',
                'date'
            );


            url.searchParams.set(
                'order',
                'desc'
            );


            if (search.value.trim()) {
                url.searchParams.set(
                    'search',
                    search.value.trim()
                );
            }


            if (mode === 'media') {
                /*
                 * Only images.
                 */
                url.searchParams.set(
                    'media_type',
                    'image'
                );


                url.searchParams.set(
                    '_fields',
                    [
                        'id',
                        'date',
                        'slug',
                        'link',
                        'title',
                        'alt_text',
                        'media_type',
                        'mime_type',
                        'source_url',
                        'media_details'
                    ].join(',')
                );

            } else {
                url.searchParams.set(
                    '_fields',
                    [
                        'id',
                        'date',
                        'slug',
                        'link',
                        'title',
                        'status'
                    ].join(',')
                );
            }


            let result;

            try {
                result =
                    await fetchCollection(url);

            } catch (e) {
                content.textContent =
                    `WordPress API error: ${e}`;

                return false;
            }


            page = newPage;

            totalPages =
                result.totalPages;

            items =
                result.items;

            selectedIndex =
                items.length ? 0 : -1;


            if (mode === 'media') {
                status.textContent =
                    `page ${page}/${totalPages} — ` +
                    `${result.total} images — ` +
                    `${mediaColumns}×${mediaRows}`;

            } else {
                status.textContent =
                    `page ${page}/${totalPages} — ` +
                    `${result.total} ${mode}`;
            }


            render();

            return true;
        }


        /*
         * Render
         */

        function render() {
            content.replaceChildren();


            if (!items.length) {
                content.textContent =
                    'No results.';

                return;
            }


            if (mode === 'media') {
                renderMedia();

            } else if (mode === 'files') {
                renderFiles();

            } else {
                renderList();
            }
        }


        function renderMedia() {
            const grid =
                document.createElement('div');

            grid.id =
                'vm-wp-media-grid';


            grid.style.gridTemplateColumns =
                `repeat(${mediaColumns}, minmax(0, 1fr))`;


            items.forEach(
                (item, index) => {
                    const box =
                        document.createElement('div');

                    box.className =
                        'vm-wp-media-item';

                    box.dataset.index =
                        index;


                    if (
                        index === selectedIndex
                    ) {
                        box.classList.add(
                            'vm-wp-selected'
                        );
                    }


                    const sizes =
                        item.media_details?.sizes;


                    const previewUrl =
                        sizes?.medium?.source_url ||
                        sizes?.thumbnail?.source_url ||
                        item.source_url;


                    const preview =
                        document.createElement('img');

                    preview.src =
                        previewUrl;

                    preview.loading =
                        'lazy';

                    preview.alt =
                        item.alt_text || '';


                    preview.addEventListener(
                        'click',
                        () => {
                            selectedIndex =
                                index;

                            updateSelection();

                            openImage(index);
                        }
                    );


                    box.appendChild(
                        preview
                    );


                    const title =
                        document.createElement(
                            'div'
                        );

                    title.className =
                        'vm-wp-media-title';

                    title.textContent =
                        item.title?.rendered ||
                        item.slug ||
                        `media ${item.id}`;

                    box.appendChild(
                        title
                    );


                    const info =
                        document.createElement(
                            'div'
                        );

                    info.className =
                        'vm-wp-media-info';


                    const dimensions =
                        item.media_details?.width &&
                        item.media_details?.height
                            ?
                            ` — ` +
                            `${item.media_details.width}×` +
                            `${item.media_details.height}`
                            :
                            '';


                    info.textContent =
                        `#${item.id} — ` +
                        `${item.mime_type || ''}` +
                        dimensions;


                    box.appendChild(
                        info
                    );


                    const links =
                        document.createElement(
                            'div'
                        );

                    links.className =
                        'vm-wp-media-links';


                    if (item.source_url) {
                        const original =
                            document.createElement(
                                'a'
                            );

                        original.href =
                            item.source_url;

                        original.target =
                            '_blank';

                        original.rel =
                            'noopener';

                        original.textContent =
                            'file';

                        links.appendChild(
                            original
                        );
                    }


                    if (item.link) {
                        const attachment =
                            document.createElement(
                                'a'
                            );

                        attachment.href =
                            item.link;

                        attachment.target =
                            '_blank';

                        attachment.rel =
                            'noopener';

                        attachment.textContent =
                            'page';

                        links.appendChild(
                            attachment
                        );
                    }


                    box.appendChild(
                        links
                    );


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


                    grid.appendChild(
                        box
                    );
                }
            );


            content.appendChild(
                grid
            );
        }


        /*
         * Non-image media text listing.
         */

        function renderFiles() {
            const list =
                document.createElement('ul');

            list.id =
                'vm-wp-list';


            items.forEach(
                (item, index) => {
                    const row =
                        document.createElement(
                            'li'
                        );

                    row.className =
                        'vm-wp-list-item';


                    if (
                        index === selectedIndex
                    ) {
                        row.classList.add(
                            'vm-wp-selected'
                        );
                    }


                    const mime =
                        document.createElement(
                            'span'
                        );

                    mime.className =
                        'vm-wp-file-type';

                    mime.textContent =
                        item.mime_type ||
                        item.media_type ||
                        'file';


                    row.appendChild(
                        mime
                    );


                    const link =
                        document.createElement(
                            'a'
                        );

                    link.href =
                        item.source_url ||
                        item.link;

                    link.target =
                        '_blank';

                    link.rel =
                        'noopener';


                    /*
                     * Prefer the actual filename from source_url.
                     */
                    let filename = '';

                    if (item.source_url) {
                        try {
                            filename =
                                decodeURIComponent(
                                    new URL(
                                        item.source_url
                                    ).pathname
                                        .split('/')
                                        .pop()
                                );

                        } catch {
                            filename = '';
                        }
                    }


                    link.textContent =
                        filename ||
                        item.title?.rendered ||
                        item.slug ||
                        `media ${item.id}`;


                    row.appendChild(
                        link
                    );


                    const meta =
                        document.createElement(
                            'span'
                        );

                    meta.className =
                        'vm-wp-list-meta';


                    const date =
                        item.date
                            ?
                            item.date.replace(
                                'T',
                                ' '
                            )
                            :
                            '';


                    meta.textContent =
                        `#${item.id}` +
                        (date
                            ? ` — ${date}`
                            : '');


                    row.appendChild(
                        meta
                    );


                    row.addEventListener(
                        'click',
                        e => {
                            if (
                                e.target.closest('a')
                            )
                                return;

                            selectedIndex =
                                index;

                            updateSelection();
                        }
                    );


                    list.appendChild(
                        row
                    );
                }
            );


            content.appendChild(
                list
            );
        }


        /*
         * Posts/pages listing.
         */

        function renderList() {
            const list =
                document.createElement('ul');

            list.id =
                'vm-wp-list';


            items.forEach(
                (item, index) => {
                    const row =
                        document.createElement(
                            'li'
                        );

                    row.className =
                        'vm-wp-list-item';


                    if (
                        index === selectedIndex
                    ) {
                        row.classList.add(
                            'vm-wp-selected'
                        );
                    }


                    const link =
                        document.createElement(
                            'a'
                        );

                    link.href =
                        item.link;

                    link.target =
                        '_blank';

                    link.rel =
                        'noopener';


                    link.textContent =
                        item.title?.rendered ||
                        item.slug ||
                        `${mode.slice(0, -1)} ${item.id}`;


                    row.appendChild(
                        link
                    );


                    const meta =
                        document.createElement(
                            'span'
                        );

                    meta.className =
                        'vm-wp-list-meta';


                    const date =
                        item.date
                            ?
                            item.date.replace(
                                'T',
                                ' '
                            )
                            :
                            '';


                    meta.textContent =
                        `#${item.id}` +
                        (date
                            ? ` — ${date}`
                            : '');


                    row.appendChild(
                        meta
                    );


                    row.addEventListener(
                        'click',
                        e => {
                            if (
                                e.target.closest('a')
                            )
                                return;

                            selectedIndex =
                                index;

                            updateSelection();
                        }
                    );


                    list.appendChild(
                        row
                    );
                }
            );


            content.appendChild(
                list
            );
        }


        /*
         * Selection
         */

        function selectionNodes() {
            if (mode === 'media') {
                return content.querySelectorAll(
                    '.vm-wp-media-item'
                );
            }

            return content.querySelectorAll(
                '.vm-wp-list-item'
            );
        }


        function updateSelection() {
            const nodes =
                selectionNodes();


            nodes.forEach(
                (node, index) => {
                    node.classList.toggle(
                        'vm-wp-selected',
                        index === selectedIndex
                    );
                }
            );


            /*
             * Lists may scroll.
             * Media grid is guaranteed to fit.
             */
            if (mode !== 'media') {
                const selected =
                    nodes[selectedIndex];

                if (selected) {
                    selected.scrollIntoView({
                        block: 'nearest',
                        inline: 'nearest'
                    });
                }
            }
        }


        /*
         * Media grid cursor movement.
         */

        function moveMediaHorizontal(delta) {
            if (selectedIndex < 0)
                return;


            const next =
                selectedIndex + delta;


            if (
                next >= 0 &&
                next < items.length
            ) {
                selectedIndex =
                    next;

                updateSelection();
            }
        }


        function moveMediaVertical(deltaRows) {
            if (selectedIndex < 0)
                return;


            const column =
                selectedIndex %
                mediaColumns;


            const currentRow =
                Math.floor(
                    selectedIndex /
                    mediaColumns
                );


            const nextRow =
                currentRow +
                deltaRows;


            if (nextRow < 0)
                return;


            const next =
                nextRow *
                mediaColumns +
                column;


            /*
             * Preserve column when possible.
             */
            if (next < items.length) {
                selectedIndex =
                    next;

                updateSelection();
                return;
            }


            /*
             * Partial final row: if moving down and the requested
             * column doesn't exist, stay where we are.
             */
        }


        /*
         * Text-list selection.
         */

        function moveListSelection(delta) {
            if (selectedIndex < 0)
                return;


            const next =
                selectedIndex + delta;


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
            if (
                selectedIndex < 0 ||
                selectedIndex >= items.length
            )
                return;


            const item =
                items[selectedIndex];


            if (mode === 'media') {
                if (item.source_url)
                    openImage(selectedIndex);

                return;
            }


            const url =
                mode === 'files'
                    ?
                    item.source_url ||
                    item.link
                    :
                    item.link;


            if (url) {
                window.open(
                    url,
                    '_blank'
                );
            }
        }


        /*
         * Full image viewer.
         */

        function showImage(index) {
            const item =
                items[index];


            if (!item?.source_url)
                return;


            imageIndex =
                index;

            selectedIndex =
                index;


            updateSelection();


            fullImage.src =
                item.source_url;

            fullImage.alt =
                item.alt_text || '';


            const title =
                item.title?.rendered ||
                item.slug ||
                `media ${item.id}`;


            const dimensions =
                item.media_details?.width &&
                item.media_details?.height
                    ?
                    ` — ` +
                    `${item.media_details.width}×` +
                    `${item.media_details.height}`
                    :
                    '';


            imageCaption.textContent =
                `${title} — #${item.id}` +
                dimensions;
        }


        function openImage(index) {
            showImage(index);
            showImageViewer();
        }


        function closeImage() {
            hideImageViewer();

            fullImage.removeAttribute(
                'src'
            );

            imageIndex =
                -1;
        }


        async function nextImage(direction) {
            if (imageIndex < 0)
                return;


            const next =
                imageIndex +
                direction;


            if (
                next >= 0 &&
                next < items.length
            ) {
                showImage(next);
                return;
            }


            if (direction > 0) {
                if (page >= totalPages)
                    return;


                if (!await load(page + 1))
                    return;


                if (items.length)
                    showImage(0);

            } else {
                if (page <= 1)
                    return;


                if (!await load(page - 1))
                    return;


                if (items.length) {
                    showImage(
                        items.length - 1
                    );
                }
            }
        }


        /*
         * Mode/search
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


            updateModeButtons();

            await load(1);
        }


        function newSearch() {
            page = 1;
            load(1);
        }


        /*
         * UI controls
         */

        button.addEventListener(
            'click',
            async () => {
                showBrowser();


                if (!content.dataset.loaded) {
                    content.dataset.loaded =
                        '1';

                    updateModeButtons();


                    /*
                     * Wait until the browser has a real layout before
                     * calculating the thumbnail grid.
                     */
                    await new Promise(
                        resolve =>
                            requestAnimationFrame(
                                resolve
                            )
                    );


                    load();
                }
            }
        );


        mediaButton.addEventListener(
            'click',
            () =>
                changeMode('media')
        );


        filesButton.addEventListener(
            'click',
            () =>
                changeMode('files')
        );


        postsButton.addEventListener(
            'click',
            () =>
                changeMode('posts')
        );


        pagesButton.addEventListener(
            'click',
            () =>
                changeMode('pages')
        );


        overlay.querySelector(
            '#vm-wp-close'
        ).addEventListener(
            'click',
            hideBrowser
        );


        overlay.querySelector(
            '#vm-wp-prev'
        ).addEventListener(
            'click',
            async () => {
                if (page > 1)
                    await load(page - 1);
            }
        );


        overlay.querySelector(
            '#vm-wp-next'
        ).addEventListener(
            'click',
            async () => {
                if (page < totalPages)
                    await load(page + 1);
            }
        );


        overlay.querySelector(
            '#vm-wp-search-button'
        ).addEventListener(
            'click',
            newSearch
        );


        search.addEventListener(
            'keydown',
            e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    newSearch();
                }
            }
        );


        overlay.addEventListener(
            'click',
            e => {
                if (e.target === overlay)
                    hideBrowser();
            }
        );


        /*
         * Full-image buttons.
         */

        imageOverlay.querySelector(
            '#vm-wp-image-prev'
        ).addEventListener(
            'click',
            e => {
                e.stopPropagation();
                nextImage(-1);
            }
        );


        imageOverlay.querySelector(
            '#vm-wp-image-next'
        ).addEventListener(
            'click',
            e => {
                e.stopPropagation();
                nextImage(+1);
            }
        );


        imageOverlay.querySelector(
            '#vm-wp-image-close'
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
         * Keyboard handling.
         *
         * Capture mode ensures we see key events before the underlying
         * WordPress theme/plugins can consume them.
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
                 * Full image viewer has highest priority.
                 */
                if (imageViewerVisible) {
                    switch (e.key) {
                        case 'ArrowRight':
                        case 'ArrowDown':
                        case 'PageDown':

                            e.preventDefault();
                            e.stopPropagation();

                            await nextImage(+1);
                            return;


                        case 'ArrowLeft':
                        case 'ArrowUp':
                        case 'PageUp':

                            e.preventDefault();
                            e.stopPropagation();

                            await nextImage(-1);
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
                 * Image thumbnail grid:
                 *
                 * Left/Right = previous/next thumbnail
                 * Up/Down    = previous/next visual row
                 * PgUp/PgDn  = previous/next REST page
                 */
                if (mode === 'media') {
                    switch (e.key) {
                        case 'ArrowLeft':

                            e.preventDefault();
                            e.stopPropagation();

                            moveMediaHorizontal(-1);
                            return;


                        case 'ArrowRight':

                            e.preventDefault();
                            e.stopPropagation();

                            moveMediaHorizontal(+1);
                            return;


                        case 'ArrowUp':

                            e.preventDefault();
                            e.stopPropagation();

                            moveMediaVertical(-1);
                            return;


                        case 'ArrowDown':

                            e.preventDefault();
                            e.stopPropagation();

                            moveMediaVertical(+1);
                            return;


                        case 'PageUp':

                            e.preventDefault();
                            e.stopPropagation();

                            if (page > 1)
                                await load(page - 1);

                            return;


                        case 'PageDown':

                            e.preventDefault();
                            e.stopPropagation();

                            if (page < totalPages)
                                await load(page + 1);

                            return;


                        case 'Enter':

                            e.preventDefault();
                            e.stopPropagation();

                            activateSelection();
                            return;


                        case 'Escape':

                            e.preventDefault();
                            e.stopPropagation();

                            hideBrowser();
                            return;
                    }


                    return;
                }


                /*
                 * Files / Posts / Pages:
                 *
                 * Up/Down       = select previous/next line
                 * Left/PageUp   = previous page
                 * Right/PageDown = next page
                 */
                switch (e.key) {
                    case 'ArrowUp':

                        e.preventDefault();
                        e.stopPropagation();

                        moveListSelection(-1);
                        return;


                    case 'ArrowDown':

                        e.preventDefault();
                        e.stopPropagation();

                        moveListSelection(+1);
                        return;


                    case 'ArrowLeft':
                    case 'PageUp':

                        e.preventDefault();
                        e.stopPropagation();

                        if (page > 1)
                            await load(page - 1);

                        return;


                    case 'ArrowRight':
                    case 'PageDown':

                        e.preventDefault();
                        e.stopPropagation();

                        if (page < totalPages)
                            await load(page + 1);

                        return;


                    case 'Enter':

                        e.preventDefault();
                        e.stopPropagation();

                        activateSelection();
                        return;


                    case 'Escape':

                        e.preventDefault();
                        e.stopPropagation();

                        hideBrowser();
                        return;
                }
            },

            true
        );
    }


    async function main() {
        const apiRoot =
            getApiRoot();


        if (await isWordPress(apiRoot))
            createUI(apiRoot);
    }


    main();

})();
