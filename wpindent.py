"""
Indent WordPress layout from standard input.

WordPress blocks:
    <!-- wp:tag --> ... <!-- /wp:tag -->

UX Builder shortcodes:
    [tag] ... [/tag]

Print the indented layout and any WARNING diagnostics to standard output.
"""
# updated by chatpt GPT-6

import argparse
from dataclasses import dataclass
import json
import re
import sys


def indent(level): return "  "*level


def stripspaces(txt):
    # shrink whitespace to single space,
    # and strip leading/trailing whitespace.
    txt = re.sub(r'\s+', ' ', txt)
    txt = re.sub(r'^\s+|\s+$', '', txt)
    return txt


def escapevalue(v):
    if not v:
        return v
    return stripspaces(v).replace("&", "&amp;").replace("\"", "&quot;")


class TokenBase:
    """
    baseclass for the nested tokens.
    provides the following methods:
      - addChild
      - oneline and multiline are used by the formatter to find
        the best fitting layout.

    subclasses should implement:
      - formatattrs: returns the tag's attribute string
      - asendtag   : returns the 'end' tag for this tag.
      - asstarttag : format the entire tag including attributes.
      - assingletag: format the entire 'single' tag including attributes.
    """
    def __init__(self):
        self.children = []
        self.source = None
        self.endtoken = None

    def addChild(self, elem):
        if self.children and isinstance(self.children[-1], BodyToken) and isinstance(elem, BodyToken):
            self.children[-1].merge(elem)
        else:
            self.children.append(elem)

    def astag(self):
        if self.source is not None:
            return self.source
        if self.isend:
            return self.asendtag()
        elif self.issingle:
            return self.assingletag()
        else:
            return self.asstarttag()

    def oneline(self):
        """
        Render this token and its children with their original spacing.
        """
        children = "".join(child.oneline() for child in self.children)
        endtag = self.endtoken.astag() if self.endtoken else ""
        return self.astag() + children + endtag

    def multiline(self, level):
        """
        Find the best layout without rewriting text or tag contents.
        """
        prefix = indent(level)
        text = self.oneline()
        if not self.endtoken or not self.children:
            return prefix + text + "\n"
        if "\n" not in text and len(prefix) + len(text) < 160:
            return prefix + text + "\n"
        children = []
        for child in self.children:
            if not isinstance(child, BodyToken):
                children.append(child)
            elif child.body.strip():
                return prefix + text + "\n"
        if not children:
            return prefix + text + "\n"

        newline = "\r\n" if "\r\n" in text else "\n"
        body = newline.join(child.multiline(level + 1)[:-1] for child in children)
        lines = (prefix + self.astag(), body, prefix + self.endtoken.astag())
        return newline.join(lines) + "\n"


@dataclass
class BodyToken:
    """
    represent anything else.
    """
    body : str

    def merge(self, elem):
        self.body += elem.body

    def oneline(self):
        return self.body

    def multiline(self, level):
        return self.body

@dataclass
class WordpressToken(TokenBase):
    """
    represents a wordpress tag.
    """
    isend : bool
    issingle : bool
    tag : str
    params : dict

    def __post_init__(self):
        super().__init__()

    def formatattrs(self):
        if self.params is None:
            return ""
        return " " + json.dumps(self.params)


    def asendtag(self):
        return f"<!-- /{self.tag} -->"

    def asstarttag(self):
        attrtxt = self.formatattrs()
        return f"<!-- {self.tag}{attrtxt} -->"

    def assingletag(self):
        attrtxt = self.formatattrs()
        return f"<!-- {self.tag}{attrtxt} /-->"


@dataclass
class UXBuilderToken(TokenBase):
    """
    represents a ux-builder tag.
    """
    isend : bool
    tag : str
    params : dict
    issingle  : bool = True

    def __post_init__(self):
        super().__init__()
        self.explicit_single = False
        notsingle = {
            'accordion-item', 'accordion', 'col', 'col_inner', 'featured_box', 'row',
            'row_inner', 'section', 'tab', 'tabgroup', 'ux_html', 'ux_image_box',
            'ux_slider', 'ux_text'
        }

        if self.tag in notsingle:
            self.issingle = False

    def formatattrs(self):
        return "".join(f" {k}=\"{escapevalue(v)}\"" for k, v in self.params.items())

    def asendtag(self):
        return f"[/{self.tag}]"

    def asstarttag(self):
        attrtxt = self.formatattrs()
        return f"[{self.tag}{attrtxt}]"

    def assingletag(self):
        attrtxt = self.formatattrs()
        return f"[{self.tag}{attrtxt} /]"


class Root:
    """
    The root of the parse tree
    """
    def __init__(self):
        self.tag = None
        self.children = []

    def addChild(self, elem):
        if self.children and isinstance(self.children[-1], BodyToken) and isinstance(elem, BodyToken):
            self.children[-1].merge(elem)
        else:
            self.children.append(elem)

    def printindented(self):
        for index, elem in enumerate(self.children):
            if isinstance(elem, BodyToken) or self.has_inline_body(index):
                sys.stdout.write(elem.oneline())
            else:
                sys.stdout.write(elem.multiline(0)[:-1])

    def has_inline_body(self, index):
        if index > 0:
            previous = self.children[index - 1]
            if isinstance(previous, BodyToken) and previous.body.rsplit("\n", 1)[-1].strip():
                return True
        if index + 1 < len(self.children):
            following = self.children[index + 1]
            if isinstance(following, BodyToken) and following.body.split("\n", 1)[0].strip():
                return True
        return False


