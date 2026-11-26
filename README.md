# WordPress and Drupal tools

A commandline tool for querying a wordpress site's api, allowing you to list pages, posts, media.
Also violentmonkey installable browser plugins, adding an interactive site browser.

## WordPress command line

[`wp.py`](wp.py) inspects WordPress REST and XML-RPC endpoints and lists posts, pages, media, and revisions.
The command-line tools require Python 3.8 or newer and use the standard library.
Loading browser cookies with `--loadcookies` also requires `browsercookies.py`.

```sh
python3 wp.py --baseurl https://example.com --apiinfo
python3 wp.py --baseurl https://example.com --posts --after 2026-01-01T00:00:00
python3 wp.py --baseurl https://example.com --media
```

For repeat use, set `baseurl` in `~/.wordpressrc`. Named sections such as `[blog]` are selected with `--sitename blog`.
A config section can also supply `username` and `password` for HTTP Basic authentication.

Some sites may require you to login. Or pass a session cookie.
Authenticated sites will return unrendered wordpress, instead of rendered html for posts, pages.

## wpindent

[`wpindent.py`](wpindent.py) reads WordPress block comments and UX Builder shortcodes from stdin, and outputs an indented an reformatted view.

## Browser userscripts

Import the scripts into Violentmonkey and open a page on the site you want to browse.

- [`wordpress.userscript.js`](wordpress.userscript.js) browses images, videos, files, posts, and pages through the WordPress REST API.
- [`drupal.userscript.js`](drupal.userscript.js) browses images, files, and content types exposed by Drupal JSON:API.

Each script looks for CMS markers in the loaded page and adds a browser button when it finds a match.
API requests start when you click the button. The collections you can browse depend on what the site exposes to your session.


