#!/usr/bin/python3
import urllib.request
import urllib.parse
import http.cookiejar
import binascii
import json
import re

def get(d, *path):
    for p in path:
        if type(d)==list and type(p)==int:
            d = d[p]
        elif type(d)==dict:
            d = d.get(p)
        else:
            return
    return d


class Wordpress:
    def __init__(self, args, url):
        self.args = args
        self.baseurl = url
        handlers = []
        if args.trace:
            handlers.append(urllib.request.HTTPSHandler(debuglevel=1))
        self.opener = urllib.request.build_opener(*handlers)

    def logprint(self, *args):
        if self.args.trace:
            print(*args)


    def jsonreq(self, path, **query):
        return self.httpreq(self.baseurl + "/wp-json" + path + "?" + urllib.parse.urlencode(query))
    def rpcreq(self, method, *args):
        xmlreq = f"""<methodCall><methodName>{method}</methodName><params>"""
        for a in args:
            xmlreq += f"""<param><value>{a}</value></param>"""
        xmlreq += f"""</params></methodCall>"""

        return self.httpreq(self.baseurl + "/xmlrpc.php", xmlreq)

    def httpreq(self, url, data = None):
        self.logprint(">", url)
        hdrs = { "User-Agent": "Mozilla/5.0" }
        if data and type(data)==str:
            data = data.encode('utf-8')
        if data and data[:1] in (b'{', b'['):
            hdrs["Content-Type"] = "application/json"
        if self.args.username:
            userpass = f"{self.args.username}:{self.args.password}"
            b64 = binascii.b2a_base64(userpass.encode('utf-8')).decode().strip()
            hdrs['Authorization'] = f"Basic {b64}"

        req = urllib.request.Request(url, headers=hdrs)
        kwargs = dict()
        if data:
            kwargs["data"] = data
        try:
            response = self.opener.open(req, **kwargs)
        except urllib.error.HTTPError as e:
            self.logprint("!", str(e))
            response = e

        data = response.read()
        if response.headers.get("content-type", '').find("application/json")>=0:
            # note: special handling for sdrplay site which sometimes prefixes json with some html.
            #if m := re.search(br'\[|{\"', data):
            #    data = data[m.start():]
            js = json.loads(data)
            self.logprint(js)
            self.logprint()
            return js
        self.logprint(data)
        self.logprint()
        return data

    def apiinfo(self):
        return self.jsonreq("")
    def rpcinfo(self):
        return self.rpcreq("system.listMethods")

    def enuminfo(self, tp):
        empty = 0
        p = 1
        ct = 'edit' if self.args.username else 'view'

        while True:
            posts = self.jsonreq("/wp/v2/"+tp, page=p, per_page=50, context=ct)
            if type(posts)==dict:
                # rest_post_invalid_page_number
                print(p, "->", posts.get('code'))
                break
            if not posts:
                empty += 1
                if empty==2:
                    break
            elif type(posts)==list:
                empty = 0
                yield from posts
            else:
                print(p, "->", posts)

            p += 1


def dumpapiinfo(api):
    for name, info in api.get('routes', {}).items():
        print("%s" % name)
        for ep in info.get('endpoints', []):
            print("  %s" % '.'.join(ep.get('methods', [])))
            alist = ep.get('args') or {}
            for n, a in alist.items():
                extra = []
                if a.get('required'):
                    extra.append("required")
                if a.get('enum'):
                    extra.append(", ".join(a.get('enum')))
                extra.append(f"{a.get('minimum', 'None')}..{a.get('maximum', 'None')}, dfl:{a.get('default', 'None')}")
                print("    %s : %s : %s" % (n, a.get('type'), "\t".join(extra)))

def dumprpcinfo(api):
    print(api)

