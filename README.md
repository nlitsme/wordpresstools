# WordPress and Drupal tools

## Browser userscripts

Import the scripts into Violentmonkey and open a page on the site you want to browse.

- [`wordpress.userscript.js`](wordpress.userscript.js) browses images, videos, files, posts, and pages through the WordPress REST API.
- [`drupal.userscript.js`](drupal.userscript.js) browses images, files, and content types exposed by Drupal JSON:API.

Each script looks for CMS markers in the loaded page and adds a browser button when it finds a match. API requests start when you click the button. The collections you can browse depend on what the site exposes to your session.

## WordPress command line

[`wp.py`](wp.py) inspects WordPress REST and XML-RPC endpoints and lists posts, pages, media, and revisions. The command-line tools require Python 3.8 or newer and use the standard library. Loading browser cookies with `--loadcookies` also requires `browsercookies.py`.

```sh
python3 wp.py --baseurl https://example.com --apiinfo
python3 wp.py --baseurl https://example.com --posts --after 2026-01-01T00:00:00
python3 wp.py --baseurl https://example.com --media
```

For repeat use, set `baseurl` in `~/.wordpressrc`. Named sections such as `[blog]` are selected with `--sitename blog`. A config section can also supply `username` and `password` for HTTP Basic authentication.

## Formatters

- [`wpindent.py`](wpindent.py) reads WordPress block comments and UX Builder shortcodes from standard input. Keep it alongside `shortcodeindent.py`, which supplies its parser.
- [`shortcodeindent.py`](shortcodeindent.py) reads bracketed shortcodes from files or standard input. Use `--warnings` for nesting diagnostics.

```sh
python3 wpindent.py < blocks.txt
python3 shortcodeindent.py --warnings shortcodes.txt
```

Both print an indented view for inspection, preserving text and the original tag and attribute syntax. Diagnostics use tagged lines such as `WARNING:` and `ERROR:` on standard output.