def kv_decoder(text):
    """
    decodes a key=value attribute list into a dictionary.
    """
    attr = []
    paramregex = re.compile(r"""\s+([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))""")
    pos = 0
    while True:
        m = paramregex.search(text, pos)
        if not m:
            break
        if pos < m.start():
            print(f"WARNING: unexpected attributes: {text[pos:m.start()]!r}")
        attr.append((m[1], next(group for group in m.groups()[1:] if group is not None)))
        pos = m.end()
    if pos < len(text):
        print(f"WARNING: unexpected attributes: {text[pos:]!r}")
    return dict(attr)


QUOTED = r"""(?:"[^"]*"|'[^']*')"""
BLOCK_TAG = re.compile(r'<!--\s*(/)?(wp:[\w-]+(?:/[\w-]+)?)(?=\s|/|-->)(.*?)-->', re.DOTALL)
MARKUP = re.compile(
    rf"""<!--.*?(?:-->|\Z)|
        <(?P<verbatim>pre|code|script|style|textarea)(?=[\s/>])(?:{QUOTED}|[^>"'])*>.*?(?:</(?P=verbatim)\s*>|\Z)|
        </?[a-z][\w:-]*(?=[\s/>])(?:{QUOTED}|[^>"'])*>|
        (?<!\[)(?P<escaped>\[)?\[(/)?(?P<shortcode>[\w-]+)(?=[\s/\]])(?P<attrs>(?:{QUOTED}|[^\[\]"'])*)\]
    """,
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)


def wordpress_tag(source):
    match = BLOCK_TAG.fullmatch(source)
    if not match:
        return None

    isend = bool(match[1])
    attrs = match[3].strip()
    issingle = attrs.endswith('/')
    if issingle:
        attrs = attrs[:-1].rstrip()

    try:
        params = json.loads(attrs) if attrs else None
        if (attrs and not isinstance(params, dict)) or (isend and (attrs or issingle)):
            raise ValueError("invalid block attributes")
    except (ValueError, RecursionError) as error:
        print(f"WARNING: {match[2]}: {error}")
        return None
    return WordpressToken(isend, issingle, match[2], params)


def uxbuilder_tag(match):
    name = match['shortcode']
    attrs = match['attrs']
    isend = match[0].startswith('[/')
    issingle = attrs.rstrip().endswith('/')
    if issingle:
        attrs = attrs.rstrip()[:-1]
    if isend and (attrs.strip() or issingle):
        return None
    token = UXBuilderToken(isend, name, kv_decoder(attrs.rstrip()))
    if issingle:
        token.issingle = True
    token.explicit_single = issingle
    return token


def escaped_shortcode_end(text, match):
    end = match.end()
    if text.startswith(']', end):
        return end + 1

    name = re.escape(match['shortcode'])
    closer = re.compile(rf'\[/{name}\s*\]\]').search(text, end)
    return closer.end() if closer else end


def wordpress_tokenizer(text):
    """
    split wordpress text into tokens.
    """
    pos = 0
    body_start = 0
    while match := MARKUP.search(text, pos):
        pos = match.end()
        if match['escaped']:
            pos = escaped_shortcode_end(text, match)
            continue

        token = uxbuilder_tag(match) if match['shortcode'] else wordpress_tag(match[0])
        if token is None:
            continue
        if body_start < match.start():
            yield BodyToken(text[body_start:match.start()])
        token.source = match[0]
        yield token
        body_start = pos

    if body_start < len(text):
        yield BodyToken(text[body_start:])


def close_token(stack, token):
    for index in range(len(stack) - 1, 0, -1):
        opener = stack[index]
        if type(opener) is type(token) and opener.tag == token.tag:
            for child in stack[index + 1:]:
                print(f"WARNING: missing end tag for {child.tag} before closing {token.tag}")
            opener.endtoken = token
            del stack[index:]
            return
    print(f"WARNING: no start tag for {token.tag}")
    stack[-1].addChild(BodyToken(token.astag()))


def wpparser(text):
    """
    decodes wordpress text into a tree of tokens.
    """
    stack = [Root()]
    tokens = list(wordpress_tokenizer(text))
    # An explicit closing tag also identifies containers outside the UX Builder list.
    paired_shortcodes = {token.tag for token in tokens if isinstance(token, UXBuilderToken) and token.isend}
    for token in tokens:
        if isinstance(token, BodyToken):
            stack[-1].addChild(token)
        elif token.isend:
            close_token(stack, token)
        else:
            if isinstance(token, UXBuilderToken) and token.tag in paired_shortcodes and not token.explicit_single:
                token.issingle = False
            stack[-1].addChild(token)
            if not token.issingle:
                stack.append(token)
    for token in stack[1:]:
        print(f"WARNING: missing end tag for {token.tag} at end of input")

    return stack[0]


class ArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        print(f"ERROR: {message}")
        raise SystemExit(2)


def main():
    parser = ArgumentParser(description='wordpress indent tool')
    parser.parse_args()
    try:
        text = sys.stdin.buffer.read().decode('utf-8')
    except (OSError, UnicodeError) as error:
        print(f"ERROR: standard input: {error}")
        return 1
    tree = wpparser(text)
    tree.printindented()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())