def dumppost(args, p):
    if args.verbose:
        for k, v in p.items():
            print(f"{k:<30}{p.get('id'):>8}\t{v}")
    else:
        which = "raw" if args.username else "rendered"

        isrev = p.get('status') is None

        if isrev:
            print(f"rev {p.get('id')} of {p.get('parent')} created: {p.get('date')}, modified: {p.get('modified')}  {p.get('title').get(which)}")
        else:
            print(f"{p.get('type')} {p.get('id')} created: {p.get('date')}, modified: {p.get('modified')}  {p.get('title').get(which)}")
        print(p.get('content').get(which))

def dumpmedia(p):
    print(f"{p.get('id')} {p.get('date')} {get(p, 'title', 'raw') or '-':<40} {get(p, 'guid', 'rendered')}")

def loadconfig(cfgfile):
    """
    Load config from .wordpressrc
    """
    with open(cfgfile, 'r') as fh:
        txt = fh.read()
    txt = "[root]\n" + txt
    import configparser
    config = configparser.ConfigParser()
    config.read_string(txt)

    return config


def applyconfig(cfg, args):
    """
    Apply the configuration read from .wordpressrc to the `args` dictionary,
    which is used to configure everything.
    """
    def add(argname, cfgname):
        if not getattr(args, argname) and cfg.has_option(args.sitename, cfgname):
            setattr(args, argname, cfg.get(args.sitename, cfgname))

    add('username', 'username')
    add('password', 'password')
    add('baseurl', 'baseurl')


def main():
    import argparse
    parser = argparse.ArgumentParser(description='wordpress tool')
    parser.add_argument('--verbose', '-v', action='store_true', help='output warnings')
    parser.add_argument('--trace',  action='store_true', help=argparse.SUPPRESS) # 'trace http'
    parser.add_argument('--posts', '-p', action='store_true', help='list posts')
    parser.add_argument('--pages', '-P', action='store_true', help='list pages')
    parser.add_argument('--revisions', '-R', action='store_true', help='show revisions of posts/pages')
    parser.add_argument('--media', '-m', action='store_true', help='list media')
    parser.add_argument('--apiinfo', '-i', action='store_true', help='print json api info')
    parser.add_argument('--rpcinfo', action='store_true', help='print rpc api info')
    parser.add_argument('--config', help=argparse.SUPPRESS) # 'specify configuration file.'
    parser.add_argument('--username', help=argparse.SUPPRESS)
    parser.add_argument('--password', help=argparse.SUPPRESS)
    parser.add_argument('--baseurl', type=str)
    parser.add_argument('--json', type=str, help='user supplied json-api request')
    parser.add_argument('--sitename', type=str, help='select site from config', default='root')
    args = parser.parse_args()

    if not args.config:
        import os
        homedir = os.environ['HOME']
        args.config = os.path.join(homedir, ".wordpressrc")

    try:
        cfg = loadconfig(args.config)

        applyconfig(cfg, args)
    except Exception as e:
        print("config: %s" % e)

    # GET https://siteaddress/wp-json   -> returns api description
    # POST -d '<methodCall><methodName>mt.supportedMethods</methodName></methodCall>' https://siteaddress/xmlrpc.php

    wp = Wordpress(args, args.baseurl)

    if args.apiinfo:
        dumpapiinfo(wp.apiinfo())
    if args.rpcinfo:
        dumprpcinfo(wp.rpcinfo().decode())
    if args.json:
        res = wp.jsonreq(args.json)
        print(res)
    if args.posts:
        for p in wp.enuminfo("posts"):
            if args.revisions:
                for r in wp.enuminfo(f"posts/{p.get('id')}/revisions"):
                    dumppost(args, r)
            else:
                dumppost(args, p)
    if args.pages:
        for p in wp.enuminfo("pages"):
            if args.revisions:
                for r in wp.enuminfo(f"pages/{p.get('id')}/revisions"):
                    dumppost(args, r)
            else:
                dumppost(args, p)
    if args.media:
        for p in wp.enuminfo("media"):
            dumpmedia(p)


if __name__ == '__main__':
    main()

